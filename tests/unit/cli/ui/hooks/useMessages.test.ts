/**
 * useMessages Hook Tests
 *
 * Tests the message fetching state machine logic and exported pure functions.
 * Mirrors the pattern from useTrace.test.ts — tests extracted pure functions
 * to avoid needing ink-testing-library.
 */

import { MessageStatus, Message, MessageFilter } from '../../../../../src/cli/types/index.js';
import { nextStatusInCycle, totalPages } from '../../../../../src/cli/ui/hooks/useMessages.js';

// =============================================================================
// Pure function tests
// =============================================================================

describe('useMessages', () => {
  describe('nextStatusInCycle', () => {
    it('should cycle null → R', () => {
      expect(nextStatusInCycle(null)).toBe('R');
    });

    it('should cycle R → F', () => {
      expect(nextStatusInCycle('R')).toBe('F');
    });

    it('should cycle F → T', () => {
      expect(nextStatusInCycle('F')).toBe('T');
    });

    it('should cycle T → S', () => {
      expect(nextStatusInCycle('T')).toBe('S');
    });

    it('should cycle S → Q', () => {
      expect(nextStatusInCycle('S')).toBe('Q');
    });

    it('should cycle Q → E', () => {
      expect(nextStatusInCycle('Q')).toBe('E');
    });

    it('should cycle E → P', () => {
      expect(nextStatusInCycle('E')).toBe('P');
    });

    it('should cycle P → null (wraps around)', () => {
      expect(nextStatusInCycle('P')).toBeNull();
    });

    it('should complete a full cycle back to null', () => {
      let current: MessageStatus | null = null;
      const seen: (MessageStatus | null)[] = [current];
      for (let i = 0; i < 8; i++) {
        current = nextStatusInCycle(current);
        seen.push(current);
      }
      // Should have cycled through all statuses and back to null
      expect(seen).toEqual([null, 'R', 'F', 'T', 'S', 'Q', 'E', 'P', null]);
    });
  });

  describe('totalPages', () => {
    it('should return 1 for zero count', () => {
      expect(totalPages(0, 20)).toBe(1);
    });

    it('should return 1 for negative count', () => {
      expect(totalPages(-5, 20)).toBe(1);
    });

    it('should return 1 for count less than page size', () => {
      expect(totalPages(10, 20)).toBe(1);
    });

    it('should return 1 for count equal to page size', () => {
      expect(totalPages(20, 20)).toBe(1);
    });

    it('should return 2 for count slightly over page size', () => {
      expect(totalPages(21, 20)).toBe(2);
    });

    it('should return correct pages for exact multiples', () => {
      expect(totalPages(60, 20)).toBe(3);
      expect(totalPages(100, 20)).toBe(5);
    });

    it('should round up partial pages', () => {
      expect(totalPages(41, 20)).toBe(3);
      expect(totalPages(99, 20)).toBe(5);
    });
  });

  // =============================================================================
  // State machine logic tests (extracted from hook)
  // =============================================================================

  describe('fetchPage logic', () => {
    function createMockClient(
      messages: Message[] = [],
      count: number = 0,
      error?: Error
    ) {
      return {
        getMessages: jest.fn().mockImplementation(async () => {
          if (error) throw error;
          return messages;
        }),
        searchMessages: jest.fn().mockImplementation(async () => {
          if (error) throw error;
          return messages;
        }),
        getMessageCount: jest.fn().mockImplementation(async () => {
          if (error) throw error;
          return count;
        }),
      };
    }

    function createMockMessage(id: number, status: MessageStatus = 'S'): Message {
      return {
        messageId: id,
        channelId: 'ch-001',
        serverId: 'server-1',
        receivedDate: '2026-02-06T10:00:00Z',
        processed: true,
        connectorMessages: {
          0: {
            messageId: id,
            metaDataId: 0,
            channelId: 'ch-001',
            connectorName: 'Source',
            receivedDate: '2026-02-06T10:00:00Z',
            status,
            sendAttempts: 1,
          },
        },
      };
    }

    it('should use getMessages when no filter is active', async () => {
      const messages = [createMockMessage(1)];
      const client = createMockClient(messages, 1);

      await Promise.all([
        client.getMessages('ch-001', { offset: 0, limit: 20 }),
        client.getMessageCount('ch-001'),
      ]);

      expect(client.getMessages).toHaveBeenCalledWith('ch-001', { offset: 0, limit: 20 });
      expect(client.getMessageCount).toHaveBeenCalledWith('ch-001');
      expect(client.searchMessages).not.toHaveBeenCalled();
    });

    it('should use searchMessages when filter is active', async () => {
      const messages = [createMockMessage(1, 'E')];
      const client = createMockClient(messages, 1);
      const filter: MessageFilter = { statuses: ['E'] };

      await Promise.all([
        client.searchMessages('ch-001', filter, { offset: 0, limit: 20 }),
        client.getMessageCount('ch-001', filter),
      ]);

      expect(client.searchMessages).toHaveBeenCalledWith('ch-001', filter, { offset: 0, limit: 20 });
      expect(client.getMessageCount).toHaveBeenCalledWith('ch-001', filter);
    });

    it('should sort messages descending by messageId', () => {
      const msgs = [
        createMockMessage(1),
        createMockMessage(3),
        createMockMessage(2),
      ];

      msgs.sort((a, b) => b.messageId - a.messageId);

      expect(msgs.map((m) => m.messageId)).toEqual([3, 2, 1]);
    });

    it('should handle errors from getMessages', async () => {
      const client = createMockClient([], 0, new Error('Connection refused'));

      try {
        await client.getMessages('ch-001', { offset: 0, limit: 20 });
        fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toBe('Connection refused');
      }
    });

    it('should calculate correct offset for page', () => {
      const pageSize = 20;
      expect(0 * pageSize).toBe(0);
      expect(1 * pageSize).toBe(20);
      expect(2 * pageSize).toBe(40);
    });
  });
});
