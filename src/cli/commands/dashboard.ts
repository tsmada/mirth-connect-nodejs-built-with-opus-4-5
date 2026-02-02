/**
 * Dashboard Command
 *
 * Interactive terminal dashboard for monitoring channels.
 * Uses Ink (React for CLI) for rendering.
 */

import { Command } from 'commander';
import React, { useState, useEffect, FC } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { ApiClient, ApiError } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { ChannelStatus, ChannelState, GlobalOptions } from '../types/index.js';

// =============================================================================
// Dashboard Components
// =============================================================================

interface DashboardProps {
  client: ApiClient;
  refreshInterval: number;
}

/**
 * Status indicator component
 */
const StatusIndicator: FC<{ state: ChannelState }> = ({ state }) => {
  const colors: Record<ChannelState, string> = {
    STARTED: 'green',
    STOPPED: 'red',
    PAUSED: 'yellow',
    STARTING: 'cyan',
    STOPPING: 'cyan',
    PAUSING: 'cyan',
    UNDEPLOYED: 'gray',
  };

  const color = colors[state] || 'white';
  return React.createElement(Text, { color }, `● ${state}`);
};

/**
 * Channel row component
 */
const ChannelRow: FC<{
  channel: ChannelStatus;
  selected: boolean;
  width: number;
}> = ({ channel, selected, width }) => {
  const nameWidth = Math.min(30, width - 60);
  const name = channel.name.length > nameWidth
    ? channel.name.slice(0, nameWidth - 3) + '...'
    : channel.name.padEnd(nameWidth);

  const stats = channel.statistics || { received: 0, sent: 0, errored: 0 };
  const errorColor = stats.errored > 0 ? 'red' : 'white';

  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(Text, { color: selected ? 'cyan' : 'white', inverse: selected },
      selected ? '▶ ' : '  '
    ),
    React.createElement(Text, { color: 'white' }, name + ' '),
    React.createElement(StatusIndicator, { state: channel.state }),
    React.createElement(Text, { color: 'white' }, '  R:'),
    React.createElement(Text, { color: 'green' }, String(stats.received).padStart(6)),
    React.createElement(Text, { color: 'white' }, ' S:'),
    React.createElement(Text, { color: 'green' }, String(stats.sent).padStart(6)),
    React.createElement(Text, { color: 'white' }, ' E:'),
    React.createElement(Text, { color: errorColor }, String(stats.errored).padStart(4))
  );
};

/**
 * Help bar component
 */
const HelpBar: FC = () => {
  return React.createElement(
    Box,
    { marginTop: 1, flexDirection: 'row' },
    React.createElement(Text, { color: 'gray' },
      '[↑↓] Navigate  ' +
      '[S]tart  ' +
      '[T]op  ' +
      '[P]ause  ' +
      '[D]eploy  ' +
      '[U]ndeploy  ' +
      '[R]efresh  ' +
      '[Q]uit'
    )
  );
};

/**
 * Status bar component
 */
const StatusBar: FC<{
  serverUrl: string;
  channelCount: number;
  lastUpdate: Date;
  message?: string;
  messageType?: 'success' | 'error' | 'info';
}> = ({ serverUrl, channelCount, lastUpdate, message, messageType }) => {
  const msgColor = messageType === 'error' ? 'red' : messageType === 'success' ? 'green' : 'yellow';

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
    message && React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, { color: msgColor }, message)
    )
  );
};

/**
 * Main Dashboard component
 */
const Dashboard: FC<DashboardProps> = ({ client, refreshInterval }) => {
  const { exit } = useApp();
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [loading, setLoading] = useState(true);

  const serverUrl = ConfigManager.getServerUrl();

  // Fetch channels
  const fetchChannels = async () => {
    try {
      const statuses = await client.getChannelStatuses(undefined, true);
      setChannels(statuses);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error) {
      setMessage({
        text: `Error fetching channels: ${(error as Error).message}`,
        type: 'error',
      });
    }
  };

  // Initial fetch and interval
  useEffect(() => {
    fetchChannels();
    const interval = setInterval(fetchChannels, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  // Clear message after delay
  useEffect(() => {
    if (message) {
      const timeout = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [message]);

  // Keyboard input handler
  useInput(async (input, key) => {
    const selectedChannel = channels[selectedIndex];

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(channels.length - 1, i + 1));
    } else if (input === 'q' || input === 'Q' || key.escape) {
      exit();
    } else if (input === 'r' || input === 'R') {
      setMessage({ text: 'Refreshing...', type: 'info' });
      await fetchChannels();
      setMessage({ text: 'Refreshed', type: 'success' });
    } else if (selectedChannel) {
      try {
        switch (input.toLowerCase()) {
          case 's': // Start
            setMessage({ text: `Starting ${selectedChannel.name}...`, type: 'info' });
            await client.startChannel(selectedChannel.channelId);
            setMessage({ text: `Started ${selectedChannel.name}`, type: 'success' });
            await fetchChannels();
            break;
          case 't': // Stop
            setMessage({ text: `Stopping ${selectedChannel.name}...`, type: 'info' });
            await client.stopChannel(selectedChannel.channelId);
            setMessage({ text: `Stopped ${selectedChannel.name}`, type: 'success' });
            await fetchChannels();
            break;
          case 'p': // Pause
            setMessage({ text: `Pausing ${selectedChannel.name}...`, type: 'info' });
            await client.pauseChannel(selectedChannel.channelId);
            setMessage({ text: `Paused ${selectedChannel.name}`, type: 'success' });
            await fetchChannels();
            break;
          case 'd': // Deploy
            setMessage({ text: `Deploying ${selectedChannel.name}...`, type: 'info' });
            await client.deployChannel(selectedChannel.channelId);
            setMessage({ text: `Deployed ${selectedChannel.name}`, type: 'success' });
            await fetchChannels();
            break;
          case 'u': // Undeploy
            setMessage({ text: `Undeploying ${selectedChannel.name}...`, type: 'info' });
            await client.undeployChannel(selectedChannel.channelId);
            setMessage({ text: `Undeployed ${selectedChannel.name}`, type: 'success' });
            await fetchChannels();
            break;
        }
      } catch (error) {
        setMessage({
          text: `Error: ${(error as Error).message}`,
          type: 'error',
        });
      }
    }
  });

  // Get terminal width (approximate)
  const termWidth = process.stdout.columns || 80;

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    // Header
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { color: 'cyan', bold: true }, '  Mirth Connect Dashboard'),
      React.createElement(Text, { color: 'gray' }, loading ? ' (loading...)' : '')
    ),
    // Channel list header
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'gray', bold: true },
        '  NAME'.padEnd(Math.min(32, termWidth - 60)) +
        'STATUS      RECV     SENT   ERR'
      )
    ),
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'gray' }, '─'.repeat(Math.min(termWidth - 2, 80)))
    ),
    // Channel list
    ...channels.map((channel, index) =>
      React.createElement(ChannelRow, {
        key: channel.channelId,
        channel,
        selected: index === selectedIndex,
        width: termWidth,
      })
    ),
    // Status bar
    React.createElement(StatusBar, {
      serverUrl,
      channelCount: channels.length,
      lastUpdate,
      message: message?.text,
      messageType: message?.type,
    }),
    // Help bar
    React.createElement(HelpBar)
  );
};

// =============================================================================
// Dashboard Command Registration
// =============================================================================

/**
 * Register dashboard command
 */
export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .alias('dash')
    .description('Interactive channel dashboard')
    .option('-r, --refresh <seconds>', 'Refresh interval in seconds', '5')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;

      // JSON mode doesn't make sense for interactive dashboard
      if (globalOpts.json) {
        console.error('Dashboard does not support JSON output mode.');
        console.error('Use "mirth-cli channels --json" for JSON output.');
        process.exit(1);
      }

      const client = new ApiClient({
        baseUrl: globalOpts.url || ConfigManager.getServerUrl(),
        verbose: globalOpts.verbose,
      });

      const refreshInterval = parseInt(options.refresh, 10);

      // Check authentication first
      try {
        await client.getChannelStatuses();
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 401) {
          console.error('Not authenticated. Please run "mirth-cli login" first.');
          process.exit(1);
        }
        console.error('Failed to connect to server:', (error as Error).message);
        process.exit(1);
      }

      // Render the dashboard
      const { waitUntilExit } = render(
        React.createElement(Dashboard, { client, refreshInterval })
      );

      await waitUntilExit();
    });
}

export default registerDashboardCommand;
