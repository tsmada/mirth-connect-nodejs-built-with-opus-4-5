import { TcpReceiver } from '../../../../src/connectors/tcp/TcpReceiver';
import {
  ServerMode,
  TransmissionMode,
  ResponseMode,
} from '../../../../src/connectors/tcp/TcpConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Note: Full integration tests require actual network connections
// These tests focus on configuration and property handling

describe('TcpReceiver', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const receiver = new TcpReceiver({ name: 'Test TCP Receiver' });

      expect(receiver.getName()).toBe('Test TCP Receiver');
      expect(receiver.getTransportName()).toBe('TCP');
      expect(receiver.isRunning()).toBe(false);

      const props = receiver.getProperties();
      expect(props.serverMode).toBe(ServerMode.SERVER);
      expect(props.host).toBe('0.0.0.0');
      expect(props.port).toBe(6661);
      expect(props.transmissionMode).toBe(TransmissionMode.MLLP);
    });

    it('should create with custom values', () => {
      const receiver = new TcpReceiver({
        name: 'Custom TCP Receiver',
        properties: {
          host: '127.0.0.1',
          port: 8080,
          transmissionMode: TransmissionMode.RAW,
          maxConnections: 20,
        },
      });

      const props = receiver.getProperties();
      expect(props.host).toBe('127.0.0.1');
      expect(props.port).toBe(8080);
      expect(props.transmissionMode).toBe(TransmissionMode.RAW);
      expect(props.maxConnections).toBe(20);
    });
  });

  describe('properties', () => {
    let receiver: TcpReceiver;

    beforeEach(() => {
      receiver = new TcpReceiver({});
    });

    it('should get default properties', () => {
      const props = receiver.getProperties();

      expect(props.serverMode).toBe(ServerMode.SERVER);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.keepConnectionOpen).toBe(true);
      expect(props.responseMode).toBe(ResponseMode.AUTO);
      expect(props.dataType).toBe('HL7V2');
    });

    it('should update properties', () => {
      receiver.setProperties({
        port: 9999,
        transmissionMode: TransmissionMode.FRAME,
        responseMode: ResponseMode.NONE,
      });

      const props = receiver.getProperties();
      expect(props.port).toBe(9999);
      expect(props.transmissionMode).toBe(TransmissionMode.FRAME);
      expect(props.responseMode).toBe(ResponseMode.NONE);
    });
  });

  describe('lifecycle', () => {
    let receiver: TcpReceiver;

    beforeEach(() => {
      receiver = new TcpReceiver({
        name: 'Test Receiver',
      });
    });

    afterEach(async () => {
      await receiver.stop();
    });

    it('should be stopped initially', () => {
      expect(receiver.isRunning()).toBe(false);
    });

    it('should not fail when stopping a stopped receiver', async () => {
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });

    it('should track connection count', () => {
      expect(receiver.getConnectionCount()).toBe(0);
    });
  });

  describe('server mode configuration', () => {
    it('should configure server mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          serverMode: ServerMode.SERVER,
          host: '0.0.0.0',
          port: 6661,
        },
      });

      const props = receiver.getProperties();
      expect(props.serverMode).toBe(ServerMode.SERVER);
    });

    it('should configure client mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          serverMode: ServerMode.CLIENT,
          host: 'remotehost.example.com',
          port: 6661,
        },
      });

      const props = receiver.getProperties();
      expect(props.serverMode).toBe(ServerMode.CLIENT);
      expect(props.host).toBe('remotehost.example.com');
    });
  });

  describe('transmission mode configuration', () => {
    it('should configure MLLP mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          transmissionMode: TransmissionMode.MLLP,
        },
      });

      const props = receiver.getProperties();
      expect(props.transmissionMode).toBe(TransmissionMode.MLLP);
      expect(props.startOfMessageBytes).toContain(0x0b);
      expect(props.endOfMessageBytes).toContain(0x1c);
    });

    it('should configure custom frame mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          transmissionMode: TransmissionMode.FRAME,
          startOfMessageBytes: [0x02],
          endOfMessageBytes: [0x03],
        },
      });

      const props = receiver.getProperties();
      expect(props.transmissionMode).toBe(TransmissionMode.FRAME);
      expect(props.startOfMessageBytes).toEqual([0x02]);
      expect(props.endOfMessageBytes).toEqual([0x03]);
    });

    it('should configure raw mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          transmissionMode: TransmissionMode.RAW,
        },
      });

      expect(receiver.getProperties().transmissionMode).toBe(
        TransmissionMode.RAW
      );
    });
  });

  describe('response mode configuration', () => {
    it('should configure auto response mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          responseMode: ResponseMode.AUTO,
        },
      });

      expect(receiver.getProperties().responseMode).toBe(ResponseMode.AUTO);
    });

    it('should configure destination response mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          responseMode: ResponseMode.DESTINATION,
        },
      });

      expect(receiver.getProperties().responseMode).toBe(ResponseMode.DESTINATION);
    });

    it('should configure no response mode', () => {
      const receiver = new TcpReceiver({
        properties: {
          responseMode: ResponseMode.NONE,
        },
      });

      expect(receiver.getProperties().responseMode).toBe(ResponseMode.NONE);
    });
  });

  describe('timeout configuration', () => {
    it('should configure receive timeout', () => {
      const receiver = new TcpReceiver({
        properties: {
          receiveTimeout: 30000,
        },
      });

      expect(receiver.getProperties().receiveTimeout).toBe(30000);
    });

    it('should configure zero timeout (no timeout)', () => {
      const receiver = new TcpReceiver({
        properties: {
          receiveTimeout: 0,
        },
      });

      expect(receiver.getProperties().receiveTimeout).toBe(0);
    });
  });

  describe('connection configuration', () => {
    it('should configure max connections', () => {
      const receiver = new TcpReceiver({
        properties: {
          maxConnections: 50,
        },
      });

      expect(receiver.getProperties().maxConnections).toBe(50);
    });

    it('should configure keep connection open', () => {
      const receiver = new TcpReceiver({
        properties: {
          keepConnectionOpen: false,
        },
      });

      expect(receiver.getProperties().keepConnectionOpen).toBe(false);
    });

    it('should configure reconnect interval', () => {
      const receiver = new TcpReceiver({
        properties: {
          reconnectInterval: 10000,
        },
      });

      expect(receiver.getProperties().reconnectInterval).toBe(10000);
    });
  });

  describe('encoding configuration', () => {
    it('should configure charset encoding', () => {
      const receiver = new TcpReceiver({
        properties: {
          charsetEncoding: 'ISO-8859-1',
        },
      });

      expect(receiver.getProperties().charsetEncoding).toBe('ISO-8859-1');
    });
  });

  describe('buffer configuration', () => {
    it('should configure buffer size', () => {
      const receiver = new TcpReceiver({
        properties: {
          bufferSize: 131072,
        },
      });

      expect(receiver.getProperties().bufferSize).toBe(131072);
    });
  });

  describe('getListenerInfo', () => {
    it('should return null when not running', () => {
      const receiver = new TcpReceiver({
        name: 'Test Receiver',
        properties: {
          port: 6661,
        },
      });

      expect(receiver.getListenerInfo()).toBeNull();
    });

    it('should return null for client mode (non-listener)', () => {
      const receiver = new TcpReceiver({
        name: 'Client Mode Receiver',
        properties: {
          serverMode: ServerMode.CLIENT,
          host: 'remotehost.example.com',
          port: 6661,
        },
      });

      // Even if it's "running" conceptually, client mode isn't a listener
      expect(receiver.getListenerInfo()).toBeNull();
    });

    it('should return listener info with MLLP transport type when running in server mode', async () => {
      const receiver = new TcpReceiver({
        name: 'MLLP Receiver',
        properties: {
          serverMode: ServerMode.SERVER,
          host: '0.0.0.0',
          port: 16661, // Use high port to avoid conflicts
          transmissionMode: TransmissionMode.MLLP,
          maxConnections: 10,
        },
      });

      await receiver.start();

      try {
        const info = receiver.getListenerInfo();
        expect(info).not.toBeNull();
        expect(info!.port).toBe(16661);
        expect(info!.host).toBe('0.0.0.0');
        expect(info!.connectionCount).toBe(0);
        expect(info!.maxConnections).toBe(10);
        expect(info!.transportType).toBe('MLLP');
        expect(info!.listening).toBe(true);
      } finally {
        await receiver.stop();
      }
    });

    it('should return TCP transport type for RAW mode', async () => {
      const receiver = new TcpReceiver({
        name: 'TCP Receiver',
        properties: {
          serverMode: ServerMode.SERVER,
          port: 16662, // Use high port to avoid conflicts
          transmissionMode: TransmissionMode.RAW,
        },
      });

      await receiver.start();

      try {
        const info = receiver.getListenerInfo();
        expect(info).not.toBeNull();
        expect(info!.transportType).toBe('TCP');
      } finally {
        await receiver.stop();
      }
    });
  });
});
