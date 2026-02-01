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
import { buildChannel } from '../donkey/channel/ChannelBuilder.js';
import { DeployedState } from '../api/models/DashboardStatus.js';
import type { Server } from 'http';

export interface MirthConfig {
  httpPort: number;
  httpsPort: number;
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

    // Initialize Donkey engine
    this.donkey = new Donkey();
    await this.donkey.start();

    // Start REST API server
    this.server = await startServer({ port: this.config.httpPort });

    // Load channels from database and deploy them
    await this.loadAndDeployChannels();

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

    // Close database connection pool
    await closePool();

    this.running = false;
    console.warn('Mirth Connect stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): MirthConfig {
    return { ...this.config };
  }

  getDonkey(): Donkey | null {
    return this.donkey;
  }

  /**
   * Load channels from database and deploy them to Donkey engine
   */
  private async loadAndDeployChannels(): Promise<void> {
    try {
      const channelConfigs = await ChannelController.getAllChannels();
      console.warn(`Found ${channelConfigs.length} channel(s) in database`);

      for (const channelConfig of channelConfigs) {
        try {
          // Build runtime channel from config
          const runtimeChannel = buildChannel(channelConfig);

          // Deploy to Donkey engine
          await this.donkey!.deployChannel(runtimeChannel);
          console.warn(`Deployed channel: ${channelConfig.name} (${channelConfig.id})`);

          // Start channel if enabled and initial state is STARTED
          const initialState = channelConfig.properties?.initialState;
          if (channelConfig.enabled && initialState !== DeployedState.STOPPED) {
            try {
              await runtimeChannel.start();
              console.warn(`Started channel: ${channelConfig.name}`);
            } catch (startError) {
              console.error(`Failed to start channel ${channelConfig.name}:`, startError);
            }
          }
        } catch (channelError) {
          console.error(`Failed to deploy channel ${channelConfig.name}:`, channelError);
        }
      }
    } catch (error) {
      console.error('Failed to load channels from database:', error);
      // Don't throw - allow server to start even if channels fail to load
    }
  }
}
