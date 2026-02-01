import axios, { AxiosInstance, AxiosResponse } from 'axios';

export interface HttpMessageResponse {
  success: boolean;
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  errorMessage?: string;
}

export interface HttpMessageClientOptions {
  baseUrl: string;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
}

export class HttpMessageClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(options: HttpMessageClientOptions) {
    this.baseUrl = options.baseUrl;
    this.client = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeout || 30000,
      headers: options.defaultHeaders || {},
      validateStatus: () => true, // Don't throw on any status
    });
  }

  /**
   * Send a POST request with the given content
   */
  async post(
    path: string,
    body: string,
    contentType = 'text/plain',
    additionalHeaders: Record<string, string> = {}
  ): Promise<HttpMessageResponse> {
    try {
      const response = await this.client.post(path, body, {
        headers: {
          'Content-Type': contentType,
          ...additionalHeaders,
        },
      });

      return this.formatResponse(response);
    } catch (error) {
      return {
        success: false,
        statusCode: 0,
        body: '',
        headers: {},
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * Send a GET request
   */
  async get(
    path: string,
    params: Record<string, string> = {},
    additionalHeaders: Record<string, string> = {}
  ): Promise<HttpMessageResponse> {
    try {
      const response = await this.client.get(path, {
        params,
        headers: additionalHeaders,
      });

      return this.formatResponse(response);
    } catch (error) {
      return {
        success: false,
        statusCode: 0,
        body: '',
        headers: {},
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * Send a PUT request with the given content
   */
  async put(
    path: string,
    body: string,
    contentType = 'text/plain',
    additionalHeaders: Record<string, string> = {}
  ): Promise<HttpMessageResponse> {
    try {
      const response = await this.client.put(path, body, {
        headers: {
          'Content-Type': contentType,
          ...additionalHeaders,
        },
      });

      return this.formatResponse(response);
    } catch (error) {
      return {
        success: false,
        statusCode: 0,
        body: '',
        headers: {},
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * Send HL7 message via HTTP (common for HTTP-to-MLLP bridges)
   */
  async sendHL7(path: string, hl7Message: string): Promise<HttpMessageResponse> {
    return this.post(path, hl7Message, 'application/hl7-v2');
  }

  /**
   * Send XML message via HTTP
   */
  async sendXML(path: string, xmlMessage: string): Promise<HttpMessageResponse> {
    return this.post(path, xmlMessage, 'application/xml');
  }

  /**
   * Send JSON message via HTTP
   */
  async sendJSON(path: string, jsonMessage: string | object): Promise<HttpMessageResponse> {
    const body = typeof jsonMessage === 'string' ? jsonMessage : JSON.stringify(jsonMessage);
    return this.post(path, body, 'application/json');
  }

  /**
   * Check if the HTTP endpoint is reachable
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/', { timeout: 5000 });
      // Any response (including 404) means the server is up
      return response.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Wait for the HTTP endpoint to be ready
   */
  async waitForReady(
    timeoutMs = 60000,
    pollIntervalMs = 2000,
    healthPath = '/'
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await this.client.get(healthPath, { timeout: 5000 });
        if (response.status < 500) {
          return true;
        }
      } catch {
        // Not ready yet
      }
      await this.delay(pollIntervalMs);
    }

    return false;
  }

  private formatResponse(response: AxiosResponse): HttpMessageResponse {
    const headers: Record<string, string> = {};
    Object.entries(response.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      }
    });

    return {
      success: response.status >= 200 && response.status < 300,
      statusCode: response.status,
      body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
      headers,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper to create HTTP clients for both Java and Node.js endpoints
 */
export function createHttpClients(
  javaBaseUrl: string,
  nodeBaseUrl: string
): {
  java: HttpMessageClient;
  node: HttpMessageClient;
} {
  return {
    java: new HttpMessageClient({ baseUrl: javaBaseUrl }),
    node: new HttpMessageClient({ baseUrl: nodeBaseUrl }),
  };
}
