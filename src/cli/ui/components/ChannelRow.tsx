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
 * Channel row component
 */
export const ChannelRow: FC<ChannelRowProps> = ({
  channel,
  selected,
  multiSelected = false,
  width,
  indent = 0,
}) => {
  const nameWidth = Math.min(30, width - 70);
  const indentStr = '  '.repeat(indent);

  let name = channel.name;
  if (name.length > nameWidth) {
    name = name.slice(0, nameWidth - 3) + '...';
  } else {
    name = name.padEnd(nameWidth);
  }

  const stats = channel.statistics || { received: 0, sent: 0, errored: 0, filtered: 0, queued: 0 };
  const errorColor = stats.errored > 0 ? 'red' : 'gray';

  const selectionIndicator = multiSelected ? '✓' : selected ? '▶' : ' ';
  const rowColor = selected ? 'cyan' : 'white';

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
    // Statistics
    React.createElement(Text, { color: 'gray' }, '  R:'),
    React.createElement(Text, { color: 'green' }, String(stats.received).padStart(6)),
    React.createElement(Text, { color: 'gray' }, ' F:'),
    React.createElement(Text, { color: 'yellow' }, String(stats.filtered || 0).padStart(4)),
    React.createElement(Text, { color: 'gray' }, ' Q:'),
    React.createElement(Text, { color: 'blue' }, String(stats.queued || 0).padStart(4)),
    React.createElement(Text, { color: 'gray' }, ' S:'),
    React.createElement(Text, { color: 'green' }, String(stats.sent).padStart(6)),
    React.createElement(Text, { color: 'gray' }, ' E:'),
    React.createElement(Text, { color: errorColor }, String(stats.errored).padStart(4))
  );
};

export default ChannelRow;
