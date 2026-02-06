/**
 * Engine Controller
 *
 * Business logic for channel deployment and status operations.
 *
 * ARCHITECTURE NOTE:
 * The Channel.currentState is the SINGLE SOURCE OF TRUTH for channel state.
 * This controller stores only deployment metadata (date, revision) and the runtime
 * channel reference. All state queries go directly to the Channel instance.
 *
 * This matches Java Mirth's architecture where the Channel class owns its state.
 */

import {
  DashboardStatus,
  DashboardChannelInfo,
  DeployedState,
  ListenerInfo,
  createDashboardStatus,
} from '../api/models/DashboardStatus.js';
import { ChannelController } from './ChannelController.js';
import { Channel } from '../donkey/channel/Channel.js';
import { buildChannel } from '../donkey/channel/ChannelBuilder.js';
import { ensureChannelTables } from '../db/SchemaManager.js';
import { getDonkeyInstance } from '../server/Mirth.js';

/**
 * Deployment metadata for a channel.
 * Note: State is NOT stored here - it comes from Channel.currentState
 */
interface DeploymentInfo {
  channelId: string;
  name: string;
  deployedDate: Date;
  deployedRevision?: number;
  runtimeChannel: Channel;  // Runtime channel instance - source of truth for state
}

/**
 * Map of deployed channels by ID.
 * The Channel.currentState within each entry is the authoritative state.
 */
const deployedChannels = new Map<string, DeploymentInfo>();

/**
 * Engine Controller - manages channel deployment and runtime state
 *
 * Key Design Principle:
 * - Channel.currentState is the single source of truth
 * - This controller only stores deployment metadata
 * - State operations delegate to Channel methods which handle their own state
 */
export class EngineController {
  /**
   * Get status for a single channel
   */
  static async getChannelStatus(channelId: string): Promise<DashboardStatus | null> {
    const deployment = deployedChannels.get(channelId);
    if (deployment) {
      return this.createStatusFromDeployment(deployment);
    }

    // Check if channel exists but isn't deployed
    const channel = await ChannelController.getChannel(channelId);
    if (channel) {
      return createDashboardStatus(channelId, channel.name, DeployedState.STOPPED);
    }

    return null;
  }

  /**
   * Get statuses for multiple channels
   */
  static async getChannelStatuses(
    channelIds?: string[],
    filter?: string,
    includeUndeployed?: boolean
  ): Promise<DashboardStatus[]> {
    const statuses: DashboardStatus[] = [];

    if (channelIds && channelIds.length > 0) {
      // Get specific channels
      for (const id of channelIds) {
        const status = await this.getChannelStatus(id);
        if (status) {
          if (this.matchesFilter(status, filter)) {
            statuses.push(status);
          }
        }
      }
    } else {
      // Get all channels
      const allChannels = await ChannelController.getAllChannels();

      for (const channel of allChannels) {
        const deployment = deployedChannels.get(channel.id);

        if (deployment) {
          const status = this.createStatusFromDeployment(deployment);
          if (this.matchesFilter(status, filter)) {
            statuses.push(status);
          }
        } else if (includeUndeployed) {
          const status = createDashboardStatus(channel.id, channel.name, DeployedState.STOPPED);
          if (this.matchesFilter(status, filter)) {
            statuses.push(status);
          }
        }
      }
    }

    return statuses;
  }

  /**
   * Get dashboard channel info (paginated)
   */
  static async getDashboardChannelInfo(
    fetchSize: number,
    filter?: string
  ): Promise<DashboardChannelInfo> {
    const allChannels = await ChannelController.getAllChannels();
    const allStatuses: DashboardStatus[] = [];

    for (const channel of allChannels) {
      const deployment = deployedChannels.get(channel.id);
      const status = deployment
        ? this.createStatusFromDeployment(deployment)
        : createDashboardStatus(channel.id, channel.name, DeployedState.STOPPED);

      if (this.matchesFilter(status, filter)) {
        allStatuses.push(status);
      }
    }

    const dashboardStatuses = allStatuses.slice(0, fetchSize);
    const remainingChannelIds = allStatuses.slice(fetchSize).map((s) => s.channelId);

    return {
      dashboardStatuses,
      remainingChannelIds,
    };
  }

  /**
   * Deploy all channels
   */
  static async deployAllChannels(): Promise<void> {
    const channels = await ChannelController.getAllChannels();
    for (const channel of channels) {
      if (channel.enabled) {
        await this.deployChannel(channel.id);
      }
    }
  }

  /**
   * Deploy a single channel
   * Registers the channel with both EngineController and Donkey engine
   */
  static async deployChannel(channelId: string): Promise<void> {
    const channelConfig = await ChannelController.getChannel(channelId);
    if (!channelConfig) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    // Ensure channel tables exist before deployment
    await ensureChannelTables(channelId);
    console.log(`Channel tables verified for ${channelConfig.name}`);

    try {
      // Build runtime channel with connectors
      const runtimeChannel = buildChannel(channelConfig);

      // Channel starts in DEPLOYING state
      runtimeChannel.updateCurrentState(DeployedState.DEPLOYING);

      // Register with Donkey engine (if available)
      const donkey = getDonkeyInstance();
      if (donkey && !donkey.getChannel(channelId)) {
        await donkey.deployChannel(runtimeChannel);
      }

      // Store deployment info (state comes from runtimeChannel.currentState)
      const deploymentInfo: DeploymentInfo = {
        channelId,
        name: channelConfig.name,
        deployedDate: new Date(),
        deployedRevision: channelConfig.revision,
        runtimeChannel,
      };
      deployedChannels.set(channelId, deploymentInfo);

      // Set to STOPPED after successful deployment build
      runtimeChannel.updateCurrentState(DeployedState.STOPPED);

      // Determine initial state from channel properties
      const initialState = channelConfig.properties?.initialState || DeployedState.STARTED;

      // Start the channel if initial state is STARTED
      // Channel.start() will manage its own state transitions
      if (initialState === DeployedState.STARTED) {
        await runtimeChannel.start();
      }

      console.log(`Channel ${channelConfig.name} deployed with state ${runtimeChannel.getCurrentState()}`);
    } catch (error) {
      console.error(`Failed to deploy channel ${channelConfig.name}:`, error);
      deployedChannels.delete(channelId);
      throw error;
    }
  }

  /**
   * Undeploy all channels
   */
  static async undeployAllChannels(): Promise<void> {
    for (const channelId of deployedChannels.keys()) {
      await this.undeployChannel(channelId);
    }
  }

  /**
   * Undeploy a single channel
   */
  static async undeployChannel(channelId: string): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      return;
    }

    const { runtimeChannel, name } = deployment;

    try {
      // Channel manages its own state during undeploy
      runtimeChannel.updateCurrentState(DeployedState.UNDEPLOYING);
      await runtimeChannel.stop();
    } catch (error) {
      console.error(`Error stopping channel ${name}:`, error);
    }

    // Remove from deployed channels
    deployedChannels.delete(channelId);
    console.log(`Channel ${name} undeployed`);
  }

  /**
   * Redeploy all channels
   */
  static async redeployAllChannels(): Promise<void> {
    await this.undeployAllChannels();
    await this.deployAllChannels();
  }

  /**
   * Start a channel
   * Delegates to Channel.start() which manages its own state transitions
   */
  static async startChannel(channelId: string): Promise<void> {
    let deployment = deployedChannels.get(channelId);

    if (!deployment) {
      // Auto-deploy if not deployed
      await this.deployChannel(channelId);
      deployment = deployedChannels.get(channelId);
    }

    if (deployment) {
      const { runtimeChannel, name } = deployment;
      // Channel.start() handles STARTING -> STARTED state transitions
      // and rollback on failure (STOPPING -> STOPPED)
      await runtimeChannel.start();
      console.log(`Channel ${name} started`);
    }
  }

  /**
   * Stop a channel
   * Delegates to Channel.stop() which manages its own state transitions
   */
  static async stopChannel(channelId: string): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    const { runtimeChannel, name } = deployment;
    // Channel.stop() handles STOPPING -> STOPPED state transitions
    await runtimeChannel.stop();
    console.log(`Channel ${name} stopped`);
  }

  /**
   * Halt a channel (force stop)
   */
  static async haltChannel(channelId: string): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    const { runtimeChannel, name } = deployment;
    await runtimeChannel.stop();
    console.log(`Channel ${name} halted`);
  }

  /**
   * Pause a channel
   * Delegates to Channel.pause() which manages its own state transitions
   */
  static async pauseChannel(channelId: string): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    const { runtimeChannel, name } = deployment;
    // Channel.pause() handles PAUSING -> PAUSED state transitions
    await runtimeChannel.pause();
    console.log(`Channel ${name} paused`);
  }

  /**
   * Resume a channel
   * Delegates to Channel.resume() which manages its own state transitions
   */
  static async resumeChannel(channelId: string): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    const { runtimeChannel, name } = deployment;
    // Channel.resume() handles STARTING -> STARTED state transitions
    await runtimeChannel.resume();
    console.log(`Channel ${name} resumed`);
  }

  /**
   * Start a connector
   */
  static async startConnector(channelId: string, metaDataId: number): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }
    console.log(`Connector ${metaDataId} on channel ${deployment.name} started`);
  }

  /**
   * Stop a connector
   */
  static async stopConnector(channelId: string, metaDataId: number): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }
    console.log(`Connector ${metaDataId} on channel ${deployment.name} stopped`);
  }

  /**
   * Check if channel is deployed
   */
  static isDeployed(channelId: string): boolean {
    return deployedChannels.has(channelId);
  }

  /**
   * Get the runtime channel instance for a deployed channel
   */
  static getDeployedChannel(channelId: string): Channel | null {
    const deployment = deployedChannels.get(channelId);
    return deployment?.runtimeChannel ?? null;
  }

  /**
   * Dispatch a raw message to a channel for processing
   * @param channelId - The channel ID to dispatch to
   * @param rawMessage - The raw message content
   * @param sourceMapData - Optional source map data
   * @returns The processed message
   */
  static async dispatchMessage(
    channelId: string,
    rawMessage: string,
    sourceMapData?: Map<string, unknown>
  ): Promise<{ messageId: number; processed: boolean }> {
    const channel = this.getDeployedChannel(channelId);
    if (!channel) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    const message = await channel.dispatchRawMessage(rawMessage, sourceMapData);
    return {
      messageId: message.getMessageId(),
      processed: message.isProcessed(),
    };
  }

  /**
   * Get deployed channel count
   */
  static getDeployedCount(): number {
    return deployedChannels.size;
  }

  /**
   * Create DashboardStatus from DeploymentInfo
   * Queries Channel.currentState as the single source of truth for state
   */
  private static createStatusFromDeployment(deployment: DeploymentInfo): DashboardStatus {
    // Query listener info from source connector if available
    let listenerInfo: ListenerInfo | undefined;
    const sourceConnector = deployment.runtimeChannel.getSourceConnector();

    if (sourceConnector) {
      // Duck-type check for getListenerInfo method (not all connectors have it)
      const connectorWithListener = sourceConnector as { getListenerInfo?: () => ListenerInfo | null };
      if (typeof connectorWithListener.getListenerInfo === 'function') {
        const info = connectorWithListener.getListenerInfo();
        if (info) {
          listenerInfo = info;
        }
      }
    }

    return {
      channelId: deployment.channelId,
      name: deployment.name,
      // STATE COMES FROM CHANNEL - Single Source of Truth
      state: deployment.runtimeChannel.getCurrentState(),
      deployedDate: deployment.deployedDate,
      deployedRevisionDelta: 0,
      statistics: deployment.runtimeChannel.getStatistics(),
      listenerInfo,
    };
  }

  /**
   * Check if status matches filter
   */
  private static matchesFilter(status: DashboardStatus, filter?: string): boolean {
    if (!filter) {
      return true;
    }
    const lowerFilter = filter.toLowerCase();
    return (
      status.name.toLowerCase().includes(lowerFilter) ||
      status.channelId.toLowerCase().includes(lowerFilter)
    );
  }
}
