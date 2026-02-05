/**
 * Dashboard Component
 *
 * Main orchestrator for the interactive CLI dashboard.
 * Combines all components with WebSocket integration and keyboard navigation.
 */

import React, { FC, useState, useEffect, useCallback, useMemo } from 'react';
import { Box, useApp, useInput } from 'ink';
import { ApiClient } from '../../lib/ApiClient.js';
import { ConfigManager } from '../../lib/ConfigManager.js';
import { ChannelStatus } from '../../types/index.js';
import { useWebSocket, WebSocketStatus } from '../hooks/useWebSocket.js';
import { useChannels } from '../hooks/useChannels.js';
import { useChannelGroups } from '../hooks/useChannelGroups.js';
import { Header } from './Header.js';
import { ChannelList, getItemAtIndex, getItemCount } from './ChannelList.js';
import { HelpBar } from './HelpBar.js';
import { StatusBar } from './StatusBar.js';
import { SearchInput } from './SearchInput.js';
import { HelpOverlay } from './HelpOverlay.js';
import { ChannelDetails } from './ChannelDetails.js';
import { ConnectionStatus, DashboardMessage, ViewMode } from '../context/DashboardContext.js';

export interface DashboardProps {
  client: ApiClient;
  refreshInterval?: number;
  enableWebSocket?: boolean;
}

/**
 * Convert WebSocket status to display status
 */
function wsStatusToConnectionStatus(wsStatus: WebSocketStatus, polling: boolean): ConnectionStatus {
  if (wsStatus === 'connected') return 'connected';
  if (wsStatus === 'connecting' || wsStatus === 'reconnecting') return 'connecting';
  if (polling) return 'polling';
  return 'disconnected';
}

/**
 * Main Dashboard component
 */
export const Dashboard: FC<DashboardProps> = ({
  client,
  refreshInterval = 5,
  enableWebSocket = true,
}) => {
  const { exit } = useApp();
  const serverUrl = ConfigManager.getServerUrl();

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState<DashboardMessage | null>(null);

  // WebSocket connection
  const ws = useWebSocket({
    serverUrl,
    enabled: enableWebSocket,
    autoSubscribe: true,
  });

  // Channel data (use polling as fallback)
  const channels = useChannels({
    client,
    refreshInterval,
    enablePolling: !ws.isConnected,
  });

  // Channel groups
  const groups = useChannelGroups({
    client,
    channels: channels.channels,
  });

  // Determine connection status
  const connectionStatus = wsStatusToConnectionStatus(
    ws.status,
    !ws.isConnected && channels.channels.length > 0
  );

  // Connect WebSocket on mount
  useEffect(() => {
    if (enableWebSocket) {
      ws.connect().catch(() => {
        // Fallback to polling (already handled)
      });
    }

    return () => {
      ws.disconnect();
    };
  }, [enableWebSocket]);

  // Register WebSocket state change handler
  useEffect(() => {
    if (ws.isConnected) {
      ws.onStateChange((_connectorId, _state) => {
        // Update channel state based on connector state
        // For now, we just trigger a refresh
        channels.refresh();
      });
    }
  }, [ws.isConnected]);

  // Clear message after delay
  useEffect(() => {
    if (message) {
      const timeout = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [message]);

  // Get current item
  const currentItem = useMemo(
    () =>
      getItemAtIndex(
        channels.channels,
        groups.groups,
        groups.expandedGroups,
        selectedIndex,
        viewMode === 'search' ? searchQuery : undefined
      ),
    [channels.channels, groups.groups, groups.expandedGroups, selectedIndex, viewMode, searchQuery]
  );

  // Get total item count
  const itemCount = useMemo(
    () =>
      getItemCount(
        channels.channels,
        groups.groups,
        groups.expandedGroups,
        viewMode === 'search' ? searchQuery : undefined
      ),
    [channels.channels, groups.groups, groups.expandedGroups, viewMode, searchQuery]
  );

  // Selected channel (for details view)
  const selectedChannel = useMemo(() => {
    if (currentItem?.type === 'channel') {
      return currentItem.data as ChannelStatus;
    }
    return null;
  }, [currentItem]);

  // Show message helper
  const showMessage = useCallback((text: string, type: DashboardMessage['type']) => {
    setMessage({ text, type });
  }, []);

  // Channel operations
  const handleChannelAction = useCallback(
    async (
      action: 'start' | 'stop' | 'pause' | 'deploy' | 'undeploy',
      channelId?: string
    ) => {
      const targetIds = channelId
        ? [channelId]
        : selectedChannelIds.size > 0
        ? Array.from(selectedChannelIds)
        : selectedChannel
        ? [selectedChannel.channelId]
        : [];

      if (targetIds.length === 0) {
        showMessage('No channel selected', 'warning');
        return;
      }

      const actionLabels: Record<string, string> = {
        start: 'Starting',
        stop: 'Stopping',
        pause: 'Pausing',
        deploy: 'Deploying',
        undeploy: 'Undeploying',
      };

      const actionMethods: Record<string, (id: string) => Promise<void>> = {
        start: channels.startChannel,
        stop: channels.stopChannel,
        pause: channels.pauseChannel,
        deploy: channels.deployChannel,
        undeploy: channels.undeployChannel,
      };

      const actionLabel = actionLabels[action] ?? action;
      showMessage(`${actionLabel} ${targetIds.length} channel(s)...`, 'info');

      try {
        const actionMethod = actionMethods[action];
        if (actionMethod) {
          for (const id of targetIds) {
            await actionMethod(id);
          }
        }
        showMessage(`${actionLabel.replace('ing', 'ed')} ${targetIds.length} channel(s)`, 'success');
      } catch (error) {
        showMessage(`Error: ${(error as Error).message}`, 'error');
      }
    },
    [selectedChannelIds, selectedChannel, channels, showMessage]
  );

  // Keyboard input handler (for list view)
  useInput(
    (input, key) => {
      // Skip if in overlay mode
      if (viewMode === 'help' || viewMode === 'details' || viewMode === 'search') {
        return;
      }

      // Navigation
      if (key.upArrow || input === 'k') {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex((i) => Math.min(itemCount - 1, i + 1));
      }
      // Enter: expand group or show details
      else if (key.return) {
        if (currentItem?.type === 'group' && currentItem.groupId) {
          groups.toggleGroup(currentItem.groupId);
        } else if (currentItem?.type === 'channel') {
          setViewMode('details');
        }
      }
      // Space: toggle selection
      else if (input === ' ') {
        if (selectedChannel) {
          setSelectedChannelIds((prev) => {
            const next = new Set(prev);
            if (next.has(selectedChannel.channelId)) {
              next.delete(selectedChannel.channelId);
            } else {
              next.add(selectedChannel.channelId);
            }
            return next;
          });
        }
      }
      // Channel actions
      else if (input === 's' || input === 'S') {
        handleChannelAction('start');
      } else if (input === 't' || input === 'T') {
        handleChannelAction('stop');
      } else if (input === 'p' || input === 'P') {
        handleChannelAction('pause');
      } else if (input === 'd' || input === 'D') {
        handleChannelAction('deploy');
      } else if (input === 'u' || input === 'U') {
        handleChannelAction('undeploy');
      }
      // Refresh
      else if (input === 'r' || input === 'R') {
        showMessage('Refreshing...', 'info');
        channels.refresh().then(() => {
          showMessage('Refreshed', 'success');
        });
      }
      // Search
      else if (input === '/') {
        setSearchQuery('');
        setViewMode('search');
      }
      // Help
      else if (input === '?') {
        setViewMode('help');
      }
      // Select all
      else if (input === 'a' || input === 'A') {
        setSelectedChannelIds(new Set(channels.channels.map((ch) => ch.channelId)));
        showMessage(`Selected ${channels.channels.length} channels`, 'info');
      }
      // Clear selection
      else if (input === 'c' || input === 'C') {
        setSelectedChannelIds(new Set());
        showMessage('Selection cleared', 'info');
      }
      // Expand all groups
      else if (input === 'e' || input === 'E') {
        groups.expandAll();
      }
      // Collapse all groups (w for "wrap")
      else if (input === 'w' || input === 'W') {
        groups.collapseAll();
      }
      // Messages view
      else if (input === 'm' || input === 'M') {
        if (selectedChannel) {
          showMessage('Messages view not yet implemented', 'warning');
        }
      }
      // Quit
      else if (input === 'q' || input === 'Q' || key.escape) {
        exit();
      }
    },
    { isActive: viewMode === 'list' }
  );

  // Terminal width
  const termWidth = process.stdout.columns || 80;

  // Render overlay components
  if (viewMode === 'help') {
    return React.createElement(HelpOverlay, {
      onClose: () => setViewMode('list'),
    });
  }

  if (viewMode === 'details' && selectedChannel) {
    return React.createElement(ChannelDetails, {
      channel: selectedChannel,
      onClose: () => setViewMode('list'),
      onStart: async () => handleChannelAction('start', selectedChannel.channelId),
      onStop: async () => handleChannelAction('stop', selectedChannel.channelId),
      onPause: async () => handleChannelAction('pause', selectedChannel.channelId),
      onDeploy: async () => handleChannelAction('deploy', selectedChannel.channelId),
      onUndeploy: async () => handleChannelAction('undeploy', selectedChannel.channelId),
      onViewMessages: () => {
        showMessage('Messages view not yet implemented', 'warning');
        setViewMode('list');
      },
    });
  }

  // Main list view
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    // Header
    React.createElement(Header, {
      connectionStatus,
      loading: channels.loading,
      serverUrl,
    }),
    // Search bar (if active)
    viewMode === 'search' &&
      React.createElement(
        Box,
        { marginBottom: 1 },
        React.createElement(SearchInput, {
          value: searchQuery,
          onChange: setSearchQuery,
          onSubmit: () => {
            setViewMode('list');
            setSelectedIndex(0);
          },
          onCancel: () => {
            setSearchQuery('');
            setViewMode('list');
          },
        })
      ),
    // Channel list
    React.createElement(ChannelList, {
      channels: channels.channels,
      groups: groups.groups,
      expandedGroups: groups.expandedGroups,
      selectedIndex,
      selectedChannelIds,
      width: termWidth,
      searchQuery: viewMode === 'search' ? searchQuery : undefined,
    }),
    // Status bar
    React.createElement(StatusBar, {
      serverUrl,
      channelCount: channels.channels.length,
      lastUpdate: channels.lastUpdate,
      message,
    }),
    // Help bar
    React.createElement(HelpBar, {
      viewMode,
      hasSelection: selectedChannelIds.size > 0,
    })
  );
};

export default Dashboard;
