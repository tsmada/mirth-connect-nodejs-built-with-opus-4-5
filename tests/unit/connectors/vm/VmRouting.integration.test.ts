jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  getNextMessageId: jest.fn().mockImplementation(() => {
    return Promise.resolve(mockNextMessageId++);
  }),
  channelTablesExist: jest.fn().mockResolvedValue(true),
}));
let mockNextMessageId = 1;

import { Channel } from '../../../../src/donkey/channel/Channel';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { VmDispatcher, EngineController, DispatchResult } from '../../../../src/connectors/vm/VmDispatcher';
import { VmReceiver } from '../../../../src/connectors/vm/VmReceiver';
import { RawMessage } from '../../../../src/model/RawMessage';
import { Status } from '../../../../src/model/Status';
import {
  SOURCE_CHANNEL_ID,
  SOURCE_MESSAGE_ID,
} from '../../../../src/connectors/vm/VmConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import {
  channelTablesExist, getNextMessageId,
  insertMessage, insertConnectorMessage, insertContent,
  updateConnectorMessageStatus, updateMessageProcessed,
  updateStatistics,
} from '../../../../src/db/DonkeyDao';

// Simple destination connector for capturing sent messages
class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];

  constructor(metaDataId: number, name: string = 'Test Destination') {
    super({
      name,
      metaDataId,
      transportName: 'TEST',
    });
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }
}

describe('VmRouting Integration', () => {
  beforeEach(() => {
    mockNextMessageId = 1;
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (insertMessage as jest.Mock).mockResolvedValue(undefined);
    (insertConnectorMessage as jest.Mock).mockResolvedValue(undefined);
    (insertContent as jest.Mock).mockResolvedValue(undefined);
    (updateConnectorMessageStatus as jest.Mock).mockResolvedValue(undefined);
    (updateMessageProcessed as jest.Mock).mockResolvedValue(undefined);
    (updateStatistics as jest.Mock).mockResolvedValue(undefined);

    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('VmDispatcher routes message to target channel', () => {
    it('should dispatch message to target channel via engine controller', async () => {
      // Set up target channel with a VmReceiver source and test destination
      const targetChannel = new Channel({
        id: 'target-channel-id',
        name: 'Target Channel',
        enabled: true,
      });
      const targetDest = new TestDestinationConnector(1, 'Target Dest');
      const vmReceiver = new VmReceiver({ name: 'sourceConnector' });
      targetChannel.setSourceConnector(vmReceiver);
      targetChannel.addDestinationConnector(targetDest);
      await targetChannel.start();

      // Create an engine controller that dispatches to the target channel
      const engineController: EngineController = {
        async dispatchRawMessage(
          channelId: string,
          rawMessage: RawMessage,
        ): Promise<DispatchResult | null> {
          if (channelId === 'target-channel-id') {
            const message = await targetChannel.dispatchRawMessage(
              rawMessage.getRawData(),
              rawMessage.getSourceMap(),
            );
            return { messageId: message.getMessageId() };
          }
          return null;
        },
      };

      // Create source channel with VmDispatcher destination
      const sourceChannel = new Channel({
        id: 'source-channel-id',
        name: 'Source Channel',
        enabled: true,
      });
      const vmDispatcher = new VmDispatcher({
        metaDataId: 1,
        name: 'VM Writer',
        properties: {
          channelId: 'target-channel-id',
          channelTemplate: '${message.encodedData}',
        },
      });
      vmDispatcher.setEngineController(engineController);

      const sourceDest = new TestDestinationConnector(2, 'Other Dest');
      sourceChannel.setSourceConnector(new TestSourceConnector());
      sourceChannel.addDestinationConnector(vmDispatcher);
      sourceChannel.addDestinationConnector(sourceDest);
      await sourceChannel.start();

      // Dispatch a message through the source channel
      await sourceChannel.dispatchRawMessage('<test>hello</test>');

      // Verify target channel received the message
      expect(targetDest.sentMessages).toHaveLength(1);

      await sourceChannel.stop();
      await targetChannel.stop();
    });
  });

  describe('sourceMap chain tracking', () => {
    it('should propagate sourceChannelId and sourceMessageId to target', async () => {
      let capturedSourceMap: Map<string, unknown> | undefined;

      const engineController: EngineController = {
        async dispatchRawMessage(
          _channelId: string,
          rawMessage: RawMessage,
        ): Promise<DispatchResult | null> {
          capturedSourceMap = rawMessage.getSourceMap();
          return { messageId: 99 };
        },
      };

      const vmDispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: { channelId: 'downstream-channel' },
      });
      vmDispatcher.setEngineController(engineController);

      const channel = new Channel({
        id: 'upstream-channel',
        name: 'Upstream',
        enabled: true,
      });
      channel.setSourceConnector(new TestSourceConnector());
      channel.addDestinationConnector(vmDispatcher);
      await channel.start();

      await channel.dispatchRawMessage('<hl7>data</hl7>');

      expect(capturedSourceMap).toBeDefined();
      expect(capturedSourceMap!.get(SOURCE_CHANNEL_ID)).toBe('upstream-channel');
      expect(capturedSourceMap!.get(SOURCE_MESSAGE_ID)).toBe(1);

      await channel.stop();
    });
  });

  describe('error when target channel is not deployed', () => {
    it('should set error on connector message when engine controller throws', async () => {
      const engineController: EngineController = {
        async dispatchRawMessage(): Promise<DispatchResult | null> {
          throw new Error('Channel not deployed: missing-channel');
        },
      };

      const vmDispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: { channelId: 'missing-channel' },
      });
      vmDispatcher.setEngineController(engineController);

      const channel = new Channel({
        id: 'source-channel',
        name: 'Source',
        enabled: true,
      });
      channel.setSourceConnector(new TestSourceConnector());
      channel.addDestinationConnector(vmDispatcher);
      await channel.start();

      const message = await channel.dispatchRawMessage('<test/>');

      // The VmDispatcher catches errors and sets them on the connector message
      const destMsg = message.getConnectorMessage(1);
      expect(destMsg?.getProcessingError()).toContain('Channel not deployed');

      await channel.stop();
    });
  });

  describe('VmReceiver dispatches to attached channel', () => {
    it('should dispatch a message to the channel pipeline', async () => {
      const channel = new Channel({
        id: 'receiver-channel',
        name: 'Receiver Channel',
        enabled: true,
      });
      const dest = new TestDestinationConnector(1);
      const vmReceiver = new VmReceiver();

      channel.setSourceConnector(vmReceiver);
      channel.addDestinationConnector(dest);
      await channel.start();

      // Dispatch via VmReceiver (simulating what VmDispatcher would do)
      const rawMessage = RawMessage.fromString('<routed>message</routed>');
      rawMessage.getSourceMap().set(SOURCE_CHANNEL_ID, 'upstream-id');
      rawMessage.getSourceMap().set(SOURCE_MESSAGE_ID, 42);

      await vmReceiver.dispatchVmMessage(rawMessage);

      expect(dest.sentMessages).toHaveLength(1);

      await channel.stop();
    });
  });

  describe('response from target channel returned to source', () => {
    it('should pass response back through engine controller', async () => {
      const engineController: EngineController = {
        async dispatchRawMessage(): Promise<DispatchResult | null> {
          return {
            messageId: 50,
            selectedResponse: {
              message: '<ack>OK</ack>',
              status: Status.SENT,
            },
          };
        },
      };

      const vmDispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: { channelId: 'target' },
      });
      vmDispatcher.setEngineController(engineController);

      const channel = new Channel({
        id: 'src-channel',
        name: 'Source',
        enabled: true,
      });
      channel.setSourceConnector(new TestSourceConnector());
      channel.addDestinationConnector(vmDispatcher);
      await channel.start();

      const message = await channel.dispatchRawMessage('<test/>');

      // The dispatch should complete successfully with SENT status on the destination
      const destMsg = message.getConnectorMessage(1);
      expect(destMsg?.getStatus()).toBe(Status.SENT);

      await channel.stop();
    });
  });
});

// Helper: simple source connector for testing
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';

class TestSourceConnector extends SourceConnector {
  constructor() {
    super({ name: 'Test Source', transportName: 'TEST' });
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
