import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the database pool
jest.mock('../../../src/db/pool.js', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

import {
  registerDeployment,
  unregisterDeployment,
  unregisterAllDeployments,
  getChannelInstances,
  getDeployedChannels,
} from '../../../src/cluster/ChannelRegistry.js';
import { query, execute } from '../../../src/db/pool.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockQuery = query as jest.MockedFunction<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExecute = execute as jest.MockedFunction<any>;

describe('ChannelRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);
  });

  describe('registerDeployment', () => {
    it('should insert a deployment record with upsert', async () => {
      await registerDeployment('server-1', 'channel-abc');

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const sql = mockExecute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO D_CHANNEL_DEPLOYMENTS');
      expect(sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(mockExecute.mock.calls[0]![1]).toEqual({
        serverId: 'server-1',
        channelId: 'channel-abc',
      });
    });
  });

  describe('unregisterDeployment', () => {
    it('should delete a specific deployment record', async () => {
      await unregisterDeployment('server-1', 'channel-abc');

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const sql = mockExecute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM D_CHANNEL_DEPLOYMENTS');
      expect(sql).toContain('SERVER_ID');
      expect(sql).toContain('CHANNEL_ID');
      expect(mockExecute.mock.calls[0]![1]).toEqual({
        serverId: 'server-1',
        channelId: 'channel-abc',
      });
    });
  });

  describe('unregisterAllDeployments', () => {
    it('should delete all deployment records for a server', async () => {
      await unregisterAllDeployments('server-1');

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const sql = mockExecute.mock.calls[0]![0] as string;
      expect(sql).toContain('DELETE FROM D_CHANNEL_DEPLOYMENTS');
      expect(sql).toContain('SERVER_ID');
      expect(mockExecute.mock.calls[0]![1]).toEqual({
        serverId: 'server-1',
      });
    });
  });

  describe('getChannelInstances', () => {
    it('should return server IDs for a deployed channel', async () => {
      mockQuery.mockResolvedValueOnce([
        { SERVER_ID: 'server-1', CHANNEL_ID: 'channel-abc', DEPLOYED_AT: new Date() },
        { SERVER_ID: 'server-2', CHANNEL_ID: 'channel-abc', DEPLOYED_AT: new Date() },
      ]);

      const result = await getChannelInstances('channel-abc');

      expect(result).toEqual(['server-1', 'server-2']);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0]![0] as string;
      expect(sql).toContain('CHANNEL_ID = :channelId');
    });

    it('should return empty array when no instances have the channel', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getChannelInstances('channel-xyz');

      expect(result).toEqual([]);
    });
  });

  describe('getDeployedChannels', () => {
    it('should return channel IDs for a server', async () => {
      mockQuery.mockResolvedValueOnce([
        { SERVER_ID: 'server-1', CHANNEL_ID: 'channel-abc', DEPLOYED_AT: new Date() },
        { SERVER_ID: 'server-1', CHANNEL_ID: 'channel-def', DEPLOYED_AT: new Date() },
      ]);

      const result = await getDeployedChannels('server-1');

      expect(result).toEqual(['channel-abc', 'channel-def']);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0]![0] as string;
      expect(sql).toContain('SERVER_ID = :serverId');
    });

    it('should return empty array when no channels deployed', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getDeployedChannels('server-empty');

      expect(result).toEqual([]);
    });
  });
});
