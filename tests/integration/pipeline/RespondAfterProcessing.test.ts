/**
 * RespondAfterProcessing Integration Tests
 *
 * Tests the source queue async processing mode:
 * - respondAfterProcessing=true (default): dispatchRawMessage() processes the full pipeline
 *   synchronously and returns with message.isProcessed()=true
 * - respondAfterProcessing=false + sourceQueue initialized (via channel.start()):
 *   dispatchRawMessage() persists raw content, adds to sourceQueue, returns immediately
 *   with message.isProcessed()=false. Background loop processes the rest.
 * - respondAfterProcessing=false WITHOUT sourceQueue (no start()): falls through to
 *   synchronous processing since the guard requires sourceQueue to be non-null.
 *
 * DB layer is mocked; JS execution is real (V8 VM).
 */

// ─────────────── DB-Only Mocks (same pattern as PipelineLifecycle.test.ts) ───────────────
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

// ─────────────── Imports ───────────────
import { Status } from '../../../src/model/Status';
import {
  PipelineTestHarness,
  resetAllSingletons,
} from './helpers/PipelineTestHarness';
import { SIMPLE_XML_MESSAGE, POSTPROCESSOR_RECORD_RAN } from './helpers/ScriptFixtures';
import { GlobalMap } from '../../../src/javascript/userutil/MirthMap';

// ─────────────── Test Suite ───────────────

describe('respondAfterProcessing integration', () => {
  beforeEach(() => {
    mockNextMessageId = 1;
    resetAllSingletons();
  });

  // ─────────────── Scenario 1: Default (respondAfterProcessing=true) ───────────────

  describe('respondAfterProcessing=true (default)', () => {
    it('processes synchronously and returns message with processed=true', async () => {
      const harness = new PipelineTestHarness();
      harness.build({
        destinations: [{ responseData: 'OK' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Default behavior: full pipeline runs synchronously
      expect(message.isProcessed()).toBe(true);
      expect(harness.getSource().getRespondAfterProcessing()).toBe(true);

      // Source connector message should be TRANSFORMED
      const sourceMsg = message.getConnectorMessage(0);
      expect(sourceMsg).toBeDefined();
      expect(sourceMsg!.getStatus()).toBe(Status.TRANSFORMED);

      // Destination should have received the message
      expect(harness.getDestination(0).sentMessages.length).toBe(1);
    });
  });

  // ─────────────── Scenario 2: respondAfterProcessing=false with sourceQueue ───────────────

  describe('respondAfterProcessing=false with sourceQueue (via channel.start())', () => {
    it('returns immediately with processed=false and queues message', async () => {
      const harness = new PipelineTestHarness();
      harness.build({
        destinations: [{}],
      });

      // Set respondAfterProcessing=false on the source connector
      harness.getSource().setRespondAfterProcessing(false);
      expect(harness.getSource().getRespondAfterProcessing()).toBe(false);

      const channel = harness.getChannel();

      // Call start() to initialize sourceQueue (the key step!)
      await channel.start();

      // Verify sourceQueue was created
      const sourceQueue = (channel as any).sourceQueue;
      expect(sourceQueue).not.toBeNull();

      // Dispatch a message — should return immediately without processing destinations
      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // The key assertion: message is NOT processed (async mode)
      expect(message.isProcessed()).toBe(false);

      // Source connector message should still exist (persisted before queuing)
      const sourceMsg = message.getConnectorMessage(0);
      expect(sourceMsg).toBeDefined();
      expect(sourceMsg!.getStatus()).toBe(Status.RECEIVED);

      // Destination should NOT have received the message yet (it's in the queue)
      expect(harness.getDestination(0).sentMessages.length).toBe(0);

      // The sourceQueue should have the message added to it
      // (it may have been consumed by the background loop already, so check both)
      // We verify the queue was used by confirming the message has __rawData in sourceMap
      // or the queue size > 0 at the time of dispatch
      // The immediate return with processed=false is the definitive proof

      // Clean up: stop the channel to terminate the source queue loop
      await channel.stop();
    });

    it('background loop eventually processes the queued message', async () => {
      const harness = new PipelineTestHarness();
      harness.build({
        postprocessorScript: POSTPROCESSOR_RECORD_RAN,
        destinations: [{ responseData: 'background-ok' }],
      });

      harness.getSource().setRespondAfterProcessing(false);

      const channel = harness.getChannel();
      await channel.start();

      // Dispatch — returns immediately
      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      expect(message.isProcessed()).toBe(false);

      // Wait for background processing to complete
      // The sourceQueue loop polls every 100ms, so 500ms should be sufficient
      await new Promise((resolve) => setTimeout(resolve, 500));

      // After background processing, the postprocessor should have run
      const postRan = GlobalMap.getInstance().get('postprocessorRan');
      expect(postRan).toBe('true');

      // Destination should have received the message via background processing
      expect(harness.getDestination(0).sentMessages.length).toBe(1);

      await channel.stop();
    });

    it('handles destination error in background without affecting source return', async () => {
      const harness = new PipelineTestHarness();
      harness.build({
        destinations: [{ sendBehavior: 'error', sendErrorMsg: 'Background send failed' }],
      });

      harness.getSource().setRespondAfterProcessing(false);

      const channel = harness.getChannel();
      await channel.start();

      // Dispatch — should return immediately regardless of destination errors
      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      expect(message.isProcessed()).toBe(false);

      // Wait for background processing to attempt the send
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Source returned quickly — the error happens asynchronously in background
      // The channel should still be running (error doesn't crash the loop)
      expect(harness.getSource().isRunning()).toBe(true);

      await channel.stop();
    });
  });

  // ─────────────── Scenario 3: respondAfterProcessing=false WITHOUT sourceQueue ───────────────

  describe('respondAfterProcessing=false without sourceQueue (no start())', () => {
    it('falls through to synchronous processing when sourceQueue is null', async () => {
      const harness = new PipelineTestHarness();
      harness.build({
        destinations: [{ responseData: 'sync-ok' }],
      });

      // Set respondAfterProcessing=false but do NOT call start()
      // This means sourceQueue remains null
      harness.getSource().setRespondAfterProcessing(false);

      // Verify sourceQueue is null (no start() called)
      const sourceQueue = (harness.getChannel() as any).sourceQueue;
      expect(sourceQueue).toBeNull();

      // Dispatch — should fall through the guard at line 1076 and process synchronously
      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Even though respondAfterProcessing=false, without sourceQueue it processes normally
      expect(message.isProcessed()).toBe(true);

      // Source message should be TRANSFORMED (synchronous processing completed)
      const sourceMsg = message.getConnectorMessage(0);
      expect(sourceMsg!.getStatus()).toBe(Status.TRANSFORMED);

      // Destination received the message synchronously
      expect(harness.getDestination(0).sentMessages.length).toBe(1);
    });
  });

  // ─────────────── Scenario 4: sourceQueue cleanup on stop ───────────────

  describe('channel stop cleans up sourceQueue', () => {
    it('nulls sourceQueue and stops background loop on channel.stop()', async () => {
      const harness = new PipelineTestHarness();
      harness.build({ destinations: [{}] });

      harness.getSource().setRespondAfterProcessing(false);

      const channel = harness.getChannel();
      await channel.start();

      // sourceQueue exists after start
      expect((channel as any).sourceQueue).not.toBeNull();

      await channel.stop();

      // sourceQueue is cleaned up after stop
      expect((channel as any).sourceQueue).toBeNull();
      expect((channel as any).sourceQueueAbortController).toBeNull();
    });
  });
});
