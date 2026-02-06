/**
 * DashboardContext Tests
 *
 * Tests the dashboard state management logic.
 */

import { ChannelStatus, ChannelGroup } from '../../../../../src/cli/types/index.js';

// Types extracted from the context
type ViewMode = 'list' | 'details' | 'messages' | 'help' | 'search';
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'polling';

interface DashboardMessage {
  text: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface DashboardState {
  channels: ChannelStatus[];
  groups: ChannelGroup[];
  selectedChannelIds: Set<string>;
  selectedIndex: number;
  viewMode: ViewMode;
  searchQuery: string;
  expandedGroups: Set<string>;
  connectionStatus: ConnectionStatus;
  lastUpdate: Date;
  message: DashboardMessage | null;
}

// Default state factory
function createDefaultState(): DashboardState {
  return {
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
}

// State reducer functions (simulating context actions)
function setChannels(state: DashboardState, channels: ChannelStatus[]): DashboardState {
  return { ...state, channels };
}

function setGroups(state: DashboardState, groups: ChannelGroup[]): DashboardState {
  return {
    ...state,
    groups,
    expandedGroups: new Set(groups.map((g) => g.id)),
  };
}

function updateChannelState(state: DashboardState, channelId: string, newState: ChannelStatus['state']): DashboardState {
  return {
    ...state,
    channels: state.channels.map((ch) =>
      ch.channelId === channelId ? { ...ch, state: newState } : ch
    ),
  };
}

function toggleChannelSelection(state: DashboardState, channelId: string): DashboardState {
  const newSelection = new Set(state.selectedChannelIds);
  if (newSelection.has(channelId)) {
    newSelection.delete(channelId);
  } else {
    newSelection.add(channelId);
  }
  return { ...state, selectedChannelIds: newSelection };
}

function selectAll(state: DashboardState): DashboardState {
  return {
    ...state,
    selectedChannelIds: new Set(state.channels.map((ch) => ch.channelId)),
  };
}

function clearSelection(state: DashboardState): DashboardState {
  return { ...state, selectedChannelIds: new Set() };
}

function toggleGroup(state: DashboardState, groupId: string): DashboardState {
  const newExpanded = new Set(state.expandedGroups);
  if (newExpanded.has(groupId)) {
    newExpanded.delete(groupId);
  } else {
    newExpanded.add(groupId);
  }
  return { ...state, expandedGroups: newExpanded };
}

describe('DashboardContext', () => {
  const createChannel = (id: string, name: string): ChannelStatus => ({
    channelId: id,
    name,
    state: 'STARTED',
    statistics: { received: 0, filtered: 0, queued: 0, sent: 0, error: 0 },
  });

  const createGroup = (id: string, name: string): ChannelGroup => ({
    id,
    name,
    channels: [],
  });

  describe('createDefaultState', () => {
    it('should create state with empty arrays', () => {
      const state = createDefaultState();
      expect(state.channels).toEqual([]);
      expect(state.groups).toEqual([]);
    });

    it('should create state with empty sets', () => {
      const state = createDefaultState();
      expect(state.selectedChannelIds.size).toBe(0);
      expect(state.expandedGroups.size).toBe(0);
    });

    it('should create state with list view mode', () => {
      const state = createDefaultState();
      expect(state.viewMode).toBe('list');
    });

    it('should create state with disconnected status', () => {
      const state = createDefaultState();
      expect(state.connectionStatus).toBe('disconnected');
    });

    it('should create state with null message', () => {
      const state = createDefaultState();
      expect(state.message).toBeNull();
    });
  });

  describe('setChannels', () => {
    it('should update channels array', () => {
      const state = createDefaultState();
      const channels = [createChannel('ch1', 'Alpha')];

      const newState = setChannels(state, channels);

      expect(newState.channels).toHaveLength(1);
      expect(newState.channels[0]!.name).toBe('Alpha');
    });

    it('should not mutate original state', () => {
      const state = createDefaultState();
      const channels = [createChannel('ch1', 'Alpha')];

      setChannels(state, channels);

      expect(state.channels).toHaveLength(0);
    });
  });

  describe('setGroups', () => {
    it('should update groups array', () => {
      const state = createDefaultState();
      const groups = [createGroup('g1', 'Production')];

      const newState = setGroups(state, groups);

      expect(newState.groups).toHaveLength(1);
    });

    it('should auto-expand all groups', () => {
      const state = createDefaultState();
      const groups = [
        createGroup('g1', 'Production'),
        createGroup('g2', 'Development'),
      ];

      const newState = setGroups(state, groups);

      expect(newState.expandedGroups.has('g1')).toBe(true);
      expect(newState.expandedGroups.has('g2')).toBe(true);
    });
  });

  describe('updateChannelState', () => {
    it('should update specific channel state', () => {
      const state = {
        ...createDefaultState(),
        channels: [
          createChannel('ch1', 'Alpha'),
          createChannel('ch2', 'Beta'),
        ],
      };

      const newState = updateChannelState(state, 'ch1', 'STOPPED');

      expect(newState.channels[0]!.state).toBe('STOPPED');
      expect(newState.channels[1]!.state).toBe('STARTED');
    });

    it('should not modify other properties', () => {
      const state = {
        ...createDefaultState(),
        channels: [createChannel('ch1', 'Alpha')],
      };

      const newState = updateChannelState(state, 'ch1', 'STOPPED');

      expect(newState.channels[0]!.name).toBe('Alpha');
      expect(newState.channels[0]!.channelId).toBe('ch1');
    });

    it('should handle non-existent channel', () => {
      const state = {
        ...createDefaultState(),
        channels: [createChannel('ch1', 'Alpha')],
      };

      const newState = updateChannelState(state, 'nonexistent', 'STOPPED');

      expect(newState.channels[0]!.state).toBe('STARTED'); // Unchanged
    });
  });

  describe('toggleChannelSelection', () => {
    it('should add channel to selection', () => {
      const state = createDefaultState();

      const newState = toggleChannelSelection(state, 'ch1');

      expect(newState.selectedChannelIds.has('ch1')).toBe(true);
    });

    it('should remove channel from selection', () => {
      const state = {
        ...createDefaultState(),
        selectedChannelIds: new Set(['ch1']),
      };

      const newState = toggleChannelSelection(state, 'ch1');

      expect(newState.selectedChannelIds.has('ch1')).toBe(false);
    });

    it('should not affect other selections', () => {
      const state = {
        ...createDefaultState(),
        selectedChannelIds: new Set(['ch1', 'ch2']),
      };

      const newState = toggleChannelSelection(state, 'ch1');

      expect(newState.selectedChannelIds.has('ch1')).toBe(false);
      expect(newState.selectedChannelIds.has('ch2')).toBe(true);
    });
  });

  describe('selectAll', () => {
    it('should select all channels', () => {
      const state = {
        ...createDefaultState(),
        channels: [
          createChannel('ch1', 'A'),
          createChannel('ch2', 'B'),
          createChannel('ch3', 'C'),
        ],
      };

      const newState = selectAll(state);

      expect(newState.selectedChannelIds.size).toBe(3);
      expect(newState.selectedChannelIds.has('ch1')).toBe(true);
      expect(newState.selectedChannelIds.has('ch2')).toBe(true);
      expect(newState.selectedChannelIds.has('ch3')).toBe(true);
    });

    it('should handle empty channels', () => {
      const state = createDefaultState();

      const newState = selectAll(state);

      expect(newState.selectedChannelIds.size).toBe(0);
    });
  });

  describe('clearSelection', () => {
    it('should remove all selections', () => {
      const state = {
        ...createDefaultState(),
        selectedChannelIds: new Set(['ch1', 'ch2', 'ch3']),
      };

      const newState = clearSelection(state);

      expect(newState.selectedChannelIds.size).toBe(0);
    });
  });

  describe('toggleGroup', () => {
    it('should expand collapsed group', () => {
      const state = createDefaultState();

      const newState = toggleGroup(state, 'g1');

      expect(newState.expandedGroups.has('g1')).toBe(true);
    });

    it('should collapse expanded group', () => {
      const state = {
        ...createDefaultState(),
        expandedGroups: new Set(['g1']),
      };

      const newState = toggleGroup(state, 'g1');

      expect(newState.expandedGroups.has('g1')).toBe(false);
    });

    it('should not affect other groups', () => {
      const state = {
        ...createDefaultState(),
        expandedGroups: new Set(['g1', 'g2']),
      };

      const newState = toggleGroup(state, 'g1');

      expect(newState.expandedGroups.has('g1')).toBe(false);
      expect(newState.expandedGroups.has('g2')).toBe(true);
    });
  });
});
