/**
 * Tests for TCP Receiver respondOnNewConnection parity fix.
 *
 * Java Reference: TcpReceiver.java
 * - respondOnNewConnection == NEW_CONNECTION (1): open new TCP socket to responseAddress:responsePort
 * - respondOnNewConnection == SAME_CONNECTION (0): write response on the same socket (default)
 * - respondOnNewConnection == NEW_CONNECTION_ON_RECOVERY (2): same as 0 for normal flow
 */

import * as net from 'net';
import { TcpReceiver } from '../../../../src/connectors/tcp/TcpReceiver';
import {
  ServerMode,
  TransmissionMode,
  ResponseMode,
  NEW_CONNECTION_DISABLED,
  NEW_CONNECTION,
  NEW_CONNECTION_ON_RECOVERY,
} from '../../../../src/connectors/tcp/TcpConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Helper: create a mock channel with required methods
function createMockChannel() {
  return {
    getId: jest.fn().mockReturnValue('test-channel-id'),
    getName: jest.fn().mockReturnValue('Test Channel'),
    dispatchRawMessage: jest.fn().mockResolvedValue(null),
  };
}

// Helper: find an available port
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

// Helper: send an MLLP message and collect the response
function sendMllpMessage(port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer = Buffer.alloc(0);

    client.connect(port, '127.0.0.1', () => {
      const framed = Buffer.concat([
        Buffer.from([0x0b]),
        Buffer.from(message, 'utf-8'),
        Buffer.from([0x1c, 0x0d]),
      ]);
      client.write(framed);
    });

    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      // Check for MLLP end
      if (buffer.includes(Buffer.from([0x1c, 0x0d]))) {
        const start = buffer.indexOf(0x0b);
        const end = buffer.indexOf(0x1c);
        if (start !== -1 && end !== -1) {
          resolve(buffer.subarray(start + 1, end).toString('utf-8'));
        }
        client.destroy();
      }
    });

    client.on('error', reject);

    // Timeout after 3 seconds
    setTimeout(() => {
      client.destroy();
      reject(new Error('Timeout waiting for MLLP response'));
    }, 3000);
  });
}

describe('TcpReceiver respondOnNewConnection', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('property configuration', () => {
    it('should default to SAME_CONNECTION (0)', () => {
      const receiver = new TcpReceiver({});
      const props = receiver.getProperties();
      expect(props.respondOnNewConnection).toBe(NEW_CONNECTION_DISABLED);
    });

    it('should accept NEW_CONNECTION mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          respondOnNewConnection: NEW_CONNECTION,
          responseAddress: '127.0.0.1',
          responsePort: '9999',
        },
      });

      const props = receiver.getProperties();
      expect(props.respondOnNewConnection).toBe(NEW_CONNECTION);
      expect(props.responseAddress).toBe('127.0.0.1');
      expect(props.responsePort).toBe('9999');
    });

    it('should accept NEW_CONNECTION_ON_RECOVERY mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          respondOnNewConnection: NEW_CONNECTION_ON_RECOVERY,
        },
      });

      expect(receiver.getProperties().respondOnNewConnection).toBe(NEW_CONNECTION_ON_RECOVERY);
    });

    it('should default responseAddress and responsePort to empty string', () => {
      const receiver = new TcpReceiver({});
      const props = receiver.getProperties();
      expect(props.responseAddress).toBe('');
      expect(props.responsePort).toBe('');
    });
  });

  describe('respondOnNewConnection=false (same socket)', () => {
    it('should send response on the same socket by default', async () => {
      const listenPort = await findFreePort();

      const receiver = new TcpReceiver({
        name: 'Same Socket Receiver',
        properties: {
          serverMode: ServerMode.SERVER,
          host: '127.0.0.1',
          port: listenPort,
          transmissionMode: TransmissionMode.MLLP,
          responseMode: ResponseMode.AUTO,
          respondOnNewConnection: NEW_CONNECTION_DISABLED,
        },
      });

      // Mock the channel so dispatchRawMessage and event dispatching work
      (receiver as any).channel = createMockChannel();

      await receiver.start();

      try {
        // Send an HL7 message and expect ACK on same socket
        const testMsg = 'MSH|^~\\&|SRC|FAC|DST|FAC|20260213||ADT^A01|12345|P|2.5\rEVN|A01|20260213';
        const response = await sendMllpMessage(listenPort, testMsg);

        // Should receive an ACK on the same connection
        expect(response).toContain('MSA|');
      } finally {
        await receiver.stop();
      }
    });
  });

  describe('respondOnNewConnection=NEW_CONNECTION', () => {
    it('should open a new connection to responseAddress:responsePort for the response', async () => {
      const listenPort = await findFreePort();
      const responsePort = await findFreePort();

      // Create a server to receive the response on the new connection
      const responseReceived = new Promise<string>((resolve, reject) => {
        const responseServer = net.createServer((socket) => {
          let buffer = Buffer.alloc(0);
          socket.on('data', (data) => {
            buffer = Buffer.concat([buffer, data]);
            // Check for MLLP end
            if (buffer.includes(Buffer.from([0x1c, 0x0d]))) {
              const start = buffer.indexOf(0x0b);
              const end = buffer.indexOf(0x1c);
              if (start !== -1 && end !== -1) {
                resolve(buffer.subarray(start + 1, end).toString('utf-8'));
              }
              responseServer.close();
            }
          });
        });

        responseServer.listen(responsePort, '127.0.0.1');

        setTimeout(() => {
          responseServer.close();
          reject(new Error('Timeout waiting for response on new connection'));
        }, 5000);
      });

      const receiver = new TcpReceiver({
        name: 'New Connection Receiver',
        properties: {
          serverMode: ServerMode.SERVER,
          host: '127.0.0.1',
          port: listenPort,
          transmissionMode: TransmissionMode.MLLP,
          responseMode: ResponseMode.AUTO,
          respondOnNewConnection: NEW_CONNECTION,
          responseAddress: '127.0.0.1',
          responsePort: String(responsePort),
        },
      });

      // Mock channel
      (receiver as any).channel = createMockChannel();

      await receiver.start();

      try {
        // Send a message — the response should NOT come back on this socket
        const testMsg = 'MSH|^~\\&|SRC|FAC|DST|FAC|20260213||ADT^A01|12345|P|2.5\rEVN|A01|20260213';

        // Send without expecting a response on the same socket
        const client = new net.Socket();
        await new Promise<void>((resolve, reject) => {
          client.connect(listenPort, '127.0.0.1', () => {
            const framed = Buffer.concat([
              Buffer.from([0x0b]),
              Buffer.from(testMsg, 'utf-8'),
              Buffer.from([0x1c, 0x0d]),
            ]);
            client.write(framed, () => resolve());
          });
          client.on('error', reject);
        });

        // Wait for the response on the new connection
        const response = await responseReceived;

        // Should contain an ACK
        expect(response).toContain('MSA|');

        client.destroy();
      } finally {
        await receiver.stop();
      }
    });

    it('should throw error when responseAddress is not configured', async () => {
      const receiver = new TcpReceiver({
        properties: {
          respondOnNewConnection: NEW_CONNECTION,
          responseAddress: '',
          responsePort: '',
        },
      });

      // Access the private method via any cast
      const sendResponseOnNew = (receiver as any).sendResponseOnNewConnection.bind(receiver);

      await expect(sendResponseOnNew(Buffer.from('test'))).rejects.toThrow(
        'respondOnNewConnection is enabled but responseAddress or responsePort is not configured'
      );
    });
  });
});
