/**
 * useMessages Hook
 *
 * React hook for fetching, paginating, and filtering channel messages.
 * Pattern mirrors useTrace.ts — wraps ApiClient calls with loading/error state.
 */

import { useState, useCallback } from 'react';
import { ApiClient } from '../../lib/ApiClient.js';
import { Message, MessageStatus, MessageFilter } from '../../types/index.js';

/** Status cycle order: null → R → F → T → S → Q → E → P → null */
const STATUS_CYCLE: (MessageStatus | null)[] = [null, 'R', 'F', 'T', 'S', 'Q', 'E', 'P'];

export interface UseMessagesOptions {
  /** API client instance */
  client: ApiClient;
}

export interface UseMessagesResult {
  messages: Message[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  statusFilter: MessageStatus | null;
  channelId: string | null;

  loadMessages(channelId: string): Promise<void>;
  nextPage(): Promise<void>;
  prevPage(): Promise<void>;
  cycleStatusFilter(): Promise<void>;
  refresh(): Promise<void>;
  clear(): void;
}

/**
 * Get the next status filter in the cycle.
 * Exported for testing.
 */
export function nextStatusInCycle(current: MessageStatus | null): MessageStatus | null {
  const idx = STATUS_CYCLE.indexOf(current);
  const nextIdx = (idx + 1) % STATUS_CYCLE.length;
  return STATUS_CYCLE[nextIdx]!;
}

/**
 * Calculate total pages from count and page size.
 * Exported for testing.
 */
export function totalPages(count: number, pageSize: number): number {
  if (count <= 0) return 1;
  return Math.ceil(count / pageSize);
}

const PAGE_SIZE = 20;

/**
 * Hook for fetching and paginating channel messages
 */
export function useMessages(options: UseMessagesOptions): UseMessagesResult {
  const { client } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<MessageStatus | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (chId: string, pageNum: number, filter: MessageStatus | null) => {
      setLoading(true);
      setError(null);

      try {
        const offset = pageNum * PAGE_SIZE;
        const fetchOptions = { offset, limit: PAGE_SIZE };

        let msgs: Message[];
        let count: number;

        if (filter) {
          const msgFilter: MessageFilter = { statuses: [filter] };
          [msgs, count] = await Promise.all([
            client.searchMessages(chId, msgFilter, fetchOptions),
            client.getMessageCount(chId, msgFilter),
          ]);
        } else {
          [msgs, count] = await Promise.all([
            client.getMessages(chId, fetchOptions),
            client.getMessageCount(chId),
          ]);
        }

        // Sort descending by messageId (newest first)
        msgs.sort((a, b) => b.messageId - a.messageId);

        setMessages(msgs);
        setTotalCount(count);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  const loadMessages = useCallback(
    async (chId: string) => {
      setChannelId(chId);
      setPage(0);
      setStatusFilter(null);
      await fetchPage(chId, 0, null);
    },
    [fetchPage]
  );

  const nextPage = useCallback(async () => {
    if (!channelId) return;
    const maxPage = totalPages(totalCount, PAGE_SIZE) - 1;
    if (page >= maxPage) return;
    const next = page + 1;
    setPage(next);
    await fetchPage(channelId, next, statusFilter);
  }, [channelId, page, totalCount, statusFilter, fetchPage]);

  const prevPage = useCallback(async () => {
    if (!channelId) return;
    if (page <= 0) return;
    const prev = page - 1;
    setPage(prev);
    await fetchPage(channelId, prev, statusFilter);
  }, [channelId, page, statusFilter, fetchPage]);

  const cycleStatusFilter = useCallback(async () => {
    if (!channelId) return;
    const next = nextStatusInCycle(statusFilter);
    setStatusFilter(next);
    setPage(0);
    await fetchPage(channelId, 0, next);
  }, [channelId, statusFilter, fetchPage]);

  const refresh = useCallback(async () => {
    if (!channelId) return;
    await fetchPage(channelId, page, statusFilter);
  }, [channelId, page, statusFilter, fetchPage]);

  const clear = useCallback(() => {
    setMessages([]);
    setTotalCount(0);
    setLoading(false);
    setError(null);
    setPage(0);
    setStatusFilter(null);
    setChannelId(null);
  }, []);

  return {
    messages,
    totalCount,
    loading,
    error,
    page,
    pageSize: PAGE_SIZE,
    statusFilter,
    channelId,
    loadMessages,
    nextPage,
    prevPage,
    cycleStatusFilter,
    refresh,
    clear,
  };
}

export default useMessages;
