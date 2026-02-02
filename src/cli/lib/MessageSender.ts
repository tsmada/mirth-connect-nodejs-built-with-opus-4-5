/**
 * Message Sender
 *
 * Utilities for sending messages via MLLP and HTTP protocols.
 * Reuses the MLLPClient from the validation suite.
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosError } from 'axios';
import { MllpSendOptions, HttpSendOptions, SendResponse } from '../types/index.js';

// MLLP framing constants
const VT = 0x0b; // Vertical Tab - Start of message
const FS = 0x1c; // File Separator - End of message
const CR = 0x0d; // Carriage Return - After FS

/**
 * Wrap a message with MLLP framing
 */
function frameMLLP(message: string): Buffer {
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
function unframeMLLP(data: Buffer): string {
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
function parseAck(ackMessage: string): { ackCode: string; errorMessage?: string } {
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
 * Read message from file or use as literal
 * Supports @filename syntax for file references
 */
export function readMessage(messageOrFile: string): string {
  if (messageOrFile.startsWith('@')) {
    const filePath = messageOrFile.slice(1);
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    return fs.readFileSync(absolutePath, 'utf8');
  }

  return messageOrFile;
}

/**
 * Send a message via MLLP protocol
 */
export async function sendMLLP(
  message: string,
  options: MllpSendOptions
): Promise<SendResponse> {
  const { host, port, timeout = 30000 } = options;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responseData = Buffer.alloc(0);
    let resolved = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    const handleResult = (response: SendResponse) => {
      if (!resolved) {
        resolved = true;
        response.duration = Date.now() - startTime;
        cleanup();
        resolve(response);
      }
    };

    const timeoutId = setTimeout(() => {
      handleResult({
        success: false,
        message: 'Connection timeout',
        error: `Connection timeout after ${timeout}ms`,
      });
    }, timeout);

    socket.on('connect', () => {
      const framedMessage = frameMLLP(message);
      socket.write(framedMessage);
    });

    socket.on('data', (data) => {
      responseData = Buffer.concat([responseData, data]);

      // Check if we have a complete MLLP message (ends with FS CR)
      if (
        responseData.length >= 2 &&
        responseData[responseData.length - 1] === CR &&
        responseData[responseData.length - 2] === FS
      ) {
        clearTimeout(timeoutId);
        const rawResponse = unframeMLLP(responseData);
        const { ackCode, errorMessage } = parseAck(rawResponse);

        handleResult({
          success: ackCode === 'AA' || ackCode === 'CA',
          message: `ACK: ${ackCode}`,
          response: rawResponse,
          error: errorMessage,
        });
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeoutId);
      handleResult({
        success: false,
        message: 'Connection error',
        error: err.message,
      });
    });

    socket.on('close', () => {
      clearTimeout(timeoutId);
      if (!resolved) {
        // If we received some data, try to parse it
        if (responseData.length > 0) {
          const rawResponse = unframeMLLP(responseData);
          const { ackCode, errorMessage } = parseAck(rawResponse);
          handleResult({
            success: ackCode === 'AA' || ackCode === 'CA',
            message: `ACK: ${ackCode}`,
            response: rawResponse,
            error: errorMessage,
          });
        } else {
          handleResult({
            success: false,
            message: 'Connection closed',
            error: 'Connection closed without response',
          });
        }
      }
    });

    socket.connect(port, host);
  });
}

/**
 * Send a message via HTTP
 */
export async function sendHTTP(
  message: string,
  options: HttpSendOptions
): Promise<SendResponse> {
  const { url, method = 'POST', headers = {}, timeout = 30000 } = options;
  const startTime = Date.now();

  try {
    const response = await axios({
      method,
      url,
      data: message,
      headers: {
        'Content-Type': 'text/plain',
        ...headers,
      },
      timeout,
      validateStatus: () => true, // Don't throw on non-2xx
    });

    const duration = Date.now() - startTime;

    return {
      success: response.status >= 200 && response.status < 300,
      statusCode: response.status,
      message: `HTTP ${response.status} ${response.statusText}`,
      response: typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data),
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof AxiosError) {
      return {
        success: false,
        statusCode: error.response?.status,
        message: 'HTTP error',
        error: error.message,
        duration,
      };
    }

    return {
      success: false,
      message: 'Request failed',
      error: (error as Error).message,
      duration,
    };
  }
}

/**
 * Parse host:port string
 */
export function parseHostPort(hostPort: string): { host: string; port: number } {
  const parts = hostPort.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid host:port format: ${hostPort}`);
  }

  const host = parts[0]!;
  const port = parseInt(parts[1]!, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${parts[1]}`);
  }

  return { host, port };
}
