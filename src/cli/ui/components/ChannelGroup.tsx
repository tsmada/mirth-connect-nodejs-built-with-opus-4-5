/**
 * ChannelGroup Component
 *
 * Collapsible channel group header.
 */

import React, { FC } from 'react';
import { Box, Text } from 'ink';

export interface ChannelGroupProps {
  name: string;
  channelCount: number;
  expanded: boolean;
  selected: boolean;
}

/**
 * Channel group header component
 */
export const ChannelGroup: FC<ChannelGroupProps> = ({ name, channelCount, expanded, selected }) => {
  const expandIcon = expanded ? '▼' : '▶';
  const rowColor = selected ? 'cyan' : 'white';

  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(
      Text,
      { color: rowColor, inverse: selected, bold: true },
      `${expandIcon} ${name} (${channelCount})`
    ),
    !expanded &&
      React.createElement(Text, { color: 'gray' }, '                              [collapsed]')
  );
};

export default ChannelGroup;
