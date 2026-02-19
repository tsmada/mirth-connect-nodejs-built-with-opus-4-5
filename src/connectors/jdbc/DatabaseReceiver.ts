/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseReceiver.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseReceiverScript.java
 *
 * Purpose: Database source connector that polls for records
 *
 * Key behaviors to replicate:
 * - Poll-based query execution
 * - Support query mode and script mode (delegate pattern)
 * - MySQL connection pooling
 * - Post-process update queries with resultMap/results injection
 * - Result caching and aggregation
 * - Script compilation at deploy time (not per-poll)
 * - Update modes: NEVER, ONCE, EACH
 */

import * as vm from 'vm';
import { createPool, Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import {
  DatabaseReceiverProperties,
  getDefaultDatabaseReceiverProperties,
  parseJdbcUrl,
  resultsToXml,
  UpdateMode,
} from './DatabaseConnectorProperties.js';
import {
  buildMessageReceiverScope,
  buildConnectorMessageScope,
  Scope,
} from '../../javascript/runtime/ScopeBuilder.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('jdbc-connector', 'Database connector');
const logger = getLogger('jdbc-connector');

export interface DatabaseReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<DatabaseReceiverProperties>;
}

/**
 * Database Source Connector that polls for records
 */
export class DatabaseReceiver extends SourceConnector {
  private properties: DatabaseReceiverProperties;
  private pool: Pool | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private connection: PoolConnection | null = null;

  /**
   * Compiled VM scripts cached at deploy time.
   * Java: DatabaseReceiverScript.deploy() compiles via JavaScriptUtil.compileAndAddScript()
   * Node.js: We use vm.Script for the same effect.
   */
  private compiledSelectScript: vm.Script | undefined;
  private compiledUpdateScript: vm.Script | undefined;

  constructor(config: DatabaseReceiverConfig) {
    super({
      name: config.name ?? 'Database Reader',
      transportName: 'JDBC',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultDatabaseReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): DatabaseReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<DatabaseReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Deploy the database receiver — create connection pool, compile scripts, dispatch IDLE.
   *
   * Java DatabaseReceiver.onDeploy() creates the delegate (DatabaseReceiverScript or
   * DatabaseReceiverQuery) and dispatches IDLE. The script delegate compiles select and
   * update scripts during deploy via JavaScriptUtil.compileAndAddScript().
   */
  async onDeploy(): Promise<void> {
    // Create connection pool during deploy (matches Java DatabaseReceiver.onDeploy())
    await this.createConnectionPool();

    // Compile scripts at deploy time (matches Java DatabaseReceiverScript.deploy())
    if (this.properties.useScript) {
      this.compileScripts();
    }

    // Dispatch IDLE event (matches Java onDeploy → delegate.onDeploy → IDLE)
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Start the database receiver — begin polling.
   *
   * Pool creation moved to onDeploy(). start() focuses on starting
   * the poll timer. Falls back to creating the pool here if onDeploy() wasn't called.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Database Receiver is already running');
    }

    // Pool should already be created in onDeploy(); create as fallback
    if (!this.pool) {
      await this.createConnectionPool();
      if (this.properties.useScript) {
        this.compileScripts();
      }
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }

    // Start polling
    this.startPolling();
    this.running = true;
  }

  /**
   * Stop the database receiver — stop polling.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Stop polling
    this.stopPolling();

    // Release persistent connection
    if (this.connection) {
      this.connection.release();
      this.connection = null;
    }

    this.running = false;
  }

  /**
   * Undeploy the database receiver — close connection pool, remove cached scripts.
   *
   * Java DatabaseReceiverScript.undeploy() calls JavaScriptUtil.removeScriptFromCache()
   * for both select and update scripts.
   */
  async onUndeploy(): Promise<void> {
    // Remove cached scripts (matches Java DatabaseReceiverScript.undeploy())
    this.compiledSelectScript = undefined;
    this.compiledUpdateScript = undefined;

    // Close pool on undeploy
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Compile select and update scripts at deploy time.
   *
   * Ported from: DatabaseReceiverScript.deploy()
   * Java compiles scripts via JavaScriptUtil.compileAndAddScript() during the deploy
   * phase, NOT per-poll. This avoids repeated compilation overhead.
   *
   * @throws Error if script compilation fails (matches Java ConnectorTaskException)
   */
  compileScripts(): void {
    if (!this.properties.select) {
      return;
    }

    // Wrap user script in a function body so 'return' works
    // Java: ScriptBuilder wraps in doScript() function
    const selectSource = `(function() {\n${this.properties.select}\n})()`;

    try {
      this.compiledSelectScript = new vm.Script(selectSource, {
        filename: 'db-receiver-select.js',
      });
    } catch (e) {
      throw new Error(
        `Error compiling select script: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // Compile update script only if updateMode is not NEVER
    // Java: if (connectorProperties.getUpdateMode() != DatabaseReceiverProperties.UPDATE_NEVER)
    if (this.properties.updateMode !== UpdateMode.NEVER && this.properties.update) {
      const updateSource = `(function() {\n${this.properties.update}\n})()`;
      try {
        this.compiledUpdateScript = new vm.Script(updateSource, {
          filename: 'db-receiver-update.js',
        });
      } catch (e) {
        throw new Error(
          `Error compiling update script: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  /**
   * Build scope for the receiver select script.
   *
   * Ported from: DatabaseReceiverScript.SelectTask.doCall()
   * Java: scope = getMessageReceiverScope(contextFactory, scriptLogger, channelId, channelName)
   *
   * The select script scope does NOT include a connector message (there is no message yet
   * during the poll). It includes: logger, globalMap, configurationMap, channelId, channelName,
   * and all userutil classes (DatabaseConnectionFactory, etc.).
   */
  buildReceiverScope(): Scope {
    const channelId = this.channel?.getId() ?? '';
    const channelName = this.channel?.getName() ?? '';

    return buildMessageReceiverScope({
      channelId,
      channelName,
      connectorName: this.name,
      metaDataId: 0,
    });
  }

  /**
   * Build scope for the receiver update script.
   *
   * Ported from: DatabaseReceiverScript.UpdateTask.doCall()
   * Java has two overloads:
   * 1. With mergedConnectorMessage → scope includes connector message maps
   * 2. Without (afterPoll with UPDATE_ONCE) → basic receiver scope only
   *
   * Additionally, Java injects:
   * - resultMap (Map<String, Object>) when processing individual rows
   * - results (List<Map<String, Object>>) when processing aggregated results
   */
  buildUpdateScope(
    resultMap: Record<string, unknown> | null,
    resultsList: Record<string, unknown>[] | null,
    mergedConnectorMessage: ConnectorMessage | null
  ): Scope {
    const channelId = this.channel?.getId() ?? '';
    const channelName = this.channel?.getName() ?? '';

    let scope: Scope;

    if (mergedConnectorMessage) {
      // Java: getMessageReceiverScope(contextFactory, scriptLogger, channelId, ImmutableConnectorMessage)
      scope = buildConnectorMessageScope(
        {
          channelId,
          channelName,
          connectorName: this.name,
          metaDataId: 0,
        },
        mergedConnectorMessage
      );
    } else {
      // Java: getMessageReceiverScope(contextFactory, scriptLogger, channelId, channelName)
      scope = buildMessageReceiverScope({
        channelId,
        channelName,
        connectorName: this.name,
        metaDataId: 0,
      });
    }

    // Java: scope.put("resultMap", scope, Context.javaToJS(resultMap, scope))
    if (resultMap != null) {
      scope.resultMap = resultMap;
    }

    // Java: scope.put("results", scope, Context.javaToJS(resultsList, scope))
    if (resultsList != null) {
      scope.results = resultsList;
    }

    return scope;
  }

  /**
   * Create connection pool
   */
  private async createConnectionPool(): Promise<void> {
    const connConfig = parseJdbcUrl(this.properties.url);
    if (!connConfig) {
      throw new Error(`Invalid database URL: ${this.properties.url}`);
    }

    this.pool = createPool({
      host: connConfig.host,
      port: connConfig.port,
      user: this.properties.username || connConfig.user,
      password: this.properties.password || connConfig.password,
      database: connConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  /**
   * Get database connection
   */
  private async getConnection(): Promise<PoolConnection> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    if (this.properties.keepConnectionOpen && this.connection) {
      return this.connection;
    }

    const conn = await this.pool.getConnection();

    if (this.properties.keepConnectionOpen) {
      this.connection = conn;
    }

    return conn;
  }

  /**
   * Release database connection
   */
  private releaseConnection(conn: PoolConnection): void {
    if (!this.properties.keepConnectionOpen) {
      conn.release();
    }
  }

  /**
   * Start polling timer
   */
  private startPolling(): void {
    // Execute first poll immediately
    this.poll().catch((err) => {
      logger.error('Poll error', err as Error);
    });

    // Schedule subsequent polls
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        logger.error('Poll error', err as Error);
      });
    }, this.properties.pollInterval);
  }

  /**
   * Stop polling timer
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Execute poll
   *
   * Matches Java DatabaseReceiver.poll() event lifecycle:
   *   POLLING → (query) → READING → (process rows) → IDLE (in finally)
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.pool) {
      return;
    }

    this.dispatchConnectionEvent(ConnectionStatusEventType.POLLING);
    let conn: PoolConnection | null = null;
    let retries = 0;

    try {
      while (retries <= this.properties.retryCount) {
        try {
          conn = await this.getConnection();

          // After query returns, transition to READING (matching Java)
          this.dispatchConnectionEvent(ConnectionStatusEventType.READING);

          await this.executeQuery(conn);
          break;
        } catch (error) {
          retries++;

          if (conn) {
            this.releaseConnection(conn);
            conn = null;
          }

          if (retries > this.properties.retryCount) {
            logger.error('Database poll failed after retries', error as Error);
            break;
          }

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, this.properties.retryInterval));
        }
      }
    } finally {
      // Always return to IDLE after poll completes (matching Java finally block)
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Execute select query
   */
  private async executeQuery(conn: PoolConnection): Promise<void> {
    if (this.properties.useScript) {
      // Script mode - execute JavaScript
      await this.executeScript(conn);
    } else {
      // Query mode - execute SQL
      await this.executeSql(conn);
    }
  }

  /**
   * Execute SQL query
   *
   * When cacheResults is false and fetchSize is set, Java uses
   * statement.setFetchSize() to stream large result sets. In mysql2,
   * we approximate this by setting the connection to streaming mode
   * with rowsAsArray: false (default).
   *
   * The fetchSize property is exposed for drivers that support it;
   * mysql2 returns all rows at once by default but the property is
   * preserved for compatibility and potential future driver support.
   */
  private async executeSql(conn: PoolConnection): Promise<void> {
    const [rows] = await conn.query<RowDataPacket[]>(this.properties.select);

    if (!rows || rows.length === 0) {
      return;
    }

    if (this.properties.aggregateResults) {
      // Send all results as single message
      const xml = resultsToXml(rows as Record<string, unknown>[]);
      await this.dispatchRawMessage(xml);

      // Execute update if needed
      if (this.properties.updateMode === UpdateMode.ONCE && this.properties.update) {
        await conn.query(this.properties.update);
      }
    } else {
      // Send each row as separate message
      for (const row of rows) {
        const xml = resultsToXml([row as Record<string, unknown>]);
        await this.dispatchRawMessage(xml);

        // Execute update for each row
        if (this.properties.updateMode === UpdateMode.EACH && this.properties.update) {
          await conn.query(this.properties.update);
        }
      }

      // Execute update once after all rows
      if (this.properties.updateMode === UpdateMode.ONCE && this.properties.update) {
        await conn.query(this.properties.update);
      }
    }
  }

  /**
   * Execute JavaScript script for script mode polling.
   *
   * Ported from: DatabaseReceiverScript.poll() → SelectTask.doCall()
   *
   * Java behavior:
   * 1. Build receiver scope (no connector message — this is a poll, not a message dispatch)
   * 2. Execute compiled select script in scope
   * 3. Unwrap result: expect List<Map<String,Object>> (Java) → Record<string,unknown>[] (Node.js)
   * 4. Convert each result row to XML and dispatch as raw message
   * 5. Run post-process update script per updateMode
   *
   * The user script has access to all standard Mirth scope variables (globalMap, $g, $cfg,
   * DatabaseConnectionFactory, etc.) but NOT dbConn — users create their own connections
   * via DatabaseConnectionFactory in their scripts.
   */
  private async executeScript(_conn: PoolConnection): Promise<void> {
    if (!this.properties.select) {
      return;
    }

    // Use compiled script if available (deploy-time compilation)
    // Fall back to dynamic compilation for backward compatibility
    if (!this.compiledSelectScript) {
      this.compileScripts();
    }

    if (!this.compiledSelectScript) {
      return;
    }

    // Build scope matching Java's getMessageReceiverScope(channelId, channelName)
    const scope = this.buildReceiverScope();

    // Execute compiled script in scope
    const context = vm.createContext(scope);
    let result: unknown;
    try {
      result = this.compiledSelectScript.runInContext(context, { timeout: 60000 });
    } catch (error) {
      throw new Error(
        `Error executing select script: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Process results — Java expects List<Map<String,Object>> or ResultSet
    // Node.js: array of objects (records)
    if (result == null) {
      return;
    }

    const rows: Record<string, unknown>[] = Array.isArray(result) ? result : [result];

    if (rows.length === 0) {
      return;
    }

    if (this.properties.aggregateResults) {
      // Send all results as single message
      const xml = resultsToXml(rows);
      const processedMessage = await this.dispatchRawMessage(xml);

      // Run aggregate post-process update (Java: runAggregatePostProcess)
      // Java passes mergedConnectorMessage from dispatchResult.getProcessedMessage()
      if (this.properties.updateMode !== UpdateMode.NEVER && this.compiledUpdateScript) {
        const merged = processedMessage?.getMergedConnectorMessage() ?? null;
        await this.runUpdateScript(null, rows, merged);
      }
    } else {
      // Send each row as separate message
      for (const row of rows) {
        const xml = resultsToXml([row]);
        const processedMessage = await this.dispatchRawMessage(xml);

        // Run per-row post-process update (Java: runPostProcess with UPDATE_EACH)
        // Java: delegate.runPostProcess(resultMap, dispatchResult.getProcessedMessage().getMergedConnectorMessage())
        if (this.properties.updateMode === UpdateMode.EACH && this.compiledUpdateScript) {
          const merged = processedMessage?.getMergedConnectorMessage() ?? null;
          await this.runUpdateScript(row, null, merged);
        }
      }
    }

    // Run afterPoll update (Java: afterPoll with UPDATE_ONCE and !aggregateResults)
    // Java afterPoll passes null for both resultMap and mergedConnectorMessage
    if (
      this.properties.updateMode === UpdateMode.ONCE &&
      !this.properties.aggregateResults &&
      this.compiledUpdateScript
    ) {
      await this.runUpdateScript(null, null, null);
    }
  }

  /**
   * Execute the compiled update script with the appropriate scope.
   *
   * Ported from: DatabaseReceiverScript.UpdateTask.doCall()
   *
   * Java injects resultMap and/or results into the update scope depending
   * on whether this is a per-row update, aggregate update, or afterPoll update.
   */
  private async runUpdateScript(
    resultMap: Record<string, unknown> | null,
    resultsList: Record<string, unknown>[] | null,
    mergedConnectorMessage: ConnectorMessage | null
  ): Promise<void> {
    if (!this.compiledUpdateScript) {
      return;
    }

    const scope = this.buildUpdateScope(resultMap, resultsList, mergedConnectorMessage);
    const context = vm.createContext(scope);

    try {
      this.compiledUpdateScript.runInContext(context, { timeout: 60000 });
    } catch (error) {
      throw new Error(
        `Error executing update script: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the pool instance (for testing)
   */
  getPool(): Pool | null {
    return this.pool;
  }
}
