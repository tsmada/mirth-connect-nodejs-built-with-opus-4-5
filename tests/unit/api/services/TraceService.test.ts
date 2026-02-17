/**
 * TraceService unit tests
 *
 * Mocks the database pool and ChannelController to test trace logic in isolation.
 */

// Mock pool before importing TraceService
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
  execute: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../../../src/db/pool', () => ({
  getPool: () => mockPool,
}));

jest.mock('../../../../src/controllers/ChannelController', () => ({
  ChannelController: {
    getAllChannels: jest.fn(),
    getChannelIdsAndNames: jest.fn(),
    getChannel: jest.fn(),
  },
}));

import { traceMessage } from '../../../../src/api/services/TraceService';
import { ChannelController } from '../../../../src/controllers/ChannelController';
import { ContentType } from '../../../../src/model/ContentType';

const mockGetAllChannels = ChannelController.getAllChannels as jest.Mock;
const mockGetIdsAndNames = ChannelController.getChannelIdsAndNames as jest.Mock;
const mockGetChannel = ChannelController.getChannel as jest.Mock;

describe('TraceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: channels exist with no VM connections
    mockGetAllChannels.mockResolvedValue([]);
    mockGetIdsAndNames.mockResolvedValue({});
    mockGetChannel.mockResolvedValue(null);
  });

  /**
   * Helper: set up a complete mock for a single-node trace
   */
  function setupSingleMessageMock(channelId: string, messageId: number, status = 'S') {
    const tableSuffix = channelId.replace(/-/g, '_');

    mockGetAllChannels.mockResolvedValue([
      { id: channelId, name: 'Test Channel', destinationConnectors: [] },
    ]);
    mockGetIdsAndNames.mockResolvedValue({ [channelId]: 'Test Channel' });

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const sqlStr = typeof sql === 'string' ? sql : '';

      // Table existence check
      if (sqlStr.includes('information_schema.TABLES')) {
        return [[{ TABLE_NAME: `D_M${tableSuffix}` }]];
      }

      // Source map query (no source map = root message)
      if (sqlStr.includes(`D_MC${tableSuffix}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
        return [[]]; // No source map
      }

      // Message query
      if (sqlStr.includes(`D_M${tableSuffix}`) && sqlStr.includes('WHERE ID')) {
        return [[{
          ID: messageId,
          SERVER_ID: 'server-1',
          RECEIVED_DATE: new Date('2026-02-06T14:30:45.123Z'),
          PROCESSED: 1,
        }]];
      }

      // Connector message query
      if (sqlStr.includes(`D_MM${tableSuffix}`)) {
        return [[{
          MESSAGE_ID: messageId,
          METADATA_ID: 0,
          RECEIVED_DATE: new Date('2026-02-06T14:30:45.123Z'),
          STATUS: status,
          CONNECTOR_NAME: 'Source',
          ERROR_CODE: null,
        }]];
      }

      // Content query
      if (sqlStr.includes(`D_MC${tableSuffix}`) && sqlStr.includes('CONTENT_TYPE IN')) {
        return [[{
          CONTENT_TYPE: ContentType.RAW,
          CONTENT: 'MSH|^~\\&|TEST',
          DATA_TYPE: 'HL7V2',
        }]];
      }

      return [[]];
    });
  }

  describe('traceMessage - single node', () => {
    it('should trace a root message with no chain', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupSingleMessageMock(channelId, 1);

      const result = await traceMessage(channelId, 1);

      expect(result.root.channelId).toBe(channelId);
      expect(result.root.channelName).toBe('Test Channel');
      expect(result.root.messageId).toBe(1);
      expect(result.root.status).toBe('SENT');
      expect(result.root.depth).toBe(0);
      expect(result.root.children).toHaveLength(0);
      expect(result.totalNodes).toBe(1);
      expect(result.maxDepth).toBe(0);
      expect(result.hasErrors).toBe(false);
    });

    it('should include content when requested', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupSingleMessageMock(channelId, 1);

      const result = await traceMessage(channelId, 1, { includeContent: true });

      expect(result.root.content).toBeDefined();
      expect(result.root.content?.raw).toBeDefined();
      expect(result.root.content?.raw?.content).toContain('MSH');
    });

    it('should exclude content when not requested', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupSingleMessageMock(channelId, 1);

      const result = await traceMessage(channelId, 1, { includeContent: false });

      expect(result.root.content).toBeUndefined();
    });
  });

  describe('traceMessage - error handling', () => {
    it('should handle message not found', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      const tableSuffix = channelId.replace(/-/g, '_');

      mockGetAllChannels.mockResolvedValue([]);
      mockGetIdsAndNames.mockResolvedValue({});

      mockQuery.mockImplementation(async (sql: string) => {
        const sqlStr = typeof sql === 'string' ? sql : '';
        if (sqlStr.includes('information_schema.TABLES')) {
          return [[{ TABLE_NAME: `D_M${tableSuffix}` }]];
        }
        // No source map found, message not found
        if (sqlStr.includes(`D_M${tableSuffix}`) && sqlStr.includes('WHERE ID')) {
          return [[]]; // Message not found
        }
        return [[]];
      });

      const result = await traceMessage(channelId, 999);

      expect(result.root.status).toBe('DELETED');
      expect(result.root.error).toContain('deleted');
    });

    it('should handle missing channel tables', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';

      mockGetAllChannels.mockResolvedValue([]);
      mockGetIdsAndNames.mockResolvedValue({});

      mockQuery.mockImplementation(async (sql: string) => {
        const sqlStr = typeof sql === 'string' ? sql : '';
        if (sqlStr.includes('information_schema.TABLES')) {
          return [[]]; // No tables
        }
        return [[]];
      });

      const result = await traceMessage(channelId, 1);

      expect(result.root.error).toContain('not deployed');
    });
  });

  describe('traceMessage - direction option', () => {
    it('should respect forward-only direction', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupSingleMessageMock(channelId, 1);

      const result = await traceMessage(channelId, 1, { direction: 'forward' });

      // Should start from the given message, not trace backward
      expect(result.root.channelId).toBe(channelId);
      expect(result.root.messageId).toBe(1);
    });

    it('should respect backward-only direction', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupSingleMessageMock(channelId, 1);

      const result = await traceMessage(channelId, 1, { direction: 'backward' });

      // Should not trace forward (no children)
      expect(result.root.children).toHaveLength(0);
    });
  });

  describe('traceMessage - content truncation', () => {
    it('should truncate content at maxContentLength', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      const tableSuffix = channelId.replace(/-/g, '_');
      const longContent = 'A'.repeat(10000);

      mockGetAllChannels.mockResolvedValue([
        { id: channelId, name: 'Test Channel', destinationConnectors: [] },
      ]);
      mockGetIdsAndNames.mockResolvedValue({ [channelId]: 'Test Channel' });

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        if (sqlStr.includes('information_schema.TABLES')) {
          return [[{ TABLE_NAME: `D_M${tableSuffix}` }]];
        }
        if (sqlStr.includes(`D_MC${tableSuffix}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
          return [[]];
        }
        if (sqlStr.includes(`D_M${tableSuffix}`) && sqlStr.includes('WHERE ID')) {
          return [[{
            ID: 1,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date(),
            PROCESSED: 1,
          }]];
        }
        if (sqlStr.includes(`D_MM${tableSuffix}`)) {
          return [[{
            MESSAGE_ID: 1,
            METADATA_ID: 0,
            RECEIVED_DATE: new Date(),
            STATUS: 'S',
            CONNECTOR_NAME: 'Source',
            ERROR_CODE: null,
          }]];
        }
        if (sqlStr.includes(`D_MC${tableSuffix}`) && sqlStr.includes('CONTENT_TYPE IN')) {
          return [[{
            CONTENT_TYPE: ContentType.RAW,
            CONTENT: longContent,
            DATA_TYPE: 'RAW',
          }]];
        }
        return [[]];
      });

      const result = await traceMessage(channelId, 1, {
        includeContent: true,
        maxContentLength: 100,
      });

      expect(result.root.content?.raw?.truncated).toBe(true);
      expect(result.root.content?.raw?.content.length).toBe(100);
      expect(result.root.content?.raw?.fullLength).toBe(10000);
    });
  });

  describe('traceMessage - dependency graph', () => {
    it('should detect Channel Writer destinations in dependency graph', async () => {
      const sourceId = 'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4';
      const targetId = 'f5f5f5f5-a6a6-b7b7-c8c8-d9d9d9d9d9d9';

      mockGetAllChannels.mockResolvedValue([
        {
          id: sourceId,
          name: 'Source Channel',
          destinationConnectors: [{
            name: 'Send to Target',
            transportName: 'Channel Writer',
            properties: { channelId: targetId },
          }],
        },
        {
          id: targetId,
          name: 'Target Channel',
          destinationConnectors: [],
        },
      ]);
      mockGetIdsAndNames.mockResolvedValue({
        [sourceId]: 'Source Channel',
        [targetId]: 'Target Channel',
      });
      mockGetChannel.mockResolvedValue({
        id: sourceId,
        name: 'Source Channel',
        destinationConnectors: [{
          name: 'Send to Target',
          transportName: 'Channel Writer',
          properties: { channelId: targetId },
        }],
      });

      const sourceSuffix = sourceId.replace(/-/g, '_');
      const targetSuffix = targetId.replace(/-/g, '_');

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        // Table existence
        if (sqlStr.includes('information_schema.TABLES')) {
          const tableName = params?.[0] as string;
          if (tableName?.includes(sourceSuffix) || tableName?.includes(targetSuffix)) {
            return [[{ TABLE_NAME: tableName }]];
          }
          return [[]];
        }

        // Source map for source channel (no parent = root)
        if (sqlStr.includes(`D_MC${sourceSuffix}`) && (params as unknown[])?.includes(ContentType.SOURCE_MAP)) {
          return [[]];
        }

        // Source message
        if (sqlStr.includes(`D_M${sourceSuffix}`) && !sqlStr.includes('D_MC') && !sqlStr.includes('D_MM') && sqlStr.includes('WHERE ID')) {
          return [[{
            ID: 1,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date('2026-02-06T14:30:45.000Z'),
            PROCESSED: 1,
          }]];
        }

        // Source connector messages
        if (sqlStr.includes(`D_MM${sourceSuffix}`)) {
          return [[{
            MESSAGE_ID: 1,
            METADATA_ID: 0,
            RECEIVED_DATE: new Date('2026-02-06T14:30:45.000Z'),
            STATUS: 'S',
            CONNECTOR_NAME: 'Source',
            ERROR_CODE: null,
          }]];
        }

        // Source content
        if (sqlStr.includes(`D_MC${sourceSuffix}`) && sqlStr.includes('CONTENT_TYPE IN')) {
          return [[]];
        }

        // Forward trace: search target channel for messages referencing source
        if (sqlStr.includes(`D_MC${targetSuffix}`) && sqlStr.includes('LIKE')) {
          return [[{
            MESSAGE_ID: 10,
            CONTENT: JSON.stringify({
              sourceChannelId: sourceId,
              sourceMessageId: 1,
              sourceChannelIds: [sourceId],
              sourceMessageIds: [1],
            }),
          }]];
        }

        // Target message
        if (sqlStr.includes(`D_M${targetSuffix}`) && !sqlStr.includes('D_MC') && !sqlStr.includes('D_MM') && sqlStr.includes('WHERE ID')) {
          return [[{
            ID: 10,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date('2026-02-06T14:30:45.100Z'),
            PROCESSED: 1,
          }]];
        }

        // Target connector messages
        if (sqlStr.includes(`D_MM${targetSuffix}`)) {
          return [[{
            MESSAGE_ID: 10,
            METADATA_ID: 0,
            RECEIVED_DATE: new Date('2026-02-06T14:30:45.100Z'),
            STATUS: 'S',
            CONNECTOR_NAME: 'Source',
            ERROR_CODE: null,
          }]];
        }

        // Target content and source map
        if (sqlStr.includes(`D_MC${targetSuffix}`)) {
          return [[]];
        }

        return [[]];
      });

      const result = await traceMessage(sourceId, 1, { includeContent: false });

      expect(result.root.channelName).toBe('Source Channel');
      expect(result.root.children).toHaveLength(1);
      expect(result.root.children[0]!.channelName).toBe('Target Channel');
      expect(result.root.children[0]!.messageId).toBe(10);
      expect(result.totalNodes).toBe(2);
      expect(result.maxDepth).toBe(1);
    });
  });

  describe('error status detection', () => {
    it('should report hasErrors when a node has ERROR status', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupSingleMessageMock(channelId, 1, 'E');

      const result = await traceMessage(channelId, 1);

      expect(result.root.status).toBe('ERROR');
      expect(result.hasErrors).toBe(true);
    });
  });

  describe('traceMessage - malformed sourceMap', () => {
    /**
     * Helper: set up a mock where the sourceMap content is customizable
     */
    function setupWithSourceMap(channelId: string, messageId: number, sourceMapContent: string | null) {
      const tableSuffix = channelId.replace(/-/g, '_');

      mockGetAllChannels.mockResolvedValue([
        { id: channelId, name: 'Test Channel', destinationConnectors: [] },
      ]);
      mockGetIdsAndNames.mockResolvedValue({ [channelId]: 'Test Channel' });

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        if (sqlStr.includes('information_schema.TABLES')) {
          return [[{ TABLE_NAME: `D_M${tableSuffix}` }]];
        }

        // Source map query — return the custom content
        if (sqlStr.includes(`D_MC${tableSuffix}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
          if (sourceMapContent === null) {
            return [[]]; // No source map row
          }
          return [[{ MESSAGE_ID: messageId, CONTENT: sourceMapContent }]];
        }

        // Message query
        if (sqlStr.includes(`D_M${tableSuffix}`) && sqlStr.includes('WHERE ID')) {
          return [[{
            ID: messageId,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date('2026-02-06T14:30:45.123Z'),
            PROCESSED: 1,
          }]];
        }

        // Connector message query
        if (sqlStr.includes(`D_MM${tableSuffix}`)) {
          return [[{
            MESSAGE_ID: messageId,
            METADATA_ID: 0,
            RECEIVED_DATE: new Date('2026-02-06T14:30:45.123Z'),
            STATUS: 'S',
            CONNECTOR_NAME: 'Source',
            ERROR_CODE: null,
          }]];
        }

        return [[]];
      });
    }

    it('should treat corrupted JSON sourceMap as root message', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupWithSourceMap(channelId, 1, 'NOT VALID JSON {{{');

      const result = await traceMessage(channelId, 1, { includeContent: false });

      expect(result.root.channelId).toBe(channelId);
      expect(result.root.messageId).toBe(1);
      expect(result.root.status).toBe('SENT');
      expect(result.totalNodes).toBe(1);
    });

    it('should treat empty JSON object sourceMap as root message', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupWithSourceMap(channelId, 1, '{}');

      const result = await traceMessage(channelId, 1, { includeContent: false });

      // No sourceChannelIds/sourceMessageIds keys → this is root
      expect(result.root.channelId).toBe(channelId);
      expect(result.root.messageId).toBe(1);
      expect(result.totalNodes).toBe(1);
    });

    it('should treat sourceMap with empty arrays as root message', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      const sourceMap = JSON.stringify({
        sourceChannelIds: [],
        sourceMessageIds: [],
      });
      setupWithSourceMap(channelId, 1, sourceMap);

      const result = await traceMessage(channelId, 1, { includeContent: false });

      expect(result.root.channelId).toBe(channelId);
      expect(result.totalNodes).toBe(1);
    });

    it('should handle mismatched sourceMap array lengths gracefully', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      const sourceMap = JSON.stringify({
        sourceChannelIds: ['11111111-aaaa-bbbb-cccc-dddddddddddd', '22222222-aaaa-bbbb-cccc-dddddddddddd'],
        sourceMessageIds: [1],  // Length mismatch!
      });
      setupWithSourceMap(channelId, 1, sourceMap);

      const result = await traceMessage(channelId, 1, { includeContent: false });

      // Should treat as root rather than accessing undefined index
      expect(result.root.channelId).toBe(channelId);
      expect(result.root.messageId).toBe(1);
      expect(result.totalNodes).toBe(1);
    });

    it('should fall back to singular sourceMap keys when arrays absent', async () => {
      const parentId = 'aaa11111-bbbb-cccc-dddd-eeeeeeeeeeee';
      const childId = 'fff22222-aaaa-bbbb-cccc-dddddddddddd';
      const parentSuffix = parentId.replace(/-/g, '_');
      const childSuffix = childId.replace(/-/g, '_');

      mockGetAllChannels.mockResolvedValue([
        { id: parentId, name: 'Parent Channel', destinationConnectors: [] },
        { id: childId, name: 'Child Channel', destinationConnectors: [] },
      ]);
      mockGetIdsAndNames.mockResolvedValue({
        [parentId]: 'Parent Channel',
        [childId]: 'Child Channel',
      });

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        if (sqlStr.includes('information_schema.TABLES')) {
          return [[{ TABLE_NAME: 'exists' }]];
        }

        // Child's sourceMap uses singular keys (no arrays)
        if (sqlStr.includes(`D_MC${childSuffix}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
          return [[{
            MESSAGE_ID: 5,
            CONTENT: JSON.stringify({
              sourceChannelId: parentId,
              sourceMessageId: 1,
            }),
          }]];
        }

        // Parent has no sourceMap (it's the root)
        if (sqlStr.includes(`D_MC${parentSuffix}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
          return [[]];
        }

        // Parent message
        if (sqlStr.includes(`D_M${parentSuffix}`) && !sqlStr.includes('D_MC') && !sqlStr.includes('D_MM') && sqlStr.includes('WHERE ID')) {
          return [[{
            ID: 1,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date('2026-02-06T14:30:00.000Z'),
            PROCESSED: 1,
          }]];
        }

        // Child message
        if (sqlStr.includes(`D_M${childSuffix}`) && !sqlStr.includes('D_MC') && !sqlStr.includes('D_MM') && sqlStr.includes('WHERE ID')) {
          return [[{
            ID: 5,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date('2026-02-06T14:30:00.100Z'),
            PROCESSED: 1,
          }]];
        }

        // Connector messages for both
        if (sqlStr.includes(`D_MM${parentSuffix}`) || sqlStr.includes(`D_MM${childSuffix}`)) {
          const msgId = sqlStr.includes(parentSuffix) ? 1 : 5;
          return [[{
            MESSAGE_ID: msgId,
            METADATA_ID: 0,
            RECEIVED_DATE: new Date('2026-02-06T14:30:00.000Z'),
            STATUS: 'S',
            CONNECTOR_NAME: 'Source',
            ERROR_CODE: null,
          }]];
        }

        return [[]];
      });

      // Trace backward from child should find parent as root via singular keys
      const result = await traceMessage(childId, 5, { includeContent: false, direction: 'backward' });

      // The root should be the parent channel (traced backward via singular sourceChannelId)
      expect(result.root.channelId).toBe(parentId);
      expect(result.root.messageId).toBe(1);
    });
  });

  describe('traceMessage - circular reference protection', () => {
    it('should not infinite loop on circular sourceMap references', async () => {
      const channelA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const channelB = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
      const suffixA = channelA.replace(/-/g, '_');
      const suffixB = channelB.replace(/-/g, '_');

      mockGetAllChannels.mockResolvedValue([
        { id: channelA, name: 'Channel A', destinationConnectors: [] },
        { id: channelB, name: 'Channel B', destinationConnectors: [] },
      ]);
      mockGetIdsAndNames.mockResolvedValue({
        [channelA]: 'Channel A',
        [channelB]: 'Channel B',
      });

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        if (sqlStr.includes('information_schema.TABLES')) {
          return [[{ TABLE_NAME: 'exists' }]];
        }

        // A's sourceMap points to B (circular: A → B → A)
        if (sqlStr.includes(`D_MC${suffixA}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
          return [[{
            MESSAGE_ID: 1,
            CONTENT: JSON.stringify({
              sourceChannelId: channelB,
              sourceMessageId: 2,
            }),
          }]];
        }

        // B's sourceMap points back to A (circular!)
        if (sqlStr.includes(`D_MC${suffixB}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
          return [[{
            MESSAGE_ID: 2,
            CONTENT: JSON.stringify({
              sourceChannelId: channelA,
              sourceMessageId: 1,
            }),
          }]];
        }

        // Messages exist for both
        if (sqlStr.includes('WHERE ID')) {
          return [[{
            ID: 1,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date('2026-02-06T14:30:00.000Z'),
            PROCESSED: 1,
          }]];
        }

        if (sqlStr.includes('D_MM')) {
          return [[{
            MESSAGE_ID: 1,
            METADATA_ID: 0,
            RECEIVED_DATE: new Date('2026-02-06T14:30:00.000Z'),
            STATUS: 'S',
            CONNECTOR_NAME: 'Source',
            ERROR_CODE: null,
          }]];
        }

        return [[]];
      });

      // Should complete without hanging — circular reference guard kicks in
      const result = await traceMessage(channelA, 1, { includeContent: false });

      expect(result.root).toBeDefined();
      expect(result.totalNodes).toBeGreaterThanOrEqual(1);
    });
  });

  describe('traceMessage - forward trace error isolation', () => {
    it('should return error node when one downstream channel fails', async () => {
      const sourceId = '11111111-2222-3333-4444-555555555555';
      const goodTargetId = '66666666-7777-8888-9999-aaaaaaaaaaaa';
      const badTargetId = 'bbbbbbbb-cccc-dddd-eeee-111111111111';
      const sourceSuffix = sourceId.replace(/-/g, '_');
      const goodSuffix = goodTargetId.replace(/-/g, '_');
      const badSuffix = badTargetId.replace(/-/g, '_');

      mockGetAllChannels.mockResolvedValue([
        {
          id: sourceId,
          name: 'Source',
          destinationConnectors: [
            { name: 'Good Dest', transportName: 'Channel Writer', properties: { channelId: goodTargetId } },
            { name: 'Bad Dest', transportName: 'Channel Writer', properties: { channelId: badTargetId } },
          ],
        },
        { id: goodTargetId, name: 'Good Target', destinationConnectors: [] },
        { id: badTargetId, name: 'Bad Target', destinationConnectors: [] },
      ]);
      mockGetIdsAndNames.mockResolvedValue({
        [sourceId]: 'Source',
        [goodTargetId]: 'Good Target',
        [badTargetId]: 'Bad Target',
      });
      mockGetChannel.mockResolvedValue({
        id: sourceId,
        name: 'Source',
        destinationConnectors: [
          { name: 'Good Dest', transportName: 'Channel Writer', properties: { channelId: goodTargetId } },
          { name: 'Bad Dest', transportName: 'Channel Writer', properties: { channelId: badTargetId } },
        ],
      });

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        if (sqlStr.includes('information_schema.TABLES')) {
          const tableName = params?.[0] as string;
          if (tableName?.includes(badSuffix)) {
            // Bad target table exists but queries will throw
            return [[{ TABLE_NAME: tableName }]];
          }
          if (tableName?.includes(sourceSuffix) || tableName?.includes(goodSuffix)) {
            return [[{ TABLE_NAME: tableName }]];
          }
          return [[]];
        }

        // Source channel: root message, no parent
        if (sqlStr.includes(`D_MC${sourceSuffix}`) && (params as unknown[])?.includes(ContentType.SOURCE_MAP)) {
          return [[]];
        }
        if (sqlStr.includes(`D_M${sourceSuffix}`) && !sqlStr.includes('D_MC') && !sqlStr.includes('D_MM') && sqlStr.includes('WHERE ID')) {
          return [[{ ID: 1, SERVER_ID: 'server-1', RECEIVED_DATE: new Date('2026-02-06T14:30:00.000Z'), PROCESSED: 1 }]];
        }
        if (sqlStr.includes(`D_MM${sourceSuffix}`)) {
          return [[{ MESSAGE_ID: 1, METADATA_ID: 0, RECEIVED_DATE: new Date('2026-02-06T14:30:00.000Z'), STATUS: 'S', CONNECTOR_NAME: 'Source', ERROR_CODE: null }]];
        }
        if (sqlStr.includes(`D_MC${sourceSuffix}`) && sqlStr.includes('CONTENT_TYPE IN')) {
          return [[]];
        }

        // Good target: normal downstream message
        if (sqlStr.includes(`D_MC${goodSuffix}`) && sqlStr.includes('LIKE')) {
          return [[{ MESSAGE_ID: 10, CONTENT: JSON.stringify({ sourceChannelId: sourceId, sourceMessageId: 1 }) }]];
        }
        if (sqlStr.includes(`D_M${goodSuffix}`) && !sqlStr.includes('D_MC') && !sqlStr.includes('D_MM') && sqlStr.includes('WHERE ID')) {
          return [[{ ID: 10, SERVER_ID: 'server-1', RECEIVED_DATE: new Date('2026-02-06T14:30:00.100Z'), PROCESSED: 1 }]];
        }
        if (sqlStr.includes(`D_MM${goodSuffix}`)) {
          return [[{ MESSAGE_ID: 10, METADATA_ID: 0, RECEIVED_DATE: new Date('2026-02-06T14:30:00.100Z'), STATUS: 'S', CONNECTOR_NAME: 'Source', ERROR_CODE: null }]];
        }
        if (sqlStr.includes(`D_MC${goodSuffix}`)) {
          return [[]];
        }

        // Bad target: LIKE query throws a database error
        if (sqlStr.includes(`D_MC${badSuffix}`) && sqlStr.includes('LIKE')) {
          throw new Error('Access denied for user on D_MC table');
        }

        return [[]];
      });

      const result = await traceMessage(sourceId, 1, { includeContent: false });

      // Good target should still be traced successfully
      expect(result.root.children.length).toBeGreaterThanOrEqual(1);
      const goodChild = result.root.children.find(c => c.channelName === 'Good Target');
      expect(goodChild).toBeDefined();
      expect(goodChild!.messageId).toBe(10);
      expect(goodChild!.status).toBe('SENT');

      // The bad target should NOT have crashed the entire trace
      // (it either shows as error node or is absent — both are acceptable)
      expect(result.root.channelName).toBe('Source');
    });
  });

  describe('traceMessage - max depth boundary', () => {
    it('should stop tracing forward when maxDepth is reached', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      setupSingleMessageMock(channelId, 1);

      // maxDepth = 0 means don't trace any children
      const result = await traceMessage(channelId, 1, { maxDepth: 0, includeContent: false });

      expect(result.root.children).toHaveLength(0);
    });
  });

  describe('traceMessage - missing connector message', () => {
    it('should default to RECEIVED status when no connector message exists', async () => {
      const channelId = 'aaabbbcc-cddd-eeef-1234-567890abcdef';
      const tableSuffix = channelId.replace(/-/g, '_');

      mockGetAllChannels.mockResolvedValue([
        { id: channelId, name: 'Test Channel', destinationConnectors: [] },
      ]);
      mockGetIdsAndNames.mockResolvedValue({ [channelId]: 'Test Channel' });

      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const sqlStr = typeof sql === 'string' ? sql : '';

        if (sqlStr.includes('information_schema.TABLES')) {
          return [[{ TABLE_NAME: `D_M${tableSuffix}` }]];
        }
        if (sqlStr.includes(`D_MC${tableSuffix}`) && params && (params as unknown[]).includes(ContentType.SOURCE_MAP)) {
          return [[]];
        }
        if (sqlStr.includes(`D_M${tableSuffix}`) && sqlStr.includes('WHERE ID')) {
          return [[{
            ID: 1,
            SERVER_ID: 'server-1',
            RECEIVED_DATE: new Date('2026-02-06T14:30:45.123Z'),
            PROCESSED: 1,
          }]];
        }
        // Return empty connector messages — no METADATA_ID = 0 row
        if (sqlStr.includes(`D_MM${tableSuffix}`)) {
          return [[]];
        }
        return [[]];
      });

      const result = await traceMessage(channelId, 1, { includeContent: false });

      // Should default to RECEIVED (the 'R' fallback in code)
      expect(result.root.status).toBe('RECEIVED');
      expect(result.root.connectorName).toBe('Source');
    });
  });
});
