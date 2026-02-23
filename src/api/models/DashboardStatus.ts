/**
 * Dashboard Status model for channel status API
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/DashboardStatus.java
 */

/**
 * Listener information for socket-based source connectors.
 * Provides real-time visibility into port and connection status.
 */
export interface ListenerInfo {
  /** The port number the connector is listening on */
  port: number;
  /** The host/interface the connector is bound to */
  host: string;
  /** Current number of active connections */
  connectionCount: number;
  /** Maximum allowed connections (0 = unlimited) */
  maxConnections: number;
  /** Transport type identifier (TCP, MLLP, HTTP, WS, DICOM) */
  transportType: string;
  /** Whether the server socket is actively listening */
  listening: boolean;
}

export enum DeployedState {
  DEPLOYING = 'DEPLOYING',
  UNDEPLOYING = 'UNDEPLOYING',
  STARTING = 'STARTING',
  STARTED = 'STARTED',
  PAUSING = 'PAUSING',
  PAUSED = 'PAUSED',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  SYNCING = 'SYNCING',
  UNKNOWN = 'UNKNOWN',
}

export interface DashboardStatus {
  channelId: string;
  name: string;
  state: DeployedState;
  deployedRevisionDelta?: number;
  deployedDate?: Date;
  statistics: ChannelStatistics;
  childStatuses?: DashboardStatus[];
  metaDataId?: number;
  queueEnabled?: boolean;
  queued?: number;
  waitForPrevious?: boolean;
  /** Transport type name, e.g. "TCP Listener", "HTTP Dispatcher" */
  transportName?: string;
  /** Whether the connector is enabled (destinations only) */
  enabled?: boolean;
  /** Listener info for socket-based source connectors (TCP, MLLP, HTTP, WS, DICOM) */
  listenerInfo?: ListenerInfo;
}

export interface ChannelStatistics {
  received: number;
  sent: number;
  error: number;
  filtered: number;
  queued: number;
}

export interface DashboardChannelInfo {
  dashboardStatuses: DashboardStatus[];
  remainingChannelIds: string[];
}

export function createEmptyStatistics(): ChannelStatistics {
  return {
    received: 0,
    sent: 0,
    error: 0,
    filtered: 0,
    queued: 0,
  };
}

export function createDashboardStatus(
  channelId: string,
  name: string,
  state: DeployedState
): DashboardStatus {
  return {
    channelId,
    name,
    state,
    statistics: createEmptyStatistics(),
  };
}
