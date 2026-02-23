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
  onTrace?: (channelId: string) => void;
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
  onTrace,
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
    } else if (input === 'x' || input === 'X') {
      onTrace?.(channel.channelId);
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

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1) + '\u2026' : s;

  const renderConnectorsTab = () => {
    const connectors = channel.childStatuses;
    if (!connectors || connectors.length === 0) {
      return React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        React.createElement(
          Text,
          { color: 'gray' },
          'Connector information unavailable. Channel may not be deployed.'
        )
      );
    }

    const source = connectors.find((c) => c.metaDataId === 0);
    const destinations = connectors.filter((c) => c.metaDataId !== 0);

    const elements: React.ReactElement[] = [];

    // Source section
    if (source) {
      elements.push(
        React.createElement(
          Box,
          { key: 'src-header', flexDirection: 'column', marginTop: 1 },
          React.createElement(Text, { bold: true, color: 'white' }, 'Source'),
          React.createElement(Text, { color: 'gray' }, '\u2500'.repeat(30))
        )
      );
      elements.push(
        React.createElement(
          Box,
          { key: 'src-name', flexDirection: 'row', marginTop: 1 },
          React.createElement(Text, { color: 'gray' }, '  Name:      '),
          React.createElement(Text, null, source.name)
        )
      );
      if (source.transportName) {
        elements.push(
          React.createElement(
            Box,
            { key: 'src-transport', flexDirection: 'row' },
            React.createElement(Text, { color: 'gray' }, '  Transport: '),
            React.createElement(Text, null, source.transportName)
          )
        );
      }
      elements.push(
        React.createElement(
          Box,
          { key: 'src-state', flexDirection: 'row' },
          React.createElement(Text, { color: 'gray' }, '  State:     '),
          React.createElement(StatusIndicator, { state: source.state })
        )
      );
      if (channel.listenerInfo) {
        const li = channel.listenerInfo;
        const connStr =
          li.connectionCount > 0
            ? ` (${li.connectionCount} connection${li.connectionCount === 1 ? '' : 's'})`
            : '';
        elements.push(
          React.createElement(
            Box,
            { key: 'src-listener', flexDirection: 'row' },
            React.createElement(Text, { color: 'gray' }, '  Listener:  '),
            React.createElement(Text, null, `${li.host}:${li.port}${connStr}`)
          )
        );
      }
    }

    // Destinations section
    if (destinations.length > 0) {
      elements.push(
        React.createElement(
          Box,
          { key: 'dest-header', flexDirection: 'column', marginTop: 1 },
          React.createElement(Text, { bold: true, color: 'white' }, 'Destinations'),
          React.createElement(Text, { color: 'gray' }, '\u2500'.repeat(30))
        )
      );
      for (const dest of destinations) {
        const namePart = truncate(dest.name, 20).padEnd(20);
        const transportPart = dest.transportName ? truncate(dest.transportName, 18).padEnd(18) : '';
        const disabledBadge = dest.enabled === false;
        elements.push(
          React.createElement(
            Box,
            { key: `dest-${dest.metaDataId}`, flexDirection: 'column', marginTop: 1 },
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, { color: 'gray' }, `  #${dest.metaDataId}  `),
              React.createElement(Text, null, namePart),
              transportPart
                ? React.createElement(Text, { color: 'gray' }, ` ${transportPart} `)
                : null,
              React.createElement(StatusIndicator, { state: dest.state }),
              disabledBadge
                ? React.createElement(Text, { color: 'gray', dimColor: true }, '  [disabled]')
                : null
            ),
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, { color: 'gray' }, '        Queue: '),
              React.createElement(
                Text,
                { color: dest.queueEnabled ? 'green' : 'gray' },
                dest.queueEnabled ? 'Enabled' : 'Disabled'
              )
            )
          )
        );
      }
    }

    return React.createElement(Box, { flexDirection: 'column' }, ...elements);
  };

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
                { color: stats.error > 0 ? 'red' : 'gray' },
                String(stats.error)
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
        React.createElement(Text, { color: 'gray' }, 'Press [M] to view messages for this channel.')
      ),
    activeTab === 'connectors' && renderConnectorsTab(),
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
        '[S] Start  [T] Stop  [P] Pause  [D] Deploy  [U] Undeploy  [M] Messages  [X] Trace'
      )
    )
  );
};

export default ChannelDetails;
