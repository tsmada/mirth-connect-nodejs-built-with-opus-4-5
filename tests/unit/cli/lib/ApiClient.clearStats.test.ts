/**
 * ApiClient Clear Statistics Tests
 *
 * Tests the clearChannelStatistics() and clearAllStatistics() methods
 * that map to POST /channels/_clearStatistics and POST /channels/_clearAllStatistics.
 */

import axios from 'axios';

// Mock ConfigManager before importing ApiClient (it imports ConfigManager at module level)
jest.mock('../../../../src/cli/lib/ConfigManager.js', () => ({
  ConfigManager: {
    getServerUrl: () => 'http://localhost:8081',
    getSessionToken: () => null,
    saveSession: jest.fn(),
    clearSession: jest.fn(),
  },
}));

// Mock axios
jest.mock('axios');

import { ApiClient } from '../../../../src/cli/lib/ApiClient.js';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ApiClient - Clear Statistics', () => {
  let client: ApiClient;
  let mockAxiosInstance: {
    post: jest.Mock;
    get: jest.Mock;
    defaults: { headers: { common: Record<string, string> } };
    interceptors: { request: { use: jest.Mock }; response: { use: jest.Mock } };
  };

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      defaults: { headers: { common: {} } },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    mockedAxios.create.mockReturnValue(
      mockAxiosInstance as unknown as ReturnType<typeof axios.create>
    );
    client = new ApiClient({ baseUrl: 'http://localhost:8081' });
  });

  describe('clearChannelStatistics', () => {
    it('should POST to /_clearStatistics with channel IDs in body', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await client.clearChannelStatistics(['ch-1', 'ch-2']);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      const [url, body] = mockAxiosInstance.post.mock.calls[0] as [string, unknown];
      expect(url).toBe('/api/channels/_clearStatistics');
      expect(body).toEqual({ 'ch-1': null, 'ch-2': null });
    });

    it('should not add query params when all stat types are cleared (default)', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await client.clearChannelStatistics(['ch-1']);

      const [url] = mockAxiosInstance.post.mock.calls[0] as [string];
      expect(url).toBe('/api/channels/_clearStatistics');
      expect(url).not.toContain('?');
    });

    it('should add query params for stat types set to false', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await client.clearChannelStatistics(['ch-1'], {
        received: true,
        filtered: false,
        sent: true,
        error: false,
      });

      const [url] = mockAxiosInstance.post.mock.calls[0] as [string];
      expect(url).toContain('filtered=false');
      expect(url).toContain('error=false');
      expect(url).not.toContain('received=false');
      expect(url).not.toContain('sent=false');
    });

    it('should add all query params when all set to false', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await client.clearChannelStatistics(['ch-1'], {
        received: false,
        filtered: false,
        sent: false,
        error: false,
      });

      const [url] = mockAxiosInstance.post.mock.calls[0] as [string];
      expect(url).toContain('received=false');
      expect(url).toContain('filtered=false');
      expect(url).toContain('sent=false');
      expect(url).toContain('error=false');
    });

    it('should handle single channel', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await client.clearChannelStatistics(['abc-123']);

      const [, body] = mockAxiosInstance.post.mock.calls[0] as [string, unknown];
      expect(body).toEqual({ 'abc-123': null });
    });

    it('should throw ApiError on 400 response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 400,
        data: { error: 'Invalid request body' },
      });

      await expect(client.clearChannelStatistics(['ch-1'])).rejects.toThrow('Invalid request body');
    });

    it('should throw ApiError on 500 response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 500,
        data: { error: 'Failed to clear statistics' },
      });

      await expect(client.clearChannelStatistics(['ch-1'])).rejects.toThrow(
        'Failed to clear statistics'
      );
    });

    it('should use fallback error message when response has no error field', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 500,
        data: null,
      });

      await expect(client.clearChannelStatistics(['ch-1'])).rejects.toThrow(
        'Failed to clear statistics'
      );
    });

    it('should not throw on 204 response', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await expect(client.clearChannelStatistics(['ch-1'])).resolves.toBeUndefined();
    });
  });

  describe('clearAllStatistics', () => {
    it('should POST to /_clearAllStatistics', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await client.clearAllStatistics();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/channels/_clearAllStatistics');
    });

    it('should not throw on 204 response', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 204, data: null });

      await expect(client.clearAllStatistics()).resolves.toBeUndefined();
    });

    it('should throw ApiError on 500 response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 500,
        data: { error: 'Failed to clear all statistics' },
      });

      await expect(client.clearAllStatistics()).rejects.toThrow('Failed to clear all statistics');
    });

    it('should throw ApiError on 403 response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        status: 403,
        data: { error: 'Unauthorized' },
      });

      await expect(client.clearAllStatistics()).rejects.toThrow('Unauthorized');
    });
  });
});
