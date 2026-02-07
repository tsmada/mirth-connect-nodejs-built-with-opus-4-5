import { SimpleLineBatchAdaptor } from '../../../../src/donkey/message/SimpleLineBatchAdaptor';
import { HL7BatchAdaptor } from '../../../../src/donkey/message/HL7BatchAdaptor';
import { SourceConnector, SourceConnectorConfig } from '../../../../src/donkey/channel/SourceConnector';
import { Channel } from '../../../../src/donkey/channel/Channel';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Concrete SourceConnector for testing dispatchBatchMessage
class TestSourceConnector extends SourceConnector {
  constructor(config?: Partial<SourceConnectorConfig>) {
    super({
      name: config?.name ?? 'Test Source',
      transportName: config?.transportName ?? 'TEST',
    });
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  // Expose protected method
  async testDispatchBatch(
    rawData: string,
    batchAdaptor: { getMessage(): Promise<string | null>; getBatchSequenceId(): number; isBatchComplete(): boolean; cleanup(): void },
    sourceMap?: Map<string, unknown>
  ): Promise<void> {
    return this.dispatchBatchMessage(rawData, batchAdaptor, sourceMap);
  }
}

describe('SimpleLineBatchAdaptor', () => {
  it('should split on newlines by default', async () => {
    const adaptor = new SimpleLineBatchAdaptor('msg1\nmsg2\nmsg3');

    const messages: string[] = [];
    while (!adaptor.isBatchComplete()) {
      const msg = await adaptor.getMessage();
      if (msg === null) break;
      messages.push(msg);
    }

    expect(messages).toEqual(['msg1', 'msg2', 'msg3']);
  });

  it('should split on custom delimiter', async () => {
    const adaptor = new SimpleLineBatchAdaptor('a|b|c', '|');

    const messages: string[] = [];
    while (!adaptor.isBatchComplete()) {
      const msg = await adaptor.getMessage();
      if (msg === null) break;
      messages.push(msg);
    }

    expect(messages).toEqual(['a', 'b', 'c']);
  });

  it('should handle empty input', async () => {
    const adaptor = new SimpleLineBatchAdaptor('');

    expect(adaptor.isBatchComplete()).toBe(true);
    const msg = await adaptor.getMessage();
    expect(msg).toBeNull();
  });

  it('should handle single message (no delimiter)', async () => {
    const adaptor = new SimpleLineBatchAdaptor('single message');

    expect(adaptor.isBatchComplete()).toBe(false);
    const msg = await adaptor.getMessage();
    expect(msg).toBe('single message');
    expect(adaptor.isBatchComplete()).toBe(true);
  });

  it('should filter empty lines', async () => {
    const adaptor = new SimpleLineBatchAdaptor('msg1\n\nmsg2\n\n\nmsg3');

    const messages: string[] = [];
    while (!adaptor.isBatchComplete()) {
      const msg = await adaptor.getMessage();
      if (msg === null) break;
      messages.push(msg);
    }

    expect(messages).toEqual(['msg1', 'msg2', 'msg3']);
  });

  it('should increment getBatchSequenceId correctly', async () => {
    const adaptor = new SimpleLineBatchAdaptor('a\nb\nc');

    expect(adaptor.getBatchSequenceId()).toBe(0); // Before any getMessage()

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(2);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(3);
  });

  it('should report isBatchComplete correctly', async () => {
    const adaptor = new SimpleLineBatchAdaptor('a\nb');

    expect(adaptor.isBatchComplete()).toBe(false);
    await adaptor.getMessage();
    expect(adaptor.isBatchComplete()).toBe(false);
    await adaptor.getMessage();
    expect(adaptor.isBatchComplete()).toBe(true);
  });
});

describe('HL7BatchAdaptor', () => {
  it('should split batch with 3 MSH messages', async () => {
    const batch = [
      'MSH|^~\\&|SendApp|SendFac|RecApp|RecFac|202301010000||ADT^A01|MSG001|P|2.3',
      'PID|||12345||Doe^John',
      'MSH|^~\\&|SendApp|SendFac|RecApp|RecFac|202301010001||ADT^A02|MSG002|P|2.3',
      'PID|||67890||Smith^Jane',
      'MSH|^~\\&|SendApp|SendFac|RecApp|RecFac|202301010002||ADT^A03|MSG003|P|2.3',
      'PID|||11111||Brown^Bob',
    ].join('\n');

    const adaptor = new HL7BatchAdaptor(batch);

    const messages: string[] = [];
    while (!adaptor.isBatchComplete()) {
      const msg = await adaptor.getMessage();
      if (msg === null) break;
      messages.push(msg);
    }

    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('MSG001');
    expect(messages[0]).toContain('Doe^John');
    expect(messages[1]).toContain('MSG002');
    expect(messages[1]).toContain('Smith^Jane');
    expect(messages[2]).toContain('MSG003');
    expect(messages[2]).toContain('Brown^Bob');
  });

  it('should return single MSH message as one message', async () => {
    const single = 'MSH|^~\\&|App|Fac|||202301010000||ADT^A01|MSG001|P|2.3\nPID|||12345||Doe^John';
    const adaptor = new HL7BatchAdaptor(single);

    const msg = await adaptor.getMessage();
    expect(msg).toContain('MSG001');
    expect(msg).toContain('Doe^John');

    expect(adaptor.isBatchComplete()).toBe(true);
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should skip FHS/BHS/BTS/FTS batch envelope segments', async () => {
    const batch = [
      'FHS|^~\\&|BatchApp|BatchFac',
      'BHS|^~\\&|BatchApp|BatchFac',
      'MSH|^~\\&|App|Fac|||202301010000||ADT^A01|MSG001|P|2.3',
      'PID|||12345||Doe^John',
      'MSH|^~\\&|App|Fac|||202301010001||ADT^A02|MSG002|P|2.3',
      'PID|||67890||Smith^Jane',
      'BTS|2',
      'FTS|1',
    ].join('\n');

    const adaptor = new HL7BatchAdaptor(batch);

    const messages: string[] = [];
    while (!adaptor.isBatchComplete()) {
      const msg = await adaptor.getMessage();
      if (msg === null) break;
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    // Ensure envelope segments are not in the output
    for (const msg of messages) {
      expect(msg).not.toContain('FHS');
      expect(msg).not.toContain('BHS');
      expect(msg).not.toContain('BTS');
      expect(msg).not.toContain('FTS');
    }
  });

  it('should use \\r as line separator in output', async () => {
    const batch = 'MSH|^~\\&|App|Fac|||202301010000||ADT^A01|MSG001|P|2.3\nPID|||12345||Doe^John\nPV1||I';
    const adaptor = new HL7BatchAdaptor(batch);

    const msg = await adaptor.getMessage();
    expect(msg).toBeDefined();
    // Should contain \r between segments, not \n
    const segments = msg!.split('\r');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatch(/^MSH/);
    expect(segments[1]).toMatch(/^PID/);
    expect(segments[2]).toMatch(/^PV1/);
  });

  it('should handle empty input', async () => {
    const adaptor = new HL7BatchAdaptor('');
    expect(adaptor.isBatchComplete()).toBe(true);
    expect(await adaptor.getMessage()).toBeNull();
  });
});

describe('SourceConnector.dispatchBatchMessage', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  it('should dispatch each sub-message through channel', async () => {
    const connector = new TestSourceConnector();
    const channel = new Channel({
      id: 'test-channel',
      name: 'Test Channel',
      enabled: true,
    });
    connector.setChannel(channel);

    // Spy on channel.dispatchRawMessage
    const dispatched: Array<{ rawData: string; sourceMap?: Map<string, unknown> }> = [];
    const originalDispatch = channel.dispatchRawMessage.bind(channel);
    channel.dispatchRawMessage = jest.fn(async (rawData: string, sourceMap?: Map<string, unknown>) => {
      dispatched.push({ rawData, sourceMap });
      // Return a dummy message to satisfy the return type
      return originalDispatch(rawData, sourceMap);
    });

    const adaptor = new SimpleLineBatchAdaptor('msg1\nmsg2\nmsg3');
    await connector.testDispatchBatch('msg1\nmsg2\nmsg3', adaptor);

    expect(channel.dispatchRawMessage).toHaveBeenCalledTimes(3);
    expect(dispatched[0]?.rawData).toBe('msg1');
    expect(dispatched[1]?.rawData).toBe('msg2');
    expect(dispatched[2]?.rawData).toBe('msg3');
  });

  it('should include batchSequenceId in sourceMap', async () => {
    const connector = new TestSourceConnector();
    const channel = new Channel({
      id: 'test-channel',
      name: 'Test Channel',
      enabled: true,
    });
    connector.setChannel(channel);

    const capturedMaps: Map<string, unknown>[] = [];
    channel.dispatchRawMessage = jest.fn(async (_rawData: string, sourceMap?: Map<string, unknown>) => {
      if (sourceMap) capturedMaps.push(new Map(sourceMap));
      return {} as any;
    });

    const adaptor = new SimpleLineBatchAdaptor('a\nb');
    const baseMap = new Map<string, unknown>([['customKey', 'customValue']]);
    await connector.testDispatchBatch('a\nb', adaptor, baseMap);

    expect(capturedMaps).toHaveLength(2);
    // First message
    expect(capturedMaps[0]?.get('batchSequenceId')).toBe(1);
    expect(capturedMaps[0]?.get('batchComplete')).toBe(false);
    expect(capturedMaps[0]?.get('customKey')).toBe('customValue');
    // Second message
    expect(capturedMaps[1]?.get('batchSequenceId')).toBe(2);
    expect(capturedMaps[1]?.get('batchComplete')).toBe(true);
    expect(capturedMaps[1]?.get('customKey')).toBe('customValue');
  });

  it('should call cleanup after processing', async () => {
    const connector = new TestSourceConnector();
    const channel = new Channel({
      id: 'test-channel',
      name: 'Test Channel',
      enabled: true,
    });
    connector.setChannel(channel);

    channel.dispatchRawMessage = jest.fn(async () => ({} as any));

    const adaptor = new SimpleLineBatchAdaptor('a\nb');
    const cleanupSpy = jest.spyOn(adaptor, 'cleanup');

    await connector.testDispatchBatch('a\nb', adaptor);

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw when no channel is attached', async () => {
    const connector = new TestSourceConnector();
    const adaptor = new SimpleLineBatchAdaptor('msg1');

    await expect(
      connector.testDispatchBatch('msg1', adaptor)
    ).rejects.toThrow('Source connector is not attached to a channel');
  });
});
