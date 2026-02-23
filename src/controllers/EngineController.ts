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
import { ConfigurationController } from './ConfigurationController.js';
import { Channel } from '../donkey/channel/Channel.js';
import { buildChannel } from '../donkey/channel/ChannelBuilder.js';
import { ensureChannelTables, ensureMetaDataColumns } from '../db/SchemaManager.js';
import type { Donkey } from '../donkey/Donkey.js';
import { RawMessage } from '../model/RawMessage.js';
import {
  VmDispatcher,
  EngineController as IVmEngineController,
  DispatchResult,
} from '../connectors/vm/VmDispatcher.js';
import { Status } from '../model/Status.js';
import {
  dashboardStatusController,
  ConnectionStatusEvent,
} from '../plugins/dashboardstatus/DashboardStatusController.js';
import { ConnectionStatusEventType } from '../plugins/dashboardstatus/ConnectionLogItem.js';
import type { StateChangeEvent } from '../donkey/channel/Channel.js';
import { isShadowMode, isChannelActive, isChannelPromoted } from '../cluster/ShadowMode.js';
import { getLogger, registerComponent } from '../logging/index.js';
import { GlobalChannelMapStore } from '../javascript/userutil/MirthMap.js';
import { getAllCodeTemplateScriptsForChannel } from '../plugins/codetemplates/CodeTemplateController.js';
import { createJavaScriptExecutor } from '../javascript/runtime/JavaScriptExecutor.js';

registerComponent('engine', 'Channel deploy/start/stop');
const logger = getLogger('engine');

// Setter injection: breaks circular import with Mirth.ts
// Mirth.ts calls setDonkeyInstance() after creating the Donkey engine
let donkeyInstanceRef: Donkey | null = null;

/**
 * Set the global Donkey engine reference.
 * Called by Mirth.ts during startup to break the circular import.
 */
export function setDonkeyInstance(d: Donkey): void {
  donkeyInstanceRef = d;
}

/**
 * Deployment metadata for a channel.
 * Note: State is NOT stored here - it comes from Channel.currentState
 */
interface DeploymentInfo {
  channelId: string;
  name: string;
  deployedDate: Date;
  deployedRevision?: number;
  runtimeChannel: Channel; // Runtime channel instance - source of truth for state
}

/**
 * Map of deployed channels by ID.
 * The Channel.currentState within each entry is the authoritative state.
 */
const deployedChannels = new Map<string, DeploymentInfo>();

/**
 * Map DeployedState to ConnectionStatusEventType for dashboard display
 */
function deployedStateToConnectionStatus(state: DeployedState): ConnectionStatusEventType {
  switch (state) {
    case DeployedState.STARTED:
      return ConnectionStatusEventType.CONNECTED;
    case DeployedState.STOPPED:
    case DeployedState.UNDEPLOYING:
      return ConnectionStatusEventType.DISCONNECTED;
    case DeployedState.STARTING:
    case DeployedState.DEPLOYING:
      return ConnectionStatusEventType.CONNECTING;
    case DeployedState.PAUSED:
    case DeployedState.PAUSING:
    case DeployedState.STOPPING:
      return ConnectionStatusEventType.WAITING;
    default:
      return ConnectionStatusEventType.IDLE;
  }
}

/**
 * Throttle timestamps for messageComplete events (1 event/second per channel)
 */
const messageCompleteLastEmit = new Map<string, number>();

/**
 * Wire a runtime channel's events to the DashboardStatusController.
 * Subscribes to stateChange, connectorStateChange, and messageComplete events.
 */
export function wireChannelToDashboard(runtimeChannel: Channel, channelName: string): void {
  const channelId = runtimeChannel.getId();

  // Channel-level state changes (source connector, metadataId 0)
  runtimeChannel.on('stateChange', (event: StateChangeEvent) => {
    const statusEvent: ConnectionStatusEvent = {
      channelId: event.channelId,
      metadataId: 0,
      state: deployedStateToConnectionStatus(event.state),
      channelName: event.channelName,
    };
    dashboardStatusController.processEvent(statusEvent);
  });

  // Individual connector state changes (with actual metaDataId)
  runtimeChannel.on(
    'connectorStateChange',
    (event: {
      channelId: string;
      channelName: string;
      metaDataId: number;
      connectorName: string;
      state: DeployedState;
    }) => {
      const statusEvent: ConnectionStatusEvent = {
        channelId: event.channelId,
        metadataId: event.metaDataId,
        state: deployedStateToConnectionStatus(event.state),
        channelName: event.channelName,
      };
      dashboardStatusController.processEvent(statusEvent);
    }
  );

  // Message complete events (throttled to 1/second per channel)
  runtimeChannel.on('messageComplete', () => {
    const now = Date.now();
    const lastEmit = messageCompleteLastEmit.get(channelId) ?? 0;
    if (now - lastEmit >= 1000) {
      messageCompleteLastEmit.set(channelId, now);
      const statusEvent: ConnectionStatusEvent = {
        channelId,
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        channelName,
      };
      dashboardStatusController.processEvent(statusEvent);
    }
  });
}

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

    // If channel is already deployed, undeploy it first (releases ports, cleans up)
    if (deployedChannels.has(channelId)) {
      logger.info(`Channel ${channelConfig.name} already deployed — undeploying before redeploy`);
      await this.undeployChannel(channelId);
    }

    // Ensure channel tables exist before deployment
    await ensureChannelTables(channelId);
    logger.debug(`Channel tables verified for ${channelConfig.name}`);

    // Sync custom metadata columns to match channel configuration
    const metaDataColumns = channelConfig.properties?.metaDataColumns ?? [];
    if (metaDataColumns.length > 0) {
      await ensureMetaDataColumns(channelId, metaDataColumns);
    }

    try {
      // Load global scripts for preprocessor/postprocessor chaining (SBF-INIT-001)
      let globalPreprocessorScript: string | undefined;
      let globalPostprocessorScript: string | undefined;
      try {
        const globalScripts = await ConfigurationController.getGlobalScripts();
        globalPreprocessorScript = globalScripts.Preprocessor || undefined;
        globalPostprocessorScript = globalScripts.Postprocessor || undefined;
      } catch (gsError) {
        logger.warn(`Failed to load global scripts for ${channelConfig.name}: ${String(gsError)}`);
      }

      // Build runtime channel with connectors
      const runtimeChannel = buildChannel(channelConfig, {
        globalPreprocessorScript,
        globalPostprocessorScript,
      });

      // Fetch code templates for this channel and create a per-channel executor
      try {
        const codeTemplateScripts = await getAllCodeTemplateScriptsForChannel(channelId);
        logger.debug(`Channel ${channelConfig.name}: found ${codeTemplateScripts.length} code template scripts`);
        if (codeTemplateScripts.length > 0) {
          const channelExecutor = createJavaScriptExecutor({ codeTemplates: codeTemplateScripts });
          runtimeChannel.setExecutor(channelExecutor);

          // Wire the same executor to all filter/transformer executors
          const sourceConnector = runtimeChannel.getSourceConnector();
          if (sourceConnector?.getFilterTransformerExecutor()) {
            sourceConnector.getFilterTransformerExecutor()!.setExecutor(channelExecutor);
          }
          for (const dest of runtimeChannel.getDestinationConnectors()) {
            if (dest.getFilterTransformerExecutor()) {
              dest.getFilterTransformerExecutor()!.setExecutor(channelExecutor);
            }
          }
          logger.debug(
            `Injected ${codeTemplateScripts.length} code template(s) for ${channelConfig.name}`
          );
        }
      } catch (ctError) {
        // Code template loading is non-fatal — log and continue
        logger.warn(`Failed to load code templates for ${channelConfig.name}: ${String(ctError)}`);
      }

      // Wire channel events to dashboard status controller
      wireChannelToDashboard(runtimeChannel, channelConfig.name);

      // Wire VM dispatchers to engine controller
      for (const dest of runtimeChannel.getDestinationConnectors()) {
        if (dest instanceof VmDispatcher) {
          dest.setEngineController(engineControllerAdapter);
        }
      }

      // Channel starts in DEPLOYING state
      runtimeChannel.updateCurrentState(DeployedState.DEPLOYING);

      // Register with Donkey engine (if available)
      if (donkeyInstanceRef && !donkeyInstanceRef.getChannel(channelId)) {
        await donkeyInstanceRef.deployChannel(runtimeChannel);
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

      // Warm per-channel GlobalChannelMap ($gc) from database backend
      try {
        await GlobalChannelMapStore.getInstance().loadChannelFromBackend(channelId);
      } catch (gcError) {
        logger.warn(
          `Failed to load GlobalChannelMap for ${channelConfig.name}: ${String(gcError)}`
        );
      }

      // Determine initial state from channel properties
      const initialState = channelConfig.properties?.initialState || DeployedState.STARTED;

      // Start the channel if initial state is STARTED
      // In shadow mode, only start promoted channels — others remain deployed but stopped
      if (initialState === DeployedState.STARTED) {
        if (!isShadowMode() || isChannelPromoted(channelId)) {
          await runtimeChannel.start();
        } else {
          // Shadow mode: load stats for dashboard display without starting connectors
          await runtimeChannel.loadStatisticsFromDb();
        }
      }

      // Register in cluster channel registry (non-fatal)
      try {
        const { registerDeployment } = await import('../cluster/ChannelRegistry.js');
        const { getServerId } = await import('../cluster/ClusterIdentity.js');
        await registerDeployment(getServerId(), channelId);
      } catch {
        // Non-fatal — cluster visibility only
      }

      logger.info(
        `Channel ${channelConfig.name} deployed with state ${runtimeChannel.getCurrentState()}`
      );
    } catch (error) {
      logger.error(`Failed to deploy channel ${channelConfig.name}`, error as Error);
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
      logger.error(`Error stopping channel ${name}`, error as Error);
    }

    // Clear dashboard state for this channel
    dashboardStatusController.resetChannelState(channelId);

    // Clean up messageComplete throttle entry
    messageCompleteLastEmit.delete(channelId);

    // Remove from Donkey engine (prevents stale channel reference on redeploy)
    if (donkeyInstanceRef && donkeyInstanceRef.getChannel(channelId)) {
      try {
        await donkeyInstanceRef.undeployChannel(channelId);
      } catch {
        // Channel may already be removed — safe to ignore
      }
    }

    // Remove from deployed channels
    deployedChannels.delete(channelId);

    // Unregister from cluster channel registry (non-fatal)
    try {
      const { unregisterDeployment } = await import('../cluster/ChannelRegistry.js');
      const { getServerId } = await import('../cluster/ClusterIdentity.js');
      await unregisterDeployment(getServerId(), channelId);
    } catch {
      // Non-fatal — cluster visibility only
    }

    logger.info(`Channel ${name} undeployed`);
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
      logger.info(`Channel ${name} started`);
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
    logger.info(`Channel ${name} stopped`);
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
    await runtimeChannel.halt();
    logger.info(`Channel ${name} halted`);
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
    logger.info(`Channel ${name} paused`);
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
    logger.info(`Channel ${name} resumed`);
  }

  /**
   * Start a specific connector within a deployed channel.
   * metaDataId 0 = source connector, 1+ = destination connector.
   * Matches Java DonkeyEngineController.startConnector().
   */
  static async startConnector(channelId: string, metaDataId: number): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    const { runtimeChannel, name } = deployment;

    if (metaDataId === 0) {
      // Source connector
      const source = runtimeChannel.getSourceConnector();
      if (!source) {
        throw new Error(`No source connector on channel ${name}`);
      }
      await source.start();
      logger.info(`Source connector on channel ${name} started`);
    } else {
      // Destination connector
      const dest = runtimeChannel
        .getDestinationConnectors()
        .find((d) => d.getMetaDataId() === metaDataId);
      if (!dest) {
        throw new Error(`Destination connector ${metaDataId} not found on channel ${name}`);
      }
      await dest.start();
      if (dest.isQueueEnabled()) {
        dest.startQueueProcessing();
      }
      logger.info(`Destination connector ${metaDataId} on channel ${name} started`);
    }
  }

  /**
   * Stop a specific connector within a deployed channel.
   * metaDataId 0 = source connector, 1+ = destination connector.
   * Matches Java DonkeyEngineController.stopConnector().
   */
  static async stopConnector(channelId: string, metaDataId: number): Promise<void> {
    const deployment = deployedChannels.get(channelId);
    if (!deployment) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    const { runtimeChannel, name } = deployment;

    if (metaDataId === 0) {
      // Source connector
      const source = runtimeChannel.getSourceConnector();
      if (!source) {
        throw new Error(`No source connector on channel ${name}`);
      }
      await source.stop();
      logger.info(`Source connector on channel ${name} stopped`);
    } else {
      // Destination connector
      const dest = runtimeChannel
        .getDestinationConnectors()
        .find((d) => d.getMetaDataId() === metaDataId);
      if (!dest) {
        throw new Error(`Destination connector ${metaDataId} not found on channel ${name}`);
      }
      await dest.stop();
      logger.info(`Destination connector ${metaDataId} on channel ${name} stopped`);
    }
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
   * Find a deployed channel by name
   */
  static getDeployedChannelByName(name: string): { id: string; name: string } | null {
    for (const [channelId, info] of deployedChannels) {
      if (info.name === name) return { id: channelId, name: info.name };
    }
    return null;
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

    // Shadow mode guard: block message dispatch to non-promoted channels
    if (isShadowMode() && !isChannelActive(channelId)) {
      throw new Error(
        `Channel ${channelId} is in shadow mode and not promoted for message processing`
      );
    }

    const message = await channel.dispatchRawMessage(rawMessage, sourceMapData);
    return {
      messageId: message.getMessageId(),
      processed: message.isProcessed(),
    };
  }

  /**
   * Dispatch a RawMessage to a channel (used by VmDispatcher and VMRouter).
   * Bridges the model RawMessage to channel.dispatchRawMessage().
   */
  static async dispatchRawMessage(
    channelId: string,
    rawMessage: RawMessage,
    _force?: boolean,
    _waitForCompletion?: boolean
  ): Promise<DispatchResult | null> {
    const channel = this.getDeployedChannel(channelId);
    if (!channel) {
      throw new Error(`Channel not deployed: ${channelId}`);
    }

    // Shadow mode guard: block message dispatch to non-promoted channels
    if (isShadowMode() && !isChannelActive(channelId)) {
      throw new Error(
        `Channel ${channelId} is in shadow mode and not promoted for message processing`
      );
    }

    const message = await channel.dispatchRawMessage(
      rawMessage.getRawData(),
      rawMessage.getSourceMap()
    );
    // Extract a response from the first destination connector message that has one
    let selectedResponse: { message: string; status?: Status } | undefined;
    const connectorMessages = message.getConnectorMessages();
    for (const [metaDataId, cm] of connectorMessages) {
      if (metaDataId > 0) {
        const responseContent = cm.getResponseContent();
        if (responseContent?.content) {
          selectedResponse = {
            message: responseContent.content,
            status: cm.getStatus(),
          };
          break;
        }
      }
    }
    return {
      messageId: message.getMessageId(),
      selectedResponse,
    };
  }

  /**
   * Get deployed channel count
   */
  static getDeployedCount(): number {
    return deployedChannels.size;
  }

  /**
   * Get all deployed channel IDs
   */
  static getDeployedChannelIds(): Set<string> {
    return new Set(deployedChannels.keys());
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
      const connectorWithListener = sourceConnector as {
        getListenerInfo?: () => ListenerInfo | null;
      };
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

/**
 * Adapter that implements VmDispatcher's EngineController interface,
 * bridging the static class to the instance interface VmDispatcher expects.
 */
export const engineControllerAdapter: IVmEngineController = {
  dispatchRawMessage: (channelId, rawMessage, force, waitForCompletion) =>
    EngineController.dispatchRawMessage(channelId, rawMessage, force, waitForCompletion),
};
