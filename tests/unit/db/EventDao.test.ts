/**
 * EventDao Behavioral Tests
 *
 * Tests CRUD operations, search filtering, date-based deletion, and edge cases.
 * Ported from Java Event controller behavioral contracts.
 *
 * Architecture:
 * - EventDao.ts provides CRUD + search operations on the EVENT table
 * - Events use auto-increment ID (database-generated)
 * - Attributes serialized as "key=value\n" text (not JSON)
 * - Search uses dynamic WHERE clause builder with AND combination
 * - Mocks: pool.ts query/execute functions
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// ---------------------------------------------------------------------------
// Mock pool module
// ---------------------------------------------------------------------------
const mockQuery = jest.fn<(...args: unknown[]) => Promise<RowDataPacket[]>>();
const mockExecute = jest.fn<(...args: unknown[]) => Promise<ResultSetHeader>>();

jest.mock('../../../src/db/pool.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}));

import {
  insertEvent,
  searchEvents,
  deleteEventsBeforeDate,
  getMaxEventId,
} from '../../../src/db/EventDao.js';
import {
  EventLevel,
  EventOutcome,
  ServerEvent,
  EventFilter,
} from '../../../src/api/models/ServerEvent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEventRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ID: 1,
    DATE_CREATED: new Date('2026-02-22T10:00:00Z'),
    NAME: 'Channel deployed',
    EVENT_LEVEL: 'INFORMATION',
    OUTCOME: 'SUCCESS',
    ATTRIBUTES: 'channelId=abc-123\nchannelName=ADT Receiver',
    USER_ID: 1,
    IP_ADDRESS: '192.168.1.100',
    SERVER_ID: 'server-001',
    constructor: { name: 'RowDataPacket' },
    ...overrides,
  } as unknown as RowDataPacket;
}

function makeEvent(overrides: Partial<Omit<ServerEvent, 'id'>> = {}): Omit<ServerEvent, 'id'> {
  const attributes = new Map<string, string>();
  attributes.set('channelId', 'abc-123');
  attributes.set('channelName', 'ADT Receiver');

  return {
    eventTime: new Date('2026-02-22T10:00:00Z'),
    name: 'Channel deployed',
    level: EventLevel.INFORMATION,
    outcome: EventOutcome.SUCCESS,
    attributes,
    userId: 1,
    ipAddress: '192.168.1.100',
    serverId: 'server-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventDao Behavioral Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Contract 1: insertEvent all fields
  // =========================================================================
  describe('insertEvent all fields', () => {
    it('should persist userId, ipAddress, level, outcome, and serialized attributes', async () => {
      mockExecute.mockResolvedValueOnce({ insertId: 42, affectedRows: 1 } as ResultSetHeader);

      const event = makeEvent();
      const insertedId = await insertEvent(event);

      expect(insertedId).toBe(42);
      expect(mockExecute).toHaveBeenCalledTimes(1);

      const callArgs = mockExecute.mock.calls[0] as unknown[];
      const sql = callArgs[0] as string;
      const params = callArgs[1] as Record<string, unknown>;

      expect(sql).toContain('INSERT INTO EVENT');
      expect(params.name).toBe('Channel deployed');
      expect(params.level).toBe('INFORMATION');
      expect(params.outcome).toBe('SUCCESS');
      expect(params.userId).toBe(1);
      expect(params.ipAddress).toBe('192.168.1.100');
      expect(params.serverId).toBe('server-001');

      // Attributes serialized as key=value\n format
      const attrStr = params.attributes as string;
      expect(attrStr).toContain('channelId=abc-123');
      expect(attrStr).toContain('channelName=ADT Receiver');
    });
  });

  // =========================================================================
  // Contract 2: searchEvents dateRange filter
  // =========================================================================
  describe('searchEvents dateRange filter', () => {
    it('should include DATE_CREATED >= startDate AND <= endDate in WHERE clause', async () => {
      mockQuery.mockResolvedValueOnce([makeEventRow()] as RowDataPacket[]);

      const filter: EventFilter = {
        startDate: new Date('2026-02-01T00:00:00Z'),
        endDate: new Date('2026-02-28T23:59:59Z'),
      };

      await searchEvents(filter);

      const sql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      const params = (mockQuery.mock.calls[0] as unknown[])[1] as Record<string, unknown>;

      expect(sql).toContain('DATE_CREATED >= :startDate');
      expect(sql).toContain('DATE_CREATED <= :endDate');
      expect(params.startDate).toEqual(new Date('2026-02-01T00:00:00Z'));
      expect(params.endDate).toEqual(new Date('2026-02-28T23:59:59Z'));
    });
  });

  // =========================================================================
  // Contract 3: searchEvents level filter
  // =========================================================================
  describe('searchEvents level filter', () => {
    it('should filter by INFORMATION, WARNING, or ERROR level using IN clause', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEventRow({ EVENT_LEVEL: 'ERROR' }),
      ] as RowDataPacket[]);

      const filter: EventFilter = {
        levels: [EventLevel.ERROR],
      };

      const results = await searchEvents(filter);

      const sql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      expect(sql).toContain('EVENT_LEVEL IN');

      expect(results).toHaveLength(1);
      expect(results[0]!.level).toBe('ERROR');
    });

    it('should support multi-level filtering', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEventRow({ ID: 1, EVENT_LEVEL: 'WARNING' }),
        makeEventRow({ ID: 2, EVENT_LEVEL: 'ERROR' }),
      ] as RowDataPacket[]);

      const filter: EventFilter = {
        levels: [EventLevel.WARNING, EventLevel.ERROR],
      };

      await searchEvents(filter);

      const sql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      const params = (mockQuery.mock.calls[0] as unknown[])[1] as Record<string, unknown>;

      expect(sql).toContain('EVENT_LEVEL IN');
      expect(params.level0).toBe('WARNING');
      expect(params.level1).toBe('ERROR');
    });
  });

  // =========================================================================
  // Contract 4: searchEvents combined filters
  // =========================================================================
  describe('searchEvents combined filters', () => {
    it('should combine multiple WHERE clauses with AND', async () => {
      mockQuery.mockResolvedValueOnce([makeEventRow()] as RowDataPacket[]);

      const filter: EventFilter = {
        levels: [EventLevel.ERROR],
        outcome: EventOutcome.FAILURE,
        userId: 1,
        name: 'deploy',
      };

      await searchEvents(filter);

      const sql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      const params = (mockQuery.mock.calls[0] as unknown[])[1] as Record<string, unknown>;

      // All conditions are ANDed
      expect(sql).toContain('EVENT_LEVEL IN');
      expect(sql).toContain('OUTCOME = :outcome');
      expect(sql).toContain('USER_ID = :userId');
      expect(sql).toContain('LOWER(NAME) LIKE LOWER(:nameLike)');

      // Combined with AND
      expect(sql).toContain(' AND ');

      // Params populated
      expect(params.outcome).toBe('FAILURE');
      expect(params.userId).toBe(1);
      expect(params.nameLike).toBe('%deploy%');
    });
  });

  // =========================================================================
  // Contract 5: deleteEventsBeforeDate
  // =========================================================================
  describe('deleteEventsBeforeDate', () => {
    it('should delete only events older than the threshold date', async () => {
      mockExecute.mockResolvedValueOnce({ affectedRows: 15 } as ResultSetHeader);

      const threshold = new Date('2026-01-01T00:00:00Z');
      const deletedCount = await deleteEventsBeforeDate(threshold);

      expect(deletedCount).toBe(15);

      const sql = (mockExecute.mock.calls[0] as unknown[])[0] as string;
      const params = (mockExecute.mock.calls[0] as unknown[])[1] as Record<string, unknown>;

      expect(sql).toContain('DELETE FROM EVENT');
      expect(sql).toContain('DATE_CREATED < :dateThreshold');
      expect(params.dateThreshold).toEqual(threshold);
    });
  });

  // =========================================================================
  // Contract 6: getMaxEventId
  // =========================================================================
  describe('getMaxEventId', () => {
    it('should return the maximum event ID', async () => {
      mockQuery.mockResolvedValueOnce([
        { max_id: 999, constructor: { name: 'RowDataPacket' } },
      ] as RowDataPacket[]);

      const maxId = await getMaxEventId();
      expect(maxId).toBe(999);
    });

    it('should return 0 when table is empty', async () => {
      mockQuery.mockResolvedValueOnce([
        { max_id: null, constructor: { name: 'RowDataPacket' } },
      ] as RowDataPacket[]);

      const maxId = await getMaxEventId();
      expect(maxId).toBe(0);
    });
  });

  // =========================================================================
  // Contract 7: searchEvents empty result
  // =========================================================================
  describe('searchEvents empty result', () => {
    it('should return empty array when no events match — not null or error', async () => {
      mockQuery.mockResolvedValueOnce([] as RowDataPacket[]);

      const filter: EventFilter = {
        levels: [EventLevel.ERROR],
        name: 'nonexistent-event-name',
      };

      const results = await searchEvents(filter);

      expect(results).toEqual([]);
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(0);
    });

    it('should return empty array for empty filter (no WHERE clause)', async () => {
      mockQuery.mockResolvedValueOnce([] as RowDataPacket[]);

      const results = await searchEvents({});

      expect(results).toEqual([]);

      // Verify no WHERE clause when filter is empty
      const sql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      expect(sql).not.toContain('WHERE');
    });
  });
});
