/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/TcpReceiverProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/TcpDispatcherProperties.java
 *
 * Purpose: Configuration properties for TCP source and destination connectors
 *
 * Key behaviors to replicate:
 * - All configuration options from Java implementation
 * - Default values matching Java
 * - Support for MLLP (Minimal Lower Layer Protocol) framing
 */

/**
 * Transmission mode for TCP connections
 */
export enum TransmissionMode {
  /** MLLP framing (HL7 standard) */
  MLLP = 'MLLP',
  /** Raw TCP with frame character separators */
  FRAME = 'FRAME',
  /** Raw TCP with no framing */
  RAW = 'RAW',
}

/**
 * Connection mode for TCP receiver
 */
export enum ServerMode {
  /** Listen for incoming connections */
  SERVER = 'SERVER',
  /** Connect to remote host */
  CLIENT = 'CLIENT',
}

/**
 * Response handling mode
 */
export enum ResponseMode {
  /** Wait for response from destination */
  DESTINATION = 'DESTINATION',
  /** Auto-generate response */
  AUTO = 'AUTO',
  /** No response */
  NONE = 'NONE',
}

/**
 * MLLP frame characters
 * Standard MLLP uses: VT (0x0B) as start, FS (0x1C) + CR (0x0D) as end
 */
export const MLLP_FRAME = {
  /** Start block character (VT - Vertical Tab) */
  START_BLOCK: 0x0b,
  /** End block character (FS - File Separator) */
  END_BLOCK: 0x1c,
  /** Carriage return */
  CARRIAGE_RETURN: 0x0d,
};

/**
 * TCP Receiver (Source) Properties
 */
export interface TcpReceiverProperties {
  /** Server mode (SERVER or CLIENT) */
  serverMode: ServerMode;
  /** Host to bind to (server mode) or connect to (client mode) */
  host: string;
  /** Port to listen on (server mode) or connect to (client mode) */
  port: number;
  /** Transmission mode (MLLP, FRAME, RAW) */
  transmissionMode: TransmissionMode;
  /** Character encoding */
  charsetEncoding: string;
  /** Receive timeout in milliseconds */
  receiveTimeout: number;
  /** Keep socket connection open */
  keepConnectionOpen: boolean;
  /** Maximum connections (server mode) */
  maxConnections: number;
  /** Response mode */
  responseMode: ResponseMode;
  /** Start of message byte (for FRAME mode) */
  startOfMessageBytes: number[];
  /** End of message byte (for FRAME mode) */
  endOfMessageBytes: number[];
  /** Data type for incoming messages */
  dataType: string;
  /** Reconnect interval for client mode (ms) */
  reconnectInterval: number;
  /** Buffer size */
  bufferSize: number;
}

/**
 * TCP Dispatcher (Destination) Properties
 */
export interface TcpDispatcherProperties {
  /** Remote host to connect to */
  host: string;
  /** Remote port to connect to */
  port: number;
  /** Transmission mode (MLLP, FRAME, RAW) */
  transmissionMode: TransmissionMode;
  /** Character encoding */
  charsetEncoding: string;
  /** Send timeout in milliseconds */
  sendTimeout: number;
  /** Response timeout in milliseconds */
  responseTimeout: number;
  /** Keep socket connection open */
  keepConnectionOpen: boolean;
  /** Start of message bytes (for FRAME mode) */
  startOfMessageBytes: number[];
  /** End of message bytes (for FRAME mode) */
  endOfMessageBytes: number[];
  /** Template for outgoing message */
  template: string;
  /** Data type for outgoing messages */
  dataType: string;
  /** Buffer size */
  bufferSize: number;
  /** Local bind address (optional) */
  localAddress?: string;
  /** Local bind port (optional) */
  localPort?: number;
  /** Socket timeout for connection (ms) */
  socketTimeout: number;
}

/**
 * Default TCP Receiver properties
 */
export function getDefaultTcpReceiverProperties(): TcpReceiverProperties {
  return {
    serverMode: ServerMode.SERVER,
    host: '0.0.0.0',
    port: 6661,
    transmissionMode: TransmissionMode.MLLP,
    charsetEncoding: 'UTF-8',
    receiveTimeout: 0, // 0 = no timeout
    keepConnectionOpen: true,
    maxConnections: 10,
    responseMode: ResponseMode.AUTO,
    startOfMessageBytes: [MLLP_FRAME.START_BLOCK],
    endOfMessageBytes: [MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN],
    dataType: 'HL7V2',
    reconnectInterval: 5000,
    bufferSize: 65536,
  };
}

/**
 * Default TCP Dispatcher properties
 */
export function getDefaultTcpDispatcherProperties(): TcpDispatcherProperties {
  return {
    host: 'localhost',
    port: 6661,
    transmissionMode: TransmissionMode.MLLP,
    charsetEncoding: 'UTF-8',
    sendTimeout: 10000,
    responseTimeout: 10000,
    keepConnectionOpen: true,
    startOfMessageBytes: [MLLP_FRAME.START_BLOCK],
    endOfMessageBytes: [MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN],
    template: '',
    dataType: 'HL7V2',
    bufferSize: 65536,
    localAddress: undefined,
    localPort: undefined,
    socketTimeout: 30000,
  };
}

/**
 * Frame a message with MLLP framing
 */
export function frameMessage(
  message: string,
  transmissionMode: TransmissionMode,
  startBytes: number[],
  endBytes: number[]
): Buffer {
  const messageBuffer = Buffer.from(message, 'utf-8');

  switch (transmissionMode) {
    case TransmissionMode.MLLP:
      return Buffer.concat([
        Buffer.from([MLLP_FRAME.START_BLOCK]),
        messageBuffer,
        Buffer.from([MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN]),
      ]);

    case TransmissionMode.FRAME:
      return Buffer.concat([
        Buffer.from(startBytes),
        messageBuffer,
        Buffer.from(endBytes),
      ]);

    case TransmissionMode.RAW:
    default:
      return messageBuffer;
  }
}

/**
 * Extract message from MLLP framed data
 */
export function unframeMessage(
  data: Buffer,
  transmissionMode: TransmissionMode,
  startBytes: number[],
  endBytes: number[]
): string | null {
  switch (transmissionMode) {
    case TransmissionMode.MLLP:
      // Find MLLP frame markers
      const startIndex = data.indexOf(MLLP_FRAME.START_BLOCK);
      const endIndex = data.indexOf(MLLP_FRAME.END_BLOCK);

      if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
        return null;
      }

      return data.subarray(startIndex + 1, endIndex).toString('utf-8');

    case TransmissionMode.FRAME:
      // Find custom frame markers
      const startMarker = Buffer.from(startBytes);
      const endMarker = Buffer.from(endBytes);

      const frameStart = data.indexOf(startMarker);
      const frameEnd = data.indexOf(endMarker);

      if (frameStart === -1 || frameEnd === -1 || frameEnd <= frameStart) {
        return null;
      }

      return data
        .subarray(frameStart + startMarker.length, frameEnd)
        .toString('utf-8');

    case TransmissionMode.RAW:
    default:
      return data.toString('utf-8');
  }
}

/**
 * Check if buffer contains a complete MLLP message
 */
export function hasCompleteMessage(
  buffer: Buffer,
  transmissionMode: TransmissionMode,
  endBytes: number[]
): boolean {
  switch (transmissionMode) {
    case TransmissionMode.MLLP:
      // Look for end block followed by carriage return
      const endBlock = buffer.indexOf(MLLP_FRAME.END_BLOCK);
      if (endBlock === -1) return false;
      return (
        endBlock + 1 < buffer.length &&
        buffer[endBlock + 1] === MLLP_FRAME.CARRIAGE_RETURN
      );

    case TransmissionMode.FRAME:
      const endMarker = Buffer.from(endBytes);
      return buffer.indexOf(endMarker) !== -1;

    case TransmissionMode.RAW:
    default:
      // For raw mode, we consider any data as complete
      return buffer.length > 0;
  }
}

/**
 * Generate a simple HL7 ACK response
 */
export function generateAck(
  controlId: string,
  ackCode: string = 'AA'
): string {
  const timestamp = formatHl7Timestamp(new Date());
  return (
    `MSH|^~\\&|MIRTH|MIRTH|MIRTH|MIRTH|${timestamp}||ACK|${controlId}|P|2.5\r` +
    `MSA|${ackCode}|${controlId}|\r`
  );
}

/**
 * Format date for HL7 timestamp
 */
function formatHl7Timestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/**
 * Extract message control ID from HL7 message
 */
export function extractControlId(message: string): string | null {
  const lines = message.split(/[\r\n]+/);
  const mshLine = lines.find((line) => line.startsWith('MSH'));

  if (!mshLine) {
    return null;
  }

  const segments = mshLine.split('|');
  // Control ID is in MSH-10
  return segments.length >= 10 ? (segments[9] ?? null) : null;
}
