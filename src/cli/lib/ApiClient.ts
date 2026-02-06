/**
 * API Client for Mirth Connect REST API
 *
 * This client wraps axios to provide typed access to all Mirth Connect
 * REST endpoints. It handles authentication, session management, and
 * response parsing.
 *
 * The client is designed to work with both the Node.js Mirth implementation
 * and the original Java Mirth Connect server.
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ConfigManager } from './ConfigManager.js';
import {
  LoginStatus,
  SystemInfo,
  SystemStats,
  ChannelStatus,
  Channel,
  ChannelGroup,
  Message,
  MessageFilter,
  AttachmentInfo,
  ServerEvent,
  EventFilter,
  ChannelStatistics,
  TraceResult,
} from '../types/index.js';

/**
 * API error with additional context
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Options for creating an API client
 */
export interface ApiClientOptions {
  baseUrl?: string;
  sessionToken?: string;
  timeout?: number;
  verbose?: boolean;
}

/**
 * Create an axios instance configured for Mirth API
 */
function createAxiosInstance(options: ApiClientOptions): AxiosInstance {
  const baseUrl = options.baseUrl || ConfigManager.getServerUrl();

  const instance = axios.create({
    baseURL: baseUrl,
    timeout: options.timeout || 30000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // Don't throw on non-2xx responses - we handle them ourselves
    validateStatus: () => true,
  });

  // Add session token if available
  if (options.sessionToken) {
    instance.defaults.headers.common['Cookie'] = `JSESSIONID=${options.sessionToken}`;
  }

  // Request interceptor for logging
  if (options.verbose) {
    instance.interceptors.request.use((config) => {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    instance.interceptors.response.use((response) => {
      console.log(`[API] Response: ${response.status} ${response.statusText}`);
      return response;
    });
  }

  return instance;
}

/**
 * Extract session token from Set-Cookie header
 */
function extractSessionToken(setCookieHeader: string | string[] | undefined): string | undefined {
  if (!setCookieHeader) return undefined;

  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];

  for (const cookie of cookies) {
    const match = cookie.match(/JSESSIONID=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Handle API response and throw on errors
 */
function handleResponse<T>(response: { status: number; statusText: string; data: unknown }): T {
  if (response.status >= 200 && response.status < 300) {
    return response.data as T;
  }

  const errorMessage =
    typeof response.data === 'object' && response.data !== null && 'error' in response.data
      ? (response.data as { error: string }).error
      : response.statusText;

  throw new ApiError(errorMessage, response.status, response.data);
}

/**
 * API Client class providing typed access to Mirth REST endpoints
 */
export class ApiClient {
  private axios: AxiosInstance;

  constructor(options: ApiClientOptions = {}) {
    // Use session token from config if not provided
    const sessionToken = options.sessionToken || ConfigManager.getSessionToken();
    this.axios = createAxiosInstance({ ...options, sessionToken });
  }

  /**
   * Extract error message from API response data
   * The API returns errors in { error: "message" } format when returnErrors=true
   */
  private extractErrorMessage(data: unknown, fallback: string): string {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.error === 'string') {
        return obj.error;
      }
      if (typeof obj.message === 'string') {
        return obj.message;
      }
    }
    if (typeof data === 'string' && data.length > 0) {
      return data;
    }
    return fallback;
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Login with username and password
   * Returns the session token on success
   */
  async login(username: string, password: string): Promise<{ status: LoginStatus; token?: string }> {
    const response = await this.axios.post('/api/users/_login', { username, password });

    if (response.status === 200 || response.status === 201) {
      const status = response.data as LoginStatus;
      const token = extractSessionToken(response.headers['set-cookie']);

      if (token && (status.status === 'SUCCESS' || status.status === 'SUCCESS_GRACE_PERIOD')) {
        // Save session to config
        ConfigManager.saveSession(token);
        // Update axios instance with new token
        this.axios.defaults.headers.common['Cookie'] = `JSESSIONID=${token}`;
      }

      return { status, token };
    }

    const status = response.data as LoginStatus;
    throw new ApiError(status.message || 'Login failed', response.status, response.data);
  }

  /**
   * Logout current session
   */
  async logout(): Promise<void> {
    await this.axios.post('/api/users/_logout');
    ConfigManager.clearSession();
    delete this.axios.defaults.headers.common['Cookie'];
  }

  /**
   * Get current user info (verifies session is valid)
   */
  async getCurrentUser(): Promise<{ id: number; username: string } | null> {
    const response = await this.axios.get('/api/users/current');

    if (response.status === 200) {
      return response.data as { id: number; username: string };
    }

    return null;
  }

  // ===========================================================================
  // System / Server Info
  // ===========================================================================

  /**
   * Get system information
   */
  async getSystemInfo(): Promise<SystemInfo> {
    const response = await this.axios.get('/api/system/info');
    return handleResponse<SystemInfo>(response);
  }

  /**
   * Get system statistics
   */
  async getSystemStats(): Promise<SystemStats> {
    const response = await this.axios.get('/api/system/stats');
    return handleResponse<SystemStats>(response);
  }

  /**
   * Get server version (from configuration endpoint)
   */
  async getServerVersion(): Promise<string> {
    // Try the configuration endpoint first
    const response = await this.axios.get('/api/server/version');
    if (response.status === 200) {
      return response.data as string;
    }
    // Fallback to a default if endpoint doesn't exist
    return 'Unknown';
  }

  // ===========================================================================
  // Channels
  // ===========================================================================

  /**
   * Get all channels
   */
  async getChannels(): Promise<Channel[]> {
    const response = await this.axios.get('/api/channels');
    return handleResponse<Channel[]>(response);
  }

  /**
   * Get a single channel by ID
   */
  async getChannel(channelId: string): Promise<Channel> {
    const response = await this.axios.get(`/api/channels/${channelId}`);
    return handleResponse<Channel>(response);
  }

  /**
   * Get channel IDs and names
   */
  async getChannelIdsAndNames(): Promise<Record<string, string>> {
    const response = await this.axios.get('/api/channels/idsAndNames');
    return handleResponse<Record<string, string>>(response);
  }

  /**
   * Get channel statuses (with statistics)
   */
  async getChannelStatuses(channelIds?: string[], includeUndeployed = false): Promise<ChannelStatus[]> {
    const params: Record<string, string> = {};
    if (includeUndeployed) {
      params.includeUndeployed = 'true';
    }

    let url = '/api/channels/statuses';
    if (channelIds && channelIds.length > 0) {
      const idParams = channelIds.map((id) => `channelId=${encodeURIComponent(id)}`).join('&');
      url += `?${idParams}`;
      if (includeUndeployed) {
        url += '&includeUndeployed=true';
      }
    } else if (includeUndeployed) {
      url += '?includeUndeployed=true';
    }

    const response = await this.axios.get(url);
    return handleResponse<ChannelStatus[]>(response);
  }

  /**
   * Get status for a single channel
   */
  async getChannelStatus(channelId: string): Promise<ChannelStatus> {
    const response = await this.axios.get(`/api/channels/${channelId}/status`);
    return handleResponse<ChannelStatus>(response);
  }

  /**
   * Get channel statistics
   */
  async getChannelStatistics(channelId: string): Promise<ChannelStatistics> {
    const response = await this.axios.get(`/api/channels/${channelId}/statistics`);
    return handleResponse<ChannelStatistics>(response);
  }

  /**
   * Get all channel statistics
   */
  async getAllChannelStatistics(): Promise<Record<string, ChannelStatistics>> {
    const response = await this.axios.get('/api/channels/statistics');
    return handleResponse<Record<string, ChannelStatistics>>(response);
  }

  // ===========================================================================
  // Channel Groups
  // ===========================================================================

  /**
   * Get all channel groups
   */
  async getChannelGroups(): Promise<ChannelGroup[]> {
    const response = await this.axios.get('/api/channelgroups');
    const result = handleResponse<ChannelGroup[] | { channelGroup: ChannelGroup[] }>(response);
    // Handle both array and wrapped response formats
    if (Array.isArray(result)) {
      return result;
    }
    return result.channelGroup || [];
  }

  /**
   * Get a specific channel group
   */
  async getChannelGroup(groupId: string): Promise<ChannelGroup> {
    const response = await this.axios.get(`/api/channelgroups/${groupId}`);
    return handleResponse<ChannelGroup>(response);
  }

  // ===========================================================================
  // Channel Operations (Deploy, Start, Stop, etc.)
  // ===========================================================================

  /**
   * Deploy a channel
   * Note: Uses returnErrors=true to surface errors (deviation from Java Mirth API default)
   */
  async deployChannel(channelId: string): Promise<void> {
    const response = await this.axios.post(`/api/channels/${channelId}/_deploy?returnErrors=true`);
    if (response.status >= 400) {
      const errorMsg = this.extractErrorMessage(response.data, 'Failed to deploy channel');
      throw new ApiError(errorMsg, response.status);
    }
  }

  /**
   * Deploy multiple channels
   * Note: Uses returnErrors=true to surface errors (deviation from Java Mirth API default)
   */
  async deployChannels(channelIds: string[]): Promise<void> {
    const response = await this.axios.post('/api/channels/_deploy?returnErrors=true', channelIds);
    if (response.status >= 400) {
      const errorMsg = this.extractErrorMessage(response.data, 'Failed to deploy channels');
      throw new ApiError(errorMsg, response.status);
    }
  }

  /**
   * Undeploy a channel
   * Note: Uses returnErrors=true to surface errors (deviation from Java Mirth API default)
   */
  async undeployChannel(channelId: string): Promise<void> {
    const response = await this.axios.post(`/api/channels/${channelId}/_undeploy?returnErrors=true`);
    if (response.status >= 400) {
      const errorMsg = this.extractErrorMessage(response.data, 'Failed to undeploy channel');
      throw new ApiError(errorMsg, response.status);
    }
  }

  /**
   * Start a channel
   * Note: Uses returnErrors=true to surface errors (deviation from Java Mirth API default)
   */
  async startChannel(channelId: string): Promise<void> {
    const response = await this.axios.post(`/api/channels/${channelId}/_start?returnErrors=true`);
    if (response.status >= 400) {
      const errorMsg = this.extractErrorMessage(response.data, 'Failed to start channel');
      throw new ApiError(errorMsg, response.status);
    }
  }

  /**
   * Stop a channel
   * Note: Uses returnErrors=true to surface errors (deviation from Java Mirth API default)
   */
  async stopChannel(channelId: string): Promise<void> {
    const response = await this.axios.post(`/api/channels/${channelId}/_stop?returnErrors=true`);
    if (response.status >= 400) {
      const errorMsg = this.extractErrorMessage(response.data, 'Failed to stop channel');
      throw new ApiError(errorMsg, response.status);
    }
  }

  /**
   * Pause a channel
   * Note: Uses returnErrors=true to surface errors (deviation from Java Mirth API default)
   */
  async pauseChannel(channelId: string): Promise<void> {
    const response = await this.axios.post(`/api/channels/${channelId}/_pause?returnErrors=true`);
    if (response.status >= 400) {
      const errorMsg = this.extractErrorMessage(response.data, 'Failed to pause channel');
      throw new ApiError(errorMsg, response.status);
    }
  }

  /**
   * Resume a channel
   * Note: Uses returnErrors=true to surface errors (deviation from Java Mirth API default)
   */
  async resumeChannel(channelId: string): Promise<void> {
    const response = await this.axios.post(`/api/channels/${channelId}/_resume?returnErrors=true`);
    if (response.status >= 400) {
      const errorMsg = this.extractErrorMessage(response.data, 'Failed to resume channel');
      throw new ApiError(errorMsg, response.status);
    }
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  /**
   * Get messages for a channel
   */
  async getMessages(
    channelId: string,
    options: { offset?: number; limit?: number; includeContent?: boolean } = {}
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.includeContent) params.set('includeContent', 'true');

    const url = `/api/channels/${channelId}/messages?${params.toString()}`;
    const response = await this.axios.get(url);
    return handleResponse<Message[]>(response);
  }

  /**
   * Search messages with filter
   */
  async searchMessages(
    channelId: string,
    filter: MessageFilter,
    options: { offset?: number; limit?: number; includeContent?: boolean } = {}
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.includeContent) params.set('includeContent', 'true');

    const url = `/api/channels/${channelId}/messages/_search?${params.toString()}`;
    const response = await this.axios.post(url, filter);
    return handleResponse<Message[]>(response);
  }

  /**
   * Get a single message
   */
  async getMessage(
    channelId: string,
    messageId: number,
    includeContent = false
  ): Promise<Message> {
    const url = `/api/channels/${channelId}/messages/${messageId}?includeContent=${includeContent}`;
    const response = await this.axios.get(url);
    return handleResponse<Message>(response);
  }

  /**
   * Get message count
   */
  async getMessageCount(channelId: string, filter?: MessageFilter): Promise<number> {
    if (filter) {
      const response = await this.axios.post(`/api/channels/${channelId}/messages/count/_search`, filter);
      return handleResponse<number>(response);
    }
    const response = await this.axios.get(`/api/channels/${channelId}/messages/count`);
    return handleResponse<number>(response);
  }

  /**
   * Get message attachments
   */
  async getMessageAttachments(channelId: string, messageId: number): Promise<AttachmentInfo[]> {
    const response = await this.axios.get(`/api/channels/${channelId}/messages/${messageId}/attachments`);
    return handleResponse<AttachmentInfo[]>(response);
  }

  /**
   * Export messages
   */
  async exportMessages(
    channelId: string,
    filter: MessageFilter,
    options: { pageSize?: number; format?: 'JSON' | 'XML' } = {}
  ): Promise<Message[] | string> {
    const params = new URLSearchParams();
    if (options.pageSize) params.set('pageSize', String(options.pageSize));
    if (options.format) params.set('writerType', options.format);

    const url = `/api/channels/${channelId}/messages/_export?${params.toString()}`;
    const response = await this.axios.post(url, filter);
    return handleResponse<Message[] | string>(response);
  }

  // ===========================================================================
  // Trace
  // ===========================================================================

  /**
   * Trace a message across VM-connected channels
   */
  async traceMessage(
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
  ): Promise<TraceResult> {
    const params = new URLSearchParams();
    if (options?.includeContent !== undefined) params.set('includeContent', String(options.includeContent));
    if (options?.contentTypes) params.set('contentTypes', options.contentTypes);
    if (options?.maxContentLength) params.set('maxContentLength', String(options.maxContentLength));
    if (options?.maxDepth) params.set('maxDepth', String(options.maxDepth));
    if (options?.maxChildren) params.set('maxChildren', String(options.maxChildren));
    if (options?.direction) params.set('direction', options.direction);

    const qs = params.toString();
    const url = `/api/messages/trace/${channelId}/${messageId}${qs ? `?${qs}` : ''}`;
    const response = await this.axios.get(url);
    return handleResponse<TraceResult>(response);
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Get events
   */
  async getEvents(options: { offset?: number; limit?: number } = {}): Promise<ServerEvent[]> {
    const params = new URLSearchParams();
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const url = `/api/events?${params.toString()}`;
    const response = await this.axios.get(url);
    return handleResponse<ServerEvent[]>(response);
  }

  /**
   * Search events with filter
   */
  async searchEvents(
    filter: EventFilter,
    options: { offset?: number; limit?: number } = {}
  ): Promise<ServerEvent[]> {
    const params = new URLSearchParams();
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const url = `/api/events/_search?${params.toString()}`;
    const response = await this.axios.post(url, filter);
    return handleResponse<ServerEvent[]>(response);
  }

  /**
   * Get event count
   */
  async getEventCount(filter?: EventFilter): Promise<number> {
    if (filter) {
      const response = await this.axios.post('/api/events/count/_search', filter);
      return handleResponse<number>(response);
    }
    const response = await this.axios.get('/api/events/count');
    return handleResponse<number>(response);
  }

  // ===========================================================================
  // Raw Request (for custom endpoints)
  // ===========================================================================

  /**
   * Make a raw request to any endpoint
   */
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.axios.request(config);
    return handleResponse<T>(response);
  }
}

/**
 * Create an API client with optional overrides
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  return new ApiClient(options);
}

export default ApiClient;
