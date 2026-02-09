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
import { ChannelController } from '../controllers/ChannelController.js';
import { EngineController } from '../controllers/EngineController.js';
import type { Server } from 'http';
import {
  setEngineController as setVmRouterEngineController,
  setChannelController as setVmRouterChannelController,
} from '../javascript/userutil/VMRouter.js';
import { Response } from '../model/Response.js';
import { dashboardStatusController } from '../plugins/dashboardstatus/DashboardStatusController.js';
import { dataPrunerController } from '../plugins/datapruner/DataPrunerController.js';
import { ConfigurationController } from '../controllers/ConfigurationController.js';
import { registerServer, startHeartbeat, stopHeartbeat, deregisterServer } from '../cluster/ServerRegistry.js';
import { setShuttingDown, setStartupComplete } from '../cluster/HealthCheck.js';
import { getClusterConfig } from '../cluster/ClusterConfig.js';
import { setShadowMode, isShadowMode } from '../cluster/ShadowMode.js';

// Global Donkey instance for EngineController to access
let donkeyInstance: Donkey | null = null;

/**
 * Get the global Donkey engine instance
 * Used by EngineController to register channels with the engine
 */
export function getDonkeyInstance(): Donkey | null {
  return donkeyInstance;
}

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

    console.warn('Starting Mirth Connect Node.js Runtime...');

    // Initialize database connection pool
    console.warn('Connecting to database...');
    initPool(this.config.database);
    console.warn(`Connected to database at ${this.config.database.host}:${this.config.database.port}`);

    // Initialize schema based on operational mode
    const { detectMode, verifySchema, ensureCoreTables, seedDefaults } = await import('../db/SchemaManager.js');

    this.detectedMode = await detectMode();
    console.warn(`Operational mode: ${this.detectedMode}`);

    // Check for shadow mode
    const shadowEnabled = process.env['MIRTH_SHADOW_MODE'] === 'true';
    if (shadowEnabled) {
      setShadowMode(true);
      console.warn('SHADOW MODE ACTIVE: Read-only observer -- no message processing');
      console.warn('    Use mirth-cli shadow promote <channel> to activate channels');
    }

    if (this.detectedMode === 'standalone') {
      console.warn('Standalone mode: ensuring core tables exist...');
      await ensureCoreTables();
      await seedDefaults();
      console.warn('Core schema initialized');
    } else {
      // Takeover mode - verify existing schema
      const result = await verifySchema();
      if (!result.compatible) {
        throw new Error(`Schema incompatible: ${result.errors.join(', ')}`);
      }
      console.warn(`Takeover mode: schema verified (version ${result.version})`);
    }

    // Initialize dashboard status controller with server ID
    const serverId = await ConfigurationController.getServerId();
    dashboardStatusController.setServerId(serverId);

    // Initialize Donkey engine
    this.donkey = new Donkey();
    donkeyInstance = this.donkey;  // Expose globally for EngineController
    await this.donkey.start();

    // Start REST API server
    this.server = await startServer({ port: this.config.httpPort });

    // Register this server in D_SERVERS and start heartbeat
    await registerServer(this.config.httpPort, isShadowMode() ? 'SHADOW' : undefined);
    const clusterConfig = getClusterConfig();
    if (clusterConfig.clusterEnabled) {
      startHeartbeat();
    }

    // Load channels from database and deploy them
    await this.loadAndDeployChannels();

    // Mark startup complete (health probe: /api/health/startup)
    setStartupComplete(true);

    if (!isShadowMode()) {
      // Initialize VMRouter singletons for user scripts (router.routeMessage())
      this.initializeVMRouter();

      // Initialize data pruner (scheduled background cleanup)
      await dataPrunerController.initialize();
    } else {
      console.warn('Shadow mode: VMRouter and DataPruner initialization deferred until cutover');
    }

    // Initialize Secrets Manager (if configured)
    const secretsProviders = process.env['MIRTH_SECRETS_PROVIDERS'];
    if (secretsProviders) {
      const { SecretsManager } = await import('../secrets/SecretsManager.js');
      await SecretsManager.initialize();
      console.warn(`Secrets providers initialized: ${secretsProviders}`);

      // Wire secrets as ConfigurationMap fallback
      const { createConfigMapFallback } = await import('../secrets/integration/ConfigMapBackend.js');
      const { ConfigurationMap } = await import('../javascript/userutil/MirthMap.js');
      ConfigurationMap.getInstance().setFallback(createConfigMapFallback());

      // Wire $secrets into script scope
      const { createSecretsFunction } = await import('../secrets/integration/ScriptSecretsMap.js');
      const { setSecretsFunction } = await import('../javascript/runtime/ScopeBuilder.js');
      setSecretsFunction(createSecretsFunction());
    }

    this.running = true;
    console.warn(
      `Mirth Connect started on port ${this.config.httpPort} (HTTP)`
    );
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.warn('Stopping Mirth Connect...');

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
            console.warn(`Stopping channel: ${channel.getName()}`);
            await channel.stop();
          }
        } catch (error) {
          console.error(`Error stopping channel ${channel.getName()}:`, error);
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
    } catch { /* module not loaded */ }

    // Close database connection pool
    await closePool();

    this.running = false;
    setStartupComplete(false);
    console.warn('Mirth Connect stopped');
  }

  /**
   * Install SIGTERM/SIGINT handlers for graceful shutdown.
   * Call this after start() to enable signal-based shutdown.
   */
  installSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      console.warn(`Received ${signal}, initiating graceful shutdown...`);
      try {
        await this.stop();
      } catch (err) {
        console.error('Error during graceful shutdown:', err);
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
   * Extracted to allow deferred initialization after shadow mode cutover.
   */
  private initializeVMRouter(): void {
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
    console.warn('VMRouter singletons initialized');
  }

  /**
   * Complete shadow mode cutover: initialize deferred services.
   * Called when all channels are promoted via the shadow API.
   */
  async completeShadowCutover(): Promise<void> {
    this.initializeVMRouter();
    await dataPrunerController.initialize();
    console.warn('Shadow mode cutover complete: VMRouter and DataPruner initialized');
  }

  /**
   * Load channels from database and deploy them via EngineController
   * This ensures consistent state tracking across the API and runtime
   */
  private async loadAndDeployChannels(): Promise<void> {
    try {
      const channelConfigs = await ChannelController.getAllChannels();
      console.warn(`Found ${channelConfigs.length} channel(s) in database`);

      for (const channelConfig of channelConfigs) {
        if (!channelConfig.enabled) {
          console.warn(`Skipping disabled channel: ${channelConfig.name}`);
          continue;
        }

        try {
          // Use EngineController to deploy - this ensures state is tracked
          // in both EngineController.channelStates AND Donkey engine
          await EngineController.deployChannel(channelConfig.id);
          console.warn(`Deployed channel: ${channelConfig.name} (${channelConfig.id})`);
        } catch (channelError) {
          console.error(`Failed to deploy channel ${channelConfig.name}:`, channelError);
          // Continue with other channels
        }
      }
    } catch (error) {
      console.error('Failed to load channels from database:', error);
      // Don't throw - allow server to start even if channels fail to load
    }
  }
}
