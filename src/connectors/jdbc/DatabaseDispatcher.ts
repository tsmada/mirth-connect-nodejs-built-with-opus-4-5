/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseDispatcher.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseDispatcherScript.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/JdbcUtils.java
 *
 * Purpose: Database destination connector that executes INSERT/UPDATE queries
 *
 * Key behaviors to replicate:
 * - Execute SQL queries with parameters (query mode)
 * - Execute JavaScript scripts with Mirth scope (script mode)
 * - MySQL connection pooling
 * - Parameter extraction: ${variable} → ? placeholders (JdbcUtils.extractParameters)
 * - Script result handling: Response, Status, string, or void
 * - QUEUED status on script error for retry
 * - Script compilation at deploy time
 */

import * as vm from 'vm';
import { createPool, Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { Response } from '../../model/Response.js';
import {
  DatabaseDispatcherProperties,
  getDefaultDatabaseDispatcherProperties,
  parseJdbcUrl,
} from './DatabaseConnectorProperties.js';
import {
  buildMessageDispatcherScope,
  Scope,
} from '../../javascript/runtime/ScopeBuilder.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';

export interface DatabaseDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<DatabaseDispatcherProperties>;
}

/**
 * Database Destination Connector that executes INSERT/UPDATE queries
 */
export class DatabaseDispatcher extends DestinationConnector {
  private properties: DatabaseDispatcherProperties;
  private pool: Pool | null = null;

  /**
   * Compiled VM script cached at deploy time.
   * Java: DatabaseDispatcherScript.deploy() compiles via JavaScriptUtil.compileAndAddScript()
   */
  private compiledScript: vm.Script | undefined;

  constructor(config: DatabaseDispatcherConfig) {
    super({
      name: config.name ?? 'Database Writer',
      metaDataId: config.metaDataId,
      transportName: 'JDBC',
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultDatabaseDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): DatabaseDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<DatabaseDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the database dispatcher
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // Create connection pool
    await this.createConnectionPool();

    // Compile script at deploy time if useScript is enabled
    // Matches Java: DatabaseDispatcher.onDeploy() → delegate = new DatabaseDispatcherScript() → deploy()
    if (this.properties.useScript) {
      this.compileScripts();
    }

    // Dispatch IDLE on deploy — matches Java's onDeploy()
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

    this.running = true;
  }

  /**
   * Stop the database dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Remove cached script (matches Java DatabaseDispatcherScript.undeploy())
    this.compiledScript = undefined;

    // Close pool
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }

    this.running = false;
  }

  /**
   * Compile the dispatcher script at deploy time.
   *
   * Ported from: DatabaseDispatcherScript.deploy()
   * Java compiles the query script via JavaScriptUtil.compileAndAddScript()
   * during deploy, not per-send.
   *
   * @throws Error if script compilation fails
   */
  compileScripts(): void {
    if (!this.properties.useScript || !this.properties.query) {
      return;
    }

    // Wrap user script in a function body so 'return' works
    const source = `(function() {\n${this.properties.query}\n})()`;

    try {
      this.compiledScript = new vm.Script(source, {
        filename: 'db-dispatcher-script.js',
      });
    } catch (e) {
      throw new Error(
        `Error compiling script: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /**
   * Build scope for the dispatcher script.
   *
   * Ported from: DatabaseDispatcherScript.DatabaseDispatcherTask.doCall()
   * Java: scope = getMessageDispatcherScope(contextFactory, scriptLogger, channelId,
   *               new ImmutableConnectorMessage(connectorMessage, true, destinationIdMap))
   *
   * Includes: all Mirth maps, logger, Status values, connector message context,
   * DatabaseConnectionFactory, Response class, etc.
   */
  buildDispatcherScope(connectorMessage: ConnectorMessage): Scope {
    const channelId = this.channel?.getId() ?? '';
    const channelName = this.channel?.getName() ?? '';

    return buildMessageDispatcherScope(
      {
        channelId,
        channelName,
        connectorName: this.name,
        metaDataId: this.getMetaDataId(),
      },
      connectorMessage
    );
  }

  /**
   * Execute the dispatcher script and return a Response.
   *
   * Ported from: DatabaseDispatcherScript.DatabaseDispatcherTask.doCall()
   *
   * Java result handling:
   * 1. If result is a Response → return as-is
   * 2. If result is a Status → return Response with that status
   * 3. If result is any other value → return Response(SENT, value.toString())
   * 4. If result is null/undefined → return Response(SENT, null, "Database write success")
   * 5. On error → return Response(QUEUED, null, errorMessage, errorDetail)
   */
  executeScriptMode(connectorMessage: ConnectorMessage): Response {
    if (!this.compiledScript) {
      throw new Error('Script not compiled — call compileScripts() first');
    }

    let responseData: string | null = null;
    let responseError: string | null = null;
    let responseStatusMessage = 'Database write success';
    let responseStatus = Status.SENT;

    try {
      const scope = this.buildDispatcherScope(connectorMessage);
      const context = vm.createContext(scope);

      const result = this.compiledScript.runInContext(context, { timeout: 60000 });

      if (result != null) {
        // Duck-type check for Response — vm.createContext creates a separate realm,
        // so instanceof fails even though the class reference is the same.
        // Check for getStatus/getMessage methods (Response API) instead.
        if (
          typeof result === 'object' &&
          typeof (result as any).getStatus === 'function' &&
          typeof (result as any).getMessage === 'function'
        ) {
          // Java: if result is Response → return as-is
          // Wrap in a new Response to ensure it's from our realm
          const r = result as Response;
          return new Response(r.getStatus(), r.getMessage(), r.getStatusMessage?.() ?? '', r.getError?.() ?? '');
        } else if (typeof result === 'string' && Object.values(Status).includes(result as Status)) {
          // Java: if result is a Status enum → update status only
          responseStatus = result as Status;
        } else {
          // Java: any other value → string representation as response data
          responseData = String(result);
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      responseStatusMessage = `Error evaluating ${this.properties.query ? 'Database Writer' : this.name}: ${errorMsg}`;
      responseError = errorMsg;
      responseStatus = Status.QUEUED;
    }

    return new Response({
      status: responseStatus,
      message: responseData ?? undefined,
      statusMessage: responseStatusMessage,
      error: responseError ?? undefined,
    });
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
   * Resolve ${variable} placeholders in connector properties before each send.
   * Matches Java DatabaseDispatcher.replaceConnectorProperties() (line 78):
   * Resolves url, username, password.
   * Returns a shallow clone — original properties are NOT modified.
   */
  replaceConnectorProperties(
    props: DatabaseDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): DatabaseDispatcherProperties {
    const resolved = { ...props };

    resolved.url = this.resolveVariables(resolved.url, connectorMessage);
    resolved.username = this.resolveVariables(resolved.username, connectorMessage);
    resolved.password = this.resolveVariables(resolved.password, connectorMessage);

    // Parameter extraction for SQL query mode (not script mode)
    // Java: JdbcUtils.extractParameters() + JdbcUtils.getParameters()
    if (!resolved.useScript && resolved.query) {
      const extracted = DatabaseDispatcher.extractParameters(resolved.query);
      resolved.query = extracted.query;
      resolved.parameters = DatabaseDispatcher.resolveParameters(
        extracted.paramNames,
        connectorMessage
      );
    }

    return resolved;
  }

  /**
   * Extract ${variable} placeholders from a SQL statement and replace with ? markers.
   *
   * Ported from: JdbcUtils.extractParameters()
   * Java: Pattern.compile("\\$\\{([^\\}]*)\\}") → replace with "?"
   *
   * @returns Object with modified query and list of parameter names (including ${} wrapper)
   */
  static extractParameters(statement: string): { query: string; paramNames: string[] } {
    if (!statement) {
      return { query: statement || '', paramNames: [] };
    }

    const paramNames: string[] = [];
    const query = statement.replace(/\$\{([^}]*)\}/g, (match) => {
      paramNames.push(match); // Push the full ${name} token
      return '?';
    });

    return { query, paramNames };
  }

  /**
   * Resolve parameter values from connector message maps.
   *
   * Ported from: JdbcUtils.getParameters()
   * Java: strips ${ and } from each param name, looks up in map then connector message.
   *
   * Lookup order (matching Java TemplateValueReplacer):
   * 1. channelMap
   * 2. sourceMap
   * 3. connectorMap
   * 4. message.encodedData / message.rawData (built-in variables)
   */
  static resolveParameters(
    paramNames: string[],
    connectorMessage: ConnectorMessage
  ): unknown[] {
    return paramNames.map((paramName) => {
      // Strip ${...} wrapper to get the key (Java: substring(2, length-1))
      const key = paramName.substring(2, paramName.length - 1);

      // Built-in message variables
      if (key === 'message.encodedData') {
        const encoded = connectorMessage.getEncodedContent();
        return encoded?.content ?? connectorMessage.getRawData() ?? '';
      }
      if (key === 'message.rawData') {
        return connectorMessage.getRawData() ?? '';
      }

      // Check channel map
      const channelMap = connectorMessage.getChannelMap?.();
      if (channelMap) {
        const v = channelMap.get(key);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check source map
      const sourceMap = connectorMessage.getSourceMap?.();
      if (sourceMap) {
        const v = sourceMap.get(key);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check connector map
      const connectorMap = connectorMessage.getConnectorMap?.();
      if (connectorMap) {
        const v = connectorMap.get(key);
        if (v !== undefined && v !== null) return String(v);
      }

      // Return the original ${...} token if unresolved
      return paramName;
    });
  }

  /**
   * Simple ${variable} resolution using connector message maps.
   * Checks channelMap, then sourceMap, then connectorMap.
   * Matches Java ValueReplacer.replaceValues() map lookup order.
   */
  private resolveVariables(template: string, connectorMessage: ConnectorMessage): string {
    if (!template || !template.includes('${')) return template;

    return template.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      // Built-in message variables (matches Java ValueReplacer)
      if (varName === 'message.encodedData') {
        const encoded = connectorMessage.getEncodedContent();
        if (encoded?.content) return encoded.content;
        return connectorMessage.getRawData() ?? match;
      }
      if (varName === 'message.rawData') {
        return connectorMessage.getRawData() ?? match;
      }

      // Check channel map
      const channelMap = connectorMessage.getChannelMap?.();
      if (channelMap) {
        const v = channelMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check source map
      const sourceMap = connectorMessage.getSourceMap?.();
      if (sourceMap) {
        const v = sourceMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check connector map
      const connectorMap = connectorMessage.getConnectorMap?.();
      if (connectorMap) {
        const v = connectorMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      return match; // Leave unresolved variables as-is
    });
  }

  /**
   * Send message to database
   *
   * Matches Java DatabaseDispatcher.send() event lifecycle:
   *   READING (with URL info) → execute → IDLE (in finally)
   *
   * When useScript=true, delegates to script mode execution.
   * When useScript=false, executes SQL query with parameter extraction.
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.pool && !this.properties.useScript) {
      throw new Error('Connection pool not initialized');
    }

    // Resolve ${variable} placeholders before each send
    const resolvedProps = this.replaceConnectorProperties(this.properties, connectorMessage);

    const info = `URL: ${resolvedProps.url}`;
    this.dispatchConnectionEvent(ConnectionStatusEventType.READING, info);

    try {
      if (resolvedProps.useScript) {
        // Script mode — delegate to JavaScript execution
        const response = this.executeScriptMode(connectorMessage);

        connectorMessage.setSendDate(new Date());
        connectorMessage.setStatus(response.getStatus());
        connectorMessage.setContent({
          contentType: ContentType.RESPONSE,
          content: response.getMessage() ?? response.getStatusMessage() ?? '',
          dataType: 'XML',
          encrypted: false,
        });

        if (response.getError()) {
          connectorMessage.setProcessingError(response.getError()!);
        }
      } else {
        // SQL query mode — execute parameterized query
        await this.executeSqlMode(connectorMessage, resolvedProps);
      }
    } finally {
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Execute SQL query mode (non-script)
   */
  private async executeSqlMode(
    connectorMessage: ConnectorMessage,
    resolvedProps: DatabaseDispatcherProperties
  ): Promise<void> {
    let conn: PoolConnection | null = null;

    try {
      conn = await this.pool!.getConnection();

      const query = resolvedProps.query;
      const params = resolvedProps.parameters || [];

      // Execute query
      const [result] = await conn.execute<ResultSetHeader>(query, params);

      // Set send date
      connectorMessage.setSendDate(new Date());

      // Set response with affected rows
      const response = this.buildResponse(result);
      connectorMessage.setContent({
        contentType: ContentType.RESPONSE,
        content: response,
        dataType: 'XML',
        encrypted: false,
      });

      // Update status
      connectorMessage.setStatus(Status.SENT);

      // Store result in connector map
      connectorMessage.getConnectorMap().set('affectedRows', result.affectedRows);
      connectorMessage.getConnectorMap().set('insertId', result.insertId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.isQueueEnabled()) {
        connectorMessage.setStatus(Status.QUEUED);
        connectorMessage.setProcessingError(errorMessage);
        connectorMessage.setContent({
          contentType: ContentType.RESPONSE,
          content: this.buildErrorResponse('Error writing to database.', errorMessage),
          dataType: 'XML',
          encrypted: false,
        });
      } else {
        connectorMessage.setStatus(Status.ERROR);
        connectorMessage.setProcessingError(errorMessage);
        throw error;
      }
    } finally {
      if (conn) {
        conn.release();
      }
    }
  }

  /**
   * Build an error response XML matching Java's ErrorMessageBuilder format
   */
  private buildErrorResponse(summary: string, detail: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <error>${this.escapeXml(summary)} ${this.escapeXml(detail)}</error>
</response>`;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Build response XML from query result
   */
  private buildResponse(result: ResultSetHeader): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <affectedRows>${result.affectedRows}</affectedRows>
  <insertId>${result.insertId || ''}</insertId>
  <warningStatus>${result.warningStatus || 0}</warningStatus>
</result>`;
  }

  /**
   * Get response from the last request
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }

  /**
   * Get the pool instance (for testing)
   */
  getPool(): Pool | null {
    return this.pool;
  }
}
