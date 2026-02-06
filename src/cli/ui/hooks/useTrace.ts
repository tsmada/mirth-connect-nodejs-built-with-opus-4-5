/**
 * useTrace Hook
 *
 * React hook for tracing messages across VM-connected channels.
 * Wraps ApiClient.traceMessage() with loading/error state management.
 */

import { useState, useCallback } from 'react';
import { ApiClient } from '../../lib/ApiClient.js';
import { TraceResult } from '../../types/index.js';

export interface UseTraceOptions {
  /** API client instance */
  client: ApiClient;
}

export interface UseTraceResult {
  /** Trace result data (null until a trace is executed) */
  traceData: TraceResult | null;
  /** Whether a trace is currently in progress */
  loading: boolean;
  /** Error message from the last trace attempt */
  error: string | null;
  /** Execute a trace for a given channel and message */
  execute: (
    channelId: string,
    messageId: number,
    options?: {
      includeContent?: boolean;
      contentTypes?: string;
      maxContentLength?: number;
      maxDepth?: number;
      maxChildren?: number;
      direction?: string;
    }
  ) => Promise<void>;
  /** Clear trace data and error state */
  clear: () => void;
}

/**
 * Hook for tracing messages across VM-connected channels
 */
export function useTrace(options: UseTraceOptions): UseTraceResult {
  const { client } = options;

  const [traceData, setTraceData] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (
      channelId: string,
      messageId: number,
      traceOptions?: {
        includeContent?: boolean;
        contentTypes?: string;
        maxContentLength?: number;
        maxDepth?: number;
        maxChildren?: number;
        direction?: string;
      }
    ) => {
      setLoading(true);
      setError(null);
      setTraceData(null);

      try {
        const result = await client.traceMessage(channelId, messageId, traceOptions);
        setTraceData(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  const clear = useCallback(() => {
    setTraceData(null);
    setLoading(false);
    setError(null);
  }, []);

  return {
    traceData,
    loading,
    error,
    execute,
    clear,
  };
}

export default useTrace;
