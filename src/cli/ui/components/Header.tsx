/**
 * Header Component
 *
 * Dashboard header with title, connection status, and refresh indicator.
 */

import React, { FC } from 'react';
import { Box, Text } from 'ink';
import { ConnectionStatus } from '../context/DashboardContext.js';

export interface HeaderProps {
  title?: string;
  connectionStatus: ConnectionStatus;
  loading?: boolean;
  serverUrl?: string;
}

const CONNECTION_STATUS_DISPLAY: Record<ConnectionStatus, { text: string; color: string }> = {
  connected: { text: 'WS: Connected', color: 'green' },
  disconnected: { text: 'WS: Disconnected', color: 'red' },
  connecting: { text: 'WS: Connecting...', color: 'yellow' },
  polling: { text: 'Polling', color: 'blue' },
};

/**
 * Header component
 */
export const Header: FC<HeaderProps> = ({
  title = 'Mirth Connect Dashboard',
  connectionStatus,
  loading = false,
  serverUrl,
}) => {
  const statusDisplay = CONNECTION_STATUS_DISPLAY[connectionStatus];
  const refreshIndicator = loading ? ' ⟳' : '';

  return React.createElement(
    Box,
    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: 'cyan', bold: true }, `  ${title}`),
      serverUrl && React.createElement(Text, { color: 'gray' }, ` (${serverUrl})`)
    ),
    React.createElement(
      Box,
      null,
      React.createElement(
        Text,
        { color: statusDisplay.color },
        `[${statusDisplay.text}]`
      ),
      React.createElement(Text, { color: 'yellow' }, refreshIndicator)
    )
  );
};

export default Header;
