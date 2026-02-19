/**
 * StatusBar Component
 *
 * Footer with server info, channel count, and status messages.
 */

import React, { FC, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { DashboardMessage } from '../context/DashboardContext.js';

export interface StatusBarProps {
  serverUrl: string;
  channelCount: number;
  lastUpdate: Date;
  message?: DashboardMessage | null;
}

/**
 * Format elapsed seconds into a human-readable string.
 */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

/**
 * Status bar component
 */
export const StatusBar: FC<StatusBarProps> = ({ serverUrl, channelCount, lastUpdate, message }) => {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - lastUpdate.getTime()) / 1000))
  );

  // Tick every second to keep the "Xs ago" display current
  useEffect(() => {
    const compute = () => Math.max(0, Math.floor((Date.now() - lastUpdate.getTime()) / 1000));
    setElapsed(compute());
    const timer = setInterval(() => setElapsed(compute()), 1000);
    return () => clearInterval(timer);
  }, [lastUpdate]);

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
      React.createElement(Text, { color: 'gray' }, `Updated: ${formatElapsed(elapsed)}`)
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
