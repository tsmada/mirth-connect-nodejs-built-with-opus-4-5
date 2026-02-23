/**
 * Pause/Resume + Queue Lifecycle Behavioral Contracts
 *
 * Tests the Channel state machine (STARTED/PAUSED/STOPPED) and queue-enabled
 * destination behavior. Uses the same DB-only mock pattern as PipelineLifecycle.test.ts:
 * real V8 VM execution for scripts, only DonkeyDao/pool/RecoveryTask mocked.
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

// ─────────────── Imports ───────────────

import { Channel, ChannelConfig } from '../../../src/donkey/channel/Channel';
import { DeployedState } from '../../../src/api/models/DashboardStatus';
import { Status } from '../../../src/model/Status';
import { GlobalMap } from '../../../src/javascript/userutil/MirthMap';
import {
  updateConnectorMessageStatus,
  channelTablesExist,
  getNextMessageId,
} from '../../../src/db/DonkeyDao';
import {
  TestSourceConnector,
  TestDestinationConnector,
  resetAllSingletons,
} from './helpers/PipelineTestHarness';

// ─────────────── Helpers ───────────────

function buildChannel(opts: {
  undeployScript?: string;
} = {}): { channel: Channel; source: TestSourceConnector; dest: TestDestinationConnector } {
  resetAllSingletons();
  const config: ChannelConfig = {
    id: 'test-pause-channel',
    name: 'Pause Test',
    enabled: true,
    undeployScript: opts.undeployScript,
  };
  const channel = new Channel(config);
  const source = new TestSourceConnector('Test Source');
  const dest = new TestDestinationConnector(1, 'Dest 1');
  channel.setSourceConnector(source);
  channel.addDestinationConnector(dest);
  return { channel, source, dest };
}

const SIMPLE_MSG = '<root><name>test</name><value>42</value></root>';

// ─────────────── Test Suite ───────────────

describe('Pause/Resume + Queue Lifecycle Behavioral Contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNextMessageId = 1;
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() =>
      Promise.resolve(mockNextMessageId++)
    );
  });

  // ═══════════════════════════════════════════════════════
  // Pause Behavior
  // ═══════════════════════════════════════════════════════

  describe('Pause behavior', () => {
    it('T4.1: pause stops the source connector and transitions to PAUSED', async () => {
      const { channel, source } = buildChannel();

      await channel.start();
      expect(source.started).toBe(true);
      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

      await channel.pause();
      expect(source.started).toBe(false);
      expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

      // Cleanup
      await channel.halt();
    });

    it('T4.2: pause preserves channel state — resume allows continued processing', async () => {
      const { channel, source } = buildChannel();

      await channel.start();

      // Dispatch first message before pause
      const msg1 = await source.testDispatch(SIMPLE_MSG);
      expect(msg1.isProcessed()).toBe(true);

      // Pause and resume
      await channel.pause();
      expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

      await channel.resume();
      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

      // Dispatch second message after resume
      const msg2 = await source.testDispatch(SIMPLE_MSG);
      expect(msg2.isProcessed()).toBe(true);

      // Both messages processed successfully
      expect(msg1.getConnectorMessage(1)!.getStatus()).toBe(Status.SENT);
      expect(msg2.getConnectorMessage(1)!.getStatus()).toBe(Status.SENT);

      await channel.stop();
    });

    it('T4.3: pause leaves destinations running', async () => {
      const { channel, dest } = buildChannel();

      await channel.start();
      expect(dest.isRunning()).toBe(true);

      await channel.pause();
      // Destinations should still be running in PAUSED state
      expect(dest.isRunning()).toBe(true);
      expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

      await channel.halt();
    });

    it('T4.4: cannot pause from STOPPED — throws error', async () => {
      const { channel } = buildChannel();
      // Channel is in STOPPED state (never started)
      expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);

      await expect(channel.pause()).rejects.toThrow('Cannot pause');
    });

    it('T4.5: pause from already-PAUSED is idempotent (no error)', async () => {
      const { channel } = buildChannel();

      await channel.start();
      await channel.pause();
      expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

      // Second pause should not throw — just logs warning and returns
      await expect(channel.pause()).resolves.toBeUndefined();
      expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

      await channel.halt();
    });
  });

  // ═══════════════════════════════════════════════════════
  // Resume Behavior
  // ═══════════════════════════════════════════════════════

  describe('Resume behavior', () => {
    it('T4.6: resume from PAUSED transitions to STARTED and restarts source', async () => {
      const { channel, source } = buildChannel();

      await channel.start();
      await channel.pause();
      expect(source.started).toBe(false);
      expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

      await channel.resume();
      expect(source.started).toBe(true);
      expect(source.isRunning()).toBe(true);
      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

      await channel.stop();
    });

    it('T4.7: cannot resume from STARTED — throws error', async () => {
      const { channel } = buildChannel();

      await channel.start();
      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

      await expect(channel.resume()).rejects.toThrow('Cannot resume');

      await channel.stop();
    });

    it('T4.8: resume allows message dispatch after pause', async () => {
      const { channel, source, dest } = buildChannel();

      await channel.start();
      await channel.pause();
      await channel.resume();

      // Should be able to dispatch a message after resume
      const message = await source.testDispatch(SIMPLE_MSG);
      expect(message.isProcessed()).toBe(true);
      expect(message.getConnectorMessage(1)!.getStatus()).toBe(Status.SENT);
      expect(dest.sentMessages.length).toBe(1);

      await channel.stop();
    });
  });

  // ═══════════════════════════════════════════════════════
  // Halt Behavior
  // ═══════════════════════════════════════════════════════

  describe('Halt behavior', () => {
    it('T4.9: halt() stops channel WITHOUT running undeploy script', async () => {
      const UNDEPLOY_SCRIPT = `globalMap.put('undeployed', 'yes');`;
      const { channel } = buildChannel({ undeployScript: UNDEPLOY_SCRIPT });

      await channel.start();
      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

      await channel.halt();
      expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);

      // halt() does NOT execute the undeploy script
      expect(GlobalMap.getInstance().get('undeployed')).toBeUndefined();
    });

    it('T4.10: halt() from PAUSED transitions to STOPPED', async () => {
      const { channel } = buildChannel();

      await channel.start();
      await channel.pause();
      expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

      await channel.halt();
      expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
    });

    it('T4.11: stop() runs undeploy script, halt() does not — behavioral difference', async () => {
      const UNDEPLOY_SCRIPT = `globalMap.put('undeployed', 'yes');`;

      // --- Channel A: stopped normally (undeploy SHOULD run) ---
      const a = buildChannel({ undeployScript: UNDEPLOY_SCRIPT });
      await a.channel.start();
      await a.channel.stop();
      expect(GlobalMap.getInstance().get('undeployed')).toBe('yes');

      // --- Channel B: halted (undeploy should NOT run) ---
      const b = buildChannel({ undeployScript: UNDEPLOY_SCRIPT });
      await b.channel.start();
      await b.channel.halt();
      // resetAllSingletons was called in buildChannel, so GlobalMap is fresh
      expect(GlobalMap.getInstance().get('undeployed')).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════
  // Queue Lifecycle
  // ═══════════════════════════════════════════════════════

  describe('Queue lifecycle', () => {
    it('T4.12: queue-enabled destination + send error → QUEUED status (not ERROR)', async () => {
      resetAllSingletons();
      const config: ChannelConfig = {
        id: 'test-queue-channel',
        name: 'Queue Test',
        enabled: true,
      };
      const channel = new Channel(config);
      const source = new TestSourceConnector('Test Source');
      const dest = new TestDestinationConnector(1, 'Dest 1');

      // Configure destination to fail and have queue enabled
      dest.setSendError('ECONNREFUSED');
      dest.enableQueue();

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      await channel.start();

      const message = await source.testDispatch(SIMPLE_MSG);

      // Destination should be QUEUED (not ERROR) because queue is enabled
      const destMsg = message.getConnectorMessage(1)!;
      expect(destMsg.getStatus()).toBe(Status.QUEUED);

      // DB should record QUEUED status
      expect(updateConnectorMessageStatus).toHaveBeenCalledWith(
        expect.anything(), // channelId
        expect.anything(), // messageId
        1,                 // metaDataId (dest 1)
        Status.QUEUED,
        expect.anything()  // conn
      );

      // Message should still complete processing
      expect(message.isProcessed()).toBe(true);

      await channel.halt();
    });
  });
});
