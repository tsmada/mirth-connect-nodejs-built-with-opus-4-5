import { TcpDispatcher } from '../../../../src/connectors/tcp/TcpDispatcher';
import { TransmissionMode } from '../../../../src/connectors/tcp/TcpConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Note: Full integration tests require actual network connections
// These tests focus on configuration and property handling

describe('TcpDispatcher', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const dispatcher = new TcpDispatcher({
        name: 'Test TCP Dispatcher',
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('Test TCP Dispatcher');
      expect(dispatcher.getMetaDataId()).toBe(1);
      expect(dispatcher.getTransportName()).toBe('TCP');
      expect(dispatcher.isRunning()).toBe(false);

      const props = dispatcher.getProperties();
      expect(props.host).toBe('127.0.0.1');
      expect(props.port).toBe(6660);
      expect(props.transmissionMode).toBe(TransmissionMode.MLLP);
    });

    it('should create with custom values', () => {
      const dispatcher = new TcpDispatcher({
        name: 'Custom TCP Dispatcher',
        metaDataId: 2,
        properties: {
          host: 'hl7server.example.com',
          port: 6662,
          transmissionMode: TransmissionMode.RAW,
          sendTimeout: 30000,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('hl7server.example.com');
      expect(props.port).toBe(6662);
      expect(props.transmissionMode).toBe(TransmissionMode.RAW);
      expect(props.sendTimeout).toBe(30000);
    });
  });

  describe('properties', () => {
    let dispatcher: TcpDispatcher;

    beforeEach(() => {
      dispatcher = new TcpDispatcher({ metaDataId: 1 });
    });

    it('should get default properties', () => {
      const props = dispatcher.getProperties();

      expect(props.host).toBe('127.0.0.1');
      expect(props.port).toBe(6660);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.keepConnectionOpen).toBe(false);
      expect(props.sendTimeout).toBe(5000);
      expect(props.responseTimeout).toBe(5000);
      expect(props.dataType).toBe('HL7V2');
    });

    it('should update properties', () => {
      dispatcher.setProperties({
        host: 'newhost',
        port: 9999,
        sendTimeout: 60000,
      });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('newhost');
      expect(props.port).toBe(9999);
      expect(props.sendTimeout).toBe(60000);
    });
  });

  describe('lifecycle', () => {
    let dispatcher: TcpDispatcher;

    beforeEach(() => {
      dispatcher = new TcpDispatcher({
        metaDataId: 1,
      });
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should be stopped initially', () => {
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should not fail when stopping a stopped dispatcher', async () => {
      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should not be connected initially', () => {
      expect(dispatcher.isConnected()).toBe(false);
    });
  });

  describe('transmission mode configuration', () => {
    it('should configure MLLP mode', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          transmissionMode: TransmissionMode.MLLP,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.transmissionMode).toBe(TransmissionMode.MLLP);
      expect(props.startOfMessageBytes).toContain(0x0b);
      expect(props.endOfMessageBytes).toContain(0x1c);
    });

    it('should configure custom frame mode', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          transmissionMode: TransmissionMode.FRAME,
          startOfMessageBytes: [0x02],
          endOfMessageBytes: [0x03],
        },
      });

      const props = dispatcher.getProperties();
      expect(props.transmissionMode).toBe(TransmissionMode.FRAME);
      expect(props.startOfMessageBytes).toEqual([0x02]);
      expect(props.endOfMessageBytes).toEqual([0x03]);
    });

    it('should configure raw mode', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          transmissionMode: TransmissionMode.RAW,
        },
      });

      expect(dispatcher.getProperties().transmissionMode).toBe(
        TransmissionMode.RAW
      );
    });
  });

  describe('timeout configuration', () => {
    it('should configure send timeout', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          sendTimeout: 30000,
        },
      });

      expect(dispatcher.getProperties().sendTimeout).toBe(30000);
    });

    it('should configure response timeout', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          responseTimeout: 60000,
        },
      });

      expect(dispatcher.getProperties().responseTimeout).toBe(60000);
    });

    it('should configure socket timeout', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          socketTimeout: 45000,
        },
      });

      expect(dispatcher.getProperties().socketTimeout).toBe(45000);
    });
  });

  describe('connection configuration', () => {
    it('should configure keep connection open', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          keepConnectionOpen: false,
        },
      });

      expect(dispatcher.getProperties().keepConnectionOpen).toBe(false);
    });

    it('should configure local address binding', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          localAddress: '192.168.1.100',
          localPort: 5000,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.localAddress).toBe('192.168.1.100');
      expect(props.localPort).toBe(5000);
    });
  });

  describe('template configuration', () => {
    it('should configure message template', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          template: 'MSH|^~\\&|${sourceSystem}||${destSystem}||${timestamp}||ADT^A01|${controlId}|P|2.5\r',
        },
      });

      expect(dispatcher.getProperties().template).toContain('MSH|^~\\&|');
    });
  });

  describe('encoding configuration', () => {
    it('should configure charset encoding', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          charsetEncoding: 'ISO-8859-1',
        },
      });

      expect(dispatcher.getProperties().charsetEncoding).toBe('ISO-8859-1');
    });
  });

  describe('buffer configuration', () => {
    it('should configure buffer size', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        properties: {
          bufferSize: 131072,
        },
      });

      expect(dispatcher.getProperties().bufferSize).toBe(131072);
    });
  });

  describe('destination connector options', () => {
    it('should configure queue settings', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        queueEnabled: true,
        queueSendFirst: true,
        retryCount: 5,
        retryIntervalMillis: 15000,
      });

      expect(dispatcher.isQueueEnabled()).toBe(true);
    });

    it('should configure enabled state', () => {
      const dispatcher = new TcpDispatcher({
        metaDataId: 1,
        enabled: false,
      });

      expect(dispatcher.isEnabled()).toBe(false);
    });
  });
});
