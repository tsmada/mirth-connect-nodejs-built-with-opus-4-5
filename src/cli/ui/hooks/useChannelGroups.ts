/**
 * useChannelGroups Hook
 *
 * React hook for managing channel groups with expand/collapse state.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ApiClient } from '../../lib/ApiClient.js';
import {
  ChannelGroup,
  ChannelStatus,
  CHANNEL_GROUP_DEFAULT_ID,
  CHANNEL_GROUP_DEFAULT_NAME,
} from '../../types/index.js';

export interface GroupedChannel {
  channel: ChannelStatus;
  groupId: string | null;
  groupName: string | null;
}

export interface UseChannelGroupsOptions {
  /** API client instance */
  client: ApiClient;
  /** List of channels to group */
  channels: ChannelStatus[];
}

export interface UseChannelGroupsResult {
  /** Channel groups */
  groups: ChannelGroup[];
  /** Whether groups are loading */
  loading: boolean;
  /** Last fetch error (if any) */
  error: Error | null;
  /** Set of expanded group IDs */
  expandedGroups: Set<string>;
  /** Toggle a group's expanded state */
  toggleGroup: (groupId: string) => void;
  /** Expand all groups */
  expandAll: () => void;
  /** Collapse all groups */
  collapseAll: () => void;
  /** Check if a group is expanded */
  isExpanded: (groupId: string) => boolean;
  /** Get channels organized by group */
  getGroupedChannels: () => {
    groupId: string | null;
    groupName: string | null;
    channels: ChannelStatus[];
  }[];
  /** Refresh groups from API */
  refresh: () => Promise<void>;
}

/**
 * Hook for managing channel groups
 */
export function useChannelGroups(options: UseChannelGroupsOptions): UseChannelGroupsResult {
  const { client, channels } = options;

  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Fetch groups from API and synthesize virtual Default Group
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const fetchedGroups = await client.getChannelGroups();
      setGroups(fetchedGroups);

      // Expand all groups (including Default Group) on first load
      if (expandedGroups.size === 0) {
        setExpandedGroups(new Set([CHANNEL_GROUP_DEFAULT_ID, ...fetchedGroups.map((g) => g.id)]));
      }

      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [client, expandedGroups.size]);

  // Initial fetch
  useEffect(() => {
    void refresh();
  }, []);

  // Synthesize the groups list with a virtual Default Group at the front
  const groupsWithDefault = useMemo(() => {
    // Collect all channel IDs that belong to a real group
    const assignedChannelIds = new Set<string>();
    for (const group of groups) {
      for (const channelId of group.channels || []) {
        assignedChannelIds.add(channelId);
      }
    }

    // Channels not in any real group belong to the Default Group
    const defaultGroupChannels = channels
      .filter((ch) => !assignedChannelIds.has(ch.channelId))
      .map((ch) => ch.channelId);

    const defaultGroup: ChannelGroup = {
      id: CHANNEL_GROUP_DEFAULT_ID,
      name: CHANNEL_GROUP_DEFAULT_NAME,
      channels: defaultGroupChannels,
    };

    return [defaultGroup, ...groups];
  }, [groups, channels]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedGroups(new Set(groupsWithDefault.map((g) => g.id)));
  }, [groupsWithDefault]);

  const collapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  const isExpanded = useCallback(
    (groupId: string) => expandedGroups.has(groupId),
    [expandedGroups]
  );

  const getGroupedChannels = useCallback(() => {
    // Build a map of channel ID to group
    const channelToGroup = new Map<string, ChannelGroup>();
    for (const group of groupsWithDefault) {
      for (const channelId of group.channels || []) {
        channelToGroup.set(channelId, group);
      }
    }

    // Group channels
    const grouped = new Map<
      string,
      { groupName: string; channels: ChannelStatus[] }
    >();

    for (const channel of channels) {
      const group = channelToGroup.get(channel.channelId);
      const groupId = group?.id ?? CHANNEL_GROUP_DEFAULT_ID;
      const groupName = group?.name ?? CHANNEL_GROUP_DEFAULT_NAME;

      if (!grouped.has(groupId)) {
        grouped.set(groupId, { groupName, channels: [] });
      }
      grouped.get(groupId)!.channels.push(channel);
    }

    // Build result: Default Group first, then named groups alphabetically
    const result: {
      groupId: string | null;
      groupName: string | null;
      channels: ChannelStatus[];
    }[] = [];

    // Default Group always first
    const defaultEntry = grouped.get(CHANNEL_GROUP_DEFAULT_ID);
    result.push({
      groupId: CHANNEL_GROUP_DEFAULT_ID,
      groupName: CHANNEL_GROUP_DEFAULT_NAME,
      channels: (defaultEntry?.channels ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    });

    // Real groups sorted alphabetically
    const namedGroups = Array.from(grouped.entries())
      .filter(([id]) => id !== CHANNEL_GROUP_DEFAULT_ID)
      .sort(([, a], [, b]) => a.groupName.localeCompare(b.groupName));

    for (const [groupId, { groupName, channels: groupChannels }] of namedGroups) {
      result.push({
        groupId,
        groupName,
        channels: groupChannels.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    return result;
  }, [groupsWithDefault, channels]);

  return {
    groups: groupsWithDefault,
    loading,
    error,
    expandedGroups,
    toggleGroup,
    expandAll,
    collapseAll,
    isExpanded,
    getGroupedChannels,
    refresh,
  };
}

export default useChannelGroups;
