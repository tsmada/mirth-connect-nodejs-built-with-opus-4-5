/**
 * Engine Controller
 *
 * Business logic for channel deployment and status operations.
 */

import {
  DashboardStatus,
  DashboardChannelInfo,
  DeployedState,
  createDashboardStatus,
  createEmptyStatistics,
} from '../api/models/DashboardStatus.js';
import { ChannelController } from './ChannelController.js';
import { Channel } from '../donkey/channel/Channel.js';
import { buildChannel } from '../donkey/channel/ChannelBuilder.js';

// In-memory channel state store
interface ChannelState {
  channelId: string;
  name: string;
  state: DeployedState;
  deployedDate?: Date;
  deployedRevision?: number;
  runtimeChannel?: Channel;  // Runtime channel instance with connectors
}

const channelStates = new Map<string, ChannelState>();

/**
 * Engine Controller - manages channel deployment and runtime state
 */
export class EngineController {
  /**
   * Get status for a single channel
   */
  static async getChannelStatus(channelId: string): Promise<DashboardStatus | null> {
    const state = channelStates.get(channelId);
    if (state) {
      return this.createStatusFromState(state);
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
        const state = channelStates.get(channel.id);

        if (state) {
          const status = this.createStatusFromState(state);
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
      const state = channelStates.get(channel.id);
      const status = state
        ? this.createStatusFromState(state)
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
   */
  static async deployChannel(channelId: string): Promise<void> {
    const channelConfig = await ChannelController.getChannel(channelId);
    if (!channelConfig) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    // Set state to deploying
    channelStates.set(channelId, {
      channelId,
      name: channelConfig.name,
      state: DeployedState.DEPLOYING,
    });

    try {
      // Build runtime channel with connectors
      const runtimeChannel = buildChannel(channelConfig);

      // Determine initial state from channel properties
      const initialState = channelConfig.properties?.initialState || DeployedState.STARTED;

      // Store state with runtime channel
      channelStates.set(channelId, {
        channelId,
        name: channelConfig.name,
        state: DeployedState.STOPPED,
        deployedDate: new Date(),
        deployedRevision: channelConfig.revision,
        runtimeChannel,
      });

      // Start the channel if initial state is STARTED
      if (initialState === DeployedState.STARTED) {
        await runtimeChannel.start();
        const state = channelStates.get(channelId);
        if (state) {
          state.state = DeployedState.STARTED;
        }
      }

      console.log(`Channel ${channelConfig.name} deployed with state ${initialState}`);
    } catch (error) {
      console.error(`Failed to deploy channel ${channelConfig.name}:`, error);
      channelStates.delete(channelId);
      throw error;
    }
  }

  /**
   * Undeploy all channels
   */
  static async undeployAllChannels(): Promise<void> {
    for (const channelId of channelStates.keys()) {
      await this.undeployChannel(channelId);
    }
  }

  /**
   * Undeploy a single channel
   */
  static async undeployChannel(channelId: string): Promise<void> {
    const state = channelStates.get(channelId);
    if (!state) {
      return;
    }

    // Set state to undeploying
    state.state = DeployedState.UNDEPLOYING;

    try {
      // Stop the runtime channel if it exists
      if (state.runtimeChannel) {
        await state.runtimeChannel.stop();
      }
    } catch (error) {
      console.error(`Error stopping channel ${state.name}:`, error);
    }

    // Remove from state
    channelStates.delete(channelId);
    console.log(`Channel ${state.name} undeployed`);
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
   */
  static async startChannel(channelId: string): Promise<void> {
    let state = channelStates.get(channelId);

    if (!state) {
      // Auto-deploy if not deployed
      await this.deployChannel(channelId);
      state = channelStates.get(channelId);
    }

    if (state) {
      state.state = DeployedState.STARTING;
      try {
        if (state.runtimeChannel) {
          await state.runtimeChannel.start();
        }
        state.state = DeployedState.STARTED;
        console.log(`Channel ${state.name} started`);
      } catch (error) {
        state.state = DeployedState.STOPPED;
        console.error(`Failed to start channel ${state.name}:`, error);
        throw error;
      }
    }
  }

  /**
   * Stop a channel
   */
  static async stopChannel(channelId: string): Promise<void> {
    const state = channelStates.get(channelId);
    if (!state) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    state.state = DeployedState.STOPPING;
    try {
      if (state.runtimeChannel) {
        await state.runtimeChannel.stop();
      }
      state.state = DeployedState.STOPPED;
      console.log(`Channel ${state.name} stopped`);
    } catch (error) {
      console.error(`Error stopping channel ${state.name}:`, error);
      state.state = DeployedState.STOPPED;
    }
  }

  /**
   * Halt a channel (force stop)
   */
  static async haltChannel(channelId: string): Promise<void> {
    const state = channelStates.get(channelId);
    if (!state) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    if (state.runtimeChannel) {
      await state.runtimeChannel.stop();
    }
    state.state = DeployedState.STOPPED;
    console.log(`Channel ${state.name} halted`);
  }

  /**
   * Pause a channel
   */
  static async pauseChannel(channelId: string): Promise<void> {
    const state = channelStates.get(channelId);
    if (!state) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    state.state = DeployedState.PAUSING;
    try {
      if (state.runtimeChannel) {
        await state.runtimeChannel.pause();
      }
      state.state = DeployedState.PAUSED;
      console.log(`Channel ${state.name} paused`);
    } catch (error) {
      console.error(`Error pausing channel ${state.name}:`, error);
      state.state = DeployedState.STARTED;
    }
  }

  /**
   * Resume a channel
   */
  static async resumeChannel(channelId: string): Promise<void> {
    const state = channelStates.get(channelId);
    if (!state) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    state.state = DeployedState.STARTING;
    try {
      if (state.runtimeChannel) {
        await state.runtimeChannel.resume();
      }
      state.state = DeployedState.STARTED;
      console.log(`Channel ${state.name} resumed`);
    } catch (error) {
      console.error(`Error resuming channel ${state.name}:`, error);
      state.state = DeployedState.PAUSED;
    }
  }

  /**
   * Start a connector
   */
  static async startConnector(channelId: string, metaDataId: number): Promise<void> {
    const state = channelStates.get(channelId);
    if (!state) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }
    console.log(`Connector ${metaDataId} on channel ${state.name} started`);
  }

  /**
   * Stop a connector
   */
  static async stopConnector(channelId: string, metaDataId: number): Promise<void> {
    const state = channelStates.get(channelId);
    if (!state) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }
    console.log(`Connector ${metaDataId} on channel ${state.name} stopped`);
  }

  /**
   * Check if channel is deployed
   */
  static isDeployed(channelId: string): boolean {
    return channelStates.has(channelId);
  }

  /**
   * Get the runtime channel instance for a deployed channel
   */
  static getDeployedChannel(channelId: string): Channel | null {
    const state = channelStates.get(channelId);
    return state?.runtimeChannel ?? null;
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
    return channelStates.size;
  }

  /**
   * Create DashboardStatus from ChannelState
   */
  private static createStatusFromState(state: ChannelState): DashboardStatus {
    return {
      channelId: state.channelId,
      name: state.name,
      state: state.state,
      deployedDate: state.deployedDate,
      deployedRevisionDelta: 0,
      statistics: createEmptyStatistics(),
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
