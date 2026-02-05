/**
 * ChannelDetails Component
 *
 * Detailed view of a single channel with tabs.
 */

import React, { FC, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ChannelStatus } from '../../types/index.js';
import { StatusIndicator } from './StatusIndicator.js';

export type DetailsTab = 'info' | 'messages' | 'connectors';

export interface ChannelDetailsProps {
  channel: ChannelStatus;
  onClose: () => void;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onPause: () => Promise<void>;
  onDeploy: () => Promise<void>;
  onUndeploy: () => Promise<void>;
  onViewMessages: () => void;
}

/**
 * Channel details overlay component
 */
export const ChannelDetails: FC<ChannelDetailsProps> = ({
  channel,
  onClose,
  onStart,
  onStop,
  onPause,
  onDeploy,
  onUndeploy,
  onViewMessages,
}) => {
  const [activeTab, setActiveTab] = useState<DetailsTab>('info');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const stats = channel.statistics || {
    received: 0,
    filtered: 0,
    queued: 0,
    sent: 0,
    errored: 0,
  };

  // Handle keyboard input
  useInput(async (input, key) => {
    if (key.escape) {
      onClose();
    } else if (key.tab) {
      const tabs: DetailsTab[] = ['info', 'messages', 'connectors'];
      const currentIndex = tabs.indexOf(activeTab);
      const nextTab = tabs[(currentIndex + 1) % tabs.length];
      if (nextTab) {
        setActiveTab(nextTab);
      }
    } else if (input === 's' || input === 'S') {
      setActionMessage('Starting...');
      try {
        await onStart();
        setActionMessage('Started');
      } catch (e) {
        setActionMessage(`Error: ${(e as Error).message}`);
      }
    } else if (input === 't' || input === 'T') {
      setActionMessage('Stopping...');
      try {
        await onStop();
        setActionMessage('Stopped');
      } catch (e) {
        setActionMessage(`Error: ${(e as Error).message}`);
      }
    } else if (input === 'p' || input === 'P') {
      setActionMessage('Pausing...');
      try {
        await onPause();
        setActionMessage('Paused');
      } catch (e) {
        setActionMessage(`Error: ${(e as Error).message}`);
      }
    } else if (input === 'd' || input === 'D') {
      setActionMessage('Deploying...');
      try {
        await onDeploy();
        setActionMessage('Deployed');
      } catch (e) {
        setActionMessage(`Error: ${(e as Error).message}`);
      }
    } else if (input === 'u' || input === 'U') {
      setActionMessage('Undeploying...');
      try {
        await onUndeploy();
        setActionMessage('Undeployed');
      } catch (e) {
        setActionMessage(`Error: ${(e as Error).message}`);
      }
    } else if (input === 'm' || input === 'M') {
      onViewMessages();
    }
  });

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(70, termWidth - 4);

  const renderTabButton = (tab: DetailsTab, label: string) =>
    React.createElement(
      Text,
      {
        color: activeTab === tab ? 'cyan' : 'gray',
        inverse: activeTab === tab,
      },
      ` ${label} `
    );

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 2,
      paddingY: 1,
      width: boxWidth,
    },
    // Header with channel name
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'white' }, channel.name),
      React.createElement(Text, { color: 'gray' }, '[Escape] Close')
    ),
    // Tabs
    React.createElement(
      Box,
      { flexDirection: 'row', marginBottom: 1 },
      renderTabButton('info', 'Info'),
      React.createElement(Text, null, ' '),
      renderTabButton('messages', 'Messages'),
      React.createElement(Text, null, ' '),
      renderTabButton('connectors', 'Connectors')
    ),
    // Divider
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: 'gray' }, '─'.repeat(boxWidth - 6))
    ),
    // Tab content
    activeTab === 'info' &&
      React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        // ID
        React.createElement(
          Box,
          { flexDirection: 'row' },
          React.createElement(Text, { color: 'gray' }, 'ID:        '),
          React.createElement(Text, null, channel.channelId)
        ),
        // Status
        React.createElement(
          Box,
          { flexDirection: 'row', marginTop: 1 },
          React.createElement(Text, { color: 'gray' }, 'Status:    '),
          React.createElement(StatusIndicator, { state: channel.state })
        ),
        // Statistics header
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, { color: 'gray', bold: true }, 'Statistics')
        ),
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, { color: 'gray' }, '─'.repeat(30))
        ),
        // Stats grid
        React.createElement(
          Box,
          { flexDirection: 'row', marginTop: 1 },
          React.createElement(
            Box,
            { flexDirection: 'column', marginRight: 4 },
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, { color: 'gray' }, 'Received:  '),
              React.createElement(Text, { color: 'green' }, String(stats.received))
            ),
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, { color: 'gray' }, 'Sent:      '),
              React.createElement(Text, { color: 'green' }, String(stats.sent))
            )
          ),
          React.createElement(
            Box,
            { flexDirection: 'column', marginRight: 4 },
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, { color: 'gray' }, 'Filtered:  '),
              React.createElement(Text, { color: 'yellow' }, String(stats.filtered || 0))
            ),
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, { color: 'gray' }, 'Errored:   '),
              React.createElement(
                Text,
                { color: stats.errored > 0 ? 'red' : 'gray' },
                String(stats.errored)
              )
            )
          ),
          React.createElement(
            Box,
            { flexDirection: 'column' },
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, { color: 'gray' }, 'Queued:    '),
              React.createElement(Text, { color: 'blue' }, String(stats.queued || 0))
            )
          )
        )
      ),
    activeTab === 'messages' &&
      React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        React.createElement(
          Text,
          { color: 'gray' },
          'Press [M] to view messages for this channel.'
        )
      ),
    activeTab === 'connectors' &&
      React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        React.createElement(Text, { color: 'gray' }, 'Connector information not yet implemented.')
      ),
    // Action message
    actionMessage &&
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: 'yellow' }, actionMessage)
      ),
    // Footer shortcuts
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { color: 'gray' },
        '[S] Start  [T] Stop  [P] Pause  [D] Deploy  [U] Undeploy  [M] Messages'
      )
    )
  );
};

export default ChannelDetails;
