/**
 * Cluster module public API
 *
 * Re-exports all cluster-related modules for convenient imports.
 */

export { getServerId, resetServerId } from './ClusterIdentity.js';
export { getClusterConfig, resetClusterConfig } from './ClusterConfig.js';
export type { ClusterConfiguration } from './ClusterConfig.js';
export {
  registerServer,
  startHeartbeat,
  stopHeartbeat,
  startDeadNodeDetection,
  stopDeadNodeDetection,
  deregisterServer,
  getClusterNodes,
  isNodeAlive,
  getOfflineNodeIds,
} from './ServerRegistry.js';
export type { ClusterNode } from './ServerRegistry.js';
export { isQuorumEnabled, hasQuorum, getQuorumStatus } from './QuorumCheck.js';
export type { QuorumStatus } from './QuorumCheck.js';
export {
  healthRouter,
  setShuttingDown,
  isShuttingDown,
  setStartupComplete,
  isStartupComplete,
} from './HealthCheck.js';
export { SequenceAllocator } from './SequenceAllocator.js';
export { ChannelMutex } from './ChannelMutex.js';
export type { MapBackend } from './MapBackend.js';
export { InMemoryMapBackend, DatabaseMapBackend, RedisMapBackend } from './MapBackend.js';
export {
  registerDeployment,
  unregisterDeployment,
  unregisterAllDeployments,
  getChannelInstances,
  getDeployedChannels,
} from './ChannelRegistry.js';
export { dispatchToRemote, internalRouter } from './RemoteDispatcher.js';
export type { RemoteDispatchResult } from './RemoteDispatcher.js';
export type { EventBus } from './EventBus.js';
export {
  LocalEventBus,
  DatabasePollingEventBus,
  RedisEventBus,
  createEventBus,
} from './EventBus.js';
export {
  isShadowMode,
  setShadowMode,
  promoteChannel,
  demoteChannel,
  isChannelPromoted,
  promoteAllChannels,
  getPromotedChannels,
  isChannelActive,
  resetShadowMode,
} from './ShadowMode.js';
export {
  initTakeoverPollingGuard,
  isPollingAllowedInTakeover,
  enableTakeoverPolling,
  disableTakeoverPolling,
  getTakeoverPollingEnabled,
  resetTakeoverPollingGuard,
} from './TakeoverPollingGuard.js';
export {
  acquireLease,
  renewLease,
  releaseLease,
  releaseAllLeases,
  startLeaseRenewal,
  stopLeaseRenewal,
  stopAllLeaseRenewals,
  getAllLeases,
} from './PollingLeaseManager.js';
export type { LeaseInfo } from './PollingLeaseManager.js';
