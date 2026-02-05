import axios, { AxiosInstance, AxiosResponse } from 'axios';
import https from 'https';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { MirthEndpoint } from '../config/environments';

// Create HTTPS agent that accepts self-signed certificates
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export interface ChannelStatus {
  channelId: string;
  name: string;
  state: 'STARTED' | 'STOPPED' | 'PAUSED' | 'DEPLOYING' | 'UNDEPLOYING';
  deployedRevisionDelta?: number;
  deployedDate?: string;
}

export interface DashboardStatus {
  channelId: string;
  name: string;
  state: string;
  statistics?: {
    received: number;
    filtered: number;
    sent: number;
    error: number;
  };
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  revision?: number;
  sourceConnector?: unknown;
  destinationConnectors?: unknown[];
  exportData?: ChannelExportData;
  [key: string]: unknown;
}

export interface ChannelExportData {
  metadata?: {
    enabled: boolean;
    lastModified?: string;
    pruningSettings?: {
      archiveEnabled: boolean;
      pruneMetaDataDays?: number;
      pruneContentDays?: number;
    };
  };
  codeTemplateLibraries?: unknown[];
  channelTags?: { id: string; name: string; backgroundColor?: string }[];
  dependencyIds?: string[];
  dependentIds?: string[];
}

export interface ServerInfo {
  version: string;
  serverId: string;
  serverTimezone?: string;
}

export class MirthApiClient {
  private client: AxiosInstance;
  private sessionCookie: string | null = null;
  private xmlParser: XMLParser;
  private xmlBuilder: XMLBuilder;

  constructor(private endpoint: MirthEndpoint) {
    this.client = axios.create({
      baseURL: endpoint.baseUrl,
      timeout: 120000,  // 2 minutes - Mirth API can be slow for channel operations
      headers: {
        'Content-Type': 'application/xml',
        Accept: 'application/xml',
      },
      // Don't throw on 4xx/5xx - we'll handle them
      validateStatus: () => true,
      // Accept self-signed certificates for HTTPS
      httpsAgent: httpsAgent,
    });

    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      trimValues: true,
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
      suppressEmptyNode: true,
    });
  }

  get name(): string {
    return this.endpoint.name;
  }

  get baseUrl(): string {
    return this.endpoint.baseUrl;
  }

  // ==================== Authentication ====================

  async login(): Promise<boolean> {
    const response = await this.client.post(
      '/api/users/_login',
      `username=${encodeURIComponent(this.endpoint.username)}&password=${encodeURIComponent(this.endpoint.password)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (response.status === 200) {
      // Extract session cookie
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        const jsessionid = setCookie
          .find((c: string) => c.includes('JSESSIONID'))
          ?.split(';')[0];
        if (jsessionid) {
          this.sessionCookie = jsessionid;
          this.client.defaults.headers.common['Cookie'] = jsessionid;
        }
      }
      return true;
    }
    return false;
  }

  async logout(): Promise<void> {
    if (this.sessionCookie) {
      await this.client.post('/api/users/_logout');
      this.sessionCookie = null;
      delete this.client.defaults.headers.common['Cookie'];
    }
  }

  isLoggedIn(): boolean {
    return this.sessionCookie !== null;
  }

  // ==================== Server Info ====================

  async getServerInfo(): Promise<ServerInfo | null> {
    const response = await this.client.get('/api/server/info');
    if (response.status !== 200) return null;

    const parsed = this.xmlParser.parse(response.data);
    return {
      version: parsed.serverInfo?.version || parsed.version,
      serverId: parsed.serverInfo?.serverId || parsed.serverId,
      serverTimezone: parsed.serverInfo?.serverTimezone,
    };
  }

  async getServerStatus(): Promise<string | null> {
    const response = await this.client.get('/api/server/status');
    if (response.status !== 200) return null;
    return response.data;
  }

  // ==================== Channel CRUD ====================

  async getChannels(): Promise<Channel[]> {
    const response = await this.client.get('/api/channels');
    if (response.status !== 200) return [];

    const parsed = this.xmlParser.parse(response.data);
    const channels = parsed.list?.channel || [];
    return Array.isArray(channels) ? channels : [channels];
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const response = await this.client.get(`/api/channels/${channelId}`);
    if (response.status !== 200) return null;

    const parsed = this.xmlParser.parse(response.data);
    return parsed.channel || parsed;
  }

  async getChannelXml(channelId: string): Promise<string | null> {
    const response = await this.client.get(`/api/channels/${channelId}`);
    if (response.status !== 200) return null;
    return response.data;
  }

  async createChannel(channel: Channel | string): Promise<boolean> {
    const xml = typeof channel === 'string' ? channel : this.xmlBuilder.build({ channel });

    const response = await this.client.post('/api/channels', xml, {
      headers: {
        'Content-Type': 'application/xml',
      },
    });

    return response.status === 200 || response.status === 201;
  }

  async updateChannel(channelId: string, channel: Channel | string, override = false): Promise<boolean> {
    const xml = typeof channel === 'string' ? channel : this.xmlBuilder.build({ channel });

    const response = await this.client.put(
      `/api/channels/${channelId}?override=${override}`,
      xml,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    return response.status === 200 || response.status === 204;
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    const response = await this.client.delete(`/api/channels/${channelId}`);
    return response.status === 200 || response.status === 204;
  }

  async importChannel(channelXml: string, override = false): Promise<boolean> {
    const response = await this.client.post(
      `/api/channels?override=${override}`,
      channelXml,
      {
        headers: {
          'Content-Type': 'application/xml',
          'Accept': '*/*',
        },
      }
    );

    // Check status code
    if (response.status !== 200 && response.status !== 201) {
      console.error(`Channel import failed with status ${response.status}: ${JSON.stringify(response.data).substring(0, 500)}`);
      return false;
    }

    // Java Mirth returns {"boolean":true/false} in response body
    if (typeof response.data === 'string') {
      try {
        const parsed = JSON.parse(response.data);
        if (parsed.boolean !== undefined) {
          return parsed.boolean === true;
        }
      } catch {
        // Not JSON, check XML
        if (response.data.includes('<boolean>true</boolean>')) {
          return true;
        }
        if (response.data.includes('<boolean>false</boolean>')) {
          return false;
        }
      }
    } else if (typeof response.data === 'object' && response.data !== null) {
      if (response.data.boolean !== undefined) {
        return response.data.boolean === true;
      }
    }

    // Default to true if status was OK but no boolean in response
    return true;
  }

  // ==================== Channel Deployment ====================

  async deployChannel(channelId: string): Promise<boolean> {
    const response = await this.client.post(
      '/api/channels/_deploy',
      `<set><string>${channelId}</string></set>`,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    return response.status === 200 || response.status === 204;
  }

  async deployChannels(channelIds: string[]): Promise<boolean> {
    const xml = `<set>${channelIds.map((id) => `<string>${id}</string>`).join('')}</set>`;
    const response = await this.client.post('/api/channels/_deploy', xml, {
      headers: {
        'Content-Type': 'application/xml',
      },
    });

    return response.status === 200 || response.status === 204;
  }

  async undeployChannel(channelId: string): Promise<boolean> {
    const response = await this.client.post(
      '/api/channels/_undeploy',
      `<set><string>${channelId}</string></set>`,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    return response.status === 200 || response.status === 204;
  }

  async redeployAllChannels(): Promise<boolean> {
    const response = await this.client.post('/api/channels/_redeployAll');
    return response.status === 200 || response.status === 204;
  }

  // ==================== Channel Status/Control ====================

  async getChannelStatuses(): Promise<DashboardStatus[]> {
    const response = await this.client.get('/api/channels/statuses');
    if (response.status !== 200) return [];

    const parsed = this.xmlParser.parse(response.data);
    const statuses = parsed.list?.dashboardStatus || [];
    return Array.isArray(statuses) ? statuses : [statuses];
  }

  async getChannelStatus(channelId: string): Promise<DashboardStatus | null> {
    const statuses = await this.getChannelStatuses();
    return statuses.find((s) => s.channelId === channelId) || null;
  }

  async startChannel(channelId: string): Promise<boolean> {
    const response = await this.client.post(
      `/api/channels/${channelId}/_start`,
      null,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    return response.status === 200 || response.status === 204;
  }

  async stopChannel(channelId: string): Promise<boolean> {
    const response = await this.client.post(
      `/api/channels/${channelId}/_stop`,
      null,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    return response.status === 200 || response.status === 204;
  }

  async pauseChannel(channelId: string): Promise<boolean> {
    const response = await this.client.post(
      `/api/channels/${channelId}/_pause`,
      null,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    return response.status === 200 || response.status === 204;
  }

  async resumeChannel(channelId: string): Promise<boolean> {
    const response = await this.client.post(
      `/api/channels/${channelId}/_resume`,
      null,
      {
        headers: {
          'Content-Type': 'application/xml',
        },
      }
    );

    return response.status === 200 || response.status === 204;
  }

  // ==================== Utility Methods ====================

  /**
   * Wait for a channel to reach a target state with exponential backoff.
   * Designed for slow environments like QEMU emulation on Apple Silicon.
   *
   * @param channelId - The channel ID to monitor
   * @param targetState - The target state (e.g., 'STARTED', 'STOPPED')
   * @param timeoutMs - Maximum time to wait (default: 120000ms for QEMU compatibility)
   * @param initialPollIntervalMs - Starting poll interval (default: 1000ms)
   * @param maxPollIntervalMs - Maximum poll interval for backoff (default: 5000ms)
   * @returns true if state reached, false if timeout
   */
  async waitForChannelState(
    channelId: string,
    targetState: string,
    timeoutMs = 120000,
    initialPollIntervalMs = 1000,
    maxPollIntervalMs = 5000
  ): Promise<boolean> {
    const startTime = Date.now();
    let pollInterval = initialPollIntervalMs;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.getChannelStatus(channelId);
        if (status && status.state === targetState) {
          return true;
        }
        consecutiveErrors = 0; // Reset on successful poll
      } catch (error) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`waitForChannelState: ${maxConsecutiveErrors} consecutive errors, giving up`);
          return false;
        }
        // Increase backoff on errors
        pollInterval = Math.min(pollInterval * 1.5, maxPollIntervalMs);
      }

      await this.delay(pollInterval);

      // Exponential backoff with cap
      pollInterval = Math.min(pollInterval * 1.2, maxPollIntervalMs);
    }

    return false;
  }

  async waitForHealthy(timeoutMs = 60000, pollIntervalMs = 2000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.getServerStatus();
        if (status) {
          return true;
        }
      } catch {
        // Server not ready yet
      }
      await this.delay(pollIntervalMs);
    }

    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==================== Raw Request ====================

  async rawGet(path: string): Promise<AxiosResponse> {
    return this.client.get(path);
  }

  async rawPost(path: string, data?: unknown, contentType = 'application/xml'): Promise<AxiosResponse> {
    return this.client.post(path, data, {
      headers: {
        'Content-Type': contentType,
      },
    });
  }
}

export function createClients(java: MirthEndpoint, node: MirthEndpoint): {
  java: MirthApiClient;
  node: MirthApiClient;
} {
  return {
    java: new MirthApiClient(java),
    node: new MirthApiClient(node),
  };
}
