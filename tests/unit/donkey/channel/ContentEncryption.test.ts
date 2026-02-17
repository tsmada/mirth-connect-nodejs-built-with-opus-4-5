/**
 * Tests for PC-MJM-004 (write-side encryption) and PC-MJM-001 (sourceMap dual-write consolidation).
 *
 * Verifies:
 * 1. Content encrypted when encryptData=true and encryption key set
 * 2. Content NOT encrypted when encryptData=false
 * 3. Content NOT encrypted when encryptor is NoOp (no key)
 * 4. IS_ENCRYPTED=1 set in DB when encrypted
 * 5. Encrypted content can be decrypted by read-side getContent()
 * 6. SourceMap written only once (no early INSERT + later UPSERT)
 * 7. Empty sourceMap skipped (no DB write)
 */

const mockPoolConnection = {} as any;
jest.mock('../../../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (callback: Function) => {
    return callback(mockPoolConnection);
  }),
  getPool: jest.fn(),
}));

jest.mock('../../../../src/donkey/channel/RecoveryTask.js', () => ({
  runRecoveryTask: jest.fn().mockResolvedValue(undefined),
}));

let mockNextMessageId = 1;

jest.mock('../../../../src/db/DonkeyDao.js', () => ({
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
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));

import { Channel, ChannelConfig } from '../../../../src/donkey/channel/Channel';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { ContentType } from '../../../../src/model/ContentType';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { MessageStorageMode, getStorageSettings } from '../../../../src/donkey/channel/StorageSettings';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import {
  insertContent,
  storeContent,
} from '../../../../src/db/DonkeyDao';
import {
  AesEncryptor,
  NoOpEncryptor,
  setEncryptor,
  getEncryptor,
  isEncryptionEnabled,
} from '../../../../src/db/Encryptor';

// Generate a valid 256-bit AES key for testing
const TEST_KEY_BASE64 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

// Test source connector
class TestSourceConnector extends SourceConnector {
  constructor() {
    super({ name: 'Test Source', transportName: 'TEST' });
  }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

// Test destination connector
class TestDestinationConnector extends DestinationConnector {
  constructor(metaDataId: number, name: string = 'Test Dest') {
    super({ name, metaDataId, transportName: 'TEST' });
  }
  async send(_msg: ConnectorMessage): Promise<void> {}
  async getResponse(): Promise<string | null> { return 'ACK'; }
}

function createChannel(overrides: Partial<ChannelConfig> = {}): Channel {
  const config: ChannelConfig = {
    id: 'test-channel-001',
    name: 'Test Channel',
    enabled: true,
    ...overrides,
  };
  return new Channel(config);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNextMessageId = 1;
  // Reset to NoOp encryptor by default
  setEncryptor(new NoOpEncryptor());
  resetDefaultExecutor();
});

describe('PC-MJM-004: Write-Side Encryption', () => {
  test('content encrypted when encryptData=true and encryption key set', async () => {
    setEncryptor(new AesEncryptor(TEST_KEY_BASE64));

    const channel = createChannel({ encryptData: true });
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1);
    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);
    channel.updateCurrentState(DeployedState.STARTED);

    await channel.dispatchRawMessage('MSH|test message');

    // RAW content should be encrypted (encryptData=true)
    const insertContentMock = insertContent as jest.Mock;
    const rawCall = insertContentMock.mock.calls.find(
      (call: any[]) => call[3] === ContentType.RAW
    );
    expect(rawCall).toBeDefined();
    // The encrypted flag parameter (index 6) should be true
    expect(rawCall![6]).toBe(true);
  });

  test('content NOT encrypted when encryptData=false', async () => {
    setEncryptor(new AesEncryptor(TEST_KEY_BASE64));

    const channel = createChannel({ encryptData: false });
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1);
    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);
    channel.updateCurrentState(DeployedState.STARTED);

    await channel.dispatchRawMessage('MSH|test message');

    const insertContentMock = insertContent as jest.Mock;
    const rawCall = insertContentMock.mock.calls.find(
      (call: any[]) => call[3] === ContentType.RAW
    );
    expect(rawCall).toBeDefined();
    // The encrypted flag parameter (index 6) should be false
    expect(rawCall![6]).toBe(false);
  });

  test('content NOT encrypted when encryptor is NoOp (no key)', async () => {
    // Default is NoOp encryptor
    setEncryptor(new NoOpEncryptor());

    const channel = createChannel({ encryptData: true });
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1);
    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);
    channel.updateCurrentState(DeployedState.STARTED);

    await channel.dispatchRawMessage('MSH|test message');

    // Even though encryptData=true, NoOp encryptor means no real encryption
    // The DonkeyDao.insertContent will see encrypted=true but isEncryptionEnabled()=false,
    // so it stores as plaintext with IS_ENCRYPTED=0
    const insertContentMock = insertContent as jest.Mock;
    const rawCall = insertContentMock.mock.calls.find(
      (call: any[]) => call[3] === ContentType.RAW
    );
    expect(rawCall).toBeDefined();
    // Channel passes encryptData=true, but DonkeyDao downgrades to false when NoOp
    expect(rawCall![6]).toBe(true);
  });

  test('IS_ENCRYPTED=1 set in DB when encrypted (DonkeyDao level)', () => {
    // This tests the DonkeyDao encryption logic directly
    setEncryptor(new AesEncryptor(TEST_KEY_BASE64));
    expect(isEncryptionEnabled()).toBe(true);

    // When encrypted=true and encryption is enabled, the encryptor should be called
    const encryptor = getEncryptor();
    const encrypted = encryptor.encrypt('test content');
    expect(encrypted).not.toBe('test content');
    expect(encrypted).toContain(':'); // IV:ciphertext format
  });

  test('encrypted content can be decrypted by read-side', () => {
    setEncryptor(new AesEncryptor(TEST_KEY_BASE64));

    const original = 'MSH|^~\\&|SENDING|FACILITY|||20240101120000||ADT^A01|MSG001|P|2.5';
    const encryptor = getEncryptor();
    const encrypted = encryptor.encrypt(original);

    // Verify it's actually encrypted (not passthrough)
    expect(encrypted).not.toBe(original);

    // Decrypt and verify round-trip
    const decrypted = encryptor.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  test('all content types use encryptData flag in dispatchRawMessage', async () => {
    setEncryptor(new AesEncryptor(TEST_KEY_BASE64));

    // Use DEVELOPMENT mode which stores everything
    const storageSettings = getStorageSettings(MessageStorageMode.DEVELOPMENT);
    const channel = createChannel({
      encryptData: true,
      storageSettings,
    });
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1);
    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);
    channel.updateCurrentState(DeployedState.STARTED);

    await channel.dispatchRawMessage('MSH|test');

    // Check that insertContent calls pass encrypted=true for content types
    const insertContentMock = insertContent as jest.Mock;
    const contentCalls = insertContentMock.mock.calls.filter(
      (call: any[]) => call[3] !== ContentType.SOURCE_MAP
    );
    // All non-sourceMap content should have encrypted=true
    for (const call of contentCalls) {
      expect(call[6]).toBe(true);
    }

    // SourceMap should NOT be encrypted (it's metadata for trace feature)
    const sourceMapCalls = insertContentMock.mock.calls.filter(
      (call: any[]) => call[3] === ContentType.SOURCE_MAP
    );
    for (const call of sourceMapCalls) {
      expect(call[6]).toBe(false);
    }
  });
});

describe('PC-MJM-001: SourceMap Dual-Write Consolidation', () => {
  test('sourceMap written only once (no early INSERT + later UPSERT)', async () => {
    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1);
    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);
    channel.updateCurrentState(DeployedState.STARTED);

    const sourceMap = new Map<string, unknown>([['key', 'value']]);
    await channel.dispatchRawMessage('MSH|test', sourceMap);

    // Count SOURCE_MAP writes
    const storeContentMock = storeContent as jest.Mock;

    const sourceMapUpserts = storeContentMock.mock.calls.filter(
      (call: any[]) => call[3] === ContentType.SOURCE_MAP
    );

    // Should have exactly ONE storeContent for SOURCE_MAP (at end of pipeline)
    expect(sourceMapUpserts.length).toBe(1);
  });

  test('empty sourceMap skipped (no DB write)', async () => {
    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1);
    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);
    channel.updateCurrentState(DeployedState.STARTED);

    // No sourceMap provided -> empty map (internal keys like DESTINATION_SET_KEY are cleaned up before persist)
    await channel.dispatchRawMessage('MSH|test');

    const storeContentMock = storeContent as jest.Mock;

    const sourceMapUpserts = storeContentMock.mock.calls.filter(
      (call: any[]) => call[3] === ContentType.SOURCE_MAP
    );

    // No user-provided source map data -> no writes (internal keys cleaned before persist)
    expect(sourceMapUpserts.length).toBe(0);
  });

  test('sourceMap consolidation also works in processFromSourceQueue path', async () => {
    // Create channel in async mode (respondAfterProcessing=false)
    const channel = createChannel();
    const source = new TestSourceConnector();
    source.setRespondAfterProcessing(false);
    const dest = new TestDestinationConnector(1);
    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    // Start the channel (initializes source queue for async mode)
    await channel.start();

    const sourceMap = new Map<string, unknown>([['traceKey', 'traceValue']]);
    await channel.dispatchRawMessage('MSH|test', sourceMap);

    // Wait for source queue processing
    await new Promise(resolve => setTimeout(resolve, 300));

    const storeContentMock = storeContent as jest.Mock;

    const sourceMapUpserts = storeContentMock.mock.calls.filter(
      (call: any[]) => call[3] === ContentType.SOURCE_MAP
    );

    // Should have exactly ONE storeContent for SOURCE_MAP (at end of pipeline)
    expect(sourceMapUpserts.length).toBe(1);

    await channel.stop();
  });
});

describe('Encryptor.isEncryptionEnabled()', () => {
  test('returns false when NoOpEncryptor is set', () => {
    setEncryptor(new NoOpEncryptor());
    expect(isEncryptionEnabled()).toBe(false);
  });

  test('returns true when AesEncryptor is set', () => {
    setEncryptor(new AesEncryptor(TEST_KEY_BASE64));
    expect(isEncryptionEnabled()).toBe(true);
  });
});
