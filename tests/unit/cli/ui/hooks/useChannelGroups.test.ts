/**
 * useChannelGroups Hook Tests
 *
 * Tests the channel grouping and expand/collapse logic.
 */

import { ChannelStatus, ChannelGroup } from '../../../../../src/cli/types/index.js';

// Helper function extracted from the hook for testing
function getGroupedChannels(
  channels: ChannelStatus[],
  groups: ChannelGroup[]
): { groupId: string | null; groupName: string | null; channels: ChannelStatus[] }[] {
  // Build a map of channel ID to group
  const channelToGroup = new Map<string, ChannelGroup>();
  for (const group of groups) {
    for (const channelId of group.channels || []) {
      channelToGroup.set(channelId, group);
    }
  }

  // Group channels
  const grouped = new Map<string | null, { groupName: string | null; channels: ChannelStatus[] }>();

  for (const channel of channels) {
    const group = channelToGroup.get(channel.channelId);
    const groupId = group?.id ?? null;
    const groupName = group?.name ?? null;

    if (!grouped.has(groupId)) {
      grouped.set(groupId, { groupName, channels: [] });
    }
    grouped.get(groupId)!.channels.push(channel);
  }

  // Sort groups: named groups first (alphabetically), then ungrouped
  const result: { groupId: string | null; groupName: string | null; channels: ChannelStatus[] }[] = [];

  // Add named groups first (sorted by name)
  const namedGroups = Array.from(grouped.entries())
    .filter(([id]) => id !== null)
    .sort(([, a], [, b]) => (a.groupName || '').localeCompare(b.groupName || ''));

  for (const [groupId, { groupName, channels: groupChannels }] of namedGroups) {
    result.push({
      groupId,
      groupName,
      channels: groupChannels.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // Add ungrouped channels last
  const ungrouped = grouped.get(null);
  if (ungrouped && ungrouped.channels.length > 0) {
    result.push({
      groupId: null,
      groupName: 'Ungrouped',
      channels: ungrouped.channels.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return result;
}

describe('useChannelGroups', () => {
  const createChannel = (id: string, name: string): ChannelStatus => ({
    channelId: id,
    name,
    state: 'STARTED',
    statistics: { received: 0, filtered: 0, queued: 0, sent: 0, errored: 0 },
  });

  const createGroup = (id: string, name: string, channelIds: string[]): ChannelGroup => ({
    id,
    name,
    channels: channelIds,
  });

  describe('getGroupedChannels', () => {
    it('should group channels by their assigned groups', () => {
      const channels = [
        createChannel('ch1', 'Channel A'),
        createChannel('ch2', 'Channel B'),
        createChannel('ch3', 'Channel C'),
      ];

      const groups = [
        createGroup('g1', 'Production', ['ch1', 'ch2']),
        createGroup('g2', 'Development', ['ch3']),
      ];

      const result = getGroupedChannels(channels, groups);

      expect(result).toHaveLength(2);
      expect(result[0]!.groupName).toBe('Development');
      expect(result[0]!.channels).toHaveLength(1);
      expect(result[0]!.channels[0]!.name).toBe('Channel C');
      expect(result[1]!.groupName).toBe('Production');
      expect(result[1]!.channels).toHaveLength(2);
    });

    it('should put ungrouped channels in "Ungrouped" group', () => {
      const channels = [
        createChannel('ch1', 'Grouped'),
        createChannel('ch2', 'Ungrouped A'),
        createChannel('ch3', 'Ungrouped B'),
      ];

      const groups = [createGroup('g1', 'Production', ['ch1'])];

      const result = getGroupedChannels(channels, groups);

      expect(result).toHaveLength(2);
      expect(result[0]!.groupName).toBe('Production');
      expect(result[1]!.groupName).toBe('Ungrouped');
      expect(result[1]!.channels).toHaveLength(2);
    });

    it('should sort channels alphabetically within groups', () => {
      const channels = [
        createChannel('ch1', 'Zebra'),
        createChannel('ch2', 'Alpha'),
        createChannel('ch3', 'Monkey'),
      ];

      const groups = [createGroup('g1', 'All', ['ch1', 'ch2', 'ch3'])];

      const result = getGroupedChannels(channels, groups);

      expect(result[0]!.channels.map((c) => c.name)).toEqual(['Alpha', 'Monkey', 'Zebra']);
    });

    it('should sort groups alphabetically by name', () => {
      const channels = [
        createChannel('ch1', 'A'),
        createChannel('ch2', 'B'),
        createChannel('ch3', 'C'),
      ];

      const groups = [
        createGroup('g1', 'Zebra Group', ['ch1']),
        createGroup('g2', 'Alpha Group', ['ch2']),
        createGroup('g3', 'Monkey Group', ['ch3']),
      ];

      const result = getGroupedChannels(channels, groups);

      expect(result.map((g) => g.groupName)).toEqual(['Alpha Group', 'Monkey Group', 'Zebra Group']);
    });

    it('should handle empty channels array', () => {
      const result = getGroupedChannels([], [createGroup('g1', 'Empty', [])]);
      expect(result).toHaveLength(0);
    });

    it('should handle empty groups array', () => {
      const channels = [createChannel('ch1', 'Orphan')];
      const result = getGroupedChannels(channels, []);

      expect(result).toHaveLength(1);
      expect(result[0]!.groupName).toBe('Ungrouped');
      expect(result[0]!.channels).toHaveLength(1);
    });

    it('should handle channel assigned to non-existent group', () => {
      const channels = [createChannel('ch1', 'Orphan')];
      const groups = [createGroup('g1', 'Empty Group', [])];

      const result = getGroupedChannels(channels, groups);

      expect(result).toHaveLength(1);
      expect(result[0]!.groupName).toBe('Ungrouped');
    });
  });
});
