/**
 * StatusIndicator Component
 *
 * Color-coded status indicator for channel states.
 */

import React, { FC } from 'react';
import { Text } from 'ink';
import { ChannelState } from '../../types/index.js';

export interface StatusIndicatorProps {
  state: ChannelState;
  compact?: boolean;
}

const STATE_COLORS: Record<ChannelState, string> = {
  STARTED: 'green',
  STOPPED: 'red',
  PAUSED: 'yellow',
  STARTING: 'cyan',
  STOPPING: 'cyan',
  PAUSING: 'cyan',
  UNDEPLOYED: 'gray',
};

const STATE_SYMBOLS: Record<ChannelState, string> = {
  STARTED: '●',
  STOPPED: '○',
  PAUSED: '◐',
  STARTING: '◔',
  STOPPING: '◔',
  PAUSING: '◔',
  UNDEPLOYED: '○',
};

/**
 * Fixed width for status display (longest: "○ UNDEPLOYED" = 12 chars)
 */
const STATUS_WIDTH = 12;

/**
 * Status indicator component
 */
export const StatusIndicator: FC<StatusIndicatorProps> = ({ state, compact = false }) => {
  const color = STATE_COLORS[state] || 'white';
  const symbol = STATE_SYMBOLS[state] || '?';

  if (compact) {
    return React.createElement(Text, { color }, symbol);
  }

  // Pad to fixed width for column alignment
  const display = `${symbol} ${state}`.padEnd(STATUS_WIDTH);
  return React.createElement(Text, { color }, display);
};

export default StatusIndicator;
