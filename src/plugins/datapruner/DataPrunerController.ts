/**
 * Data Pruner Controller
 *
 * Manages the data pruner lifecycle, scheduling, and configuration.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datapruner/DefaultDataPrunerController.java
 */

import {
  dataPruner,
  DataPruner,
  DEFAULT_PRUNING_BLOCK_SIZE,
  DEFAULT_ARCHIVING_BLOCK_SIZE,
  SkipStatus,
} from './DataPruner.js';
import { DataPrunerStatus } from './DataPrunerStatus.js';
import * as MirthDao from '../../db/MirthDao.js';
import type { MessageWriterOptions } from './MessageArchiver.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('data-pruner', 'Pruning engine');
const logger = getLogger('data-pruner');

/**
 * Data pruner configuration
 */
export interface DataPrunerConfig {
  enabled: boolean;
  pollingIntervalHours: number;
  pruningBlockSize: number;
  archivingBlockSize: number;
  archiveEnabled: boolean;
  pruneEvents: boolean;
  maxEventAgeDays: number | null;
  skipStatuses: SkipStatus[];
  archiverOptions?: MessageWriterOptions;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DataPrunerConfig = {
  enabled: false,
  pollingIntervalHours: 24, // Run daily by default
  pruningBlockSize: DEFAULT_PRUNING_BLOCK_SIZE,
  archivingBlockSize: DEFAULT_ARCHIVING_BLOCK_SIZE,
  archiveEnabled: false,
  pruneEvents: false,
  maxEventAgeDays: null,
  skipStatuses: [SkipStatus.ERROR, SkipStatus.QUEUED, SkipStatus.PENDING],
};

/**
 * Data Pruner Controller
 */
class DataPrunerController {
  private config: DataPrunerConfig = { ...DEFAULT_CONFIG };
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private initialized: boolean = false;

  /**
   * Initialize the data pruner controller
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load configuration from database (would normally use ConfigurationController)
    // For now, use defaults
    await this.loadConfiguration();

    // Apply configuration to pruner
    this.applyConfiguration();

    // Start scheduler if enabled
    if (this.config.enabled) {
      this.startScheduler();
    }

    this.initialized = true;
    logger.info('Data Pruner Controller initialized');
  }

  /**
   * Shutdown the data pruner controller
   */
  async shutdown(): Promise<void> {
    this.stopScheduler();

    if (dataPruner.isRunning()) {
      await dataPruner.stop();
    }

    this.initialized = false;
    logger.info('Data Pruner Controller shutdown');
  }

  /**
   * Load configuration from CONFIGURATION table
   */
  private async loadConfiguration(): Promise<void> {
    try {
      const stored = await MirthDao.getConfiguration('Data Pruner', 'pruner.config');
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DataPrunerConfig>;
        this.config = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      // Database may not be ready or config may not exist yet — use defaults
    }
  }

  /**
   * Save configuration to CONFIGURATION table
   */
  private async saveConfiguration(): Promise<void> {
    try {
      await MirthDao.setConfiguration('Data Pruner', 'pruner.config', JSON.stringify(this.config));
    } catch (error) {
      logger.error('Failed to save data pruner configuration', error as Error);
    }
  }

  /**
   * Apply configuration to the data pruner
   */
  private applyConfiguration(): void {
    dataPruner.setPrunerBlockSize(this.config.pruningBlockSize);
    dataPruner.setArchiverBlockSize(this.config.archivingBlockSize);
    dataPruner.setArchiveEnabled(this.config.archiveEnabled);
    dataPruner.setPruneEvents(this.config.pruneEvents);
    dataPruner.setMaxEventAge(this.config.maxEventAgeDays);
    dataPruner.setSkipStatuses(this.config.skipStatuses);
    if (this.config.archiverOptions) {
      dataPruner.setArchiverOptions(this.config.archiverOptions);
    }
  }

  /**
   * Get current configuration
   */
  getConfiguration(): DataPrunerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  async updateConfiguration(config: Partial<DataPrunerConfig>): Promise<void> {
    const wasEnabled = this.config.enabled;

    this.config = {
      ...this.config,
      ...config,
    };

    this.applyConfiguration();
    await this.saveConfiguration();

    // Handle scheduler state changes
    if (this.config.enabled && !wasEnabled) {
      this.startScheduler();
    } else if (!this.config.enabled && wasEnabled) {
      this.stopScheduler();
    } else if (this.config.enabled) {
      // Restart scheduler if interval changed
      this.stopScheduler();
      this.startScheduler();
    }
  }

  /**
   * Start the scheduler
   */
  private startScheduler(): void {
    if (this.schedulerTimer) {
      return;
    }

    const intervalMs = this.config.pollingIntervalHours * 60 * 60 * 1000;

    logger.info(
      `Starting data pruner scheduler (interval: ${this.config.pollingIntervalHours} hours)`
    );

    this.schedulerTimer = setInterval(() => {
      void this.runScheduledPrune();
    }, intervalMs);

    // Don't keep process alive just for pruner
    if (this.schedulerTimer.unref) {
      this.schedulerTimer.unref();
    }
  }

  /**
   * Stop the scheduler
   */
  private stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      logger.info('Data pruner scheduler stopped');
    }
  }

  /**
   * Run a scheduled prune
   */
  private async runScheduledPrune(): Promise<void> {
    if (dataPruner.isRunning()) {
      logger.info('Data pruner is already running, skipping scheduled run');
      return;
    }

    logger.info('Running scheduled data prune');
    await this.startPruner();
  }

  /**
   * Get the data pruner instance
   */
  getPruner(): DataPruner {
    return dataPruner;
  }

  /**
   * Start the data pruner manually
   */
  async startPruner(): Promise<boolean> {
    return dataPruner.start();
  }

  /**
   * Stop the data pruner
   */
  async stopPruner(): Promise<void> {
    return dataPruner.stop();
  }

  /**
   * Check if the pruner is running
   */
  isRunning(): boolean {
    return dataPruner.isRunning();
  }

  /**
   * Get current pruner status
   */
  getStatus(): DataPrunerStatus {
    return dataPruner.getPrunerStatus();
  }

  /**
   * Get last completed pruner status
   */
  getLastStatus(): DataPrunerStatus | null {
    return dataPruner.getLastPrunerStatus();
  }

  /**
   * Get status for API response (serializable)
   */
  getStatusForApi(): SerializableDataPrunerStatus {
    const status = dataPruner.getPrunerStatus();
    return this.serializeStatus(status);
  }

  /**
   * Get last status for API response (serializable)
   */
  getLastStatusForApi(): SerializableDataPrunerStatus | null {
    const status = dataPruner.getLastPrunerStatus();
    return status ? this.serializeStatus(status) : null;
  }

  /**
   * Convert status to serializable format
   */
  private serializeStatus(status: DataPrunerStatus): SerializableDataPrunerStatus {
    return {
      startTime: status.startTime?.toISOString() ?? null,
      endTime: status.endTime?.toISOString() ?? null,
      taskStartTime: status.taskStartTime?.toISOString() ?? null,
      currentChannelId: status.currentChannelId,
      currentChannelName: status.currentChannelName,
      isArchiving: status.isArchiving,
      isPruning: status.isPruning,
      isPruningEvents: status.isPruningEvents,
      pendingChannelIds: Array.from(status.pendingChannelIds),
      processedChannelIds: Array.from(status.processedChannelIds),
      failedChannelIds: Array.from(status.failedChannelIds),
    };
  }
}

/**
 * Serializable version of DataPrunerStatus for API responses
 */
export interface SerializableDataPrunerStatus {
  startTime: string | null;
  endTime: string | null;
  taskStartTime: string | null;
  currentChannelId: string | null;
  currentChannelName: string | null;
  isArchiving: boolean;
  isPruning: boolean;
  isPruningEvents: boolean;
  pendingChannelIds: string[];
  processedChannelIds: string[];
  failedChannelIds: string[];
}

/**
 * Singleton controller instance
 */
export const dataPrunerController = new DataPrunerController();
