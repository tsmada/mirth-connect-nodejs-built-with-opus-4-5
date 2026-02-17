/**
 * TLS/SSL tests for TCP/MLLP connectors.
 * Validates MLLPS (MLLP over TLS) support for healthcare transport security.
 *
 * Tests cover:
 * 1. TLS server + TLS client data exchange
 * 2. TLS dispatcher connecting to TLS server
 * 3. Plaintext fallback when TLS is disabled (default)
 * 4. Certificate validation (reject invalid certs)
 * 5. Mutual TLS (mTLS) with client certificates
 * 6. TLS properties on receiver and dispatcher
 * 7. ListenerInfo transport type reflects TLS
 */

import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { TcpReceiver } from '../../../../src/connectors/tcp/TcpReceiver';
import { TcpDispatcher } from '../../../../src/connectors/tcp/TcpDispatcher';
import {
  TransmissionMode,
  ResponseMode,
  TlsProperties,
  frameMessage,
  MLLP_FRAME,
} from '../../../../src/connectors/tcp/TcpConnectorProperties';
import { Status } from '../../../../src/model/Status';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// --- Test certificate generation helpers ---

interface TestCerts {
  serverKey: string;
  serverCert: string;
  clientKey: string;
  clientCert: string;
  caKey: string;
  caCert: string;
  dir: string;
}

/**
 * Generate a self-signed CA, server cert, and client cert using openssl.
 * All files are written to a temporary directory and cleaned up after tests.
 */
function generateTestCerts(): TestCerts {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirth-tls-test-'));

  const caKeyPath = path.join(dir, 'ca.key');
  const caCertPath = path.join(dir, 'ca.crt');
  const serverKeyPath = path.join(dir, 'server.key');
  const serverCsrPath = path.join(dir, 'server.csr');
  const serverCertPath = path.join(dir, 'server.crt');
  const clientKeyPath = path.join(dir, 'client.key');
  const clientCsrPath = path.join(dir, 'client.csr');
  const clientCertPath = path.join(dir, 'client.crt');
  const serverExtPath = path.join(dir, 'server.ext');

  // Generate CA key and self-signed cert
  execSync(`openssl genrsa -out "${caKeyPath}" 2048 2>/dev/null`);
  execSync(
    `openssl req -new -x509 -key "${caKeyPath}" -out "${caCertPath}" -days 1 ` +
    `-subj "/CN=Test CA" 2>/dev/null`
  );

  // Write server extension file for SAN (required by modern TLS)
  fs.writeFileSync(serverExtPath, [
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ].join('\n'));

  // Generate server key, CSR, and CA-signed cert
  execSync(`openssl genrsa -out "${serverKeyPath}" 2048 2>/dev/null`);
  execSync(
    `openssl req -new -key "${serverKeyPath}" -out "${serverCsrPath}" ` +
    `-subj "/CN=localhost" 2>/dev/null`
  );
  execSync(
    `openssl x509 -req -in "${serverCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" ` +
    `-CAcreateserial -out "${serverCertPath}" -days 1 -extfile "${serverExtPath}" 2>/dev/null`
  );

  // Generate client key, CSR, and CA-signed cert
  execSync(`openssl genrsa -out "${clientKeyPath}" 2048 2>/dev/null`);
  execSync(
    `openssl req -new -key "${clientKeyPath}" -out "${clientCsrPath}" ` +
    `-subj "/CN=Test Client" 2>/dev/null`
  );
  execSync(
    `openssl x509 -req -in "${clientCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" ` +
    `-CAcreateserial -out "${clientCertPath}" -days 1 2>/dev/null`
  );

  return {
    serverKey: serverKeyPath,
    serverCert: serverCertPath,
    clientKey: clientKeyPath,
    clientCert: clientCertPath,
    caKey: caKeyPath,
    caCert: caCertPath,
    dir,
  };
}

function cleanupTestCerts(certs: TestCerts): void {
  try {
    fs.rmSync(certs.dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// --- Helpers for sending MLLP messages over sockets ---

function sendMllpMessage(socket: net.Socket | tls.TLSSocket, message: string): void {
  const framed = frameMessage(
    message,
    TransmissionMode.MLLP,
    [MLLP_FRAME.START_BLOCK],
    [MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN]
  );
  socket.write(framed);
}

// --- Test port allocation ---
let nextPort = 17700;
function getPort(): number {
  return nextPort++;
}

// --- Tests ---

describe('TCP/MLLP TLS Support', () => {
  let certs: TestCerts;

  beforeAll(() => {
    certs = generateTestCerts();
  });

  afterAll(() => {
    cleanupTestCerts(certs);
  });

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('TLS Properties', () => {
    it('should default to TLS disabled on receiver', () => {
      const receiver = new TcpReceiver({ name: 'Test' });
      const props = receiver.getProperties();
      expect(props.tls).toBeUndefined();
    });

    it('should default to TLS disabled on dispatcher', () => {
      const dispatcher = new TcpDispatcher({ metaDataId: 1 });
      const props = dispatcher.getProperties();
      expect(props.tls).toBeUndefined();
    });

    it('should accept TLS configuration on receiver', () => {
      const tlsConfig: TlsProperties = {
        enabled: true,
        keyStorePath: '/path/to/key.pem',
        certStorePath: '/path/to/cert.pem',
        trustStorePath: '/path/to/ca.pem',
        rejectUnauthorized: true,
        requireClientAuth: true,
      };

      const receiver = new TcpReceiver({
        name: 'TLS Receiver',
        properties: { tls: tlsConfig },
      });

      const props = receiver.getProperties();
      expect(props.tls).toBeDefined();
      expect(props.tls!.enabled).toBe(true);
      expect(props.tls!.keyStorePath).toBe('/path/to/key.pem');
      expect(props.tls!.certStorePath).toBe('/path/to/cert.pem');
      expect(props.tls!.trustStorePath).toBe('/path/to/ca.pem');
      expect(props.tls!.rejectUnauthorized).toBe(true);
      expect(props.tls!.requireClientAuth).toBe(true);
    });

    it('should accept TLS configuration on dispatcher', () => {
      const tlsConfig: TlsProperties = {
        enabled: true,
        certStorePath: '/path/to/cert.pem',
        trustStorePath: '/path/to/ca.pem',
        sniServerName: 'hl7server.hospital.org',
      };

      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: { tls: tlsConfig },
      });

      const props = dispatcher.getProperties();
      expect(props.tls).toBeDefined();
      expect(props.tls!.enabled).toBe(true);
      expect(props.tls!.sniServerName).toBe('hl7server.hospital.org');
    });
  });

  describe('Plaintext fallback (TLS disabled)', () => {
    it('should use plain TCP when TLS is not configured', async () => {
      const port = getPort();
      const receiver = new TcpReceiver({
        name: 'Plain Receiver',
        properties: {
          port,
          host: '127.0.0.1',
          responseMode: ResponseMode.NONE,
          transmissionMode: TransmissionMode.RAW,
        },
      });

      await receiver.start();

      try {
        const server = receiver.getServer();
        expect(server).toBeInstanceOf(net.Server);
        // net.Server that is NOT a tls.Server
        expect(server).not.toBeInstanceOf(tls.Server);
      } finally {
        await receiver.stop();
      }
    });

    it('should use plain TCP when TLS is explicitly disabled', async () => {
      const port = getPort();
      const receiver = new TcpReceiver({
        name: 'Explicit Plain Receiver',
        properties: {
          port,
          host: '127.0.0.1',
          responseMode: ResponseMode.NONE,
          transmissionMode: TransmissionMode.RAW,
          tls: { enabled: false },
        },
      });

      await receiver.start();

      try {
        const server = receiver.getServer();
        expect(server).toBeInstanceOf(net.Server);
        expect(server).not.toBeInstanceOf(tls.Server);
      } finally {
        await receiver.stop();
      }
    });
  });

  describe('TLS Server (Receiver)', () => {
    it('should create a TLS server when TLS is enabled', async () => {
      const port = getPort();
      const receiver = new TcpReceiver({
        name: 'TLS Receiver',
        properties: {
          port,
          host: '127.0.0.1',
          responseMode: ResponseMode.NONE,
          transmissionMode: TransmissionMode.RAW,
          tls: {
            enabled: true,
            keyStorePath: certs.serverKey,
            certStorePath: certs.serverCert,
            trustStorePath: certs.caCert,
            rejectUnauthorized: false,
          },
        },
      });

      await receiver.start();

      try {
        const server = receiver.getServer();
        expect(server).toBeInstanceOf(tls.Server);
      } finally {
        await receiver.stop();
      }
    });

    it('should accept TLS connections and receive data', async () => {
      const port = getPort();
      const received: string[] = [];

      const receiver = new TcpReceiver({
        name: 'TLS Data Receiver',
        properties: {
          port,
          host: '127.0.0.1',
          responseMode: ResponseMode.NONE,
          transmissionMode: TransmissionMode.RAW,
          tls: {
            enabled: true,
            keyStorePath: certs.serverKey,
            certStorePath: certs.serverCert,
            rejectUnauthorized: false,
          },
        },
      });

      // Mock the channel to capture dispatched messages
      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockImplementation(async (rawData: string) => {
          received.push(rawData);
          return null;
        }),
      };
      (receiver as any).channel = mockChannel;

      await receiver.start();

      try {
        // Connect with TLS client
        const clientSocket = tls.connect({
          host: '127.0.0.1',
          port,
          ca: [fs.readFileSync(certs.caCert)],
          rejectUnauthorized: false,
        });

        await new Promise<void>((resolve, reject) => {
          clientSocket.once('secureConnect', resolve);
          clientSocket.once('error', reject);
        });

        // Send data
        clientSocket.write('Hello TLS');

        // Wait for message processing
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(received.length).toBeGreaterThanOrEqual(1);
        expect(received[0]).toBe('Hello TLS');

        clientSocket.destroy();
      } finally {
        await receiver.stop();
      }
    });

    it('should report MLLPS transport type in listener info when TLS + MLLP', async () => {
      const port = getPort();
      const receiver = new TcpReceiver({
        name: 'MLLPS Receiver',
        properties: {
          port,
          host: '127.0.0.1',
          transmissionMode: TransmissionMode.MLLP,
          responseMode: ResponseMode.NONE,
          tls: {
            enabled: true,
            keyStorePath: certs.serverKey,
            certStorePath: certs.serverCert,
            rejectUnauthorized: false,
          },
        },
      });

      await receiver.start();

      try {
        const info = receiver.getListenerInfo();
        expect(info).not.toBeNull();
        expect(info!.transportType).toBe('MLLPS');
      } finally {
        await receiver.stop();
      }
    });

    it('should report TCP+TLS transport type for non-MLLP TLS mode', async () => {
      const port = getPort();
      const receiver = new TcpReceiver({
        name: 'TCP+TLS Receiver',
        properties: {
          port,
          host: '127.0.0.1',
          transmissionMode: TransmissionMode.RAW,
          responseMode: ResponseMode.NONE,
          tls: {
            enabled: true,
            keyStorePath: certs.serverKey,
            certStorePath: certs.serverCert,
            rejectUnauthorized: false,
          },
        },
      });

      await receiver.start();

      try {
        const info = receiver.getListenerInfo();
        expect(info).not.toBeNull();
        expect(info!.transportType).toBe('TCP+TLS');
      } finally {
        await receiver.stop();
      }
    });
  });

  describe('TLS Client (Dispatcher)', () => {
    let tlsServer: tls.Server;
    let serverPort: number;
    let serverReceivedData: Buffer[];

    beforeEach(async () => {
      serverPort = getPort();
      serverReceivedData = [];

      tlsServer = tls.createServer({
        key: fs.readFileSync(certs.serverKey),
        cert: fs.readFileSync(certs.serverCert),
        ca: [fs.readFileSync(certs.caCert)],
        requestCert: false,
        rejectUnauthorized: false,
      }, (socket) => {
        socket.on('data', (data) => {
          serverReceivedData.push(data);
          // Send back an MLLP-framed ACK response
          const ack = 'MSH|^~\\&|MIRTH|MIRTH|MIRTH|MIRTH|20260217||ACK|12345|P|2.5\rMSA|AA|12345|\r';
          const framed = frameMessage(
            ack,
            TransmissionMode.MLLP,
            [MLLP_FRAME.START_BLOCK],
            [MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN]
          );
          socket.write(framed);
        });
      });

      await new Promise<void>((resolve) => {
        tlsServer.listen(serverPort, '127.0.0.1', () => resolve());
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        tlsServer.close(() => resolve());
      });
    });

    it('should connect to TLS server and send data', async () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        name: 'TLS Dispatcher',
        properties: {
          host: '127.0.0.1',
          port: serverPort,
          transmissionMode: TransmissionMode.MLLP,
          keepConnectionOpen: false,
          tls: {
            enabled: true,
            trustStorePath: certs.caCert,
            rejectUnauthorized: true,
          },
        },
      });

      await dispatcher.start();

      try {
        // Create a mock ConnectorMessage
        const mockMessage = createMockConnectorMessage(
          'MSH|^~\\&|TEST|TEST|DEST|DEST|20260217||ADT^A01|12345|P|2.5\rPID|||12345||Doe^John\r'
        );

        await dispatcher.send(mockMessage);

        // Verify data was received by TLS server
        expect(serverReceivedData.length).toBeGreaterThanOrEqual(1);
        const combined = Buffer.concat(serverReceivedData).toString();
        expect(combined).toContain('MSH');
        expect(combined).toContain('ADT^A01');
      } finally {
        await dispatcher.stop();
      }
    });
  });

  describe('Certificate validation', () => {
    it('should reject connection when server cert is not trusted and rejectUnauthorized=true', async () => {
      const port = getPort();

      // Create a server with a self-signed cert (no CA trust chain)
      const selfSignedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirth-ss-'));
      const ssKeyPath = path.join(selfSignedDir, 'ss.key');
      const ssCertPath = path.join(selfSignedDir, 'ss.crt');

      execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${ssKeyPath}" -out "${ssCertPath}" -days 1 -nodes -subj "/CN=untrusted" 2>/dev/null`);

      const server = tls.createServer({
        key: fs.readFileSync(ssKeyPath),
        cert: fs.readFileSync(ssCertPath),
      }, (_socket) => {
        // Connection handler
      });

      await new Promise<void>((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve());
      });

      try {
        const dispatcher = new TcpDispatcher({
          metaDataId: 1,
          name: 'Strict TLS Dispatcher',
          properties: {
            host: '127.0.0.1',
            port,
            transmissionMode: TransmissionMode.RAW,
            ignoreResponse: true,
            tls: {
              enabled: true,
              // No trustStorePath and rejectUnauthorized=true (default)
              rejectUnauthorized: true,
            },
          },
        });

        await dispatcher.start();

        const mockMessage = createMockConnectorMessage('test data');

        // Should throw due to untrusted certificate
        await expect(dispatcher.send(mockMessage)).rejects.toThrow();

        await dispatcher.stop();
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        fs.rmSync(selfSignedDir, { recursive: true, force: true });
      }
    });

    it('should accept connection when rejectUnauthorized=false (self-signed OK)', async () => {
      const port = getPort();

      // Create a server with a self-signed cert
      const selfSignedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirth-ss2-'));
      const ssKeyPath = path.join(selfSignedDir, 'ss.key');
      const ssCertPath = path.join(selfSignedDir, 'ss.crt');

      execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${ssKeyPath}" -out "${ssCertPath}" -days 1 -nodes -subj "/CN=localhost" 2>/dev/null`);

      const server = tls.createServer({
        key: fs.readFileSync(ssKeyPath),
        cert: fs.readFileSync(ssCertPath),
      }, (socket) => {
        // Suppress ECONNRESET from the server side when client disconnects
        socket.on('error', () => {});
        socket.on('data', () => {
          // Just consume data, no response needed since ignoreResponse=true
        });
      });
      // Suppress server-level errors
      server.on('error', () => {});

      await new Promise<void>((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve());
      });

      try {
        const dispatcher = new TcpDispatcher({
          metaDataId: 1,
          name: 'Lenient TLS Dispatcher',
          properties: {
            host: '127.0.0.1',
            port,
            transmissionMode: TransmissionMode.RAW,
            ignoreResponse: true,
            keepConnectionOpen: false,
            tls: {
              enabled: true,
              rejectUnauthorized: false,  // Accept self-signed
            },
          },
        });

        await dispatcher.start();

        const mockMessage = createMockConnectorMessage('test data');

        // Should NOT throw because rejectUnauthorized=false
        await dispatcher.send(mockMessage);

        // Verify the message was sent successfully
        expect(mockMessage.setStatus).toHaveBeenCalledWith(Status.SENT);

        await dispatcher.stop();
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        fs.rmSync(selfSignedDir, { recursive: true, force: true });
      }
    });
  });

  describe('Mutual TLS (mTLS)', () => {
    it('should require client certificates when requireClientAuth=true', async () => {
      const port = getPort();

      // Use a raw tls.createServer to test mTLS behavior directly
      // (avoids TcpReceiver mock complexity for the rejection test)
      const server = tls.createServer({
        key: fs.readFileSync(certs.serverKey),
        cert: fs.readFileSync(certs.serverCert),
        ca: [fs.readFileSync(certs.caCert)],
        requestCert: true,
        rejectUnauthorized: true,
      }, (_socket) => {
        // Connection accepted
      });

      // Suppress server-level errors from rejected connections
      server.on('error', () => {});
      // Suppress tlsClientError from rejected connections
      server.on('tlsClientError', () => {});

      await new Promise<void>((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve());
      });

      try {
        // Connect WITH client cert — should succeed
        const goodSocket = tls.connect({
          host: '127.0.0.1',
          port,
          key: fs.readFileSync(certs.clientKey),
          cert: fs.readFileSync(certs.clientCert),
          ca: [fs.readFileSync(certs.caCert)],
        });

        await new Promise<void>((resolve, reject) => {
          goodSocket.once('secureConnect', resolve);
          goodSocket.once('error', reject);
        });

        expect(goodSocket.authorized).toBe(true);
        goodSocket.destroy();

        // Small delay to let the server process the disconnect
        await new Promise(resolve => setTimeout(resolve, 50));

        // Connect WITHOUT client cert — should be rejected by server
        const badSocket = tls.connect({
          host: '127.0.0.1',
          port,
          ca: [fs.readFileSync(certs.caCert)],
          rejectUnauthorized: false,
        });

        // The TLS handshake may complete from the client's perspective
        // (secureConnect fires), but the server will then immediately
        // terminate the connection. We check for either:
        // - error event (handshake failure)
        // - close event (server terminated after handshake)
        // - secureConnect followed by quick close (server rejects post-handshake)
        const wasTerminated = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            resolve(false);
          }, 2000);

          badSocket.once('secureConnect', () => {
            // Server should close this connection shortly
          });

          badSocket.once('error', () => {
            clearTimeout(timer);
            resolve(true);
          });

          badSocket.once('close', () => {
            clearTimeout(timer);
            // If connected then closed = server terminated us
            // If not connected then closed = rejected during handshake
            resolve(true);
          });
        });

        expect(wasTerminated).toBe(true);
        badSocket.destroy();
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });

    it('should allow mTLS dispatcher to connect with client cert', async () => {
      const port = getPort();

      // Create mTLS server that requires client certs
      const server = tls.createServer({
        key: fs.readFileSync(certs.serverKey),
        cert: fs.readFileSync(certs.serverCert),
        ca: [fs.readFileSync(certs.caCert)],
        requestCert: true,
        rejectUnauthorized: true,
      }, (socket) => {
        socket.on('data', () => {
          // Consume data, no response needed
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve());
      });

      try {
        const dispatcher = new TcpDispatcher({
          metaDataId: 1,
          name: 'mTLS Dispatcher',
          properties: {
            host: '127.0.0.1',
            port,
            transmissionMode: TransmissionMode.RAW,
            ignoreResponse: true,
            keepConnectionOpen: false,
            tls: {
              enabled: true,
              keyStorePath: certs.clientKey,
              certStorePath: certs.clientCert,
              trustStorePath: certs.caCert,
              rejectUnauthorized: true,
            },
          },
        });

        await dispatcher.start();

        const mockMessage = createMockConnectorMessage('mTLS test data');

        // Should succeed because we provide valid client cert
        await expect(dispatcher.send(mockMessage)).resolves.not.toThrow();

        await dispatcher.stop();
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });
  });

  describe('MLLPS end-to-end', () => {
    it('should exchange MLLP messages over TLS between receiver and raw TLS client', async () => {
      const port = getPort();
      const received: string[] = [];

      const receiver = new TcpReceiver({
        name: 'MLLPS E2E Receiver',
        properties: {
          port,
          host: '127.0.0.1',
          transmissionMode: TransmissionMode.MLLP,
          responseMode: ResponseMode.NONE,
          tls: {
            enabled: true,
            keyStorePath: certs.serverKey,
            certStorePath: certs.serverCert,
            rejectUnauthorized: false,
          },
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'MLLPS E2E Channel',
        dispatchRawMessage: jest.fn().mockImplementation(async (rawData: string) => {
          received.push(rawData);
          return null;
        }),
      };
      (receiver as any).channel = mockChannel;

      await receiver.start();

      try {
        // Connect TLS client
        const clientSocket = tls.connect({
          host: '127.0.0.1',
          port,
          rejectUnauthorized: false,
        });

        await new Promise<void>((resolve, reject) => {
          clientSocket.once('secureConnect', resolve);
          clientSocket.once('error', reject);
        });

        // Send MLLP-framed HL7 message over TLS
        const hl7Message = 'MSH|^~\\&|SRC|FAC|DST|FAC|20260217||ADT^A01|MSG001|P|2.5\rPID|||12345||Smith^Jane\r';
        sendMllpMessage(clientSocket, hl7Message);

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(received.length).toBe(1);
        expect(received[0]).toContain('MSH|');
        expect(received[0]).toContain('Smith^Jane');

        clientSocket.destroy();
      } finally {
        await receiver.stop();
      }
    });
  });
});

// --- Mock ConnectorMessage helper ---

function createMockConnectorMessage(rawData: string): any {
  const channelMap = new Map<string, unknown>();
  const sourceMap = new Map<string, unknown>();
  const connectorMap = new Map<string, unknown>();

  return {
    getMetaDataId: () => 1,
    getRawData: () => rawData,
    getEncodedContent: () => ({ content: rawData, dataType: 'HL7V2', contentType: 0, encrypted: false }),
    getChannelMap: () => channelMap,
    getSourceMap: () => sourceMap,
    getConnectorMap: () => connectorMap,
    setStatus: jest.fn(),
    setSendDate: jest.fn(),
    setContent: jest.fn(),
    setProcessingError: jest.fn(),
    getResponseContent: () => null,
  };
}
