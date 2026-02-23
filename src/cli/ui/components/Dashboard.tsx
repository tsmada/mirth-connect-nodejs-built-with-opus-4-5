/**
 * Dashboard Component
 *
 * Main orchestrator for the interactive CLI dashboard.
 * Combines all components with WebSocket integration and keyboard navigation.
 */

import React, { FC, useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ApiClient } from '../../lib/ApiClient.js';
import { ConfigManager } from '../../lib/ConfigManager.js';
import {
  ChannelStatus,
  CHANNEL_GROUP_DEFAULT_ID,
  CHANNEL_GROUP_DEFAULT_NAME,
} from '../../types/index.js';
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
import { TraceInput } from './TraceInput.js';
import { TraceTreeView } from './TraceTreeView.js';
import { MessageList } from './MessageList.js';
import { MessageDetail } from './MessageDetail.js';
import { GroupPicker } from './GroupPicker.js';
import { useTrace } from '../hooks/useTrace.js';
import { useMessages } from '../hooks/useMessages.js';
import { Message } from '../../types/index.js';
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
 * Minimal component to handle Escape key in trace error/fallback states
 */
const TraceErrorHandler: FC<{ onClose: () => void }> = ({ onClose }) => {
  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });
  return null;
};

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
  const [traceChannelId, setTraceChannelId] = useState<string | null>(null);
  const [traceVerbose, setTraceVerbose] = useState(false);
  const [messagesChannelId, setMessagesChannelId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [fullMessage, setFullMessage] = useState<Message | null>(null);
  const [fullMessageLoading, setFullMessageLoading] = useState(false);
  const [fullMessageError, setFullMessageError] = useState<string | null>(null);
  const [groupPickerChannelIds, setGroupPickerChannelIds] = useState<string[]>([]);

  // Trace hook
  const trace = useTrace({ client });

  // Messages hook
  const messages = useMessages({ client });

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
        void channels.refresh();
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
    async (action: 'start' | 'stop' | 'pause' | 'deploy' | 'undeploy', channelId?: string) => {
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

      const actionMethods: Record<string, (id: string, skipRefresh?: boolean) => Promise<void>> = {
        start: channels.startChannel,
        stop: channels.stopChannel,
        pause: channels.pauseChannel,
        deploy: channels.deployChannel,
        undeploy: channels.undeployChannel,
      };

      const actionLabel = actionLabels[action] ?? action;
      showMessage(`${actionLabel} ${targetIds.length} channel(s)...`, 'info');

      const actionMethod = actionMethods[action];
      if (!actionMethod) return;

      // For batch operations (more than 1 channel), skip individual refreshes
      const isBatch = targetIds.length > 1;

      // Process all channels, collecting errors instead of stopping on first failure
      const errors: string[] = [];
      let successCount = 0;

      for (const id of targetIds) {
        try {
          // Pass skipRefresh=true for batch operations to avoid overwhelming Ink
          await actionMethod(id, isBatch);
          successCount++;
        } catch (error) {
          errors.push((error as Error).message);
        }
      }

      // Single refresh after batch operation completes
      if (isBatch) {
        await channels.refresh();
      }

      // Report results
      if (errors.length === 0) {
        showMessage(`${actionLabel.replace('ing', 'ed')} ${successCount} channel(s)`, 'success');
      } else if (successCount > 0) {
        showMessage(`${successCount} succeeded, ${errors.length} failed: ${errors[0]}`, 'warning');
      } else {
        showMessage(`Error: ${errors[0]}`, 'error');
      }
    },
    [selectedChannelIds, selectedChannel, channels, showMessage]
  );

  // Keyboard input handler (for list view)
  useInput(
    (input, key) => {
      // Skip if in overlay mode
      if (
        viewMode === 'help' ||
        viewMode === 'details' ||
        viewMode === 'search' ||
        viewMode === 'traceInput' ||
        viewMode === 'trace' ||
        viewMode === 'messages' ||
        viewMode === 'messageDetail' ||
        viewMode === 'groupPicker'
      ) {
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
      // Channel actions - use .catch() to prevent unhandled rejections from corrupting display
      else if (input === 's' || input === 'S') {
        handleChannelAction('start').catch(() => {});
      } else if (input === 't' || input === 'T') {
        handleChannelAction('stop').catch(() => {});
      } else if (input === 'p' || input === 'P') {
        handleChannelAction('pause').catch(() => {});
      } else if (input === 'd' || input === 'D') {
        handleChannelAction('deploy').catch(() => {});
      } else if (input === 'u' || input === 'U') {
        handleChannelAction('undeploy').catch(() => {});
      }
      // Refresh
      else if (input === 'r' || input === 'R') {
        showMessage('Refreshing...', 'info');
        channels
          .refresh()
          .then(() => showMessage('Refreshed', 'success'))
          .catch((err: Error) => showMessage(`Refresh failed: ${err.message}`, 'error'));
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
      // Trace message
      else if (input === 'x' || input === 'X') {
        if (selectedChannel) {
          setTraceChannelId(selectedChannel.channelId);
          trace.clear();
          setViewMode('traceInput');
        }
      }
      // Group picker
      else if (input === 'g' || input === 'G') {
        if (selectedChannel) {
          const targetIds =
            selectedChannelIds.size > 0
              ? Array.from(selectedChannelIds)
              : [selectedChannel.channelId];
          setGroupPickerChannelIds(targetIds);
          setViewMode('groupPicker');
        }
      }
      // Messages view
      else if (input === 'm' || input === 'M') {
        if (selectedChannel) {
          setMessagesChannelId(selectedChannel.channelId);
          setViewMode('messages');
          messages.loadMessages(selectedChannel.channelId).catch(() => {});
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
        setMessagesChannelId(selectedChannel.channelId);
        setViewMode('messages');
        messages.loadMessages(selectedChannel.channelId).catch(() => {});
      },
      onTrace: (channelId: string) => {
        setTraceChannelId(channelId);
        trace.clear();
        setViewMode('traceInput');
      },
    });
  }

  if (viewMode === 'messages' && messagesChannelId) {
    const msgsChannel = channels.channels.find((ch) => ch.channelId === messagesChannelId);
    const msgsChannelName = msgsChannel?.name ?? messagesChannelId;

    return React.createElement(MessageList, {
      messages: messages.messages,
      totalCount: messages.totalCount,
      loading: messages.loading,
      error: messages.error,
      page: messages.page,
      pageSize: messages.pageSize,
      statusFilter: messages.statusFilter,
      channelName: msgsChannelName,
      onClose: () => {
        messages.clear();
        setMessagesChannelId(null);
        setViewMode('list');
      },
      onSelectMessage: (msg: Message) => {
        setSelectedMessage(msg);
        setFullMessage(null);
        setFullMessageLoading(true);
        setFullMessageError(null);
        setViewMode('messageDetail');
        client
          .getMessage(msg.channelId, msg.messageId, true)
          .then((full) => {
            setFullMessage(full);
            setFullMessageLoading(false);
          })
          .catch((err) => {
            setFullMessageError(err instanceof Error ? err.message : String(err));
            setFullMessageLoading(false);
          });
      },
      onTrace: (channelId: string, messageId: number) => {
        setTraceChannelId(channelId);
        trace.clear();
        setViewMode('trace');
        trace
          .execute(channelId, messageId, {
            includeContent: true,
            maxContentLength: traceVerbose ? 2000 : 500,
          })
          .catch(() => {});
      },
      onCycleFilter: () => {
        messages.cycleStatusFilter().catch(() => {});
      },
      onNextPage: () => {
        messages.nextPage().catch(() => {});
      },
      onPrevPage: () => {
        messages.prevPage().catch(() => {});
      },
      onRefresh: () => {
        messages.refresh().catch(() => {});
      },
    });
  }

  if (viewMode === 'messageDetail' && selectedMessage) {
    const detailChannel = channels.channels.find(
      (ch) => ch.channelId === selectedMessage.channelId
    );
    const detailChannelName = detailChannel?.name ?? selectedMessage.channelId;

    return React.createElement(MessageDetail, {
      message: selectedMessage,
      channelName: detailChannelName,
      fullMessage,
      loading: fullMessageLoading,
      error: fullMessageError,
      onClose: () => {
        setSelectedMessage(null);
        setFullMessage(null);
        setFullMessageError(null);
        setViewMode('messages');
      },
      onTrace: (channelId: string, messageId: number) => {
        setTraceChannelId(channelId);
        trace.clear();
        setViewMode('trace');
        trace
          .execute(channelId, messageId, {
            includeContent: true,
            maxContentLength: traceVerbose ? 2000 : 500,
          })
          .catch(() => {});
      },
    });
  }

  if (viewMode === 'traceInput' && traceChannelId) {
    const traceChannel = channels.channels.find((ch) => ch.channelId === traceChannelId);
    const traceChannelName = traceChannel?.name ?? traceChannelId;

    return React.createElement(TraceInput, {
      channelName: traceChannelName,
      onSubmit: (messageId: number) => {
        setViewMode('trace');
        trace
          .execute(traceChannelId, messageId, {
            includeContent: true,
            maxContentLength: traceVerbose ? 2000 : 500,
          })
          .catch(() => {});
      },
      onCancel: () => {
        setTraceChannelId(null);
        setViewMode('list');
      },
    });
  }

  if (viewMode === 'trace') {
    if (trace.loading) {
      return React.createElement(
        Box,
        { flexDirection: 'column', paddingX: 2, paddingY: 1 },
        React.createElement(Text, { color: 'cyan' }, 'Tracing message... please wait.')
      );
    }

    if (trace.error) {
      return React.createElement(
        Box,
        { flexDirection: 'column', paddingX: 2, paddingY: 1 },
        React.createElement(Text, { color: 'red', bold: true }, 'Trace Error'),
        React.createElement(Text, { color: 'red' }, trace.error),
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, { color: 'gray' }, '[Escape] Back to list')
        ),
        React.createElement(TraceErrorHandler, {
          onClose: () => {
            trace.clear();
            setTraceChannelId(null);
            setViewMode('list');
          },
        })
      );
    }

    if (trace.traceData) {
      return React.createElement(TraceTreeView, {
        traceData: trace.traceData,
        verbose: traceVerbose,
        onClose: () => {
          trace.clear();
          setTraceChannelId(null);
          setViewMode('list');
        },
        onToggleVerbose: () => setTraceVerbose((v) => !v),
      });
    }

    // Fallback (shouldn't happen - but handle gracefully)
    return React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 2, paddingY: 1 },
      React.createElement(Text, { color: 'gray' }, 'No trace data available.'),
      React.createElement(TraceErrorHandler, {
        onClose: () => {
          trace.clear();
          setTraceChannelId(null);
          setViewMode('list');
        },
      })
    );
  }

  // Group picker overlay
  if (viewMode === 'groupPicker' && groupPickerChannelIds.length > 0) {
    const pickerLabel =
      groupPickerChannelIds.length === 1
        ? (channels.channels.find((ch) => ch.channelId === groupPickerChannelIds[0])?.name ??
          groupPickerChannelIds[0]!)
        : `${groupPickerChannelIds.length} channels`;

    const handleGroupSelect = async (groupId: string) => {
      try {
        showMessage('Moving channel(s)...', 'info');

        // Fetch current real groups (not including virtual Default Group)
        const allGroups = await client.getChannelGroups();

        // Remove channel(s) from any current group
        const updatedGroups = allGroups.map((g) => ({
          ...g,
          channels: (g.channels || []).filter((chId) => !groupPickerChannelIds.includes(chId)),
          revision: (g.revision || 0) + 1,
        }));

        // Add channel(s) to target group (unless Default Group = just remove from all)
        if (groupId !== CHANNEL_GROUP_DEFAULT_ID) {
          const targetGroup = updatedGroups.find((g) => g.id === groupId);
          if (targetGroup) {
            targetGroup.channels = [...targetGroup.channels, ...groupPickerChannelIds];
          }
        }

        await client.bulkUpdateChannelGroups(updatedGroups);
        await groups.refresh();
        showMessage(
          `Moved ${groupPickerChannelIds.length} channel(s) to ${
            groupId === CHANNEL_GROUP_DEFAULT_ID
              ? CHANNEL_GROUP_DEFAULT_NAME
              : (allGroups.find((g) => g.id === groupId)?.name ?? groupId)
          }`,
          'success'
        );
      } catch (err) {
        showMessage(`Failed: ${(err as Error).message}`, 'error');
      }
      setGroupPickerChannelIds([]);
      setViewMode('list');
    };

    const handleGroupCreate = async (name: string) => {
      try {
        showMessage('Creating group...', 'info');
        const allGroups = await client.getChannelGroups();

        // Remove channel(s) from current groups
        const updatedGroups = allGroups.map((g) => ({
          ...g,
          channels: (g.channels || []).filter((chId) => !groupPickerChannelIds.includes(chId)),
          revision: (g.revision || 0) + 1,
        }));

        // Create new group with the channel(s)
        const { v4: uuidv4 } = await import('uuid');
        updatedGroups.push({
          id: uuidv4(),
          name,
          channels: [...groupPickerChannelIds],
          revision: 1,
        });

        await client.bulkUpdateChannelGroups(updatedGroups);
        await groups.refresh();
        showMessage(
          `Created group '${name}' with ${groupPickerChannelIds.length} channel(s)`,
          'success'
        );
      } catch (err) {
        showMessage(`Failed: ${(err as Error).message}`, 'error');
      }
      setGroupPickerChannelIds([]);
      setViewMode('list');
    };

    return React.createElement(GroupPicker, {
      groups: groups.groups,
      channelLabel: pickerLabel,
      onSelect: (groupId: string) => {
        handleGroupSelect(groupId).catch(() => {});
      },
      onCreate: (name: string) => {
        handleGroupCreate(name).catch(() => {});
      },
      onCancel: () => {
        setGroupPickerChannelIds([]);
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
