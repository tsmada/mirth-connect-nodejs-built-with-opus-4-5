/**
 * useChannels Hook
 *
 * React hook for managing channel data and operations.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiClient } from '../../lib/ApiClient.js';
import { ChannelStatus } from '../../types/index.js';

export interface UseChannelsOptions {
  /** API client instance */
  client: ApiClient;
  /** Refresh interval in seconds (for polling fallback) */
  refreshInterval?: number;
  /** Whether to enable polling (use as fallback for WebSocket) */
  enablePolling?: boolean;
}

export interface UseChannelsResult {
  /** List of channels with their statuses */
  channels: ChannelStatus[];
  /** Whether channels are currently loading */
  loading: boolean;
  /** Last fetch error (if any) */
  error: Error | null;
  /** Last update timestamp */
  lastUpdate: Date;
  /** Manually refresh channels */
  refresh: () => Promise<void>;
  /** Start a channel */
  startChannel: (channelId: string) => Promise<void>;
  /** Stop a channel */
  stopChannel: (channelId: string) => Promise<void>;
  /** Pause a channel */
  pauseChannel: (channelId: string) => Promise<void>;
  /** Resume a channel */
  resumeChannel: (channelId: string) => Promise<void>;
  /** Deploy a channel */
  deployChannel: (channelId: string) => Promise<void>;
  /** Undeploy a channel */
  undeployChannel: (channelId: string) => Promise<void>;
  /** Update a single channel's state (for WebSocket updates) */
  updateChannelState: (channelId: string, state: ChannelStatus['state']) => void;
  /** Update channel statistics */
  updateChannelStats: (
    channelId: string,
    stats: Partial<ChannelStatus['statistics']>
  ) => void;
}

/**
 * Hook for managing channel data
 */
export function useChannels(options: UseChannelsOptions): UseChannelsResult {
  const { client, refreshInterval = 5, enablePolling = true } = options;

  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch channels from API
  const refresh = useCallback(async () => {
    try {
      const statuses = await client.getChannelStatuses(undefined, true);
      setChannels(statuses);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [client]);

  // Initial fetch and polling setup
  useEffect(() => {
    refresh();

    if (enablePolling && refreshInterval > 0) {
      intervalRef.current = setInterval(refresh, refreshInterval * 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [refresh, refreshInterval, enablePolling]);

  // Channel operations
  const startChannel = useCallback(
    async (channelId: string) => {
      await client.startChannel(channelId);
      await refresh();
    },
    [client, refresh]
  );

  const stopChannel = useCallback(
    async (channelId: string) => {
      await client.stopChannel(channelId);
      await refresh();
    },
    [client, refresh]
  );

  const pauseChannel = useCallback(
    async (channelId: string) => {
      await client.pauseChannel(channelId);
      await refresh();
    },
    [client, refresh]
  );

  const resumeChannel = useCallback(
    async (channelId: string) => {
      await client.resumeChannel(channelId);
      await refresh();
    },
    [client, refresh]
  );

  const deployChannel = useCallback(
    async (channelId: string) => {
      await client.deployChannel(channelId);
      await refresh();
    },
    [client, refresh]
  );

  const undeployChannel = useCallback(
    async (channelId: string) => {
      await client.undeployChannel(channelId);
      await refresh();
    },
    [client, refresh]
  );

  // Direct state updates (for WebSocket integration)
  const updateChannelState = useCallback(
    (channelId: string, state: ChannelStatus['state']) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.channelId === channelId ? { ...ch, state } : ch))
      );
      setLastUpdate(new Date());
    },
    []
  );

  const updateChannelStats = useCallback(
    (channelId: string, stats: Partial<ChannelStatus['statistics']>) => {
      setChannels((prev) =>
        prev.map((ch) =>
          ch.channelId === channelId
            ? {
                ...ch,
                statistics: ch.statistics
                  ? { ...ch.statistics, ...stats }
                  : (stats as ChannelStatus['statistics']),
              }
            : ch
        )
      );
      setLastUpdate(new Date());
    },
    []
  );

  return {
    channels,
    loading,
    error,
    lastUpdate,
    refresh,
    startChannel,
    stopChannel,
    pauseChannel,
    resumeChannel,
    deployChannel,
    undeployChannel,
    updateChannelState,
    updateChannelStats,
  };
}

export default useChannels;
