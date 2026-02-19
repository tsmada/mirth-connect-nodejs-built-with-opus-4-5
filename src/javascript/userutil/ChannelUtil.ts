/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/ChannelUtil.java
 *
 * Purpose: This utility class allows the user to query information from channels or to perform
 * actions on channels.
 *
 * Key behaviors to replicate:
 * - Get channel IDs and names (all and deployed)
 * - Start, stop, pause, resume, halt channels
 * - Deploy and undeploy channels
 * - Start and stop individual connectors
 * - Get channel and connector state
 * - Get statistics (received, filtered, queued, sent, error counts)
 * - Reset statistics
 * - Accept channel ID or channel name for all operations
 */

import { Future } from './Future.js';
import { DeployedState } from './DeployedState.js';
import { Status } from '../../model/Status.js';

/**
 * Minimal channel interface needed by ChannelUtil
 */
export interface IChannel {
  id: string;
  name: string;
}

/**
 * Dashboard status for a channel or connector
 */
export interface IDashboardStatus {
  channelId: string;
  name: string;
  state: DeployedState;
  metaDataId?: number;
  queued?: number;
  statistics: Map<Status, number>;
  childStatuses?: IDashboardStatus[];
}

/**
 * Deployed channel interface
 */
export interface IDeployedChannel {
  getMetaDataIds(): number[];
}

/**
 * Interface for channel controller used by ChannelUtil
 */
export interface IChannelUtilChannelController {
  /** Get all channel names */
  getChannelNames(): string[];

  /** Get all channel IDs */
  getChannelIds(): string[];

  /** Get a channel by ID */
  getChannelById(channelId: string): IChannel | null;

  /** Get a channel by name */
  getChannelByName(channelName: string): IChannel | null;

  /** Get all deployed channels */
  getDeployedChannels(channelIds: string[] | null): IChannel[];

  /** Get a deployed channel by ID */
  getDeployedChannelById(channelId: string): IChannel | null;

  /** Get a deployed channel by name */
  getDeployedChannelByName(channelName: string): IChannel | null;

  /** Reset statistics for channels */
  resetStatistics(
    channelMap: Map<string, (number | null)[]>,
    statusesToReset: Set<Status>
  ): Promise<void>;
}

/**
 * Error task handler result
 */
export interface IErrorTaskHandler {
  isErrored(): boolean;
  getError(): Error | null;
}

/**
 * Interface for engine controller used by ChannelUtil
 */
export interface IChannelUtilEngineController {
  /** Get all deployed channel IDs */
  getDeployedIds(): Set<string>;

  /** Get a deployed channel by ID */
  getDeployedChannel(channelId: string): IDeployedChannel | null;

  /** Get channel status from dashboard */
  getChannelStatus(channelId: string): IDashboardStatus | null;

  /** Start channels */
  startChannels(channelIds: Set<string>): Promise<IErrorTaskHandler>;

  /** Stop channels */
  stopChannels(channelIds: Set<string>): Promise<IErrorTaskHandler>;

  /** Pause channels */
  pauseChannels(channelIds: Set<string>): Promise<IErrorTaskHandler>;

  /** Resume channels */
  resumeChannels(channelIds: Set<string>): Promise<IErrorTaskHandler>;

  /** Halt channels */
  haltChannels(channelIds: Set<string>): Promise<IErrorTaskHandler>;

  /** Deploy channels */
  deployChannels(channelIds: Set<string>, context: unknown | null): Promise<IErrorTaskHandler>;

  /** Undeploy channels */
  undeployChannels(channelIds: Set<string>, context: unknown | null): Promise<IErrorTaskHandler>;

  /** Start a connector */
  startConnector(channelConnectorMap: Map<string, number[]>): Promise<IErrorTaskHandler>;

  /** Stop a connector */
  stopConnector(channelConnectorMap: Map<string, number[]>): Promise<IErrorTaskHandler>;
}

// Singleton controllers
let channelController: IChannelUtilChannelController | null = null;
let engineController: IChannelUtilEngineController | null = null;

/**
 * Set the channel controller for ChannelUtil to use.
 * This should be called during application startup.
 */
export function setChannelUtilChannelController(controller: IChannelUtilChannelController): void {
  channelController = controller;
}

/**
 * Set the engine controller for ChannelUtil to use.
 * This should be called during application startup.
 */
export function setChannelUtilEngineController(controller: IChannelUtilEngineController): void {
  engineController = controller;
}

/**
 * Get the current channel controller.
 */
export function getChannelUtilChannelController(): IChannelUtilChannelController | null {
  return channelController;
}

/**
 * Get the current engine controller.
 */
export function getChannelUtilEngineController(): IChannelUtilEngineController | null {
  return engineController;
}

/**
 * Statuses that can be reset
 */
const RESETABLE_STATUSES: Set<Status> = new Set([
  Status.RECEIVED,
  Status.FILTERED,
  Status.ERROR,
  Status.SENT,
]);

/**
 * This utility class allows the user to query information from channels or to perform actions
 * on channels.
 */
export class ChannelUtil {
  private channelCtrl: IChannelUtilChannelController;
  private engineCtrl: IChannelUtilEngineController;

  /**
   * Create a ChannelUtil instance.
   *
   * @param customChannelController Optional custom channel controller
   * @param customEngineController Optional custom engine controller
   */
  constructor(
    customChannelController?: IChannelUtilChannelController,
    customEngineController?: IChannelUtilEngineController
  ) {
    if (customChannelController) {
      this.channelCtrl = customChannelController;
    } else if (channelController) {
      this.channelCtrl = channelController;
    } else {
      throw new Error(
        'No channel controller available. Call setChannelUtilChannelController() during startup.'
      );
    }

    if (customEngineController) {
      this.engineCtrl = customEngineController;
    } else if (engineController) {
      this.engineCtrl = engineController;
    } else {
      throw new Error(
        'No engine controller available. Call setChannelUtilEngineController() during startup.'
      );
    }
  }

  // ============================================
  // Channel Name/ID Query Methods
  // ============================================

  /**
   * Get all channel names.
   *
   * @return A list of all channel names.
   */
  getChannelNames(): string[] {
    return [...this.channelCtrl.getChannelNames()];
  }

  /**
   * Get all channel IDs.
   *
   * @return A list of all channel IDs.
   */
  getChannelIds(): string[] {
    return [...this.channelCtrl.getChannelIds()];
  }

  /**
   * Get all deployed channel names.
   *
   * @return A list of all deployed channel names.
   */
  getDeployedChannelNames(): string[] {
    const channelNames: string[] = [];
    for (const channel of this.channelCtrl.getDeployedChannels(null)) {
      channelNames.push(channel.name);
    }
    return channelNames;
  }

  /**
   * Get all deployed channel IDs.
   *
   * @return A list of all deployed channel IDs.
   */
  getDeployedChannelIds(): string[] {
    const channelIds: string[] = [];
    for (const channel of this.channelCtrl.getDeployedChannels(null)) {
      channelIds.push(channel.id);
    }
    return channelIds;
  }

  /**
   * Get the name for a channel.
   *
   * @param channelId The channel ID of the channel.
   * @return The channel name of the specified channel, or null if not found.
   */
  getChannelName(channelId: string): string | null {
    const channel = this.channelCtrl.getChannelById(channelId);
    return channel?.name ?? null;
  }

  /**
   * Get the name for a deployed channel.
   *
   * @param channelId The channel ID of the deployed channel.
   * @return The channel name of the specified channel, or null if not found.
   */
  getDeployedChannelName(channelId: string): string | null {
    const channel = this.channelCtrl.getDeployedChannelById(channelId);
    return channel?.name ?? null;
  }

  /**
   * Get the ID for a deployed channel.
   *
   * @param channelName The channel name of the deployed channel.
   * @return The channel ID of the specified channel, or null if not found.
   */
  getDeployedChannelId(channelName: string): string | null {
    const channel = this.channelCtrl.getDeployedChannelByName(channelName);
    return channel?.id ?? null;
  }

  // ============================================
  // Channel Control Methods
  // ============================================

  /**
   * Start a deployed channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  startChannel(channelIdOrName: string): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const handler = await this.engineCtrl.startChannels(new Set([channelId]));
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Stop a deployed channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  stopChannel(channelIdOrName: string): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const handler = await this.engineCtrl.stopChannels(new Set([channelId]));
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Pause a deployed channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  pauseChannel(channelIdOrName: string): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const handler = await this.engineCtrl.pauseChannels(new Set([channelId]));
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Resume a deployed channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  resumeChannel(channelIdOrName: string): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const handler = await this.engineCtrl.resumeChannels(new Set([channelId]));
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Halt a deployed channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  haltChannel(channelIdOrName: string): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const handler = await this.engineCtrl.haltChannels(new Set([channelId]));
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Deploy a channel.
   *
   * @param channelIdOrName The channel ID or current name of the channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  deployChannel(channelIdOrName: string): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const handler = await this.engineCtrl.deployChannels(new Set([channelId]), null);
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Undeploy a channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  undeployChannel(channelIdOrName: string): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const handler = await this.engineCtrl.undeployChannels(new Set([channelId]), null);
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Check if a channel is currently deployed.
   *
   * @param channelIdOrName The channel ID or current name of the channel.
   * @return True if the channel is deployed, false if it is not.
   */
  isChannelDeployed(channelIdOrName: string): boolean {
    return this.engineCtrl.getDeployedIds().has(this.convertId(channelIdOrName));
  }

  /**
   * Get the current state of a channel.
   *
   * @param channelIdOrName The channel ID or current name of the channel.
   * @return The current DeployedState, or null if not found.
   */
  getChannelState(channelIdOrName: string): DeployedState | null {
    const dashboardStatus = this.getDashboardStatus(channelIdOrName, null);
    return dashboardStatus?.state ?? null;
  }

  // ============================================
  // Connector Control Methods
  // ============================================

  /**
   * Start a connector on a given channel.
   *
   * @param channelIdOrName The channel ID or current name of the channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return A Future object representing the result of the asynchronous operation.
   */
  startConnector(channelIdOrName: string, metaDataId: number): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const channelConnectorMap = new Map<string, number[]>();
      channelConnectorMap.set(channelId, [metaDataId]);
      const handler = await this.engineCtrl.startConnector(channelConnectorMap);
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Stop a connector on a given channel.
   *
   * @param channelIdOrName The channel ID or current name of the channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return A Future object representing the result of the asynchronous operation.
   */
  stopConnector(channelIdOrName: string, metaDataId: number): Future<void> {
    const channelId = this.convertId(channelIdOrName);
    const promise = (async () => {
      const channelConnectorMap = new Map<string, number[]>();
      channelConnectorMap.set(channelId, [metaDataId]);
      const handler = await this.engineCtrl.stopConnector(channelConnectorMap);
      if (handler.isErrored()) {
        throw handler.getError();
      }
    })();
    return new Future<void>(promise);
  }

  /**
   * Get the current state of a connector.
   *
   * @param channelIdOrName The channel ID or current name of the channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return The current connector state as DeployedState, or null if not found.
   */
  getConnectorState(channelIdOrName: string, metaDataId: number): DeployedState | null {
    const dashboardStatus = this.getDashboardStatus(channelIdOrName, metaDataId);
    return dashboardStatus?.state ?? null;
  }

  // ============================================
  // Statistics Methods
  // ============================================

  /**
   * Get the received count statistic for a specific channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return The received count statistic for the specified channel.
   */
  getReceivedCount(channelIdOrName: string): number | null;

  /**
   * Get the received count statistic for a specific connector.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return The received count statistic for the specified connector.
   */
  getReceivedCount(channelIdOrName: string, metaDataId: number): number | null;

  // Implementation
  getReceivedCount(channelIdOrName: string, metaDataId?: number): number | null {
    return this.getStatisticByStatus(channelIdOrName, metaDataId ?? null, Status.RECEIVED);
  }

  /**
   * Get the filtered count statistic for a specific channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return The filtered count statistic for the specified channel.
   */
  getFilteredCount(channelIdOrName: string): number | null;

  /**
   * Get the filtered count statistic for a specific connector.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return The filtered count statistic for the specified connector.
   */
  getFilteredCount(channelIdOrName: string, metaDataId: number): number | null;

  // Implementation
  getFilteredCount(channelIdOrName: string, metaDataId?: number): number | null {
    return this.getStatisticByStatus(channelIdOrName, metaDataId ?? null, Status.FILTERED);
  }

  /**
   * Get the queued count statistic for a specific channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return The queued count statistic for the specified channel.
   */
  getQueuedCount(channelIdOrName: string): number | null;

  /**
   * Get the queued count statistic for a specific connector.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return The queued count statistic for the specified connector.
   */
  getQueuedCount(channelIdOrName: string, metaDataId: number): number | null;

  // Implementation
  getQueuedCount(channelIdOrName: string, metaDataId?: number): number | null {
    return this.getStatisticByStatus(channelIdOrName, metaDataId ?? null, Status.QUEUED);
  }

  /**
   * Get the sent count statistic for a specific channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return The sent count statistic for the specified channel.
   */
  getSentCount(channelIdOrName: string): number | null;

  /**
   * Get the sent count statistic for a specific connector.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return The sent count statistic for the specified connector.
   */
  getSentCount(channelIdOrName: string, metaDataId: number): number | null;

  // Implementation
  getSentCount(channelIdOrName: string, metaDataId?: number): number | null {
    return this.getStatisticByStatus(channelIdOrName, metaDataId ?? null, Status.SENT);
  }

  /**
   * Get the error count statistic for a specific channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return The error count statistic for the specified channel.
   */
  getErrorCount(channelIdOrName: string): number | null;

  /**
   * Get the error count statistic for a specific connector.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0.
   * @return The error count statistic for the specified connector.
   */
  getErrorCount(channelIdOrName: string, metaDataId: number): number | null;

  // Implementation
  getErrorCount(channelIdOrName: string, metaDataId?: number): number | null {
    return this.getStatisticByStatus(channelIdOrName, metaDataId ?? null, Status.ERROR);
  }

  /**
   * Reset all statistics for a specific channel.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @return A Future object representing the result of the asynchronous operation.
   */
  resetStatistics(channelIdOrName: string): Future<void>;

  /**
   * Reset all statistics for a specific connector.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0,
   *        and null for aggregate.
   * @return A Future object representing the result of the asynchronous operation.
   */
  resetStatistics(channelIdOrName: string, metaDataId: number | null): Future<void>;

  /**
   * Reset specific statistics for a specific connector.
   *
   * @param channelIdOrName The channel ID or current name of the deployed channel.
   * @param metaDataId The metadata ID of the connector. The source connector has metadata ID 0,
   *        and null for aggregate.
   * @param statuses A collection of statuses to reset.
   * @return A Future object representing the result of the asynchronous operation.
   */
  resetStatistics(
    channelIdOrName: string,
    metaDataId: number | null,
    statuses: Status[]
  ): Future<void>;

  // Implementation
  resetStatistics(
    channelIdOrName: string,
    metaDataId?: number | null,
    statuses?: Status[]
  ): Future<void> {
    const promise = this.clearStatistics(channelIdOrName, metaDataId ?? null, statuses ?? null);
    return new Future<void>(promise);
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Convert a channel ID or name to a channel ID.
   * If the value is not found as an ID, assume it's a name and look it up.
   */
  private convertId(channelIdOrName: string): string {
    if (!this.channelCtrl.getChannelIds().includes(channelIdOrName)) {
      // Assume the name was passed in instead, check the deployed cache first
      const channel = this.channelCtrl.getDeployedChannelByName(channelIdOrName);
      if (channel !== null) {
        return channel.id;
      }

      // Check the regular cache second
      const regularChannel = this.channelCtrl.getChannelByName(channelIdOrName);
      if (regularChannel !== null) {
        return regularChannel.id;
      }
    }

    return channelIdOrName;
  }

  /**
   * Get the dashboard status for a channel or connector.
   */
  private getDashboardStatus(
    channelIdOrName: string,
    metaDataId: number | null
  ): IDashboardStatus | null {
    const dashboardStatus = this.engineCtrl.getChannelStatus(this.convertId(channelIdOrName));

    if (dashboardStatus !== null) {
      if (metaDataId === null) {
        return dashboardStatus;
      } else {
        const targetId = Math.floor(metaDataId);

        if (dashboardStatus.childStatuses) {
          for (const childStatus of dashboardStatus.childStatuses) {
            if (childStatus.metaDataId === targetId) {
              return childStatus;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Get a statistic by status for a channel or connector.
   */
  private getStatisticByStatus(
    channelIdOrName: string,
    metaDataId: number | null,
    status: Status
  ): number | null {
    const dashboardStatus = this.getDashboardStatus(channelIdOrName, metaDataId);
    if (dashboardStatus !== null) {
      if (status === Status.QUEUED) {
        return dashboardStatus.queued ?? null;
      } else {
        return dashboardStatus.statistics.get(status) ?? null;
      }
    }
    return null;
  }

  /**
   * Clear statistics for a channel or connector.
   */
  private async clearStatistics(
    channelIdOrName: string,
    metaDataId: number | null,
    statuses: Status[] | null
  ): Promise<void> {
    const channelId = this.convertId(channelIdOrName);
    const statusesToReset = new Set<Status>();

    const deployedChannel = this.engineCtrl.getDeployedChannel(channelId);
    if (deployedChannel !== null) {
      const connectorList: (number | null)[] = [...deployedChannel.getMetaDataIds()];

      if (metaDataId === null) {
        connectorList.push(null);
      } else {
        const metaDataIds = new Set(connectorList);
        connectorList.length = 0;
        if (metaDataIds.has(metaDataId)) {
          connectorList.push(metaDataId);
        }
      }

      if (connectorList.length > 0) {
        const channelMap = new Map<string, (number | null)[]>();
        channelMap.set(channelId, connectorList);

        if (statuses === null) {
          for (const status of RESETABLE_STATUSES) {
            statusesToReset.add(status);
          }
        } else {
          for (const status of statuses) {
            if (RESETABLE_STATUSES.has(status)) {
              statusesToReset.add(status);
            }
          }
        }

        await this.channelCtrl.resetStatistics(channelMap, statusesToReset);
      }
    }
  }
}

// ============================================
// Static API (for backward compatibility with Java API)
// ============================================

/**
 * Singleton instance for static method access
 */
let singletonInstance: ChannelUtil | null = null;

/**
 * Get or create the singleton ChannelUtil instance.
 */
function getInstance(): ChannelUtil {
  if (singletonInstance === null) {
    singletonInstance = new ChannelUtil();
  }
  return singletonInstance;
}

/**
 * Reset the singleton instance (useful for testing).
 */
export function resetChannelUtilInstance(): void {
  singletonInstance = null;
}

// Static wrapper methods that delegate to the singleton instance

export function getChannelNames(): string[] {
  return getInstance().getChannelNames();
}

export function getChannelIds(): string[] {
  return getInstance().getChannelIds();
}

export function getDeployedChannelNames(): string[] {
  return getInstance().getDeployedChannelNames();
}

export function getDeployedChannelIds(): string[] {
  return getInstance().getDeployedChannelIds();
}

export function getChannelName(channelId: string): string | null {
  return getInstance().getChannelName(channelId);
}

export function getDeployedChannelName(channelId: string): string | null {
  return getInstance().getDeployedChannelName(channelId);
}

export function getDeployedChannelId(channelName: string): string | null {
  return getInstance().getDeployedChannelId(channelName);
}

export function startChannel(channelIdOrName: string): Future<void> {
  return getInstance().startChannel(channelIdOrName);
}

export function stopChannel(channelIdOrName: string): Future<void> {
  return getInstance().stopChannel(channelIdOrName);
}

export function pauseChannel(channelIdOrName: string): Future<void> {
  return getInstance().pauseChannel(channelIdOrName);
}

export function resumeChannel(channelIdOrName: string): Future<void> {
  return getInstance().resumeChannel(channelIdOrName);
}

export function haltChannel(channelIdOrName: string): Future<void> {
  return getInstance().haltChannel(channelIdOrName);
}

export function deployChannel(channelIdOrName: string): Future<void> {
  return getInstance().deployChannel(channelIdOrName);
}

export function undeployChannel(channelIdOrName: string): Future<void> {
  return getInstance().undeployChannel(channelIdOrName);
}

export function isChannelDeployed(channelIdOrName: string): boolean {
  return getInstance().isChannelDeployed(channelIdOrName);
}

export function getChannelState(channelIdOrName: string): DeployedState | null {
  return getInstance().getChannelState(channelIdOrName);
}

export function startConnector(channelIdOrName: string, metaDataId: number): Future<void> {
  return getInstance().startConnector(channelIdOrName, metaDataId);
}

export function stopConnector(channelIdOrName: string, metaDataId: number): Future<void> {
  return getInstance().stopConnector(channelIdOrName, metaDataId);
}

export function getConnectorState(
  channelIdOrName: string,
  metaDataId: number
): DeployedState | null {
  return getInstance().getConnectorState(channelIdOrName, metaDataId);
}

export function getReceivedCount(channelIdOrName: string, metaDataId?: number): number | null {
  return metaDataId !== undefined
    ? getInstance().getReceivedCount(channelIdOrName, metaDataId)
    : getInstance().getReceivedCount(channelIdOrName);
}

export function getFilteredCount(channelIdOrName: string, metaDataId?: number): number | null {
  return metaDataId !== undefined
    ? getInstance().getFilteredCount(channelIdOrName, metaDataId)
    : getInstance().getFilteredCount(channelIdOrName);
}

export function getQueuedCount(channelIdOrName: string, metaDataId?: number): number | null {
  return metaDataId !== undefined
    ? getInstance().getQueuedCount(channelIdOrName, metaDataId)
    : getInstance().getQueuedCount(channelIdOrName);
}

export function getSentCount(channelIdOrName: string, metaDataId?: number): number | null {
  return metaDataId !== undefined
    ? getInstance().getSentCount(channelIdOrName, metaDataId)
    : getInstance().getSentCount(channelIdOrName);
}

export function getErrorCount(channelIdOrName: string, metaDataId?: number): number | null {
  return metaDataId !== undefined
    ? getInstance().getErrorCount(channelIdOrName, metaDataId)
    : getInstance().getErrorCount(channelIdOrName);
}

export function resetStatistics(
  channelIdOrName: string,
  metaDataId?: number | null,
  statuses?: Status[]
): Future<void> {
  if (statuses !== undefined) {
    return getInstance().resetStatistics(channelIdOrName, metaDataId ?? null, statuses);
  } else if (metaDataId !== undefined) {
    return getInstance().resetStatistics(channelIdOrName, metaDataId);
  } else {
    return getInstance().resetStatistics(channelIdOrName);
  }
}
