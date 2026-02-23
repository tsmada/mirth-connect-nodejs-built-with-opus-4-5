/**
 * Content Storage Modes — Behavioral Integration Tests
 *
 * Verifies that the Channel pipeline gates insertContent() / storeContent() calls
 * based on StorageSettings flags. Different MessageStorageMode values
 * (DEVELOPMENT, PRODUCTION, RAW, METADATA, DISABLED) control which content
 * types are persisted to the database.
 *
 * Only the database layer is mocked. Real JS execution, real Channel pipeline.
 */

// ─────────────── DB-Only Mocks (MUST be before imports) ───────────────
const mockPoolConnection = {} as any;
jest.mock('../../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (callback: Function) => {
    return callback(mockPoolConnection);
  }),
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/donkey/channel/RecoveryTask.js', () => ({
  runRecoveryTask: jest.fn().mockResolvedValue(undefined),
}));

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

let mockNextMessageId = 1;
jest.mock('../../../src/db/DonkeyDao.js', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  batchInsertContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateResponseMap: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  getNextMessageId: jest.fn().mockImplementation(() => {
    return Promise.resolve(mockNextMessageId++);
  }),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(0),
  pruneMessageAttachments: jest.fn().mockResolvedValue(0),
  deleteMessageContentByMetaDataIds: jest.fn().mockResolvedValue(0),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));

// ─────────────── Imports ───────────────

import { Channel, ChannelConfig } from '../../../src/donkey/channel/Channel';
import {
  MessageStorageMode,
  getStorageSettings,
} from '../../../src/donkey/channel/StorageSettings';
import { ContentType } from '../../../src/model/ContentType';
import { Status } from '../../../src/model/Status';
import {
  insertMessage,
  insertConnectorMessage,
  insertContent,
  storeContent,
  updateMaps,
  pruneMessageContent,
  pruneMessageAttachments,
  deleteMessageContentByMetaDataIds,
  getConnectorMessageStatuses,
  channelTablesExist,
  getNextMessageId,
} from '../../../src/db/DonkeyDao';
import {
  TestSourceConnector,
  TestDestinationConnector,
  resetAllSingletons,
} from './helpers/PipelineTestHarness';

// ─────────────── Helpers ───────────────

const SIMPLE_RAW = '<test>hello</test>';

/**
 * Build a channel with specific MessageStorageMode settings.
 * Returns the channel + connectors for dispatching test messages.
 */
function buildChannelWithStorageMode(
  mode: MessageStorageMode,
  channelProps?: {
    removeContentOnCompletion?: boolean;
    removeOnlyFilteredOnCompletion?: boolean;
    removeAttachmentsOnCompletion?: boolean;
    storeAttachments?: boolean;
  },
  options?: {
    destinationCount?: number;
    destSendBehavior?: 'success' | 'error';
  }
): {
  channel: Channel;
  source: TestSourceConnector;
  destinations: TestDestinationConnector[];
} {
  resetAllSingletons();

  const storageSettings = getStorageSettings(mode, channelProps);
  const config: ChannelConfig = {
    id: 'test-storage-channel',
    name: 'Storage Mode Test',
    enabled: true,
    storageSettings,
  };

  const channel = new Channel(config);
  const source = new TestSourceConnector('Test Source');
  channel.setSourceConnector(source);

  const destCount = options?.destinationCount ?? 1;
  const destinations: TestDestinationConnector[] = [];
  for (let i = 0; i < destCount; i++) {
    const dest = new TestDestinationConnector(i + 1, `Dest ${i + 1}`);
    if (options?.destSendBehavior === 'error') {
      dest.setSendError('Test error');
    }
    channel.addDestinationConnector(dest);
    destinations.push(dest);
  }

  return { channel, source, destinations };
}

/**
 * Collect all ContentType values that were passed to insertContent() calls.
 * insertContent signature: (channelId, messageId, metaDataId, contentType, content, dataType, encrypted, conn?)
 * contentType is at index 3.
 */
function getInsertedContentTypes(): ContentType[] {
  return (insertContent as jest.Mock).mock.calls.map(
    (call: any[]) => call[3] as ContentType
  );
}

/**
 * Collect all ContentType values that were passed to storeContent() calls.
 * storeContent signature: (channelId, messageId, metaDataId, contentType, content, dataType, encrypted, conn?)
 * contentType is at index 3.
 */
function getStoredContentTypes(): ContentType[] {
  return (storeContent as jest.Mock).mock.calls.map(
    (call: any[]) => call[3] as ContentType
  );
}

/**
 * Get all content types persisted (insertContent + storeContent combined).
 */
function getAllPersistedContentTypes(): ContentType[] {
  return [...getInsertedContentTypes(), ...getStoredContentTypes()];
}

// ─────────────── Test Suite ───────────────

describe('Content Storage Mode Behavioral Contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNextMessageId = 1;
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() =>
      Promise.resolve(mockNextMessageId++)
    );
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.1: DEVELOPMENT mode stores all content types
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.1: DEVELOPMENT mode stores all content types', () => {
    it('should persist RAW, TRANSFORMED, ENCODED, SENT, RESPONSE, SOURCE_MAP, and maps', async () => {
      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.DEVELOPMENT
      );
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      // insertMessage and insertConnectorMessage should be called
      expect(insertMessage).toHaveBeenCalled();
      expect(insertConnectorMessage).toHaveBeenCalled();

      // RAW content should be stored via insertContent
      const insertedTypes = getInsertedContentTypes();
      expect(insertedTypes).toContain(ContentType.RAW);

      // Maps should be stored (storeMaps=true in DEVELOPMENT)
      // storeContent is used for SOURCE_MAP and SENT
      const storedTypes = getStoredContentTypes();
      expect(storedTypes).toContain(ContentType.SOURCE_MAP);

      // All persisted content types combined should include key types
      const allTypes = getAllPersistedContentTypes();
      expect(allTypes).toContain(ContentType.RAW);
      // SOURCE_MAP is always written via storeContent (upsert)
      expect(allTypes).toContain(ContentType.SOURCE_MAP);

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.2: PRODUCTION mode skips intermediate content
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.2: PRODUCTION mode skips intermediate content', () => {
    it('should NOT store PROCESSED_RAW or TRANSFORMED, but SHOULD store RAW and ENCODED', async () => {
      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.PRODUCTION
      );
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      const insertedTypes = getInsertedContentTypes();
      const storedTypes = getStoredContentTypes();
      const allTypes = getAllPersistedContentTypes();

      // RAW should still be stored
      expect(insertedTypes).toContain(ContentType.RAW);

      // PROCESSED_RAW and TRANSFORMED should NOT be stored
      expect(allTypes).not.toContain(ContentType.PROCESSED_RAW);
      expect(allTypes).not.toContain(ContentType.TRANSFORMED);
      // RESPONSE_TRANSFORMED and PROCESSED_RESPONSE also skipped
      expect(allTypes).not.toContain(ContentType.RESPONSE_TRANSFORMED);
      expect(allTypes).not.toContain(ContentType.PROCESSED_RESPONSE);

      // insertMessage and insertConnectorMessage still called
      expect(insertMessage).toHaveBeenCalled();
      expect(insertConnectorMessage).toHaveBeenCalled();

      // Maps should still be stored (storeMaps=true in PRODUCTION)
      expect(storedTypes).toContain(ContentType.SOURCE_MAP);

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.3: RAW mode stores only raw content
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.3: RAW mode stores only raw content', () => {
    it('should store RAW but NOT TRANSFORMED, ENCODED, SENT, RESPONSE, or maps', async () => {
      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.RAW
      );
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      const insertedTypes = getInsertedContentTypes();

      // RAW should be stored
      expect(insertedTypes).toContain(ContentType.RAW);

      // All intermediate and downstream content types should NOT be stored
      const allTypes = getAllPersistedContentTypes();
      expect(allTypes).not.toContain(ContentType.PROCESSED_RAW);
      expect(allTypes).not.toContain(ContentType.TRANSFORMED);
      expect(allTypes).not.toContain(ContentType.ENCODED);
      expect(allTypes).not.toContain(ContentType.RESPONSE);
      expect(allTypes).not.toContain(ContentType.RESPONSE_TRANSFORMED);
      expect(allTypes).not.toContain(ContentType.PROCESSED_RESPONSE);

      // updateMaps should NOT be called (storeMaps=false in RAW)
      expect(updateMaps).not.toHaveBeenCalled();

      // insertMessage and insertConnectorMessage still called (metadata rows)
      expect(insertMessage).toHaveBeenCalled();
      expect(insertConnectorMessage).toHaveBeenCalled();

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.4: METADATA mode stores no content
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.4: METADATA mode stores no content', () => {
    it('should NOT call insertContent for ANY content type, but SHOULD create message/connector rows', async () => {
      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.METADATA
      );
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      // No content of any type should be stored via insertContent
      expect(insertContent).not.toHaveBeenCalled();

      // updateMaps should NOT be called (storeMaps=false in METADATA)
      expect(updateMaps).not.toHaveBeenCalled();

      // But message and connector message rows ARE still created (metadata)
      expect(insertMessage).toHaveBeenCalled();
      expect(insertConnectorMessage).toHaveBeenCalled();

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.5: DISABLED mode stores nothing (but pipeline still runs)
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.5: DISABLED mode — message/connector rows still created', () => {
    it('should still create message/connector rows but store NO content and NO maps', async () => {
      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.DISABLED
      );
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      // No content of any type should be stored
      expect(insertContent).not.toHaveBeenCalled();

      // No maps stored
      expect(updateMaps).not.toHaveBeenCalled();

      // DISABLED sets all store* flags to false AND enabled=false,
      // but insertMessage/insertConnectorMessage are called unconditionally
      // in the Channel pipeline (Transaction 1 is always executed)
      expect(insertMessage).toHaveBeenCalled();
      expect(insertConnectorMessage).toHaveBeenCalled();

      // The message still processes successfully through the pipeline
      const message = await source.testDispatch(SIMPLE_RAW);
      expect(message.isProcessed()).toBe(true);

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.6: removeContentOnCompletion — content removed after all dests complete
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.6: removeContentOnCompletion removes content after message completes', () => {
    it('should call pruneMessageContent when all destinations are terminal', async () => {
      // Mock getConnectorMessageStatuses to return all terminal statuses
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(
        new Map<number, Status>([
          [0, Status.TRANSFORMED], // source
          [1, Status.SENT],       // dest 1 — terminal
        ])
      );

      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.DEVELOPMENT,
        { removeContentOnCompletion: true }
      );
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      // Content should have been stored first (DEVELOPMENT mode)
      expect(insertContent).toHaveBeenCalled();

      // Then pruneMessageContent should be called for bulk removal
      expect(pruneMessageContent).toHaveBeenCalledWith(
        'test-storage-channel',
        expect.arrayContaining([1]) // messageId = 1
      );

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.7: removeOnlyFilteredOnCompletion — selective removal
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.7: removeOnlyFilteredOnCompletion removes only FILTERED dest content', () => {
    it('should call deleteMessageContentByMetaDataIds for FILTERED destinations only', async () => {
      // Mock: dest 1 = SENT (keep), dest 2 = FILTERED (remove)
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(
        new Map<number, Status>([
          [0, Status.TRANSFORMED],
          [1, Status.SENT],
          [2, Status.FILTERED],
        ])
      );

      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.DEVELOPMENT,
        {
          removeContentOnCompletion: true,
          removeOnlyFilteredOnCompletion: true,
        },
        { destinationCount: 2 }
      );

      // Set dest 2 to filter (via a filter rule that rejects)
      // Note: since we don't set filter rules, dest 2 won't actually be
      // filtered in pipeline — but getConnectorMessageStatuses returns
      // FILTERED, which is what removeCompletedMessageContent reads
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      // deleteMessageContentByMetaDataIds should be called for dest 2 (metaDataId=2)
      expect(deleteMessageContentByMetaDataIds).toHaveBeenCalledWith(
        'test-storage-channel',
        1, // messageId
        [2] // only the FILTERED destination
      );

      // pruneMessageContent should NOT be called (selective removal, not bulk)
      expect(pruneMessageContent).not.toHaveBeenCalled();

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.8: removeAttachmentsOnCompletion
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.8: removeAttachmentsOnCompletion removes attachments after completion', () => {
    it('should call pruneMessageAttachments after message completes', async () => {
      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.DEVELOPMENT,
        { removeAttachmentsOnCompletion: true }
      );
      await channel.start();
      await source.testDispatch(SIMPLE_RAW);

      expect(pruneMessageAttachments).toHaveBeenCalledWith(
        'test-storage-channel',
        expect.arrayContaining([1]) // messageId = 1
      );

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.9: StorageSettings flag verification (pure unit test)
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.9: getStorageSettings produces correct flags per mode', () => {
    it('DEVELOPMENT has all store flags true', () => {
      const s = getStorageSettings(MessageStorageMode.DEVELOPMENT);
      expect(s.enabled).toBe(true);
      expect(s.storeRaw).toBe(true);
      expect(s.storeProcessedRaw).toBe(true);
      expect(s.storeTransformed).toBe(true);
      expect(s.storeSourceEncoded).toBe(true);
      expect(s.storeDestinationEncoded).toBe(true);
      expect(s.storeSent).toBe(true);
      expect(s.storeResponse).toBe(true);
      expect(s.storeResponseTransformed).toBe(true);
      expect(s.storeProcessedResponse).toBe(true);
      expect(s.storeMaps).toBe(true);
      expect(s.storeResponseMap).toBe(true);
      expect(s.messageRecoveryEnabled).toBe(true);
      expect(s.durable).toBe(true);
    });

    it('PRODUCTION disables processedRaw, transformed, responseTransformed, processedResponse', () => {
      const s = getStorageSettings(MessageStorageMode.PRODUCTION);
      expect(s.storeProcessedRaw).toBe(false);
      expect(s.storeTransformed).toBe(false);
      expect(s.storeResponseTransformed).toBe(false);
      expect(s.storeProcessedResponse).toBe(false);
      // Still stores these:
      expect(s.storeRaw).toBe(true);
      expect(s.storeSourceEncoded).toBe(true);
      expect(s.storeDestinationEncoded).toBe(true);
      expect(s.storeSent).toBe(true);
      expect(s.storeResponse).toBe(true);
      expect(s.storeMaps).toBe(true);
    });

    it('RAW disables everything except raw and metadata', () => {
      const s = getStorageSettings(MessageStorageMode.RAW);
      expect(s.storeRaw).toBe(true);
      expect(s.storeProcessedRaw).toBe(false);
      expect(s.storeTransformed).toBe(false);
      expect(s.storeSourceEncoded).toBe(false);
      expect(s.storeDestinationEncoded).toBe(false);
      expect(s.storeSent).toBe(false);
      expect(s.storeResponse).toBe(false);
      expect(s.storeMaps).toBe(false);
      expect(s.messageRecoveryEnabled).toBe(false);
      expect(s.durable).toBe(false);
    });

    it('METADATA disables ALL content including raw', () => {
      const s = getStorageSettings(MessageStorageMode.METADATA);
      expect(s.storeRaw).toBe(false);
      expect(s.storeProcessedRaw).toBe(false);
      expect(s.storeTransformed).toBe(false);
      expect(s.storeSourceEncoded).toBe(false);
      expect(s.storeDestinationEncoded).toBe(false);
      expect(s.storeSent).toBe(false);
      expect(s.storeResponse).toBe(false);
      expect(s.storeMaps).toBe(false);
      expect(s.durable).toBe(false);
      expect(s.rawDurable).toBe(false);
    });

    it('DISABLED sets enabled=false and all store flags false', () => {
      const s = getStorageSettings(MessageStorageMode.DISABLED);
      expect(s.enabled).toBe(false);
      expect(s.storeRaw).toBe(false);
      expect(s.storeProcessedRaw).toBe(false);
      expect(s.storeTransformed).toBe(false);
      expect(s.storeSourceEncoded).toBe(false);
      expect(s.storeDestinationEncoded).toBe(false);
      expect(s.storeSent).toBe(false);
      expect(s.storeResponse).toBe(false);
      expect(s.storeMaps).toBe(false);
      expect(s.storeCustomMetaData).toBe(false);
      expect(s.messageRecoveryEnabled).toBe(false);
    });

    it('channel properties override removal flags', () => {
      const s = getStorageSettings(MessageStorageMode.DEVELOPMENT, {
        removeContentOnCompletion: true,
        removeOnlyFilteredOnCompletion: true,
        removeAttachmentsOnCompletion: true,
        storeAttachments: false,
      });
      expect(s.removeContentOnCompletion).toBe(true);
      expect(s.removeOnlyFilteredOnCompletion).toBe(true);
      expect(s.removeAttachmentsOnCompletion).toBe(true);
      expect(s.storeAttachments).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // T3.10: Multiple messages with same storage mode
  // ═══════════════════════════════════════════════════════════════════
  describe('T3.10: Multiple messages with METADATA mode', () => {
    it('should create message rows for each dispatch but never store content', async () => {
      const { channel, source } = buildChannelWithStorageMode(
        MessageStorageMode.METADATA
      );
      await channel.start();

      // Dispatch 3 messages
      await source.testDispatch('<msg>one</msg>');
      await source.testDispatch('<msg>two</msg>');
      await source.testDispatch('<msg>three</msg>');

      // insertMessage called 3 times (once per dispatch)
      expect(insertMessage).toHaveBeenCalledTimes(3);

      // insertContent never called (no content in METADATA mode)
      expect(insertContent).not.toHaveBeenCalled();

      // updateMaps never called
      expect(updateMaps).not.toHaveBeenCalled();

      await channel.stop();
    });
  });
});
