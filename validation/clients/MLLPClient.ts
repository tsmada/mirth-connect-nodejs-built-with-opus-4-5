import * as net from 'net';

// MLLP framing constants
const VT = 0x0b; // Vertical Tab - Start of message
const FS = 0x1c; // File Separator - End of message
const CR = 0x0d; // Carriage Return - After FS

export interface MLLPResponse {
  success: boolean;
  message: string;
  ackCode?: string; // AA, AE, AR
  errorMessage?: string;
  rawResponse?: string;
}

export interface MLLPClientOptions {
  host: string;
  port: number;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

export class MLLPClient {
  private host: string;
  private port: number;
  private timeout: number;
  private retryCount: number;
  private retryDelay: number;

  constructor(options: MLLPClientOptions) {
    this.host = options.host;
    this.port = options.port;
    this.timeout = options.timeout || 30000;
    this.retryCount = options.retryCount || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  /**
   * Wrap a message with MLLP framing
   */
  static frame(message: string): Buffer {
    const messageBuffer = Buffer.from(message, 'utf8');
    const framedBuffer = Buffer.alloc(messageBuffer.length + 3);

    framedBuffer[0] = VT; // Start byte
    messageBuffer.copy(framedBuffer, 1);
    framedBuffer[framedBuffer.length - 2] = FS; // End byte
    framedBuffer[framedBuffer.length - 1] = CR; // CR after FS

    return framedBuffer;
  }

  /**
   * Remove MLLP framing from a message
   */
  static unframe(data: Buffer): string {
    let start = 0;
    let end = data.length;

    // Skip leading VT if present
    if (data[0] === VT) {
      start = 1;
    }

    // Skip trailing FS CR if present
    if (data[end - 1] === CR && data[end - 2] === FS) {
      end -= 2;
    } else if (data[end - 1] === FS) {
      end -= 1;
    }

    return data.slice(start, end).toString('utf8');
  }

  /**
   * Parse an HL7 ACK to extract the acknowledgment code
   */
  static parseAck(ackMessage: string): { ackCode: string; errorMessage?: string } {
    const segments = ackMessage.split(/[\r\n]+/).filter((s) => s.length > 0);

    // Find MSA segment
    const msaSegment = segments.find((s) => s.startsWith('MSA'));
    if (!msaSegment) {
      return { ackCode: 'UNKNOWN' };
    }

    const fields = msaSegment.split('|');
    const ackCode = fields[1] || 'UNKNOWN';
    const errorMessage = fields[3]; // Text message field

    return { ackCode, errorMessage };
  }

  /**
   * Send an HL7 message and receive an ACK
   */
  async send(message: string): Promise<MLLPResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryCount; attempt++) {
      try {
        const response = await this.sendOnce(message);
        return response;
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.retryCount) {
          await this.delay(this.retryDelay);
        }
      }
    }

    return {
      success: false,
      message: `Failed after ${this.retryCount} attempts: ${lastError?.message}`,
      errorMessage: lastError?.message,
    };
  }

  /**
   * Single send attempt
   */
  private sendOnce(message: string): Promise<MLLPResponse> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let responseData = Buffer.alloc(0);
      let resolved = false;

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Connection timeout after ${this.timeout}ms`));
        }
      }, this.timeout);

      socket.on('connect', () => {
        const framedMessage = MLLPClient.frame(message);
        socket.write(framedMessage);
      });

      socket.on('data', (data) => {
        responseData = Buffer.concat([responseData, data]);

        // Check if we have a complete MLLP message (ends with FS CR)
        if (
          responseData.length >= 2 &&
          (responseData[responseData.length - 1] === CR &&
            responseData[responseData.length - 2] === FS)
        ) {
          clearTimeout(timeoutId);
          if (!resolved) {
            resolved = true;
            const rawResponse = MLLPClient.unframe(responseData);
            const { ackCode, errorMessage } = MLLPClient.parseAck(rawResponse);

            cleanup();
            resolve({
              success: ackCode === 'AA' || ackCode === 'CA',
              message: rawResponse,
              ackCode,
              errorMessage,
              rawResponse,
            });
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      });

      socket.on('close', () => {
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          cleanup();

          // If we received some data, try to parse it
          if (responseData.length > 0) {
            const rawResponse = MLLPClient.unframe(responseData);
            const { ackCode, errorMessage } = MLLPClient.parseAck(rawResponse);
            resolve({
              success: ackCode === 'AA' || ackCode === 'CA',
              message: rawResponse,
              ackCode,
              errorMessage,
              rawResponse,
            });
          } else {
            reject(new Error('Connection closed without response'));
          }
        }
      });

      socket.connect(this.port, this.host);
    });
  }

  /**
   * Check if the MLLP server is accepting connections
   */
  async checkConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 5000;

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeout);

      socket.on('connect', () => {
        clearTimeout(timeoutId);
        cleanup();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeoutId);
        cleanup();
        resolve(false);
      });

      socket.connect(this.port, this.host);
    });
  }

  /**
   * Wait for the MLLP server to be ready
   */
  async waitForReady(timeoutMs = 60000, pollIntervalMs = 2000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.checkConnection()) {
        return true;
      }
      await this.delay(pollIntervalMs);
    }

    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper to create MLLP clients for both Java and Node.js endpoints
 */
export function createMLLPClients(javaPort: number, nodePort: number, host = 'localhost'): {
  java: MLLPClient;
  node: MLLPClient;
} {
  return {
    java: new MLLPClient({ host, port: javaPort }),
    node: new MLLPClient({ host, port: nodePort }),
  };
}
