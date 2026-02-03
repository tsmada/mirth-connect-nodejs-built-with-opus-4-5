/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/DeployedState.java
 * and ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/channel/DeployedState.java
 *
 * Purpose: Represents the deployment state of a channel or connector.
 *
 * Key behaviors to replicate:
 * - Match Java enum values exactly
 * - Provide conversion from donkey DeployedState
 */

/**
 * Represents the deployment state of a channel or connector.
 */
export enum DeployedState {
  /** Channel/connector is deployed and started, actively processing messages */
  STARTED = 'STARTED',

  /** Channel/connector is deployed and stopped, not processing messages */
  STOPPED = 'STOPPED',

  /** Channel/connector is deployed but paused, temporarily not processing messages */
  PAUSED = 'PAUSED',

  /** Channel/connector is currently starting */
  STARTING = 'STARTING',

  /** Channel/connector is currently stopping */
  STOPPING = 'STOPPING',

  /** Channel/connector is in an unknown state */
  UNKNOWN = 'UNKNOWN',
}

/**
 * State descriptions for display purposes
 */
export const DEPLOYED_STATE_DESCRIPTIONS: Record<DeployedState, string> = {
  [DeployedState.STARTED]: 'Started',
  [DeployedState.STOPPED]: 'Stopped',
  [DeployedState.PAUSED]: 'Paused',
  [DeployedState.STARTING]: 'Starting',
  [DeployedState.STOPPING]: 'Stopping',
  [DeployedState.UNKNOWN]: 'Unknown',
};

/**
 * Parse a string to DeployedState enum
 */
export function parseDeployedState(value: string): DeployedState {
  const upperValue = value.toUpperCase();
  const state = Object.values(DeployedState).find((s) => s === upperValue);
  if (state == null) {
    return DeployedState.UNKNOWN;
  }
  return state;
}

/**
 * Check if a state represents a running/active state
 */
export function isActiveState(state: DeployedState): boolean {
  return state === DeployedState.STARTED;
}

/**
 * Check if a state represents a transitional state
 */
export function isTransitionalState(state: DeployedState): boolean {
  return state === DeployedState.STARTING || state === DeployedState.STOPPING;
}
