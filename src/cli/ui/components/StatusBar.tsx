/**
 * StatusBar Component
 *
 * Footer with server info, channel count, and status messages.
 */

import React, { FC } from 'react';
import { Box, Text } from 'ink';
import { DashboardMessage } from '../context/DashboardContext.js';

export interface StatusBarProps {
  serverUrl: string;
  channelCount: number;
  lastUpdate: Date;
  message?: DashboardMessage | null;
}

/**
 * Status bar component
 */
export const StatusBar: FC<StatusBarProps> = ({
  serverUrl,
  channelCount,
  lastUpdate,
  message,
}) => {
  const messageColor = message
    ? message.type === 'error'
      ? 'red'
      : message.type === 'success'
      ? 'green'
      : message.type === 'warning'
      ? 'yellow'
      : 'blue'
    : 'white';

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'gray' }, `Server: ${serverUrl} | `),
      React.createElement(Text, { color: 'gray' }, `Channels: ${channelCount} | `),
      React.createElement(Text, { color: 'gray' }, `Updated: ${lastUpdate.toLocaleTimeString()}`)
    ),
    message &&
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: messageColor }, message.text)
      )
  );
};

export default StatusBar;
