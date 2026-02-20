/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/Mirth.java
 *
 * Purpose: Main server lifecycle management
 *
 * Key behaviors to replicate:
 * - Initialize database connection
 * - Start Donkey engine
 * - Start REST API server
 * - Handle graceful shutdown
 */

import { Donkey } from '../donkey/Donkey.js';
import { startServer } from '../api/server.js';
import { initPool, closePool } from '../db/pool.js';
import { initEncryptorFromEnv } from '../db/Encryptor.js';
import { ChannelController } from '../controllers/ChannelController.js';
import { EngineController, setDonkeyInstance } from '../controllers/EngineController.js';
import type { Server } from 'http';
import {
  setEngineController as setVmRouterEngineController,
  setChannelController as setVmRouterChannelController,
} from '../javascript/userutil/VMRouter.js';
import { Response } from '../model/Response.js';
import { dashboardStatusController } from '../plugins/dashboardstatus/DashboardStatusController.js';
import { dataPrunerController } from '../plugins/datapruner/DataPrunerController.js';
import { ConfigurationController } from '../controllers/ConfigurationController.js';
import {
  registerServer,
  startHeartbeat,
  stopHeartbeat,
  deregisterServer,
} from '../cluster/ServerRegistry.js';
import { setShuttingDown, setStartupComplete } from '../cluster/HealthCheck.js';
import { getClusterConfig } from '../cluster/ClusterConfig.js';
import { setShadowMode, isShadowMode } from '../cluster/ShadowMode.js';
import {
  initializeLogging,
  shutdownLogging,
  getLogger,
  registerComponent,
} from '../logging/index.js';
import { serverLogController } from '../plugins/serverlog/ServerLogController.js';
import { DatabaseMapBackend } from '../cluster/MapBackend.js';
import {
  GlobalMap,
  GlobalChannelMapStore,
  ConfigurationMap,
} from '../javascript/userutil/MirthMap.js';

registerComponent('server', 'Server lifecycle');
const logger = getLogger('server');

// Global Donkey instance for EngineController to access
let donkeyInstance: Donkey | null = null;

/**
 * Get the global Donkey engine instance
 * Used by EngineController to register channels with the engine
 */
export function getDonkeyInstance(): Donkey | null {
  return donkeyInstance;
}

// Global Mirth instance for cross-cutting concerns (e.g., shadow cutover)
let mirthInstance: Mirth | null = null;

/**
 * Get the global Mirth server instance.
 * Used by ShadowServlet to call completeShadowCutover() after full promote.
 */
export function getMirthInstance(): Mirth | null {
  return mirthInstance;
}

// Synchronous channel cache — shared module used by ChannelUtil adapters and ChannelServlet
import {
  refreshChannelCache,
  getChannelNames as getCachedChannelNames,
  getChannelIds as getCachedChannelIds,
  getChannelById as getCachedChannelById,
  getChannelByName as getCachedChannelByName,
} from '../controllers/ChannelCache.js';

export type OperationalMode = 'takeover' | 'standalone' | 'auto';

export interface MirthConfig {
  httpPort: number;
  httpsPort: number;
  mode?: OperationalMode;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

const DEFAULT_CONFIG: MirthConfig = {
  httpPort: parseInt(process.env['PORT'] ?? '8080', 10),
  httpsPort: parseInt(process.env['HTTPS_PORT'] ?? '8443', 10),
  mode: (process.env['MIRTH_MODE'] as OperationalMode) ?? 'auto',
  database: {
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
    database: process.env['DB_NAME'] ?? 'mirthdb',
    user: process.env['DB_USER'] ?? 'mirth',
    password: process.env['DB_PASSWORD'] ?? 'mirth',
  },
};

export class Mirth {
  private config: MirthConfig;
  private donkey: Donkey | null = null;
  private server: Server | null = null;
  private running = false;
  private detectedMode: 'takeover' | 'standalone' = 'standalone';

  constructor(config: Partial<MirthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Mirth is already running');
    }

    // Initialize logging as the FIRST thing
    initializeLogging(serverLogController);

    logger.info('Starting Mirth Connect Node.js Runtime...');

    // Validate required environment before attempting DB connection
    if (process.env['NODE_ENV'] === 'production') {
      const missing: string[] = [];
      if (!process.env['DB_HOST']) missing.push('DB_HOST');
      if (!process.env['DB_NAME']) missing.push('DB_NAME');
      if (!process.env['DB_USER']) missing.push('DB_USER');
      if (missing.length > 0) {
        throw new Error(
          `Missing required environment variables for production: ${missing.join(', ')}. ` +
            'Set these before starting, or unset NODE_ENV=production to use defaults.'
        );
      }
    }

    // Initialize database connection pool
    logger.info('Connecting to database...');
    initPool(this.config.database);
    logger.info(
      `Connected to database at ${this.config.database.host}:${this.config.database.port}`
    );

    // Initialize content encryptor from environment (MIRTH_ENCRYPTION_KEY)
    initEncryptorFromEnv();

    // Warn about default credentials
    if (this.config.database.user === 'mirth' && this.config.database.password === 'mirth') {
      logger.warn(
        'SECURITY: Using default database credentials (mirth/mirth). Change DB_USER and DB_PASSWORD for production.'
      );
    }

    // Block default database credentials in production unless explicitly opted in
    const isDefaultUser = this.config.database.user === 'mirth' && !process.env['DB_USER'];
    const isDefaultPass = this.config.database.password === 'mirth' && !process.env['DB_PASSWORD'];
    if ((isDefaultUser || isDefaultPass) && process.env.NODE_ENV === 'production') {
      if (process.env['MIRTH_ALLOW_DEFAULT_CREDENTIALS'] !== 'true') {
        throw new Error(
          'Default database credentials are not allowed in production. ' +
            'Set DB_USER/DB_PASSWORD environment variables, or set MIRTH_ALLOW_DEFAULT_CREDENTIALS=true to override.'
        );
      }
      logger.warn(
        'Using default database credentials in production (MIRTH_ALLOW_DEFAULT_CREDENTIALS=true)'
      );
    }

    // Initialize schema based on operational mode
    const { detectMode, verifySchema, ensureCoreTables, ensureNodeJsTables, seedDefaults } =
      await import('../db/SchemaManager.js');

    this.detectedMode = await detectMode();
    logger.info(`Operational mode: ${this.detectedMode}`);

    // Check for shadow mode
    const shadowEnabled = process.env['MIRTH_SHADOW_MODE'] === 'true';
    if (shadowEnabled) {
      setShadowMode(true);
      logger.warn('SHADOW MODE ACTIVE: Read-only observer -- no message processing');
      logger.info('Use mirth-cli shadow promote <channel> to activate channels');
    }

    if (this.detectedMode === 'standalone') {
      logger.info('Standalone mode: ensuring core tables exist...');
      await ensureCoreTables();
      await seedDefaults();
      logger.warn(
        'SECURITY: Default admin/admin credentials seeded. Change the admin password before production use.'
      );
      logger.info('Core schema initialized');
    } else {
      // Takeover mode - verify existing schema
      const result = await verifySchema();
      if (!result.compatible) {
        throw new Error(`Schema incompatible: ${result.errors.join(', ')}`);
      }
      logger.info(`Takeover mode: schema verified (version ${result.version})`);
      // Create Node.js-only tables (safe in shared DB — Java Mirth ignores unknown tables)
      await ensureNodeJsTables();
    }

    // Initialize dashboard status controller with server ID
    const serverId = await ConfigurationController.getServerId();
    dashboardStatusController.setServerId(serverId);

    // Initialize Donkey engine
    this.donkey = new Donkey();
    donkeyInstance = this.donkey; // Expose globally (legacy — prefer setDonkeyInstance)
    setDonkeyInstance(this.donkey); // Setter injection — breaks circular import
    await this.donkey.start();

    // Start REST API server
    this.server = await startServer({ port: this.config.httpPort });

    // Register this server in D_SERVERS and start heartbeat
    await registerServer(this.config.httpPort, isShadowMode() ? 'SHADOW' : undefined);
    const clusterConfig = getClusterConfig();
    if (clusterConfig.clusterEnabled) {
      if (!clusterConfig.redisUrl && process.env['NODE_ENV'] === 'production') {
        throw new Error(
          'MIRTH_CLUSTER_ENABLED=true requires MIRTH_CLUSTER_REDIS_URL in production. ' +
            'Set MIRTH_CLUSTER_REDIS_URL to a Redis instance for shared state, or unset NODE_ENV=production to use in-memory storage.'
        );
      }
      startHeartbeat();
      if (!clusterConfig.redisUrl) {
        logger.warn(
          'Cluster mode active but MIRTH_CLUSTER_REDIS_URL not set. GlobalMap will use volatile in-memory storage. Set MIRTH_CLUSTER_REDIS_URL for persistent shared state.'
        );
      }
      logger.warn(
        'Cluster mode: session store is in-memory. Sessions will not be shared across instances. Consider a shared session store for production.'
      );
    }

    // Wire GlobalMap and GlobalChannelMap to database backend for persistent $g/$gc
    // This benefits both single-instance (survives restarts) and cluster (shared state)
    GlobalMap.setBackend(new DatabaseMapBackend('global'));
    GlobalChannelMapStore.setBackendFactory(
      (channelId) => new DatabaseMapBackend('gcm:' + channelId)
    );
    await GlobalMap.getInstance().loadFromBackend();
    logger.info('GlobalMap database backend initialized');

    // Load ConfigurationMap ($cfg) from database
    // Java Mirth stores ConfigurationProperty objects but exposes only the .value strings
    try {
      const configProps = await ConfigurationController.getConfigurationMap();
      const valueMap: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(configProps)) {
        valueMap[key] = prop.value;
      }
      ConfigurationMap.getInstance().load(valueMap);
      logger.info(`ConfigurationMap loaded (${Object.keys(configProps).length} entries)`);
    } catch (err) {
      logger.warn(`Failed to load ConfigurationMap: ${String(err)}`);
    }

    // Load channels from database and deploy them
    await this.loadAndDeployChannels();

    // Wire ChannelUtil singletons for user scripts (ChannelUtil.startChannel(), etc.)
    await this.initializeChannelUtil();

    // Register OTEL observable gauges (channels deployed/started, DB pool stats)
    try {
      const { registerObservableGauges } = await import('../telemetry/metrics.js');
      const { getPool } = await import('../db/pool.js');
      registerObservableGauges({
        getDeployedChannelCount: () => EngineController.getDeployedChannelIds().size,
        getStartedChannelCount: () => {
          let count = 0;
          for (const id of EngineController.getDeployedChannelIds()) {
            const ch = EngineController.getDeployedChannel(id);
            if (ch && ch.getCurrentState() === 'STARTED') count++;
          }
          return count;
        },
        getDbPoolActive: () => {
          try {
            const p = getPool();
            return (
              (p as { pool?: { _allConnections?: { length: number } } }).pool?._allConnections
                ?.length ?? 0
            );
          } catch {
            return 0;
          }
        },
        getDbPoolIdle: () => {
          try {
            const p = getPool();
            return (
              (p as { pool?: { _freeConnections?: { length: number } } }).pool?._freeConnections
                ?.length ?? 0
            );
          } catch {
            return 0;
          }
        },
      });
    } catch {
      // Telemetry module not available — ok (no-otel mode)
    }

    // Mark startup complete (health probe: /api/health/startup)
    setStartupComplete(true);

    if (!isShadowMode()) {
      // Initialize VMRouter singletons for user scripts (router.routeMessage())
      this.initializeVMRouter();

      // Initialize data pruner (scheduled background cleanup)
      await dataPrunerController.initialize();
    } else {
      logger.info('Shadow mode: VMRouter and DataPruner initialization deferred until cutover');
    }

    // Initialize Secrets Manager (if configured)
    const secretsProviders = process.env['MIRTH_SECRETS_PROVIDERS'];
    if (secretsProviders) {
      const { SecretsManager } = await import('../secrets/SecretsManager.js');
      await SecretsManager.initialize();
      logger.info(`Secrets providers initialized: ${secretsProviders}`);

      // Wire secrets as ConfigurationMap fallback
      const { createConfigMapFallback } =
        await import('../secrets/integration/ConfigMapBackend.js');
      const { ConfigurationMap } = await import('../javascript/userutil/MirthMap.js');
      ConfigurationMap.getInstance().setFallback(createConfigMapFallback());

      // Wire $secrets into script scope
      const { createSecretsFunction } = await import('../secrets/integration/ScriptSecretsMap.js');
      const { setSecretsFunction } = await import('../javascript/runtime/ScopeBuilder.js');
      setSecretsFunction(createSecretsFunction());
    }

    mirthInstance = this;
    this.running = true;
    logger.info(`Mirth Connect started on port ${this.config.httpPort} (HTTP)`);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping Mirth Connect...');

    // Signal health checks to return 503
    setShuttingDown(true);

    // Stop data pruner before stopping channels
    await dataPrunerController.shutdown();

    // Stop heartbeat
    stopHeartbeat();

    // Stop all running channels
    if (this.donkey) {
      const channels = this.donkey.getChannels();
      for (const channel of channels) {
        try {
          if (channel.getState() !== 'STOPPED') {
            logger.info(`Stopping channel: ${channel.getName()}`);
            await channel.stop();
          }
        } catch (error) {
          logger.error(`Error stopping channel ${channel.getName()}`, error as Error);
        }
      }
    }

    // Stop REST API server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    if (this.donkey) {
      await this.donkey.stop();
      this.donkey = null;
    }

    // Mark server as offline in D_SERVERS
    try {
      await deregisterServer();
    } catch {
      // DB pool may already be closed; best-effort
    }

    // Shutdown secrets manager
    try {
      const { SecretsManager } = await import('../secrets/SecretsManager.js');
      const mgr = SecretsManager.getInstance();
      if (mgr) await mgr.shutdown();
    } catch {
      /* module not loaded */
    }

    // Flush OTEL spans/metrics before closing DB pool
    try {
      const { shutdown: otelShutdown } = await import('../instrumentation.js');
      await otelShutdown();
    } catch {
      // OTEL not loaded (start:no-otel mode) — ok
    }

    // Close database connection pool
    await closePool();

    mirthInstance = null;
    this.running = false;
    setStartupComplete(false);
    await shutdownLogging();
    logger.info('Mirth Connect stopped');
  }

  /**
   * Install SIGTERM/SIGINT handlers for graceful shutdown.
   * Call this after start() to enable signal-based shutdown.
   */
  installSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      try {
        await this.stop();
      } catch (err) {
        logger.error('Error during graceful shutdown', err as Error);
      }
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): MirthConfig {
    return { ...this.config };
  }

  getMode(): OperationalMode {
    return this.config.mode ?? 'auto';
  }

  getDetectedMode(): 'takeover' | 'standalone' {
    return this.detectedMode;
  }

  getDonkey(): Donkey | null {
    return this.donkey;
  }

  /**
   * Initialize VMRouter singletons for user scripts.
   * Public to allow deferred initialization after shadow mode cutover.
   */
  initializeVMRouter(): void {
    setVmRouterEngineController({
      dispatchRawMessage: async (channelId, rawMessageObj, _force, _storeRawResponse) => {
        const channel = EngineController.getDeployedChannel(channelId);
        if (!channel) throw new Error(`Channel not deployed: ${channelId}`);
        const message = await channel.dispatchRawMessage(
          rawMessageObj.rawData,
          rawMessageObj.sourceMap
        );
        let selectedResponse: Response | undefined;
        for (const [metaDataId, cm] of message.getConnectorMessages()) {
          if (metaDataId > 0) {
            const responseContent = cm.getResponseContent();
            if (responseContent?.content) {
              selectedResponse = new Response({
                status: cm.getStatus(),
                message: responseContent.content,
              });
              break;
            }
          }
        }
        return { selectedResponse };
      },
    });
    setVmRouterChannelController({
      getDeployedChannelByName: (name) => EngineController.getDeployedChannelByName(name),
    });
    logger.info('VMRouter singletons initialized');
  }

  /**
   * Complete shadow mode cutover: initialize deferred services.
   * Called when all channels are promoted via the shadow API.
   */
  async completeShadowCutover(): Promise<void> {
    this.initializeVMRouter();
    await dataPrunerController.initialize();
    logger.info('Shadow mode cutover complete: VMRouter and DataPruner initialized');
  }

  /**
   * Initialize ChannelUtil singletons so user scripts can call
   * ChannelUtil.getChannelNames(), ChannelUtil.startChannel(), etc.
   */
  private async initializeChannelUtil(): Promise<void> {
    try {
      const { setChannelUtilChannelController, setChannelUtilEngineController } =
        await import('../javascript/userutil/ChannelUtil.js');
      const { EngineController: EC } = await import('../controllers/EngineController.js');
      const { Status } = await import('../model/Status.js');
      const { DeployedState: UserDeployedState } =
        await import('../javascript/userutil/DeployedState.js');

      // --- ErrorTaskHandler helper ---
      type IErrorTaskHandler = { isErrored(): boolean; getError(): Error | null };
      function noError(): IErrorTaskHandler {
        return { isErrored: () => false, getError: () => null };
      }
      function withError(err: unknown): IErrorTaskHandler {
        return {
          isErrored: () => true,
          getError: () => (err instanceof Error ? err : new Error(String(err))),
        };
      }

      // --- Channel controller adapter ---
      setChannelUtilChannelController({
        getChannelNames(): string[] {
          // Synchronous — backed by shared ChannelCache; caller is inside a VM script.
          return getCachedChannelNames();
        },
        getChannelIds(): string[] {
          return getCachedChannelIds();
        },
        getChannelById(channelId: string) {
          return getCachedChannelById(channelId);
        },
        getChannelByName(channelName: string) {
          return getCachedChannelByName(channelName);
        },
        getDeployedChannels(_channelIds: string[] | null) {
          const ids = EC.getDeployedChannelIds();
          const result: { id: string; name: string }[] = [];
          for (const id of ids) {
            const ch = getCachedChannelById(id);
            if (ch) result.push(ch);
          }
          return result;
        },
        getDeployedChannelById(channelId: string) {
          if (!EC.isDeployed(channelId)) return null;
          return getCachedChannelById(channelId);
        },
        getDeployedChannelByName(channelName: string) {
          const lookup = EC.getDeployedChannelByName(channelName);
          return lookup ?? null;
        },
        async resetStatistics(
          _channelMap: Map<string, (number | null)[]>,
          _statusesToReset: Set<(typeof Status)[keyof typeof Status]>
        ) {
          // Stub — statistics reset through ChannelStatisticsServlet is the primary path
        },
      });

      // --- Engine controller adapter ---
      setChannelUtilEngineController({
        getDeployedIds(): Set<string> {
          return EC.getDeployedChannelIds();
        },
        getDeployedChannel(channelId: string) {
          const ch = EC.getDeployedChannel(channelId);
          if (!ch) return null;
          return {
            getMetaDataIds() {
              const ids = [0]; // source connector
              for (let i = 0; i < ch.getDestinationConnectors().length; i++) {
                ids.push(i + 1);
              }
              return ids;
            },
          };
        },
        getChannelStatus(channelId: string) {
          const ch = EC.getDeployedChannel(channelId);
          if (!ch) return null;
          const stats = ch.getStatistics();
          const statMap = new Map<(typeof Status)[keyof typeof Status], number>();
          statMap.set(Status.RECEIVED, stats.received);
          statMap.set(Status.FILTERED, stats.filtered);
          statMap.set(Status.SENT, stats.sent);
          statMap.set(Status.ERROR, stats.error);
          statMap.set(Status.QUEUED, stats.queued);
          // Map DashboardStatus DeployedState → userutil DeployedState (string-compatible)
          const rawState = ch.getCurrentState() as string;
          const mappedState = (UserDeployedState as Record<string, string>)[rawState] as
            | (typeof UserDeployedState)[keyof typeof UserDeployedState]
            | undefined;
          return {
            channelId,
            name: ch.getName(),
            state: mappedState ?? UserDeployedState.UNKNOWN,
            statistics: statMap,
          };
        },
        async startChannels(channelIds: Set<string>) {
          try {
            for (const id of channelIds) await EC.startChannel(id);
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async stopChannels(channelIds: Set<string>) {
          try {
            for (const id of channelIds) await EC.stopChannel(id);
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async pauseChannels(channelIds: Set<string>) {
          try {
            for (const id of channelIds) await EC.pauseChannel(id);
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async resumeChannels(channelIds: Set<string>) {
          try {
            for (const id of channelIds) await EC.resumeChannel(id);
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async haltChannels(channelIds: Set<string>) {
          try {
            for (const id of channelIds) await EC.haltChannel(id);
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async deployChannels(channelIds: Set<string>, _context: unknown | null) {
          try {
            for (const id of channelIds) await EC.deployChannel(id);
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async undeployChannels(channelIds: Set<string>, _context: unknown | null) {
          try {
            for (const id of channelIds) await EC.undeployChannel(id);
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async startConnector(channelConnectorMap: Map<string, number[]>) {
          try {
            for (const [chId, metaIds] of channelConnectorMap) {
              for (const mid of metaIds) await EC.startConnector(chId, mid);
            }
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
        async stopConnector(channelConnectorMap: Map<string, number[]>) {
          try {
            for (const [chId, metaIds] of channelConnectorMap) {
              for (const mid of metaIds) await EC.stopConnector(chId, mid);
            }
            return noError();
          } catch (e) {
            return withError(e);
          }
        },
      });

      // Populate synchronous caches for the channel controller adapter
      await this.refreshChannelUtilCache();

      logger.info('ChannelUtil singletons initialized');
    } catch (err) {
      logger.warn(`Failed to initialize ChannelUtil: ${String(err)}`);
    }
  }

  /**
   * Refresh the synchronous channel cache used by ChannelUtil adapters.
   * Delegates to the shared ChannelCache module (also called by ChannelServlet after CRUD).
   */
  private async refreshChannelUtilCache(): Promise<void> {
    await refreshChannelCache();
  }

  /**
   * Load channels from database and deploy them via EngineController
   * This ensures consistent state tracking across the API and runtime
   */
  private async loadAndDeployChannels(): Promise<void> {
    try {
      const channelConfigs = await ChannelController.getAllChannels();
      logger.info(`Found ${channelConfigs.length} channel(s) in database`);

      for (const channelConfig of channelConfigs) {
        if (!channelConfig.enabled) {
          logger.debug(`Skipping disabled channel: ${channelConfig.name}`);
          continue;
        }

        try {
          // Use EngineController to deploy - this ensures state is tracked
          // in both EngineController.channelStates AND Donkey engine
          await EngineController.deployChannel(channelConfig.id);
          logger.info(`Deployed channel: ${channelConfig.name} (${channelConfig.id})`);
        } catch (channelError) {
          logger.error(`Failed to deploy channel ${channelConfig.name}`, channelError as Error);
          // Continue with other channels
        }
      }
    } catch (error) {
      logger.error('Failed to load channels from database', error as Error);
      // Don't throw - allow server to start even if channels fail to load
    }
  }
}
