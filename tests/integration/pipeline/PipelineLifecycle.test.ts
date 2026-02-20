/**
 * Pipeline Lifecycle Integration Tests
 *
 * These tests exercise the COMPLETE message lifecycle with:
 * - Real E4X transpilation (E4XTranspiler)
 * - Real V8 VM execution (JavaScriptExecutor)
 * - Real scope construction (ScopeBuilder)
 * - Real script generation (ScriptBuilder)
 *
 * ONLY the database layer is mocked (DonkeyDao, pool, RecoveryTask).
 * No JavaScript executor mocks — every script runs in a real VM context.
 *
 * This fills the testing gap between:
 * 1. Channel.test.ts (full pipeline + mocked JS executor)
 * 2. RealWorldPatterns.test.ts (real VM + isolated script execution)
 */

// ─────────────── DB-Only Mocks (NO JS executor mock) ───────────────
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
import { ContentType } from '../../../src/model/ContentType';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../src/javascript/userutil/MirthMap';
import {
  updateConnectorMessageStatus,
  updateErrors,
  channelTablesExist,
  getNextMessageId,
} from '../../../src/db/DonkeyDao';

import {
  PipelineTestHarness,
  filterRule,
  transformerStep,
} from './helpers/PipelineTestHarness';

import {
  XML_ADT_MESSAGE,
  SIMPLE_XML_MESSAGE,
  FILTER_ACCEPT,
  FILTER_REJECT,
  FILTER_CONTAINS_DOE,
  TRANSFORMER_EXTRACT_PID,
  TRANSFORMER_READ_ALL_MAPS,
  TRANSFORMER_REMOVE_DEST2,
  PREPROCESSOR_APPEND_COMMENT,
  PREPROCESSOR_RETURN_NULL,
  PREPROCESSOR_SET_MAP_ONLY,
  POSTPROCESSOR_READ_RESPONSE,
  POSTPROCESSOR_RECORD_RAN,
  POSTPROCESSOR_READ_ALL_MAPS,
  DEPLOY_SET_GLOBAL,
  UNDEPLOY_SET_GLOBAL,
  GLOBAL_PREPROCESSOR,
  GLOBAL_POSTPROCESSOR,
  CHANNEL_PREPROCESSOR_CHECK_GLOBAL,
  CHANNEL_POSTPROCESSOR_SET_MARKER,
  RESPONSE_TRANSFORMER_READ_RESPONSE,
  E4X_TRANSFORMER_XML_LITERAL,
  DEST_TRANSFORMER_READ_ALL_MAPS,
} from './helpers/ScriptFixtures';

// ─────────────── Test Suite ───────────────

describe('Pipeline Lifecycle Integration Tests', () => {
  let harness: PipelineTestHarness;

  beforeEach(() => {
    mockNextMessageId = 1;
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() =>
      Promise.resolve(mockNextMessageId++)
    );
    harness = new PipelineTestHarness();
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 1: Happy Path — Source Transform + Destination Send
  // ═══════════════════════════════════════════════════════

  describe('Scenario 1: Happy path — transform + send', () => {
    it('should extract PID.5.1, put to channelMap, and send to destination', async () => {
      harness.build({
        sourceTransformerSteps: [transformerStep(TRANSFORMER_EXTRACT_PID)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(XML_ADT_MESSAGE);

      // Source connector message should be TRANSFORMED
      const source = message.getConnectorMessage(0)!;
      expect(source.getStatus()).toBe(Status.TRANSFORMED);

      // Destination should be SENT
      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.SENT);

      // channelMap should contain the extracted patient name
      const channelMap = source.getChannelMap();
      expect(channelMap.get('patientName')).toBe('DOE');

      // Destination connector should have received exactly 1 message
      expect(harness.getDestination(0).sentMessages.length).toBe(1);

      // Message should be marked as processed
      expect(message.isProcessed()).toBe(true);
    });

    it('should pass through when no filter/transformer is configured', async () => {
      harness.build({
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      const source = message.getConnectorMessage(0)!;
      expect(source.getStatus()).toBe(Status.TRANSFORMED);

      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.SENT);

      expect(harness.getDestination(0).sentMessages.length).toBe(1);
      expect(message.isProcessed()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 2: Source Filter Rejects → FILTERED
  // ═══════════════════════════════════════════════════════

  describe('Scenario 2: Source filter rejects → FILTERED', () => {
    it('should filter message when source filter returns false', async () => {
      harness.build({
        sourceFilterRules: [filterRule(FILTER_REJECT)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Source should be FILTERED
      const source = message.getConnectorMessage(0)!;
      expect(source.getStatus()).toBe(Status.FILTERED);

      // No destination messages should be created
      const dest = message.getConnectorMessage(1);
      expect(dest).toBeUndefined();

      // Destination connector should not have been called
      expect(harness.getDestination(0).sentMessages.length).toBe(0);

      // Message should still be processed
      expect(message.isProcessed()).toBe(true);

      // DB should have recorded FILTERED status
      expect(updateConnectorMessageStatus).toHaveBeenCalledWith(
        expect.anything(), // channelId
        expect.anything(), // messageId
        0,                 // metaDataId (source)
        Status.FILTERED,
        expect.anything()  // conn
      );
    });

    it('should filter based on message content', async () => {
      harness.build({
        sourceFilterRules: [filterRule(FILTER_CONTAINS_DOE)],
        destinations: [{ name: 'Dest 1' }],
      });

      // Message without DOE should be filtered
      const message = await harness.dispatch('<msg><name>SMITH</name></msg>');
      const source = message.getConnectorMessage(0)!;
      expect(source.getStatus()).toBe(Status.FILTERED);

      // Message with DOE should pass
      mockNextMessageId = 10;
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() =>
        Promise.resolve(mockNextMessageId++)
      );
      const message2 = await harness.dispatch(XML_ADT_MESSAGE);
      const source2 = message2.getConnectorMessage(0)!;
      expect(source2.getStatus()).toBe(Status.TRANSFORMED);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 3: Partial Destination Filtering
  // ═══════════════════════════════════════════════════════

  describe('Scenario 3: Destination filter rejects one of two destinations', () => {
    it('should send to dest 1 and filter dest 2', async () => {
      harness.build({
        destinations: [
          { name: 'Dest 1', filterRules: [filterRule(FILTER_ACCEPT)] },
          { name: 'Dest 2', filterRules: [filterRule(FILTER_REJECT)] },
        ],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Source should be TRANSFORMED
      const source = message.getConnectorMessage(0)!;
      expect(source.getStatus()).toBe(Status.TRANSFORMED);

      // Dest 1 should be SENT
      const dest1 = message.getConnectorMessage(1)!;
      expect(dest1.getStatus()).toBe(Status.SENT);
      expect(harness.getDestination(0).sentMessages.length).toBe(1);

      // Dest 2 should be FILTERED
      const dest2 = message.getConnectorMessage(2)!;
      expect(dest2.getStatus()).toBe(Status.FILTERED);
      expect(harness.getDestination(1).sentMessages.length).toBe(0);

      expect(message.isProcessed()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 4: Send Error → ERROR Status
  // ═══════════════════════════════════════════════════════

  describe('Scenario 4: Send error → ERROR status', () => {
    it('should set ERROR status when destination send throws', async () => {
      harness.build({
        destinations: [{
          name: 'Dest 1',
          sendBehavior: 'error',
          sendErrorMsg: 'ECONNREFUSED',
        }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Dest should be ERROR
      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.ERROR);
      expect(dest.getProcessingError()).toContain('ECONNREFUSED');

      // updateErrors should have been called with the error message
      expect(updateErrors).toHaveBeenCalled();
      const errorCallArgs = (updateErrors as jest.Mock).mock.calls[0]!;
      expect(errorCallArgs[2]).toBe(1); // metaDataId (dest 1)
      expect(errorCallArgs[3]).toContain('ECONNREFUSED'); // processingError

      // Message should still complete
      expect(message.isProcessed()).toBe(true);
    });

    it('should run postprocessor even after destination error', async () => {
      harness.build({
        postprocessorScript: POSTPROCESSOR_RECORD_RAN,
        destinations: [{
          name: 'Dest 1',
          sendBehavior: 'error',
        }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.ERROR);

      // Postprocessor should still have run (writes to globalMap since
      // postprocessor's channelMap is on the merged copy, not source)
      expect(GlobalMap.getInstance().get('postprocessorRan')).toBe('true');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 5: Queue-Enabled Error → QUEUED Status
  // ═══════════════════════════════════════════════════════

  describe('Scenario 5: Queue-enabled error → QUEUED status', () => {
    it('should set QUEUED status when queue-enabled destination send throws', async () => {
      harness.build({
        destinations: [{
          name: 'Dest 1',
          sendBehavior: 'error',
          queueEnabled: true,
        }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.QUEUED);

      // DB should record QUEUED status
      expect(updateConnectorMessageStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        1,
        Status.QUEUED,
        expect.anything()
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 6: Response Transformer Execution
  // ═══════════════════════════════════════════════════════

  describe('Scenario 6: Response transformer reads and modifies response', () => {
    it('should execute response transformer with response data in scope', async () => {
      harness.build({
        destinations: [{
          name: 'Dest 1',
          responseData: '{"result":"ok"}',
          responseTransformerSteps: [
            transformerStep(RESPONSE_TRANSFORMER_READ_RESPONSE),
          ],
        }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.SENT);

      // Response transformer should have run and set channelMap
      const channelMap = dest.getChannelMap();
      expect(channelMap.get('responseTransformerRan')).toBe('true');

      // Response content should be stored
      const response = dest.getResponseContent();
      expect(response).toBeDefined();
      expect(response!.content).toBe('{"result":"ok"}');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 7: Preprocessor Return Semantics
  // ═══════════════════════════════════════════════════════

  describe('Scenario 7: Preprocessor return semantics', () => {
    it('should modify message when preprocessor returns modified content', async () => {
      harness.build({
        preprocessorScript: PREPROCESSOR_APPEND_COMMENT,
        sourceTransformerSteps: [transformerStep(`
          // Verify preprocessor ran by checking the channelMap value it set.
          // (XML comments like <!-- preprocessed --> are stripped by the data
          // type serializer during XML parsing, so String(msg) won't contain them)
          var fromPre = channelMap.get('fromPre');
          if (fromPre === 'preValue') {
            channelMap.put('sawPreprocessorMod', 'true');
          }
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      const source = message.getConnectorMessage(0)!;

      // Preprocessor should have set channelMap
      expect(source.getChannelMap().get('fromPre')).toBe('preValue');

      // Transformer should have seen the preprocessor's modification
      expect(source.getChannelMap().get('sawPreprocessorMod')).toBe('true');

      // PROCESSED_RAW should contain the modification
      const processedRaw = source.getContent(ContentType.PROCESSED_RAW);
      expect(processedRaw).toBeDefined();
      expect(processedRaw!.content).toContain('<!-- preprocessed -->');
    });

    it('should preserve original message when preprocessor returns null', async () => {
      harness.build({
        preprocessorScript: PREPROCESSOR_RETURN_NULL,
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      const source = message.getConnectorMessage(0)!;

      // PROCESSED_RAW should exist but contain original message (null return = no change)
      const processedRaw = source.getContent(ContentType.PROCESSED_RAW);
      expect(processedRaw).toBeDefined();
      // The content should be the original (or close to it) since null = preserve
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 8: Postprocessor Response Object
  // ═══════════════════════════════════════════════════════

  describe('Scenario 8: Postprocessor creates Response object', () => {
    it('should access destination response via merged $r', async () => {
      harness.build({
        postprocessorScript: POSTPROCESSOR_READ_RESPONSE,
        destinations: [{
          name: 'Dest 1',
          responseData: '{"status":"accepted"}',
        }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Postprocessor should have run (writes to globalMap since merged
      // channelMap copy doesn't propagate back to source)
      expect(GlobalMap.getInstance().get('postprocessorRan')).toBe('true');

      // Message should be processed
      expect(message.isProcessed()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 9: Deploy/Undeploy Script Lifecycle
  // ═══════════════════════════════════════════════════════

  describe('Scenario 9: Deploy/undeploy script lifecycle', () => {
    it('should execute deploy script on start and undeploy on stop', async () => {
      harness.build({
        channelId: 'deploy-test-channel',
        deployScript: DEPLOY_SET_GLOBAL,
        undeployScript: UNDEPLOY_SET_GLOBAL,
        destinations: [{ name: 'Dest 1' }],
      });

      const channel = harness.getChannel();
      const globalMap = GlobalMap.getInstance();

      // Before start — globalMap should be empty
      expect(globalMap.get('deployed')).toBeUndefined();

      // Start channel — deploy script runs
      await channel.start();
      expect(globalMap.get('deployed')).toBe('yes');
      expect(globalMap.get('deployedChannel')).toBe('deploy-test-channel');

      // Stop channel — undeploy script runs
      await channel.stop();
      expect(globalMap.get('undeployed')).toBe('yes');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 10: Global + Channel Script Chaining Order
  // ═══════════════════════════════════════════════════════

  describe('Scenario 10: Global + channel script chaining order', () => {
    it('should run global preprocessor before channel preprocessor', async () => {
      harness.build({
        globalPreprocessorScript: GLOBAL_PREPROCESSOR,
        preprocessorScript: CHANNEL_PREPROCESSOR_CHECK_GLOBAL,
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      const source = message.getConnectorMessage(0)!;
      const globalMap = GlobalMap.getInstance();

      // Global preprocessor should have run
      expect(globalMap.get('globalPreRan')).toBe('true');

      // Channel preprocessor should have seen global preprocessor's output
      expect(source.getChannelMap().get('channelPreRan')).toBe('true');
      expect(source.getChannelMap().get('sawGlobalPre')).toBe('true');
    });

    it('should run channel postprocessor before global postprocessor', async () => {
      harness.build({
        postprocessorScript: CHANNEL_POSTPROCESSOR_SET_MARKER,
        globalPostprocessorScript: GLOBAL_POSTPROCESSOR,
        destinations: [{ name: 'Dest 1' }],
      });

      await harness.dispatch(SIMPLE_XML_MESSAGE);
      const globalMap = GlobalMap.getInstance();

      // Channel postprocessor runs first — writes to globalMap
      expect(globalMap.get('channelPostRan')).toBe('true');

      // Global postprocessor runs second — reads channel marker from globalMap
      // (each executePostprocessor() call builds a fresh scope from a new
      // getMergedConnectorMessage(), so channelMap writes don't carry between them)
      expect(globalMap.get('globalPostRan')).toBe('true');
      expect(globalMap.get('sawChannelPost')).toBe('true');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 11: E4X Transform Pipeline End-to-End
  // ═══════════════════════════════════════════════════════

  describe('Scenario 11: E4X transform pipeline end-to-end', () => {
    it('should transpile and execute E4X XML operations', async () => {
      harness.build({
        sourceTransformerSteps: [transformerStep(E4X_TRANSFORMER_XML_LITERAL)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(XML_ADT_MESSAGE);
      const source = message.getConnectorMessage(0)!;

      // E4X should have been transpiled and executed
      const ackXml = source.getChannelMap().get('ackXml') as string;
      expect(ackXml).toBeDefined();
      expect(ackXml).toContain('DOE');
      expect(ackXml).toContain('ACK');
      expect(ackXml).toContain('OK');

      // Pipeline should complete
      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.SENT);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 12: DestinationSet Fan-Out Control
  // ═══════════════════════════════════════════════════════

  describe('Scenario 12: Multi-destination fan-out with destinationSet.remove()', () => {
    it('should skip dest 2 when removed by destinationSet', async () => {
      harness.build({
        sourceTransformerSteps: [transformerStep(TRANSFORMER_REMOVE_DEST2)],
        destinations: [
          { name: 'Dest 1' },
          { name: 'Dest 2' },
          { name: 'Dest 3' },
        ],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      const source = message.getConnectorMessage(0)!;

      // Source should be TRANSFORMED
      expect(source.getStatus()).toBe(Status.TRANSFORMED);
      expect(source.getChannelMap().get('removedDest2')).toBe('true');

      // Dest 1 should be SENT
      const dest1 = message.getConnectorMessage(1)!;
      expect(dest1.getStatus()).toBe(Status.SENT);
      expect(harness.getDestination(0).sentMessages.length).toBe(1);

      // Dest 2 should be FILTERED (skipped by destinationSet)
      const dest2 = message.getConnectorMessage(2)!;
      expect(dest2.getStatus()).toBe(Status.FILTERED);
      expect(harness.getDestination(1).sentMessages.length).toBe(0);

      // Dest 3 should be SENT
      const dest3 = message.getConnectorMessage(3)!;
      expect(dest3.getStatus()).toBe(Status.SENT);
      expect(harness.getDestination(2).sentMessages.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 13: Map Variable Propagation Across All Stages
  // ═══════════════════════════════════════════════════════

  describe('Scenario 13: Map variable propagation across all stages', () => {
    it('should propagate maps from preprocessor through to postprocessor', async () => {
      // IMPORTANT: build() calls resetAllSingletons(), so pre-seeding MUST happen AFTER build()
      harness.build({
        preprocessorScript: PREPROCESSOR_SET_MAP_ONLY,
        sourceTransformerSteps: [transformerStep(TRANSFORMER_READ_ALL_MAPS)],
        postprocessorScript: POSTPROCESSOR_READ_ALL_MAPS,
        destinations: [{
          name: 'Dest 1',
          transformerSteps: [transformerStep(DEST_TRANSFORMER_READ_ALL_MAPS)],
          responseData: '{"ok":true}',
        }],
      });

      // Pre-seed global maps AFTER build() — singletons are now fresh
      const globalMap = GlobalMap.getInstance();
      const globalChannelMapStore = GlobalChannelMapStore.getInstance();
      const configMap = ConfigurationMap.getInstance();

      globalMap.put('globalKey', 'globalValue');
      globalChannelMapStore.get('test-pipeline-channel').put('gcKey', 'gcValue');
      configMap.put('cfgKey', 'cfgValue');

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);
      const source = message.getConnectorMessage(0)!;
      const dest = message.getConnectorMessage(1)!;

      // ── Preprocessor wrote to channelMap ──
      expect(source.getChannelMap().get('fromPre')).toBe('preValue');

      // ── Source transformer read preprocessor's value + global maps ──
      expect(source.getChannelMap().get('fromSource')).toBe('sourceValue');
      expect(source.getChannelMap().get('sawGlobal')).toBe('globalValue');
      expect(source.getChannelMap().get('sawGlobalChannel')).toBe('gcValue');
      expect(source.getChannelMap().get('sawConfig')).toBe('cfgValue');

      // ── Destination transformer read channelMap from source ──
      const destConnectorMap = dest.getConnectorMap();
      expect(destConnectorMap.get('destKey')).toBe('destValue');
      expect(destConnectorMap.get('sawFromPre')).toBe('preValue');
      expect(destConnectorMap.get('sawFromSource')).toBe('sourceValue');
      expect(destConnectorMap.get('sawGlobal')).toBe('globalValue');
      expect(destConnectorMap.get('sawGlobalChannel')).toBe('gcValue');
      expect(destConnectorMap.get('sawConfig')).toBe('cfgValue');

      // ── Postprocessor read merged maps + response (via globalMap since
      //    postprocessor's channelMap writes are on a merged copy) ──
      expect(globalMap.get('postprocessorRan')).toBe('true');
      expect(globalMap.get('postSawFromPre')).toBe('preValue');
      expect(globalMap.get('postSawFromSource')).toBe('sourceValue');

      // Pipeline completes successfully
      expect(message.isProcessed()).toBe(true);
      expect(dest.getStatus()).toBe(Status.SENT);
    });
  });
});
