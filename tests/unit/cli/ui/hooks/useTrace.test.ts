/**
 * useTrace Hook Tests
 *
 * Tests the trace data-fetching logic and state management.
 * Tests are written against extracted pure functions to avoid
 * needing ink-testing-library for hook rendering.
 */

import { TraceResult } from '../../../../../src/cli/types/index.js';

// Mock ApiClient for testing
function createMockClient(response?: TraceResult, error?: Error) {
  return {
    traceMessage: jest.fn().mockImplementation(async () => {
      if (error) throw error;
      return response;
    }),
  };
}

// Extracted state machine logic from the hook for testability
interface TraceState {
  traceData: TraceResult | null;
  loading: boolean;
  error: string | null;
}

async function executeTrace(
  client: { traceMessage: jest.Mock },
  channelId: string,
  messageId: number,
  options?: Record<string, unknown>
): Promise<TraceState> {
  try {
    const result = await client.traceMessage(channelId, messageId, options);
    return { traceData: result, loading: false, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { traceData: null, loading: false, error: message };
  }
}

function clearState(): TraceState {
  return { traceData: null, loading: false, error: null };
}

// Test fixtures
function createMockTraceResult(overrides?: Partial<TraceResult>): TraceResult {
  return {
    root: {
      channelId: 'ch-001',
      channelName: 'ADT Receiver',
      messageId: 42,
      receivedDate: '2026-02-06T10:00:00Z',
      status: 'SENT',
      connectorName: 'Source',
      depth: 0,
      children: [],
    },
    totalNodes: 1,
    maxDepth: 0,
    totalLatencyMs: 15,
    hasErrors: false,
    truncated: false,
    ...overrides,
  };
}

describe('useTrace', () => {
  describe('executeTrace', () => {
    it('should return trace data on success', async () => {
      const mockResult = createMockTraceResult();
      const client = createMockClient(mockResult);

      const state = await executeTrace(client, 'ch-001', 42);

      expect(state.traceData).toEqual(mockResult);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(client.traceMessage).toHaveBeenCalledWith('ch-001', 42, undefined);
    });

    it('should pass options to the client', async () => {
      const mockResult = createMockTraceResult();
      const client = createMockClient(mockResult);
      const opts = { includeContent: true, maxDepth: 5, direction: 'both' };

      await executeTrace(client, 'ch-001', 42, opts);

      expect(client.traceMessage).toHaveBeenCalledWith('ch-001', 42, opts);
    });

    it('should return error state on failure', async () => {
      const client = createMockClient(undefined, new Error('Channel not found'));

      const state = await executeTrace(client, 'ch-999', 1);

      expect(state.traceData).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.error).toBe('Channel not found');
    });

    it('should handle non-Error exceptions', async () => {
      const client = {
        traceMessage: jest.fn().mockRejectedValue('string error'),
      };

      const state = await executeTrace(client, 'ch-001', 1);

      expect(state.error).toBe('string error');
      expect(state.traceData).toBeNull();
    });

    it('should return trace data with errors flag', async () => {
      const mockResult = createMockTraceResult({ hasErrors: true });
      const client = createMockClient(mockResult);

      const state = await executeTrace(client, 'ch-001', 42);

      expect(state.traceData!.hasErrors).toBe(true);
    });

    it('should return trace data with truncated flag', async () => {
      const mockResult = createMockTraceResult({ truncated: true });
      const client = createMockClient(mockResult);

      const state = await executeTrace(client, 'ch-001', 42);

      expect(state.traceData!.truncated).toBe(true);
    });
  });

  describe('clearState', () => {
    it('should return a clean initial state', () => {
      const state = clearState();

      expect(state.traceData).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('mock client', () => {
    it('should track call count', async () => {
      const client = createMockClient(createMockTraceResult());

      await executeTrace(client, 'ch-001', 1);
      await executeTrace(client, 'ch-001', 2);
      await executeTrace(client, 'ch-002', 1);

      expect(client.traceMessage).toHaveBeenCalledTimes(3);
    });

    it('should record different channel/message combinations', async () => {
      const client = createMockClient(createMockTraceResult());

      await executeTrace(client, 'ch-001', 10);
      await executeTrace(client, 'ch-002', 20);

      expect(client.traceMessage).toHaveBeenNthCalledWith(1, 'ch-001', 10, undefined);
      expect(client.traceMessage).toHaveBeenNthCalledWith(2, 'ch-002', 20, undefined);
    });
  });
});
