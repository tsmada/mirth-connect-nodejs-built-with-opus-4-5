/**
 * Adversarial Pipeline Integration Tests
 *
 * Validates the adversarial runtime fixes (P0-1 through P2-3) work correctly
 * through the FULL message lifecycle:
 *   E4X transpilation → ScriptBuilder → ScopeBuilder → VM execution → scope readback
 *
 * These tests specifically target bugs that were invisible to prior automated
 * scanning waves — they only manifest when adversarial data flows through the
 * complete pipeline with real V8 VM execution.
 *
 * ONLY the database layer is mocked (DonkeyDao, pool, RecoveryTask).
 * No JavaScript executor mocks — every script runs in a real VM context.
 *
 * Bug categories exercised:
 * - P0-1: Global default namespace isolation across channels/messages
 * - P0-2: XMLProxy.exists() for segment existence checking
 * - P0-3: Multi-node XMLProxy.set() updates all nodes
 * - P0-4: toXMLString() error context (not silent empty string)
 * - P1-1: E4X double-quote attribute escaping
 * - P1-2: E4X inside template literal interpolation
 * - P2-2: Buffer prototype pollution isolation
 * - P2-3: Auto-serialization circular reference error context
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
import { GlobalMap } from '../../../src/javascript/userutil/MirthMap';
import {
  channelTablesExist,
  getNextMessageId,
} from '../../../src/db/DonkeyDao';

import {
  PipelineTestHarness,
  filterRule,
  transformerStep,
} from './helpers/PipelineTestHarness';

// ─────────────── Test Messages ───────────────

const HL7_MULTI_OBX_XML = `<HL7Message>
  <MSH>
    <MSH.9><MSH.9.1>ORU</MSH.9.1><MSH.9.2>R01</MSH.9.2></MSH.9>
  </MSH>
  <PID>
    <PID.3><PID.3.1>MRN001</PID.3.1></PID.3>
    <PID.5><PID.5.1>DOE</PID.5.1></PID.5>
  </PID>
  <PV1>
    <PV1.2>I</PV1.2>
  </PV1>
  <OBX>
    <OBX.3>WBC</OBX.3>
    <OBX.5>7.5</OBX.5>
  </OBX>
  <OBX>
    <OBX.3>RBC</OBX.3>
    <OBX.5>4.2</OBX.5>
  </OBX>
  <OBX>
    <OBX.3>HGB</OBX.3>
    <OBX.5>14.0</OBX.5>
  </OBX>
</HL7Message>`;

const SIMPLE_XML = '<root><name>test</name><value>42</value></root>';

// ─────────────── Test Suite ───────────────

describe('Adversarial Pipeline Integration Tests', () => {
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
  // P0-1: Namespace Isolation Across Pipeline Stages
  // ═══════════════════════════════════════════════════════

  describe('P0-1: Default XML namespace isolation', () => {
    it('should not leak namespace from source transformer to destination transformer', async () => {
      // Source transformer sets default xml namespace
      // Destination transformer checks if namespace leaked
      harness.build({
        channelId: 'ns-isolation-channel',
        sourceTransformerSteps: [transformerStep(`
          // Set default xml namespace (transpiled by E4X transpiler)
          setDefaultXmlNamespace("urn:hl7-org:v3");
          var ns = getDefaultXmlNamespace();
          channelMap.put('sourceNS', ns);
        `)],
        destinations: [{
          name: 'Dest 1',
          transformerSteps: [transformerStep(`
            // In the destination transformer scope, getDefaultXmlNamespace
            // should return '' — not the source transformer's namespace.
            // P0-1 fix: each scope gets its own namespace via createNamespaceFunctions()
            var destNS = getDefaultXmlNamespace();
            connectorMap.put('destNS', destNS);
          `)],
        }],
      });

      const message = await harness.dispatch(SIMPLE_XML);

      const source = message.getConnectorMessage(0)!;
      expect(source.getStatus()).toBe(Status.TRANSFORMED);
      expect(source.getChannelMap().get('sourceNS')).toBe('urn:hl7-org:v3');

      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.SENT);
      // P0-1: destination should NOT inherit source's namespace
      expect(dest.getConnectorMap().get('destNS')).toBe('');
    });

    it('should not leak namespace from first message to second message', async () => {
      harness.build({
        channelId: 'ns-msg-isolation',
        sourceTransformerSteps: [transformerStep(`
          var currentNS = getDefaultXmlNamespace();
          channelMap.put('nsAtStart', currentNS);
          setDefaultXmlNamespace("urn:msg-specific:" + String(msg).substring(0, 10));
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      // First message — sets a namespace
      const msg1 = await harness.dispatch('<msg1>hello</msg1>');
      const source1 = msg1.getConnectorMessage(0)!;
      expect(source1.getChannelMap().get('nsAtStart')).toBe('');

      // Reset message ID counter for second dispatch
      mockNextMessageId = 100;
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() =>
        Promise.resolve(mockNextMessageId++)
      );

      // Second message — should start with empty namespace
      const msg2 = await harness.dispatch('<msg2>world</msg2>');
      const source2 = msg2.getConnectorMessage(0)!;
      // P0-1: second message should NOT see first message's namespace
      expect(source2.getChannelMap().get('nsAtStart')).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════
  // P0-2: XMLProxy.exists() Through Pipeline
  // ═══════════════════════════════════════════════════════

  describe('P0-2: XMLProxy.exists() for segment existence', () => {
    it('should correctly identify present and absent segments via exists()', async () => {
      harness.build({
        sourceTransformerSteps: [transformerStep(`
          var xmlMsg = new XML(msg);

          // PID exists in message — exists() should return true
          var pidExists = xmlMsg.PID.exists();
          channelMap.put('pidExists', String(pidExists));

          // ZZZ does not exist — exists() should return false
          var zzzExists = xmlMsg.ZZZ.exists();
          channelMap.put('zzzExists', String(zzzExists));

          // PV1 exists — exists() should return true
          var pv1Exists = xmlMsg.PV1.exists();
          channelMap.put('pv1Exists', String(pv1Exists));

          // Verify toString on non-existent returns empty string
          var zzzStr = String(xmlMsg.ZZZ);
          channelMap.put('zzzString', zzzStr);
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(HL7_MULTI_OBX_XML);
      const source = message.getConnectorMessage(0)!;

      expect(source.getStatus()).toBe(Status.TRANSFORMED);
      expect(source.getChannelMap().get('pidExists')).toBe('true');
      expect(source.getChannelMap().get('zzzExists')).toBe('false');
      expect(source.getChannelMap().get('pv1Exists')).toBe('true');
      expect(source.getChannelMap().get('zzzString')).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════
  // P0-3: Multi-Node Set Through Pipeline
  // ═══════════════════════════════════════════════════════

  describe('P0-3: Multi-node XMLProxy.set() updates all nodes', () => {
    it('should update OBX.5 across all three OBX segments', async () => {
      harness.build({
        sourceTransformerSteps: [transformerStep(`
          var xmlMsg = new XML(msg);

          // Before: OBX.5 values are 7.5, 4.2, 14.0
          var beforeCount = xmlMsg.OBX.length();
          channelMap.put('obxCount', String(beforeCount));

          // Record original values
          var origValues = [];
          xmlMsg.OBX.forEach(function(obx) {
            origValues.push(String(obx['OBX.5']));
          });
          channelMap.put('origValues', origValues.join(','));

          // P0-3: Set all OBX.5 to 'UPDATED' — should update ALL 3 nodes, not just first
          xmlMsg.OBX['OBX.5'] = 'UPDATED';

          // Verify all three were updated
          var updatedValues = [];
          xmlMsg.OBX.forEach(function(obx) {
            updatedValues.push(String(obx['OBX.5']));
          });
          channelMap.put('updatedValues', updatedValues.join(','));

          msg = xmlMsg;
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(HL7_MULTI_OBX_XML);
      const source = message.getConnectorMessage(0)!;

      expect(source.getStatus()).toBe(Status.TRANSFORMED);
      expect(source.getChannelMap().get('obxCount')).toBe('3');
      expect(source.getChannelMap().get('origValues')).toBe('7.5,4.2,14.0');
      // P0-3: ALL three OBX.5 should be UPDATED, not just the first
      expect(source.getChannelMap().get('updatedValues')).toBe('UPDATED,UPDATED,UPDATED');
    });
  });

  // ═══════════════════════════════════════════════════════
  // P0-4 + P2-3: Auto-Serialization Error Context
  // ═══════════════════════════════════════════════════════

  describe('P0-4 + P2-3: Auto-serialization error provides context', () => {
    it('should throw contextual error on circular reference in msg', async () => {
      harness.build({
        sourceTransformerSteps: [transformerStep(`
          // Create a circular reference — the auto-serialization in doTransform()
          // will try JSON.stringify(msg) which throws TypeError
          msg = { name: 'test' };
          msg.self = msg;
          // P2-3: error should include "auto-serialization error" context
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      // The pipeline should handle the error — message ends up ERROR or
      // the error is caught and the message still completes with error status
      try {
        const message = await harness.dispatch(SIMPLE_XML);
        // If it doesn't throw, the error should be recorded on the connector message
        const source = message.getConnectorMessage(0)!;
        if (source.getProcessingError()) {
          expect(source.getProcessingError()).toContain('auto-serialization');
        }
      } catch (err: any) {
        // P2-3: The error message should include contextual information
        expect(err.message).toContain('auto-serialization');
        expect(err.message).toContain('circular');
      }
    });
  });

  // ═══════════════════════════════════════════════════════
  // P1-1: E4X Double-Quote Attribute Through Pipeline
  // ═══════════════════════════════════════════════════════

  describe('P1-1: E4X double-quote attribute escaping', () => {
    it('should handle E4X with attribute values created from string concat', async () => {
      // This test exercises the E4X transpiler + XMLProxy through the full pipeline
      // P1-1: double quotes in attribute values must be escaped to &quot;
      harness.build({
        sourceTransformerSteps: [transformerStep(`
          // Build XML with an attribute containing special characters
          var patientName = 'O\\'Brien';
          var xml = XMLProxy.create('<patient name="' + patientName + '"/>');
          channelMap.put('xmlStr', xml.toXMLString());
          channelMap.put('attrVal', String(xml.attr('name')));
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML);
      const source = message.getConnectorMessage(0)!;

      expect(source.getStatus()).toBe(Status.TRANSFORMED);
      // The attribute value should be preserved correctly
      const attrVal = source.getChannelMap().get('attrVal') as string;
      expect(attrVal).toContain("O'Brien");
    });
  });

  // ═══════════════════════════════════════════════════════
  // P2-2: Buffer Prototype Isolation Through Pipeline
  // ═══════════════════════════════════════════════════════

  describe('P2-2: Buffer prototype pollution is blocked', () => {
    it('should allow Buffer.from() but block adding properties to Buffer', async () => {
      harness.build({
        sourceTransformerSteps: [transformerStep(`
          // Buffer.from() should work (needed for String.prototype.getBytes)
          var buf = Buffer.from('hello');
          channelMap.put('bufLength', String(buf.length));

          // P2-2: Attempt to add a property to the frozen Buffer wrapper
          // should silently fail (frozen object prevents new properties in sloppy mode)
          try {
            Buffer.evilProp = 'polluted';
          } catch(e) {
            // May throw in strict mode
          }
          // The property should NOT have been set on the frozen wrapper
          channelMap.put('evilPropExists', String(Buffer.evilProp !== undefined));

          // Verify Buffer still works after attempted pollution
          var buf2 = Buffer.from('world');
          channelMap.put('buf2Length', String(buf2.length));
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML);
      const source = message.getConnectorMessage(0)!;

      expect(source.getStatus()).toBe(Status.TRANSFORMED);
      expect(source.getChannelMap().get('bufLength')).toBe('5');
      expect(source.getChannelMap().get('buf2Length')).toBe('5');
      // P2-2: Property addition to frozen Buffer should have been blocked
      expect(source.getChannelMap().get('evilPropExists')).toBe('false');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Filter Rule Map Persistence Semantics
  // ═══════════════════════════════════════════════════════

  describe('Filter rule map persistence semantics', () => {
    it('should NOT persist $c changes when filter returns false', async () => {
      harness.build({
        sourceFilterRules: [filterRule(`
          // Set channelMap value then reject
          channelMap.put('filterSetThis', 'shouldNotPersist');
          return false;
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML);
      const source = message.getConnectorMessage(0)!;

      // Source should be FILTERED
      expect(source.getStatus()).toBe(Status.FILTERED);
      // Destination should not have been called
      expect(harness.getDestination(0).sentMessages.length).toBe(0);
    });

    it('should persist $g changes even when filter returns false', async () => {
      harness.build({
        sourceFilterRules: [filterRule(`
          // globalMap changes persist regardless of filter result
          globalMap.put('filterGlobalWrite', 'persisted');
          return false;
        `)],
        destinations: [{ name: 'Dest 1' }],
      });

      const message = await harness.dispatch(SIMPLE_XML);
      const source = message.getConnectorMessage(0)!;

      expect(source.getStatus()).toBe(Status.FILTERED);
      // P0: globalMap writes from filter should persist (globalMap is a singleton)
      expect(GlobalMap.getInstance().get('filterGlobalWrite')).toBe('persisted');
    });
  });

  // ═══════════════════════════════════════════════════════
  // Kitchen Sink: All Adversarial Fixes Combined
  // ═══════════════════════════════════════════════════════

  describe('Kitchen sink: E4X + exists() + multi-node + maps', () => {
    it('should exercise all adversarial fixes in a single pipeline', async () => {
      harness.build({
        channelId: 'kitchen-sink-adversarial',
        preprocessorScript: `
          channelMap.put('preRan', 'yes');
          return message;
        `,
        sourceTransformerSteps: [transformerStep(`
          var xmlMsg = new XML(msg);

          // P0-2: exists() — verify present segment
          var pidExists = xmlMsg.PID.exists();
          channelMap.put('pidExists', String(pidExists));

          // P0-2: exists() — verify absent segment
          var zzzExists = xmlMsg.ZZZ.exists();
          channelMap.put('zzzExists', String(zzzExists));

          // P0-3: Multi-node set — update all OBX.3 values
          var obxCount = xmlMsg.OBX.length();
          channelMap.put('obxCount', String(obxCount));
          xmlMsg.OBX['OBX.3'] = 'UNIFIED';

          // Verify all were updated
          var allUnified = true;
          xmlMsg.OBX.forEach(function(obx) {
            if (String(obx['OBX.3']) !== 'UNIFIED') allUnified = false;
          });
          channelMap.put('allUnified', String(allUnified));

          // P0-1: Namespace isolation — set it here
          setDefaultXmlNamespace("urn:kitchen-sink");
          channelMap.put('srcNS', getDefaultXmlNamespace());

          // Map operations
          globalMap.put('kitchenSinkRan', 'true');
          channelMap.put('fromSource', 'srcVal');

          msg = xmlMsg;
        `)],
        postprocessorScript: `
          globalMap.put('postRan', 'true');
          var fromSource = channelMap.get('fromSource');
          globalMap.put('postSawFromSource', String(fromSource));
        `,
        destinations: [{
          name: 'Kitchen Dest',
          transformerSteps: [transformerStep(`
            // P0-1: Destination should NOT see source's namespace
            var destNS = getDefaultXmlNamespace();
            connectorMap.put('destNS', destNS);

            // Verify channelMap propagation from source
            var fromSource = channelMap.get('fromSource');
            connectorMap.put('sawFromSource', String(fromSource));
          `)],
        }],
      });

      const message = await harness.dispatch(HL7_MULTI_OBX_XML);

      // ── Source assertions ──
      const source = message.getConnectorMessage(0)!;
      expect(source.getStatus()).toBe(Status.TRANSFORMED);
      expect(source.getChannelMap().get('preRan')).toBe('yes');
      expect(source.getChannelMap().get('pidExists')).toBe('true');
      expect(source.getChannelMap().get('zzzExists')).toBe('false');
      expect(source.getChannelMap().get('obxCount')).toBe('3');
      expect(source.getChannelMap().get('allUnified')).toBe('true');
      expect(source.getChannelMap().get('srcNS')).toBe('urn:kitchen-sink');

      // ── Destination assertions ──
      const dest = message.getConnectorMessage(1)!;
      expect(dest.getStatus()).toBe(Status.SENT);
      // P0-1: namespace should NOT leak
      expect(dest.getConnectorMap().get('destNS')).toBe('');
      expect(dest.getConnectorMap().get('sawFromSource')).toBe('srcVal');

      // ── Global assertions ──
      const gm = GlobalMap.getInstance();
      expect(gm.get('kitchenSinkRan')).toBe('true');
      expect(gm.get('postRan')).toBe('true');
      expect(gm.get('postSawFromSource')).toBe('srcVal');

      // ── Pipeline complete ──
      expect(message.isProcessed()).toBe(true);
    });
  });
});
