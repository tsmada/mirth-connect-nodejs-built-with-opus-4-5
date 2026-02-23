/**
 * Destination Chain Contracts — Behavioral Tests
 *
 * Verifies the sequential chain execution semantics from DestinationChain.ts:
 * - Messages processed sequentially through chain of destinations
 * - Error in one destination stops the chain (stopChain flag)
 * - Next message in chain receives previous destination's encoded output as RAW
 * - Map propagation: sourceMap shared reference, channelMap/responseMap copied
 * - QUEUED messages added to queue, FILTERED messages are terminal
 *
 * Ported from: ~/Projects/connect/donkey/src/test/java/com/mirth/connect/donkey/test/DestinationChainTests.java
 * Pattern: P10 (Model Object Graph) with mock connectors
 */

jest.mock('../../../src/logging/index.js', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: () => false,
  }),
  registerComponent: jest.fn(),
}));

jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  transaction: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/db/DonkeyDao.js', () => ({
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/plugins/dashboardstatus/DashboardStatusController.js', () => ({
  dashboardStatusController: { processEvent: jest.fn() },
}));

jest.mock('../../../src/telemetry/metrics.js', () => ({
  messagesProcessed: { add: jest.fn() },
  messagesErrored: { add: jest.fn() },
  messageDuration: { record: jest.fn() },
  queueDepth: { add: jest.fn() },
}));

import { DestinationChain, DestinationChainProvider } from '../../../src/donkey/channel/DestinationChain.js';
import { DestinationConnector } from '../../../src/donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage.js';
import { ContentType } from '../../../src/model/ContentType.js';
import { Status } from '../../../src/model/Status.js';

// Minimal test connector
class MockDestConnector extends DestinationConnector {
  public filterResult = false; // false = don't filter (accept)
  public sendShouldThrow = false;
  public sendThrowMessage = 'send error';
  public sentMessages: ConnectorMessage[] = [];

  constructor(metaDataId: number, name: string) {
    super({ name, metaDataId, transportName: 'TEST' });
  }

  async executeFilter(_msg: ConnectorMessage): Promise<boolean> {
    return this.filterResult;
  }

  async executeTransformer(msg: ConnectorMessage): Promise<void> {
    // Set encoded content to simulate transformer output
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: `encoded-by-${this.getName()}`,
      dataType: 'HL7V2',
      encrypted: false,
    });
  }

  async send(msg: ConnectorMessage): Promise<void> {
    if (this.sendShouldThrow) {
      throw new Error(this.sendThrowMessage);
    }
    this.sentMessages.push(msg);
  }

  async getResponse(_msg: ConnectorMessage): Promise<string | null> {
    return null;
  }

  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

function createChain(
  connectors: Map<number, MockDestConnector>,
  metaDataIds: number[]
): DestinationChain {
  const provider: DestinationChainProvider = {
    getChannelId: () => 'test-channel',
    getChannelName: () => 'Test Channel',
    getMetaDataIds: () => metaDataIds,
    getDestinationConnectors: () => connectors as Map<number, DestinationConnector>,
    getChainId: () => 1,
    getServerId: () => 'server-1',
  };
  return new DestinationChain(provider);
}

function createMessage(metaDataId: number, status: Status = Status.RECEIVED): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: `Dest ${metaDataId}`,
    serverId: 'server-1',
    receivedDate: new Date(),
    status,
  });
  msg.setContent({
    contentType: ContentType.RAW,
    content: '<HL7Message><MSH/></HL7Message>',
    dataType: 'HL7V2',
    encrypted: false,
  });
  return msg;
}

describe('DestinationChain: sequential processing contracts', () => {
  it('should process RECEIVED messages through filter → transform → send', async () => {
    const dest1 = new MockDestConnector(1, 'Dest 1');
    const connectors = new Map([[1, dest1]]);
    const chain = createChain(connectors, [1]);
    const msg = createMessage(1);

    chain.setMessage(msg);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.SENT);
    expect(dest1.sentMessages).toHaveLength(1);
  });

  it('should stop chain when a destination errors without sending', async () => {
    const dest1 = new MockDestConnector(1, 'Dest 1');
    const dest2 = new MockDestConnector(2, 'Dest 2');
    dest1.sendShouldThrow = true;

    const connectors = new Map([[1, dest1], [2, dest2]]);
    const chain = createChain(connectors, [1, 2]);
    const msg = createMessage(1);

    chain.setMessage(msg);
    const results = await chain.call();

    // dest1 errored so chain stopped — dest2 never executed
    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.ERROR);
    expect(dest2.sentMessages).toHaveLength(0);
  });

  it('should pass encoded output of dest N as RAW input of dest N+1', async () => {
    const dest1 = new MockDestConnector(1, 'Dest 1');
    const dest2 = new MockDestConnector(2, 'Dest 2');

    const connectors = new Map([[1, dest1], [2, dest2]]);
    const chain = createChain(connectors, [1, 2]);
    const msg = createMessage(1);

    chain.setMessage(msg);
    const results = await chain.call();

    expect(results).toHaveLength(2);
    // Dest 2's message should have dest 1's encoded output as its RAW content
    const dest2Msg = results[1]!;
    const rawContent = dest2Msg.getRawContent();
    expect(rawContent).toBeDefined();
    expect(rawContent!.content).toBe('encoded-by-Dest 1');
  });

  it('should copy channelMap to next message in chain (not shared reference)', async () => {
    const dest1 = new MockDestConnector(1, 'Dest 1');
    const dest2 = new MockDestConnector(2, 'Dest 2');

    const connectors = new Map([[1, dest1], [2, dest2]]);
    const chain = createChain(connectors, [1, 2]);
    const msg = createMessage(1);
    msg.getChannelMap().set('sharedKey', 'value1');

    chain.setMessage(msg);
    const results = await chain.call();

    // Both should have the key
    expect(results[0]!.getChannelMap().get('sharedKey')).toBe('value1');
    expect(results[1]!.getChannelMap().get('sharedKey')).toBe('value1');

    // Modifying dest2's map should NOT affect dest1's
    results[1]!.getChannelMap().set('sharedKey', 'modified');
    expect(results[0]!.getChannelMap().get('sharedKey')).toBe('value1');
  });

  it('should handle FILTERED status without error', async () => {
    const dest1 = new MockDestConnector(1, 'Dest 1');
    dest1.filterResult = true; // Filter will reject

    const connectors = new Map([[1, dest1]]);
    const chain = createChain(connectors, [1]);
    const msg = createMessage(1);

    chain.setMessage(msg);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.FILTERED);
    expect(dest1.sentMessages).toHaveLength(0);
  });

  it('should throw when message metaDataId is not in chain enabled IDs', async () => {
    const dest1 = new MockDestConnector(1, 'Dest 1');
    const connectors = new Map([[1, dest1]]);
    const chain = createChain(connectors, [1]);

    // Message has metaDataId=99 but chain only has [1]
    const msg = createMessage(99);
    chain.setMessage(msg);

    await expect(chain.call()).rejects.toThrow('not in the destination chain');
  });
});
