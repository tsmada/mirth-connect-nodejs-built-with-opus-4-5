/**
 * ChannelList Component Tests
 *
 * Tests the channel list building and filtering logic.
 */

import { ChannelStatus, ChannelGroup } from '../../../../../src/cli/types/index.js';

// Type definitions extracted from the component
interface ListItem {
  type: 'group' | 'channel';
  id: string;
  groupId: string | null;
  data: ChannelGroup | ChannelStatus;
}

/**
 * Build a flat list of items for display (extracted from component)
 */
function buildFlatList(
  channels: ChannelStatus[],
  groups: ChannelGroup[],
  expandedGroups: Set<string>,
  searchQuery?: string
): ListItem[] {
  const items: ListItem[] = [];

  // Build channel to group mapping
  const channelToGroup = new Map<string, string>();
  for (const group of groups) {
    for (const channelId of group.channels || []) {
      channelToGroup.set(channelId, group.id);
    }
  }

  // Filter channels by search query
  let filteredChannels = channels;
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filteredChannels = channels.filter(
      (ch) =>
        ch.name.toLowerCase().includes(query) ||
        ch.channelId.toLowerCase().includes(query) ||
        ch.state.toLowerCase().includes(query)
    );
  }

  // Group channels
  const groupedChannels = new Map<string | null, ChannelStatus[]>();
  for (const channel of filteredChannels) {
    const groupId = channelToGroup.get(channel.channelId) ?? null;
    if (!groupedChannels.has(groupId)) {
      groupedChannels.set(groupId, []);
    }
    groupedChannels.get(groupId)!.push(channel);
  }

  // Sort channels within groups by name
  for (const [, channelList] of groupedChannels) {
    channelList.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Add groups and their channels to the flat list
  const sortedGroups = [...groups].sort((a, b) => a.name.localeCompare(b.name));

  for (const group of sortedGroups) {
    const groupChannels = groupedChannels.get(group.id);
    if (!groupChannels || groupChannels.length === 0) continue;

    // Add group header
    items.push({
      type: 'group',
      id: `group-${group.id}`,
      groupId: group.id,
      data: group,
    });

    // Add channels if expanded
    if (expandedGroups.has(group.id)) {
      for (const channel of groupChannels) {
        items.push({
          type: 'channel',
          id: channel.channelId,
          groupId: group.id,
          data: channel,
        });
      }
    }
  }

  // Add ungrouped channels
  const ungroupedChannels = groupedChannels.get(null);
  if (ungroupedChannels && ungroupedChannels.length > 0) {
    // Add "Ungrouped" header if there are groups
    if (groups.length > 0) {
      items.push({
        type: 'group',
        id: 'group-ungrouped',
        groupId: null,
        data: { id: 'ungrouped', name: 'Ungrouped', channels: [] } as ChannelGroup,
      });
    }

    // Always show ungrouped channels (no collapse)
    for (const channel of ungroupedChannels) {
      items.push({
        type: 'channel',
        id: channel.channelId,
        groupId: null,
        data: channel,
      });
    }
  }

  return items;
}

function getItemAtIndex(
  channels: ChannelStatus[],
  groups: ChannelGroup[],
  expandedGroups: Set<string>,
  index: number,
  searchQuery?: string
): ListItem | null {
  const items = buildFlatList(channels, groups, expandedGroups, searchQuery);
  return items[index] || null;
}

function getItemCount(
  channels: ChannelStatus[],
  groups: ChannelGroup[],
  expandedGroups: Set<string>,
  searchQuery?: string
): number {
  return buildFlatList(channels, groups, expandedGroups, searchQuery).length;
}

describe('ChannelList', () => {
  const createChannel = (id: string, name: string, state: ChannelStatus['state'] = 'STARTED'): ChannelStatus => ({
    channelId: id,
    name,
    state,
    statistics: { received: 0, filtered: 0, queued: 0, sent: 0, error: 0 },
  });

  const createGroup = (id: string, name: string, channelIds: string[]): ChannelGroup => ({
    id,
    name,
    channels: channelIds,
  });

  describe('buildFlatList', () => {
    it('should build list with groups and channels', () => {
      const channels = [
        createChannel('ch1', 'Alpha'),
        createChannel('ch2', 'Beta'),
      ];
      const groups = [createGroup('g1', 'Production', ['ch1', 'ch2'])];
      const expandedGroups = new Set(['g1']);

      const result = buildFlatList(channels, groups, expandedGroups);

      expect(result).toHaveLength(3); // 1 group header + 2 channels
      expect(result[0]!.type).toBe('group');
      expect(result[1]!.type).toBe('channel');
      expect(result[2]!.type).toBe('channel');
    });

    it('should hide channels when group is collapsed', () => {
      const channels = [createChannel('ch1', 'Alpha'), createChannel('ch2', 'Beta')];
      const groups = [createGroup('g1', 'Production', ['ch1', 'ch2'])];
      const expandedGroups = new Set<string>(); // All collapsed

      const result = buildFlatList(channels, groups, expandedGroups);

      expect(result).toHaveLength(1); // Only group header
      expect(result[0]!.type).toBe('group');
    });

    it('should filter channels by search query in name', () => {
      const channels = [
        createChannel('ch1', 'ADT Processing'),
        createChannel('ch2', 'Lab Results'),
        createChannel('ch3', 'ADT Archive'),
      ];
      const groups: ChannelGroup[] = [];
      const expandedGroups = new Set<string>();

      const result = buildFlatList(channels, groups, expandedGroups, 'adt');

      expect(result).toHaveLength(2);
      expect((result[0]!.data as ChannelStatus).name).toBe('ADT Archive');
      expect((result[1]!.data as ChannelStatus).name).toBe('ADT Processing');
    });

    it('should filter channels by search query in channel ID', () => {
      const channels = [
        createChannel('abc-123', 'Channel A'),
        createChannel('def-456', 'Channel B'),
      ];
      const groups: ChannelGroup[] = [];
      const expandedGroups = new Set<string>();

      const result = buildFlatList(channels, groups, expandedGroups, 'abc');

      expect(result).toHaveLength(1);
      expect((result[0]!.data as ChannelStatus).channelId).toBe('abc-123');
    });

    it('should filter channels by search query in state', () => {
      const channels = [
        createChannel('ch1', 'Channel A', 'STARTED'),
        createChannel('ch2', 'Channel B', 'STOPPED'),
        createChannel('ch3', 'Channel C', 'STARTED'),
      ];
      const groups: ChannelGroup[] = [];
      const expandedGroups = new Set<string>();

      const result = buildFlatList(channels, groups, expandedGroups, 'stopped');

      expect(result).toHaveLength(1);
      expect((result[0]!.data as ChannelStatus).name).toBe('Channel B');
    });

    it('should sort channels alphabetically within groups', () => {
      const channels = [
        createChannel('ch1', 'Zebra'),
        createChannel('ch2', 'Alpha'),
        createChannel('ch3', 'Monkey'),
      ];
      const groups = [createGroup('g1', 'All', ['ch1', 'ch2', 'ch3'])];
      const expandedGroups = new Set(['g1']);

      const result = buildFlatList(channels, groups, expandedGroups);

      expect(result).toHaveLength(4);
      expect((result[1]!.data as ChannelStatus).name).toBe('Alpha');
      expect((result[2]!.data as ChannelStatus).name).toBe('Monkey');
      expect((result[3]!.data as ChannelStatus).name).toBe('Zebra');
    });

    it('should include ungrouped channels at the end', () => {
      const channels = [
        createChannel('ch1', 'Grouped'),
        createChannel('ch2', 'Orphan'),
      ];
      const groups = [createGroup('g1', 'Production', ['ch1'])];
      const expandedGroups = new Set(['g1']);

      const result = buildFlatList(channels, groups, expandedGroups);

      expect(result).toHaveLength(4); // group header + 1 channel + ungrouped header + 1 channel
      expect(result[0]!.type).toBe('group');
      expect((result[0]!.data as ChannelGroup).name).toBe('Production');
      expect(result[2]!.type).toBe('group');
      expect((result[2]!.data as ChannelGroup).name).toBe('Ungrouped');
    });

    it('should handle empty inputs', () => {
      expect(buildFlatList([], [], new Set())).toHaveLength(0);
    });

    it('should handle search with no matches', () => {
      const channels = [createChannel('ch1', 'Alpha')];
      const result = buildFlatList(channels, [], new Set(), 'xyz');
      expect(result).toHaveLength(0);
    });

    it('should handle whitespace-only search query', () => {
      const channels = [createChannel('ch1', 'Alpha')];
      const result = buildFlatList(channels, [], new Set(), '   ');
      expect(result).toHaveLength(1); // Should not filter
    });
  });

  describe('getItemAtIndex', () => {
    it('should return item at valid index', () => {
      const channels = [createChannel('ch1', 'Alpha')];
      const item = getItemAtIndex(channels, [], new Set(), 0);
      expect(item).not.toBeNull();
      expect(item!.type).toBe('channel');
    });

    it('should return null for invalid index', () => {
      const channels = [createChannel('ch1', 'Alpha')];
      expect(getItemAtIndex(channels, [], new Set(), 99)).toBeNull();
      expect(getItemAtIndex(channels, [], new Set(), -1)).toBeNull();
    });
  });

  describe('getItemCount', () => {
    it('should return correct count', () => {
      const channels = [
        createChannel('ch1', 'Alpha'),
        createChannel('ch2', 'Beta'),
      ];
      const groups = [createGroup('g1', 'All', ['ch1', 'ch2'])];
      const expandedGroups = new Set(['g1']);

      expect(getItemCount(channels, groups, expandedGroups)).toBe(3);
    });

    it('should return 0 for empty list', () => {
      expect(getItemCount([], [], new Set())).toBe(0);
    });

    it('should respect search filter', () => {
      const channels = [
        createChannel('ch1', 'ADT'),
        createChannel('ch2', 'LAB'),
      ];
      expect(getItemCount(channels, [], new Set(), 'adt')).toBe(1);
    });
  });
});
