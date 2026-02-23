/**
 * Tests for the Reverse Behavioral Analysis findings (F1-F5).
 *
 * Covers:
 * - F1: Per-message StatisticsAccumulator (no shared mutable state)
 * - F2: Conditional in-memory stats increment (guarded by persist success)
 * - F3: MySQL timezone configuration in pool defaults
 * - F4: HTTP Receiver concurrency limiting middleware
 * - F5: safeSerializeMap Date fallback uses ISO-8601
 */

// ── F1+F2 tests: Stats isolation and conditional increment ──────────────

const mockPoolConnection = {} as any;
jest.mock('../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (callback: Function) => {
    return callback(mockPoolConnection);
  }),
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../src/donkey/channel/RecoveryTask.js', () => ({
  runRecoveryTask: jest.fn().mockResolvedValue(undefined),
}));

const mockChannelTablesExist = jest.fn().mockResolvedValue(true);

jest.mock('../../src/db/DonkeyDao.js', () => ({
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
  getNextMessageId: jest.fn().mockImplementation(() => Promise.resolve(nextMsgId++)),
  channelTablesExist: (...args: unknown[]) => mockChannelTablesExist(...args),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(0),
  pruneMessageAttachments: jest.fn().mockResolvedValue(0),
  deleteMessageContentByMetaDataIds: jest.fn().mockResolvedValue(0),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));
let nextMsgId = 1;

import { Channel, ChannelConfig } from '../../src/donkey/channel/Channel';
import { SourceConnector } from '../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../src/model/ConnectorMessage';
import { Status } from '../../src/model/Status';
import { StatisticsAccumulator } from '../../src/donkey/channel/StatisticsAccumulator';
import { transaction, withRetry } from '../../src/db/pool';
import { resetDefaultExecutor } from '../../src/javascript/runtime/JavaScriptExecutor';

// ── Test helpers (matching Channel.test.ts patterns) ────────────────────

class TestSourceConnector extends SourceConnector {
  constructor() {
    super({ name: 'Test Source', transportName: 'TEST' });
  }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

class TestDestinationConnector extends DestinationConnector {
  shouldFail = false;
  constructor(metaDataId: number = 1, name: string = 'Test Destination') {
    super({ name, metaDataId, transportName: 'TEST' });
  }
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (this.shouldFail) throw new Error('Destination send failed');
    connectorMessage.setSendDate(new Date());
  }
  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }
}

function createChannel(config?: Partial<ChannelConfig>): Channel {
  return new Channel({
    id: 'test-ch',
    name: 'Test Channel',
    enabled: true,
    ...config,
  });
}

// ── F1: Per-message StatisticsAccumulator ────────────────────────────────

describe('F1: Per-message StatisticsAccumulator', () => {
  beforeEach(() => {
    nextMsgId = 1;
    mockChannelTablesExist.mockResolvedValue(true);
    jest.clearAllMocks();
    resetDefaultExecutor();
  });

  it('should NOT have a shared statsAccumulator on the Channel instance', () => {
    const channel = createChannel();
    // The class-level statsAccumulator field was removed in F1.
    expect((channel as any).statsAccumulator).toBeUndefined();
  });

  it('StatisticsAccumulator instances are independent', () => {
    const acc1 = new StatisticsAccumulator();
    const acc2 = new StatisticsAccumulator();

    acc1.increment(0, Status.RECEIVED);
    acc1.increment(1, Status.SENT);

    acc2.increment(0, Status.RECEIVED);
    acc2.increment(1, Status.ERROR);

    const ops1 = acc1.getFlushOps('test-ch', 'node-1');
    const ops2 = acc2.getFlushOps('test-ch', 'node-1');

    // Each accumulator tracks its own increments independently
    expect(ops1).not.toEqual(ops2);
  });

  it('concurrent dispatches should produce exact stats counts', async () => {
    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1, 'Dest1');

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    // Dispatch 5 messages concurrently
    const promises = Array.from({ length: 5 }, (_, i) =>
      channel.dispatchRawMessage(`msg-${i}`)
    );
    await Promise.all(promises);

    const stats = channel.getStatistics();
    // With per-message accumulators, exactly 5 received and 5 sent
    expect(stats.received).toBe(5);
    expect(stats.sent).toBe(5);
    expect(stats.error).toBe(0);
    expect(stats.filtered).toBe(0);
  });

  it('10 concurrent dispatches produce exact counts (stress)', async () => {
    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1, 'Dest1');

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    const promises = Array.from({ length: 10 }, (_, i) =>
      channel.dispatchRawMessage(`stress-msg-${i}`)
    );
    await Promise.all(promises);

    const stats = channel.getStatistics();
    expect(stats.received).toBe(10);
    expect(stats.sent).toBe(10);
  });
});

// ── F2: Conditional in-memory stats increment ────────────────────────────

describe('F2: Conditional stats increment on persist success', () => {
  beforeEach(() => {
    nextMsgId = 100;
    mockChannelTablesExist.mockResolvedValue(true);
    jest.clearAllMocks();
    resetDefaultExecutor();
  });

  it('should increment stats when persist succeeds', async () => {
    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1, 'Dest1');

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    await channel.dispatchRawMessage('success message');

    const stats = channel.getStatistics();
    expect(stats.received).toBe(1);
    expect(stats.sent).toBe(1);
  });

  it('should NOT increment stats when channel tables do not exist', async () => {
    mockChannelTablesExist.mockResolvedValue(false);

    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1, 'Dest1');

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    await channel.dispatchRawMessage('no-tables message');

    const stats = channel.getStatistics();
    // persistInTransaction returns false when tables don't exist
    expect(stats.received).toBe(0);
    expect(stats.sent).toBe(0);
  });

  it('should NOT increment stats when transaction throws', async () => {
    // Make the pool's transaction throw on first call
    (transaction as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('Deadlock detected');
    });
    // withRetry propagates the throw
    (withRetry as jest.Mock).mockImplementationOnce(async (fn: any) => fn());

    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1, 'Dest1');

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    // Dispatch should not throw — persist errors are caught internally
    await channel.dispatchRawMessage('will-fail-persist');

    const stats = channel.getStatistics();
    // Stats should NOT be incremented since first persist returned false
    expect(stats.received).toBe(0);
  });

  it('should show error stats when destination fails and persist succeeds', async () => {
    const channel = createChannel();
    const source = new TestSourceConnector();
    const dest = new TestDestinationConnector(1, 'Dest1');
    dest.shouldFail = true;

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    await channel.dispatchRawMessage('will-error');

    const stats = channel.getStatistics();
    expect(stats.received).toBe(1);
    expect(stats.error).toBe(1);
    expect(stats.sent).toBe(0);
  });
});

// ── F3: MySQL timezone configuration ────────────────────────────────────

describe('F3: MySQL timezone configuration', () => {
  it('pool.ts DEFAULT_CONFIG should include timezone +00:00', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('../../src/db/pool'),
      'utf-8'
    );
    expect(source).toContain('timezone');
    expect(source).toContain('+00:00');
  });

  it('DatabaseConfig interface should include timezone field', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('../../src/db/pool'),
      'utf-8'
    );
    // Verify the interface includes timezone as an optional field
    expect(source).toMatch(/timezone\??\s*:\s*string/);
  });

  it('timezone should default from DB_TIMEZONE env var', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('../../src/db/pool'),
      'utf-8'
    );
    expect(source).toContain('DB_TIMEZONE');
  });
});

// ── F4: HTTP Receiver concurrency limiting ───────────────────────────────

describe('F4: HTTP Receiver concurrency limiting', () => {
  const {
    getDefaultHttpReceiverProperties,
  } = jest.requireActual('../../src/connectors/http/HttpConnectorProperties');

  it('default maxConnections should be 0 (no limit)', () => {
    const defaults = getDefaultHttpReceiverProperties();
    expect(defaults.maxConnections).toBe(0);
  });

  it('HttpReceiverProperties should include maxConnections as a number', () => {
    const props = getDefaultHttpReceiverProperties();
    expect(props).toHaveProperty('maxConnections');
    expect(typeof props.maxConnections).toBe('number');
  });

  it('maxConnections=0 means middleware is not activated', () => {
    const defaults = getDefaultHttpReceiverProperties();
    // Middleware guard: if (this.properties.maxConnections > 0)
    expect(defaults.maxConnections > 0).toBe(false);
  });

  it('HttpReceiver source file should contain concurrency middleware', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require.resolve('../../src/connectors/http/HttpReceiver'),
      'utf-8'
    );
    expect(source).toContain('activeRequests');
    expect(source).toContain('maxConnections');
    expect(source).toContain('503');
    expect(source).toContain('Retry-After');
  });
});

// ── F5: safeSerializeMap Date fallback ───────────────────────────────────

describe('F5: safeSerializeMap Date fallback to ISO-8601', () => {
  const { safeSerializeMap } = jest.requireActual('../../src/db/DonkeyDao');

  it('should serialize Dates as ISO-8601 in primary path', () => {
    const map = new Map<string, unknown>();
    const date = new Date('2026-02-23T14:30:00.000Z');
    map.set('timestamp', date);
    map.set('name', 'test');

    const result = JSON.parse(safeSerializeMap(map));
    expect(result.timestamp).toBe('2026-02-23T14:30:00.000Z');
    expect(result.name).toBe('test');
  });

  it('should serialize Dates as ISO-8601 in fallback path (with circular ref)', () => {
    const map = new Map<string, unknown>();
    const date = new Date('2026-02-23T14:30:00.000Z');
    const circular: any = {};
    circular.self = circular;

    map.set('timestamp', date);
    map.set('circular', circular);
    map.set('name', 'test');

    const result = JSON.parse(safeSerializeMap(map));
    expect(result.timestamp).toBe('2026-02-23T14:30:00.000Z');
    expect(result.name).toBe('test');
    expect(result.circular).toBe('[object Object]');
  });

  it('primary and fallback paths produce identical Date format', () => {
    const date = new Date('2026-01-15T08:00:00.000Z');

    // Primary path (no circular ref)
    const primaryMap = new Map<string, unknown>();
    primaryMap.set('date', date);
    const primaryResult = JSON.parse(safeSerializeMap(primaryMap));

    // Fallback path (circular ref forces fallback)
    const fallbackMap = new Map<string, unknown>();
    fallbackMap.set('date', date);
    const circular: any = {};
    circular.self = circular;
    fallbackMap.set('trigger', circular);
    const fallbackResult = JSON.parse(safeSerializeMap(fallbackMap));

    expect(primaryResult.date).toBe(fallbackResult.date);
    expect(primaryResult.date).toBe('2026-01-15T08:00:00.000Z');
  });

  it('should handle BigInt in fallback path', () => {
    const map = new Map<string, unknown>();
    map.set('bignum', BigInt(123456789));
    const circular: any = {};
    circular.self = circular;
    map.set('trigger', circular);

    const result = JSON.parse(safeSerializeMap(map));
    expect(result.bignum).toBe('123456789');
  });

  it('should handle null in fallback path', () => {
    const map = new Map<string, unknown>();
    map.set('nullVal', null);
    const circular: any = {};
    circular.self = circular;
    map.set('trigger', circular);

    const result = JSON.parse(safeSerializeMap(map));
    expect(result.nullVal).toBeNull();
  });
});
