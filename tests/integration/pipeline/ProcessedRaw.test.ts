/**
 * ProcessedRaw Content Path Integration Tests
 *
 * Tests that the PROCESSED_RAW content type (ContentType=2) is correctly
 * stored by the preprocessor and retrieved by getProcessedRawData().
 *
 * Java Mirth behavior:
 * - Preprocessor modifies message → stored as PROCESSED_RAW (setContent)
 * - FilterTransformerExecutor reads getProcessedRawData() which checks PROCESSED_RAW first
 * - If no preprocessor or preprocessor returns null → falls back to RAW
 *
 * DB layer is mocked. JavaScript execution is real (V8 VM).
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
import {
  channelTablesExist,
  getNextMessageId,
  insertContent,
} from '../../../src/db/DonkeyDao';

import {
  PipelineTestHarness,
  transformerStep,
} from './helpers/PipelineTestHarness';

import { SIMPLE_XML_MESSAGE } from './helpers/ScriptFixtures';

// ─────────────── Test Suite ───────────────

describe('ProcessedRaw Content Path', () => {
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
  // Scenario 1: Preprocessor modifies message
  // ═══════════════════════════════════════════════════════

  describe('Preprocessor modifies message', () => {
    it('should store PROCESSED_RAW and pass modified message to filter/transformer', async () => {
      // Preprocessor uppercases the message
      const preprocessorScript = `return message.toUpperCase();`;

      // Transformer records what it received via channelMap
      const transformerScript = `
        channelMap.put('receivedMsg', String(msg).substring(0, 50));
      `;

      harness.build({
        preprocessorScript,
        sourceTransformerSteps: [transformerStep(transformerScript)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Source connector message should have PROCESSED_RAW content
      const source = message.getConnectorMessage(0)!;
      const processedRaw = source.getProcessedRawData();
      expect(processedRaw).toBe(SIMPLE_XML_MESSAGE.toUpperCase());

      // PROCESSED_RAW should be stored in the content map
      const processedRawContent = source.getContent(ContentType.PROCESSED_RAW);
      expect(processedRawContent).toBeDefined();
      expect(processedRawContent!.content).toBe(SIMPLE_XML_MESSAGE.toUpperCase());
      expect(processedRawContent!.contentType).toBe(ContentType.PROCESSED_RAW);

      // The original RAW should still be the original message
      const rawData = source.getRawData();
      expect(rawData).toBe(SIMPLE_XML_MESSAGE);

      // Source should be TRANSFORMED (pipeline completed successfully)
      expect(source.getStatus()).toBe(Status.TRANSFORMED);

      // Destination should be SENT
      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.SENT);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 2: Preprocessor returns null
  // ═══════════════════════════════════════════════════════

  describe('Preprocessor returns null', () => {
    it('should use original raw message when preprocessor returns null', async () => {
      const preprocessorScript = `return null;`;

      // Transformer records what msg it received
      const transformerScript = `
        channelMap.put('receivedMsg', String(msg).substring(0, 30));
      `;

      harness.build({
        preprocessorScript,
        sourceTransformerSteps: [transformerStep(transformerScript)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      const source = message.getConnectorMessage(0)!;

      // getProcessedRawData() should fall back to raw when preprocessor returns null
      // (Java behavior: null return means "don't modify")
      const processedRaw = source.getProcessedRawData();
      expect(processedRaw).toBe(SIMPLE_XML_MESSAGE);

      // Source should complete successfully
      expect(source.getStatus()).toBe(Status.TRANSFORMED);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 3: Preprocessor returns undefined (no return statement)
  // ═══════════════════════════════════════════════════════

  describe('Preprocessor returns undefined', () => {
    it('should use original raw message when preprocessor has no return', async () => {
      // Script with side-effect only, no return statement
      const preprocessorScript = `
        channelMap.put('preRan', 'yes');
      `;

      harness.build({
        preprocessorScript,
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      const source = message.getConnectorMessage(0)!;

      // getProcessedRawData() should fall back to raw
      const processedRaw = source.getProcessedRawData();
      expect(processedRaw).toBe(SIMPLE_XML_MESSAGE);

      // Pipeline should complete
      expect(source.getStatus()).toBe(Status.TRANSFORMED);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 4: No preprocessor configured
  // ═══════════════════════════════════════════════════════

  describe('No preprocessor configured', () => {
    it('should return raw data when no preprocessor exists', async () => {
      harness.build({
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML_MESSAGE);

      const source = message.getConnectorMessage(0)!;

      // No PROCESSED_RAW content should be stored
      const processedRawContent = source.getContent(ContentType.PROCESSED_RAW);
      expect(processedRawContent).toBeUndefined();

      // getProcessedRawData() should fall back to raw data
      const processedRaw = source.getProcessedRawData();
      expect(processedRaw).toBe(SIMPLE_XML_MESSAGE);

      // Pipeline should complete
      expect(source.getStatus()).toBe(Status.TRANSFORMED);
    });
  });

  // ═══════════════════════════════════════════════════════
  // Scenario 5: PROCESSED_RAW persistence
  // ═══════════════════════════════════════════════════════

  describe('PROCESSED_RAW persistence', () => {
    it('should call insertContent with ContentType.PROCESSED_RAW when stored', async () => {
      const preprocessorScript = `return message + ' MODIFIED';`;

      harness.build({
        preprocessorScript,
        destinations: [{ name: 'Dest 1' }],
      });

      await harness.dispatch(SIMPLE_XML_MESSAGE);

      // Verify insertContent was called with PROCESSED_RAW content type
      const insertContentMock = insertContent as jest.Mock;
      const processedRawCalls = insertContentMock.mock.calls.filter(
        (call: any[]) => call[3] === ContentType.PROCESSED_RAW
      );

      // Should have at least one call storing PROCESSED_RAW
      expect(processedRawCalls.length).toBeGreaterThanOrEqual(1);

      // The stored content should be the modified message
      const storedContent = processedRawCalls[0]![4];
      expect(storedContent).toBe(SIMPLE_XML_MESSAGE + ' MODIFIED');
    });
  });
});
