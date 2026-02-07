import { VmReceiver, VmConnectionStatus, ConnectionStatusListener } from '../../../../src/connectors/vm/VmReceiver';
import { RawMessage } from '../../../../src/model/RawMessage';
import { Channel } from '../../../../src/donkey/channel/Channel';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Mock channel for testing
class MockChannel extends Channel {
  public dispatchedMessages: { rawData: string; sourceMap?: Map<string, unknown> }[] = [];

  constructor() {
    super({
      id: 'test-channel-id',
      name: 'Test Channel',
      enabled: true,
    });
  }

  async dispatchRawMessage(rawData: string, sourceMap?: Map<string, unknown>): Promise<any> {
    this.dispatchedMessages.push({ rawData, sourceMap });
    return {} as any;
  }
}

describe('VmReceiver', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const receiver = new VmReceiver();

      expect(receiver.getName()).toBe('Channel Reader');
      expect(receiver.getTransportName()).toBe('VM');
      expect(receiver.isRunning()).toBe(false);
    });

    it('should create with custom name', () => {
      const receiver = new VmReceiver({ name: 'Custom VM Reader' });

      expect(receiver.getName()).toBe('Custom VM Reader');
    });

    it('should create with custom properties', () => {
      const receiver = new VmReceiver({
        properties: {
          canBatch: false,
        },
      });

      const props = receiver.getProperties();
      expect(props.canBatch).toBe(false);
    });
  });

  describe('static methods', () => {
    it('should return correct connector name', () => {
      expect(VmReceiver.getConnectorName()).toBe('Channel Reader');
    });

    it('should return correct protocol', () => {
      expect(VmReceiver.getProtocol()).toBe('VM');
    });
  });

  describe('properties', () => {
    let receiver: VmReceiver;

    beforeEach(() => {
      receiver = new VmReceiver();
    });

    it('should get default properties', () => {
      const props = receiver.getProperties();
      expect(props.canBatch).toBe(true);
    });

    it('should update properties', () => {
      receiver.setProperties({ canBatch: false });

      const props = receiver.getProperties();
      expect(props.canBatch).toBe(false);
    });
  });

  describe('lifecycle', () => {
    let receiver: VmReceiver;

    beforeEach(() => {
      receiver = new VmReceiver();
    });

    afterEach(async () => {
      await receiver.stop();
    });

    it('should be stopped initially', () => {
      expect(receiver.isRunning()).toBe(false);
    });

    it('should start successfully', async () => {
      await receiver.start();
      expect(receiver.isRunning()).toBe(true);
    });

    it('should throw when starting twice', async () => {
      await receiver.start();
      await expect(receiver.start()).rejects.toThrow('already running');
    });

    it('should stop successfully', async () => {
      await receiver.start();
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });

    it('should not fail when stopping a stopped receiver', async () => {
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });
  });

  describe('status events', () => {
    let receiver: VmReceiver;
    let statusEvents: VmConnectionStatus[];
    let listener: ConnectionStatusListener;

    beforeEach(() => {
      receiver = new VmReceiver();
      statusEvents = [];
      listener = (status) => statusEvents.push(status);
      receiver.addStatusListener(listener);
    });

    afterEach(async () => {
      await receiver.stop();
    });

    it('should emit IDLE on start', async () => {
      await receiver.start();
      expect(statusEvents).toContain(VmConnectionStatus.IDLE);
    });

    it('should emit DISCONNECTED on stop', async () => {
      await receiver.start();
      statusEvents = []; // Clear start events
      await receiver.stop();
      expect(statusEvents).toContain(VmConnectionStatus.DISCONNECTED);
    });

    it('should remove listener', async () => {
      receiver.removeStatusListener(listener);
      await receiver.start();
      expect(statusEvents).toEqual([]);
    });

    it('should handle errors in listener gracefully', async () => {
      const errorListener = () => {
        throw new Error('Listener error');
      };
      receiver.addStatusListener(errorListener);

      // Should not throw
      await receiver.start();
      expect(receiver.isRunning()).toBe(true);
    });
  });

  describe('dispatchVmMessage', () => {
    let receiver: VmReceiver;
    let channel: MockChannel;

    beforeEach(async () => {
      receiver = new VmReceiver();
      channel = new MockChannel();
      receiver.setChannel(channel);
      await receiver.start();
    });

    afterEach(async () => {
      await receiver.stop();
    });

    it('should dispatch string message to channel', async () => {
      const rawMessage = RawMessage.fromString('test message content');
      await receiver.dispatchVmMessage(rawMessage);

      expect(channel.dispatchedMessages).toHaveLength(1);
      expect(channel.dispatchedMessages[0]!.rawData).toBe('test message content');
    });

    it('should dispatch binary message to channel', async () => {
      const buffer = Buffer.from('binary content');
      const rawMessage = RawMessage.fromBytes(buffer);
      await receiver.dispatchVmMessage(rawMessage);

      expect(channel.dispatchedMessages).toHaveLength(1);
      expect(channel.dispatchedMessages[0]!.rawData).toBe('binary content');
    });

    it('should pass source map to channel', async () => {
      const rawMessage = RawMessage.fromString('message with source map');
      rawMessage.getSourceMap().set('patientId', 'P123');
      rawMessage.getSourceMap().set('visitId', 'V456');

      await receiver.dispatchVmMessage(rawMessage);

      expect(channel.dispatchedMessages).toHaveLength(1);
      const sourceMap = channel.dispatchedMessages[0]!.sourceMap;
      expect(sourceMap).toBeDefined();
      expect(sourceMap!.get('patientId')).toBe('P123');
      expect(sourceMap!.get('visitId')).toBe('V456');
    });

    it('should throw when not running', async () => {
      await receiver.stop();
      const rawMessage = RawMessage.fromString('test');

      await expect(receiver.dispatchVmMessage(rawMessage)).rejects.toThrow('not running');
    });

    it('should throw when no channel attached', async () => {
      const unattachedReceiver = new VmReceiver();
      await unattachedReceiver.start();

      const rawMessage = RawMessage.fromString('test');

      await expect(unattachedReceiver.dispatchVmMessage(rawMessage)).rejects.toThrow(
        'not attached to a channel'
      );

      await unattachedReceiver.stop();
    });

    it('should emit RECEIVING status during dispatch', async () => {
      const statusEvents: VmConnectionStatus[] = [];
      receiver.addStatusListener((status) => statusEvents.push(status));

      const rawMessage = RawMessage.fromString('test');
      await receiver.dispatchVmMessage(rawMessage);

      expect(statusEvents).toContain(VmConnectionStatus.RECEIVING);
      expect(statusEvents).toContain(VmConnectionStatus.IDLE);
    });
  });

  describe('dispatchVmBatchMessages', () => {
    let receiver: VmReceiver;
    let channel: MockChannel;

    beforeEach(async () => {
      receiver = new VmReceiver();
      channel = new MockChannel();
      receiver.setChannel(channel);
      await receiver.start();
    });

    afterEach(async () => {
      await receiver.stop();
    });

    it('should dispatch multiple messages', async () => {
      const messages = [
        RawMessage.fromString('message 1'),
        RawMessage.fromString('message 2'),
        RawMessage.fromString('message 3'),
      ];

      const result = await receiver.dispatchVmBatchMessages(messages);

      expect(result).toBe(true);
      expect(channel.dispatchedMessages).toHaveLength(3);
      expect(channel.dispatchedMessages[0]!.rawData).toBe('message 1');
      expect(channel.dispatchedMessages[1]!.rawData).toBe('message 2');
      expect(channel.dispatchedMessages[2]!.rawData).toBe('message 3');
    });

    it('should throw when batching disabled', async () => {
      receiver.setProperties({ canBatch: false });

      const messages = [RawMessage.fromString('message 1')];

      await expect(receiver.dispatchVmBatchMessages(messages)).rejects.toThrow(
        'does not support batch'
      );
    });

    it('should throw when not running', async () => {
      await receiver.stop();
      const messages = [RawMessage.fromString('message 1')];

      await expect(receiver.dispatchVmBatchMessages(messages)).rejects.toThrow('not running');
    });
  });

  describe('handleRecoveredResponse', () => {
    it('should handle recovered response without error', () => {
      const receiver = new VmReceiver();

      // Should not throw
      receiver.handleRecoveredResponse({ messageId: 123 });
    });
  });
});
