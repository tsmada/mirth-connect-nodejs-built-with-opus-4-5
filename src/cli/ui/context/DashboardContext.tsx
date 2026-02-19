/**
 * Dashboard Context
 *
 * Shared state provider for the dashboard components.
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { ChannelStatus, ChannelGroup } from '../../types/index.js';

export type ViewMode =
  | 'list'
  | 'details'
  | 'messages'
  | 'messageDetail'
  | 'help'
  | 'search'
  | 'traceInput'
  | 'trace';
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'polling';

export interface DashboardMessage {
  text: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export interface DashboardState {
  // Data
  channels: ChannelStatus[];
  groups: ChannelGroup[];
  selectedChannelIds: Set<string>;

  // UI State
  selectedIndex: number;
  viewMode: ViewMode;
  searchQuery: string;
  expandedGroups: Set<string>;

  // Connection
  connectionStatus: ConnectionStatus;
  lastUpdate: Date;

  // Messages
  message: DashboardMessage | null;
}

export interface DashboardActions {
  // Data updates
  setChannels: (channels: ChannelStatus[]) => void;
  setGroups: (groups: ChannelGroup[]) => void;
  updateChannelState: (channelId: string, state: string) => void;

  // Selection
  setSelectedIndex: (index: number) => void;
  toggleChannelSelection: (channelId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  // View mode
  setViewMode: (mode: ViewMode) => void;

  // Search
  setSearchQuery: (query: string) => void;

  // Groups
  toggleGroup: (groupId: string) => void;
  expandAllGroups: () => void;
  collapseAllGroups: () => void;

  // Connection
  setConnectionStatus: (status: ConnectionStatus) => void;
  setLastUpdate: (date: Date) => void;

  // Messages
  showMessage: (message: DashboardMessage) => void;
  clearMessage: () => void;
}

export interface DashboardContextValue {
  state: DashboardState;
  actions: DashboardActions;
}

const defaultState: DashboardState = {
  channels: [],
  groups: [],
  selectedChannelIds: new Set(),
  selectedIndex: 0,
  viewMode: 'list',
  searchQuery: '',
  expandedGroups: new Set(),
  connectionStatus: 'disconnected',
  lastUpdate: new Date(),
  message: null,
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export interface DashboardProviderProps {
  children: ReactNode;
}

/**
 * Dashboard Provider Component
 */
export const DashboardProvider: React.FC<DashboardProviderProps> = ({ children }) => {
  const [state, setState] = useState<DashboardState>(defaultState);

  // Data updates
  const setChannels = useCallback((channels: ChannelStatus[]) => {
    setState((prev) => ({ ...prev, channels }));
  }, []);

  const setGroups = useCallback((groups: ChannelGroup[]) => {
    setState((prev) => ({
      ...prev,
      groups,
      // Expand all groups by default
      expandedGroups: new Set(groups.map((g) => g.id)),
    }));
  }, []);

  const updateChannelState = useCallback((channelId: string, newState: string) => {
    setState((prev) => ({
      ...prev,
      channels: prev.channels.map((ch) =>
        ch.channelId === channelId ? { ...ch, state: newState as ChannelStatus['state'] } : ch
      ),
    }));
  }, []);

  // Selection
  const setSelectedIndex = useCallback((index: number) => {
    setState((prev) => ({ ...prev, selectedIndex: index }));
  }, []);

  const toggleChannelSelection = useCallback((channelId: string) => {
    setState((prev) => {
      const newSelection = new Set(prev.selectedChannelIds);
      if (newSelection.has(channelId)) {
        newSelection.delete(channelId);
      } else {
        newSelection.add(channelId);
      }
      return { ...prev, selectedChannelIds: newSelection };
    });
  }, []);

  const selectAll = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedChannelIds: new Set(prev.channels.map((ch) => ch.channelId)),
    }));
  }, []);

  const clearSelection = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedChannelIds: new Set(),
    }));
  }, []);

  // View mode
  const setViewMode = useCallback((mode: ViewMode) => {
    setState((prev) => ({ ...prev, viewMode: mode }));
  }, []);

  // Search
  const setSearchQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, searchQuery: query }));
  }, []);

  // Groups
  const toggleGroup = useCallback((groupId: string) => {
    setState((prev) => {
      const newExpanded = new Set(prev.expandedGroups);
      if (newExpanded.has(groupId)) {
        newExpanded.delete(groupId);
      } else {
        newExpanded.add(groupId);
      }
      return { ...prev, expandedGroups: newExpanded };
    });
  }, []);

  const expandAllGroups = useCallback(() => {
    setState((prev) => ({
      ...prev,
      expandedGroups: new Set(prev.groups.map((g) => g.id)),
    }));
  }, []);

  const collapseAllGroups = useCallback(() => {
    setState((prev) => ({
      ...prev,
      expandedGroups: new Set(),
    }));
  }, []);

  // Connection
  const setConnectionStatus = useCallback((status: ConnectionStatus) => {
    setState((prev) => ({ ...prev, connectionStatus: status }));
  }, []);

  const setLastUpdate = useCallback((date: Date) => {
    setState((prev) => ({ ...prev, lastUpdate: date }));
  }, []);

  // Messages
  const showMessage = useCallback((message: DashboardMessage) => {
    setState((prev) => ({ ...prev, message }));
  }, []);

  const clearMessage = useCallback(() => {
    setState((prev) => ({ ...prev, message: null }));
  }, []);

  const actions: DashboardActions = {
    setChannels,
    setGroups,
    updateChannelState,
    setSelectedIndex,
    toggleChannelSelection,
    selectAll,
    clearSelection,
    setViewMode,
    setSearchQuery,
    toggleGroup,
    expandAllGroups,
    collapseAllGroups,
    setConnectionStatus,
    setLastUpdate,
    showMessage,
    clearMessage,
  };

  return React.createElement(DashboardContext.Provider, { value: { state, actions } }, children);
};

/**
 * Hook to access dashboard context
 */
export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}

export default DashboardContext;
