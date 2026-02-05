/**
 * ChannelRow Component
 *
 * Single channel row in the channel list.
 */

import React, { FC } from 'react';
import { Box, Text } from 'ink';
import { ChannelStatus } from '../../types/index.js';
import { StatusIndicator } from './StatusIndicator.js';

export interface ChannelRowProps {
  channel: ChannelStatus;
  selected: boolean;
  multiSelected?: boolean;
  width: number;
  indent?: number;
}

/**
 * Format listener info for display.
 * Shows "PORT(N)" where N is connection count, or "-" for non-listeners.
 */
function formatListenerInfo(channel: ChannelStatus): string {
  const info = channel.listenerInfo;
  if (!info || !info.port) {
    return '-'.padStart(10);
  }

  // Format: "6661(3)" or just "6661" if no active connections
  const portStr = String(info.port);
  const display = info.connectionCount > 0
    ? `${portStr}(${info.connectionCount})`
    : portStr;

  return display.padStart(10);
}

/**
 * Column widths for consistent layout
 */
export const COLUMN_WIDTHS = {
  selector: 2,      // "✓ " or "▶ " or "  "
  indentPer: 2,     // 2 chars per indent level
  nameSpace: 1,     // space after name
  status: 12,       // StatusIndicator fixed width
  port: 10,         // listenerDisplay padStart
  stats: 38,        // R:+5 + F:+4 + Q:+4 + S:+5 + E:+4 with labels
};

/**
 * Calculate name width based on terminal width
 */
export function calculateNameWidth(terminalWidth: number, indent: number = 0): number {
  const baseWidth = COLUMN_WIDTHS.selector +
    (COLUMN_WIDTHS.indentPer * indent) +
    COLUMN_WIDTHS.nameSpace +
    COLUMN_WIDTHS.status +
    COLUMN_WIDTHS.port +
    COLUMN_WIDTHS.stats;
  return Math.max(15, Math.min(28, terminalWidth - baseWidth));
}

/**
 * Channel row component
 */
export const ChannelRow: FC<ChannelRowProps> = ({
  channel,
  selected,
  multiSelected = false,
  width,
  indent = 0,
}) => {
  const nameWidth = calculateNameWidth(width, indent);
  const indentStr = '  '.repeat(indent);

  let name = channel.name;
  if (name.length > nameWidth) {
    name = name.slice(0, nameWidth - 3) + '...';
  } else {
    name = name.padEnd(nameWidth);
  }

  const stats = channel.statistics || { received: 0, sent: 0, error: 0, filtered: 0, queued: 0 };
  const errorColor = stats.error > 0 ? 'red' : 'gray';

  const selectionIndicator = multiSelected ? '✓' : selected ? '▶' : ' ';
  const rowColor = selected ? 'cyan' : 'white';

  // Format listener info (port and connection count)
  const listenerDisplay = formatListenerInfo(channel);
  const listenerColor = channel.listenerInfo?.connectionCount ? 'cyan' : 'gray';

  return React.createElement(
    Box,
    { flexDirection: 'row' },
    // Selection indicator
    React.createElement(
      Text,
      { color: multiSelected ? 'green' : rowColor, inverse: selected && !multiSelected },
      `${selectionIndicator} ${indentStr}`
    ),
    // Channel name
    React.createElement(Text, { color: 'white' }, name + ' '),
    // Status
    React.createElement(StatusIndicator, { state: channel.state }),
    // Port/Listener info
    React.createElement(Text, { color: listenerColor }, listenerDisplay),
    // Statistics
    React.createElement(Text, { color: 'gray' }, '  R:'),
    React.createElement(Text, { color: 'green' }, String(stats.received).padStart(5)),
    React.createElement(Text, { color: 'gray' }, ' F:'),
    React.createElement(Text, { color: 'yellow' }, String(stats.filtered || 0).padStart(4)),
    React.createElement(Text, { color: 'gray' }, ' Q:'),
    React.createElement(Text, { color: 'blue' }, String(stats.queued || 0).padStart(4)),
    React.createElement(Text, { color: 'gray' }, ' S:'),
    React.createElement(Text, { color: 'green' }, String(stats.sent).padStart(5)),
    React.createElement(Text, { color: 'gray' }, ' E:'),
    React.createElement(Text, { color: errorColor }, String(stats.error).padStart(4))
  );
};

export default ChannelRow;
