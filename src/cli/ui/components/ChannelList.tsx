/**
 * ChannelList Component
 *
 * Grouped channel list with collapsible groups.
 */

import React, { FC, useMemo } from 'react';
import { Box, Text } from 'ink';
import { ChannelStatus, ChannelGroup as ChannelGroupType } from '../../types/index.js';
import { ChannelRow, COLUMN_WIDTHS, calculateNameWidth } from './ChannelRow.js';
import { ChannelGroup } from './ChannelGroup.js';

export interface ListItem {
  type: 'group' | 'channel';
  id: string;
  groupId: string | null;
  data: ChannelGroupType | ChannelStatus;
}

export interface ChannelListProps {
  channels: ChannelStatus[];
  groups: ChannelGroupType[];
  expandedGroups: Set<string>;
  selectedIndex: number;
  selectedChannelIds: Set<string>;
  width: number;
  searchQuery?: string;
}

/**
 * Build a flat list of items for display
 */
function buildFlatList(
  channels: ChannelStatus[],
  groups: ChannelGroupType[],
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
        data: { id: 'ungrouped', name: 'Ungrouped', channels: [] } as ChannelGroupType,
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

/**
 * Channel list component
 */
export const ChannelList: FC<ChannelListProps> = ({
  channels,
  groups,
  expandedGroups,
  selectedIndex,
  selectedChannelIds,
  width,
  searchQuery,
}) => {
  const items = useMemo(
    () => buildFlatList(channels, groups, expandedGroups, searchQuery),
    [channels, groups, expandedGroups, searchQuery]
  );

  if (items.length === 0) {
    return React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 2 },
      React.createElement(
        Text,
        { color: 'gray' },
        searchQuery ? 'No channels match your search.' : 'No channels found.'
      )
    );
  }

  // Calculate layout dimensions matching ChannelRow
  const hasGroups = groups.length > 0;
  const headerIndent = hasGroups ? 1 : 0;
  const nameWidth = calculateNameWidth(width, headerIndent);

  // Build header string matching row layout exactly
  const selectorPad = ' '.repeat(COLUMN_WIDTHS.selector + COLUMN_WIDTHS.indentPer * headerIndent);
  const nameHeader = 'NAME'.padEnd(nameWidth);
  const statusHeader = 'STATUS'.padEnd(COLUMN_WIDTHS.status);
  const portHeader = 'PORT'.padStart(COLUMN_WIDTHS.port);
  // Stats header: matches row format "  R:" + 5 + " F:" + 4 + " Q:" + 4 + " S:" + 5 + " E:" + 4
  // Each column: label chars + digit chars, right-aligned headers
  const statsHeader =
    'RECV'.padStart(9) + // "  R:" (4) + 5 digits
    'FILT'.padStart(7) + // " F:" (3) + 4 digits
    'QUE'.padStart(7) + // " Q:" (3) + 4 digits
    'SENT'.padStart(8) + // " S:" (3) + 5 digits
    'ERR'.padStart(7); // " E:" (3) + 4 digits

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    // Header row
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(
        Text,
        { color: 'gray', bold: true },
        selectorPad + nameHeader + ' ' + statusHeader + portHeader + statsHeader
      )
    ),
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'gray' }, '─'.repeat(Math.min(width - 2, 100)))
    ),
    // Items
    ...items.map((item, index) => {
      if (item.type === 'group') {
        const group = item.data as ChannelGroupType;
        const channelCount =
          item.groupId === null
            ? channels.filter((ch) => {
                for (const g of groups) {
                  if ((g.channels || []).includes(ch.channelId)) return false;
                }
                return true;
              }).length
            : (group.channels || []).length;

        return React.createElement(ChannelGroup, {
          key: item.id,
          name: group.name,
          channelCount,
          expanded: item.groupId === null || expandedGroups.has(item.groupId),
          selected: index === selectedIndex,
        });
      }

      const channel = item.data as ChannelStatus;
      return React.createElement(ChannelRow, {
        key: item.id,
        channel,
        selected: index === selectedIndex,
        multiSelected: selectedChannelIds.has(channel.channelId),
        width,
        indent: groups.length > 0 ? 1 : 0,
      });
    })
  );
};

/**
 * Get the item at a specific index
 */
export function getItemAtIndex(
  channels: ChannelStatus[],
  groups: ChannelGroupType[],
  expandedGroups: Set<string>,
  index: number,
  searchQuery?: string
): ListItem | null {
  const items = buildFlatList(channels, groups, expandedGroups, searchQuery);
  return items[index] || null;
}

/**
 * Get total item count
 */
export function getItemCount(
  channels: ChannelStatus[],
  groups: ChannelGroupType[],
  expandedGroups: Set<string>,
  searchQuery?: string
): number {
  return buildFlatList(channels, groups, expandedGroups, searchQuery).length;
}

export default ChannelList;
