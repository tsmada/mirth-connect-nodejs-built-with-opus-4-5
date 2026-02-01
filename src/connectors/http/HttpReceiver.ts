/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/http/HttpReceiver.java
 *
 * Purpose: HTTP source connector that listens for incoming HTTP requests
 *
 * Key behaviors to replicate:
 * - Listen on configurable host:port
 * - Handle context paths
 * - Populate sourceMap with request metadata
 * - Support binary content detection
 * - Handle responses based on message processing result
 * - GZIP compression support
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import { gunzipSync, gzipSync } from 'zlib';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import {
  HttpReceiverProperties,
  getDefaultHttpReceiverProperties,
  isBinaryMimeType,
} from './HttpConnectorProperties.js';

export interface HttpReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<HttpReceiverProperties>;
}

/**
 * HTTP Source Connector that listens for incoming HTTP requests
 */
export class HttpReceiver extends SourceConnector {
  private properties: HttpReceiverProperties;
  private app: Express | null = null;
  private server: Server | null = null;

  constructor(config: HttpReceiverConfig) {
    super({
      name: config.name ?? 'HTTP Listener',
      transportName: 'HTTP',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultHttpReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): HttpReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<HttpReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('HTTP Receiver is already running');
    }

    this.app = express();

    // Configure middleware
    this.configureMiddleware();

    // Configure routes
    this.configureRoutes();

    // Start server
    await new Promise<void>((resolve, reject) => {
      try {
        this.server = this.app!.listen(this.properties.port, this.properties.host, () => {
          this.running = true;
          resolve();
        });

        this.server.on('error', (err) => {
          reject(err);
        });

        // Set timeout
        if (this.properties.timeout > 0) {
          this.server.setTimeout(this.properties.timeout);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.running = false;
          this.server = null;
          this.app = null;
          resolve();
        }
      });
    });
  }

  /**
   * Configure Express middleware
   */
  private configureMiddleware(): void {
    if (!this.app) return;

    // Raw body parser for all content types
    this.app.use(
      express.raw({
        type: '*/*',
        limit: '50mb',
      })
    );

    // GZIP decompression middleware
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      const contentEncoding = req.headers['content-encoding'];
      if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          try {
            req.body = gunzipSync(req.body);
          } catch {
            // If decompression fails, keep original body
          }
        }
      }
      next();
    });
  }

  /**
   * Configure Express routes
   */
  private configureRoutes(): void {
    if (!this.app) return;

    // Normalize context path
    let contextPath = this.properties.contextPath.trim();
    if (!contextPath.startsWith('/')) {
      contextPath = '/' + contextPath;
    }
    if (contextPath.endsWith('/') && contextPath.length > 1) {
      contextPath = contextPath.slice(0, -1);
    }

    // Handle all HTTP methods at the context path
    const routePath = contextPath === '/' ? '*' : `${contextPath}*`;

    this.app.all(routePath, async (req: Request, res: Response) => {
      await this.handleRequest(req, res);
    });
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: Request, res: Response): Promise<void> {
    try {
      // Build source map with request metadata
      const sourceMap = this.buildSourceMap(req);

      // Get message content
      const messageContent = this.getMessageContent(req);

      // Dispatch the message through the channel
      await this.dispatchRawMessage(messageContent, sourceMap);

      // Send response
      await this.sendResponse(req, res);
    } catch (error) {
      await this.sendErrorResponse(res, error);
    }
  }

  /**
   * Build source map from request
   */
  private buildSourceMap(req: Request): Map<string, unknown> {
    const sourceMap = new Map<string, unknown>();

    // Connection info
    sourceMap.set('remoteAddress', req.ip || req.socket.remoteAddress || '');
    sourceMap.set('remotePort', req.socket.remotePort || 0);
    sourceMap.set('localAddress', req.socket.localAddress || '');
    sourceMap.set('localPort', req.socket.localPort || 0);

    // Request info
    sourceMap.set('method', req.method);
    sourceMap.set('url', `${req.protocol}://${req.get('host')}${req.originalUrl}`);
    sourceMap.set('uri', req.originalUrl);
    sourceMap.set('protocol', `HTTP/${req.httpVersion}`);
    sourceMap.set('query', req.url.includes('?') ? req.url.split('?')[1] : '');
    sourceMap.set('contextPath', req.path);

    // Headers (case-insensitive)
    const headers = new Map<string, string[]>();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(key.toLowerCase(), Array.isArray(value) ? value : [value]);
      }
    }
    sourceMap.set('headers', headers);

    // Query parameters
    const parameters = new Map<string, string[]>();
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined) {
        parameters.set(key, Array.isArray(value) ? (value as string[]) : [String(value)]);
      }
    }
    sourceMap.set('parameters', parameters);

    return sourceMap;
  }

  /**
   * Get message content from request
   */
  private getMessageContent(req: Request): string {
    // Determine if content is binary
    const contentTypeHeader = req.headers['content-type'] || 'text/plain';
    const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : contentTypeHeader[0] || 'text/plain';
    const mimeType = (contentType.split(';')[0] || '').trim();
    const isBinary = isBinaryMimeType(
      mimeType,
      this.properties.binaryMimeTypes,
      this.properties.binaryMimeTypesRegex
    );

    if (Buffer.isBuffer(req.body)) {
      if (isBinary) {
        // Return base64 encoded for binary content
        return req.body.toString('base64');
      } else {
        // Return as string with proper encoding
        return req.body.toString(this.properties.charset as BufferEncoding);
      }
    }

    return typeof req.body === 'string' ? req.body : String(req.body || '');
  }

  /**
   * Send successful response
   */
  private async sendResponse(req: Request, res: Response): Promise<void> {
    // Set content type
    res.setHeader('Content-Type', this.properties.responseContentType);

    // Set custom headers
    for (const [key, values] of this.properties.responseHeaders) {
      for (const value of values) {
        res.append(key, value);
      }
    }

    // Determine status code
    let statusCode = 200;
    if (this.properties.responseStatusCode) {
      const parsed = parseInt(this.properties.responseStatusCode, 10);
      if (!isNaN(parsed)) {
        statusCode = parsed;
      }
    }

    res.status(statusCode);

    // Check if client accepts GZIP
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const acceptsGzip =
      acceptEncoding.includes('gzip') || acceptEncoding.includes('x-gzip');

    // Get response body from channel if available
    let responseBody = '';

    // Compress if accepted
    if (acceptsGzip && responseBody.length > 0) {
      res.setHeader('Content-Encoding', 'gzip');
      const compressed = gzipSync(Buffer.from(responseBody, this.properties.charset as BufferEncoding));
      res.send(compressed);
    } else {
      res.send(responseBody);
    }
  }

  /**
   * Send error response
   */
  private async sendErrorResponse(res: Response, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    res.status(500);
    res.setHeader('Content-Type', 'text/plain');
    res.send(`Error processing request: ${errorMessage}`);
  }

  /**
   * Get the server instance (for testing)
   */
  getServer(): Server | null {
    return this.server;
  }

  /**
   * Get the Express app instance (for testing)
   */
  getApp(): Express | null {
    return this.app;
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.properties.port;
  }

  /**
   * Get the host the server is listening on
   */
  getHost(): string {
    return this.properties.host;
  }
}
