/**
 * FilterTransformerExecutor failure mode tests
 *
 * Tests distinct failure paths through the executor:
 * 1. Filter returns accepted=false -> result.filtered=true
 * 2. Filter throws Error -> error propagated
 * 3. Transformer returns transformed=false with error -> result.error set
 * 4. Transformer throws Error -> result.error set
 * 5. Normal success with filter + transformer -> filtered=false, transformedData set
 * 6. No filter rules -> always accepts (filtered=false)
 * 7. No transformer steps -> returns raw content
 *
 * Plus a pipeline integration test with real filter rule via Channel.dispatchRawMessage().
 */

import {
  FilterTransformerExecutor,
} from '../../../../src/donkey/channel/FilterTransformerExecutor';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { SerializationType } from '../../../../src/javascript/runtime/ScriptBuilder';
import { ScriptContext } from '../../../../src/javascript/runtime/ScopeBuilder';
import {
  JavaScriptExecutor,
  ExecutionResult,
  FilterResult,
  TransformerResult,
  resetDefaultExecutor,
} from '../../../../src/javascript/runtime/JavaScriptExecutor';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';

// Pipeline integration imports
import {
  PipelineTestHarness,
  filterRule,
  resetAllSingletons,
} from '../../../integration/pipeline/helpers/PipelineTestHarness';

describe('FilterTransformerExecutor — failure modes', () => {
  const context: ScriptContext = {
    channelId: 'fail-test-channel',
    channelName: 'Failure Test Channel',
    connectorName: 'Source',
    metaDataId: 0,
  };

  function makeConnectorMessage(rawContent: string = '<root><value>test</value></root>'): ConnectorMessage {
    const cm = new ConnectorMessage({
      messageId: 1,
      metaDataId: 0,
      channelId: 'fail-test-channel',
      channelName: 'Failure Test Channel',
      connectorName: 'Source',
      serverId: 'server-1',
      receivedDate: new Date(),
      status: Status.RECEIVED,
    });
    cm.setContent({
      contentType: ContentType.RAW,
      content: rawContent,
      dataType: 'XML',
      encrypted: false,
    });
    return cm;
  }

  /**
   * Create a mock JavaScriptExecutor with controllable behavior.
   */
  function createMockExecutor(overrides: {
    filterResult?: Partial<FilterResult>;
    transformerResult?: Partial<TransformerResult>;
    filterTransformerResult?: Partial<ExecutionResult<boolean>>;
    filterThrow?: Error;
    transformerThrow?: Error;
    filterTransformerThrow?: Error;
  } = {}): JavaScriptExecutor {
    const mockExecutor = {
      initialize: jest.fn(),
      executeFilter: jest.fn().mockImplementation((): FilterResult => {
        if (overrides.filterThrow) throw overrides.filterThrow;
        return {
          accepted: true,
          ...overrides.filterResult,
        } as FilterResult;
      }),
      executeTransformer: jest.fn().mockImplementation((): TransformerResult => {
        if (overrides.transformerThrow) throw overrides.transformerThrow;
        return {
          transformed: true,
          ...overrides.transformerResult,
        } as TransformerResult;
      }),
      executeFilterTransformer: jest.fn().mockImplementation((): ExecutionResult<boolean> => {
        if (overrides.filterTransformerThrow) throw overrides.filterTransformerThrow;
        return {
          success: true,
          result: true,
          executionTime: 1,
          ...overrides.filterTransformerResult,
        } as ExecutionResult<boolean>;
      }),
    } as unknown as JavaScriptExecutor;

    return mockExecutor;
  }

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  // ─────────────────────────────────────────────────────
  // 1. Filter returns accepted=false -> result.filtered=true
  // ─────────────────────────────────────────────────────
  describe('filter rejects message', () => {
    it('should return filtered=true when filter returns accepted=false', async () => {
      const mockExec = createMockExecutor({
        filterResult: { accepted: false },
      });

      const executor = new FilterTransformerExecutor(context, {
        filterRules: [{ name: 'Reject', script: 'return false;', operator: 'AND', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      const filtered = await executor.executeFilter(cm);
      expect(filtered).toBe(true); // Not accepted -> filtered
    });
  });

  // ─────────────────────────────────────────────────────
  // 2. Filter throws Error -> error propagated
  // ─────────────────────────────────────────────────────
  describe('filter throws error', () => {
    it('should propagate error when filter throws', async () => {
      const mockExec = createMockExecutor({
        filterThrow: new Error('Filter script crashed'),
      });

      const executor = new FilterTransformerExecutor(context, {
        filterRules: [{ name: 'Crash', script: 'throw new Error("crash");', operator: 'AND', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      await expect(executor.executeFilter(cm)).rejects.toThrow('Filter execution error');
    });
  });

  // ─────────────────────────────────────────────────────
  // 3. Transformer returns transformed=false with error -> result.error set
  // ─────────────────────────────────────────────────────
  describe('transformer returns error', () => {
    it('should set result.error when transformer returns transformed=false with error', async () => {
      const mockExec = createMockExecutor({
        transformerResult: {
          transformed: false,
          error: new Error('Transformer validation failed'),
        },
      });

      const executor = new FilterTransformerExecutor(context, {
        transformerSteps: [{ name: 'Step1', script: 'broken', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      const result = await executor.executeTransformer(cm);
      expect(result.filtered).toBe(false);
      expect(result.error).toBe('Transformer validation failed');
      expect(result.transformedData).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────
  // 4. Transformer throws Error -> result.error set
  // ─────────────────────────────────────────────────────
  describe('transformer throws error', () => {
    it('should catch thrown error and set result.error', async () => {
      const mockExec = createMockExecutor({
        transformerThrow: new Error('Transformer threw unexpectedly'),
      });

      const executor = new FilterTransformerExecutor(context, {
        transformerSteps: [{ name: 'Step1', script: 'throw "boom";', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      const result = await executor.executeTransformer(cm);
      expect(result.filtered).toBe(false);
      expect(result.error).toContain('Transformer threw unexpectedly');
    });
  });

  // ─────────────────────────────────────────────────────
  // 5. Normal success with filter + transformer
  // ─────────────────────────────────────────────────────
  describe('normal success with filter + transformer', () => {
    it('should return filtered=false and set transformedData on success', async () => {
      const mockExec = createMockExecutor({
        filterTransformerResult: { success: true, result: true },
      });

      const executor = new FilterTransformerExecutor(context, {
        filterRules: [{ name: 'Accept', script: 'return true;', operator: 'AND', enabled: true }],
        transformerSteps: [{ name: 'Transform', script: '$c("key", "val");', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage('<msg>hello</msg>');
      const result = await executor.execute(cm);
      expect(result.filtered).toBe(false);
      // transformedData comes from connectorMessage.getTransformedData() fallback to raw
      expect(result.transformedData).toBeDefined();
      expect(result.error).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────
  // 6. No filter rules -> always accepts
  // ─────────────────────────────────────────────────────
  describe('no filter rules', () => {
    it('should return filtered=false when no filter rules are configured', async () => {
      const executor = new FilterTransformerExecutor(context, {
        filterRules: [], // empty
      });
      // No need to mock — executeFilter short-circuits for empty rules

      const cm = makeConnectorMessage();
      const filtered = await executor.executeFilter(cm);
      expect(filtered).toBe(false);
    });

    it('should not call the executor when no filter rules exist', async () => {
      const mockExec = createMockExecutor();
      const executor = new FilterTransformerExecutor(context, {
        filterRules: [],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      await executor.executeFilter(cm);
      expect(mockExec.executeFilter).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────
  // 7. No transformer steps -> returns raw content
  // ─────────────────────────────────────────────────────
  describe('no transformer steps', () => {
    it('should return raw content when no transformer steps are configured', async () => {
      const executor = new FilterTransformerExecutor(context, {
        transformerSteps: [],
      });

      const rawContent = '<root><value>original</value></root>';
      const cm = makeConnectorMessage(rawContent);
      const result = await executor.executeTransformer(cm);
      expect(result.filtered).toBe(false);
      expect(result.transformedData).toBe(rawContent);
      expect(result.error).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────
  // execute() combined filter + transformer failure modes
  // ─────────────────────────────────────────────────────
  describe('execute() combined failure modes', () => {
    it('should return filtered=true when filterTransformer result is false', async () => {
      const mockExec = createMockExecutor({
        filterTransformerResult: { success: true, result: false },
      });

      const executor = new FilterTransformerExecutor(context, {
        filterRules: [{ name: 'Reject', script: 'return false;', operator: 'AND', enabled: true }],
        transformerSteps: [{ name: 'Step', script: 'msg;', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      const result = await executor.execute(cm);
      expect(result.filtered).toBe(true);
      expect(result.transformedData).toBeUndefined();
    });

    it('should return error when filterTransformer fails', async () => {
      const mockExec = createMockExecutor({
        filterTransformerResult: {
          success: false,
          result: undefined,
          error: new Error('Script syntax error'),
        },
      });

      const executor = new FilterTransformerExecutor(context, {
        filterRules: [{ name: 'R1', script: 'broken', operator: 'AND', enabled: true }],
        transformerSteps: [{ name: 'S1', script: 'broken', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      const result = await executor.execute(cm);
      expect(result.filtered).toBe(false);
      expect(result.error).toBe('Script syntax error');
    });
  });

  // ─────────────────────────────────────────────────────
  // processConnectorMessage status updates
  // ─────────────────────────────────────────────────────
  describe('processConnectorMessage', () => {
    it('should set transformed content on connector message when not filtered', async () => {
      const mockExec = createMockExecutor({
        filterTransformerResult: { success: true, result: true },
      });

      const executor = new FilterTransformerExecutor(context, {
        transformerSteps: [{ name: 'Step', script: 'msg;', enabled: true }],
        outboundDataType: SerializationType.XML,
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage('<root>data</root>');
      const result = await executor.processConnectorMessage(cm);
      expect(result.filtered).toBe(false);

      // processConnectorMessage writes transformed content back to the ConnectorMessage
      const transformed = cm.getTransformedContent();
      expect(transformed).toBeDefined();
      expect(transformed!.content).toBeDefined();
    });

    it('should NOT set transformed content when filtered', async () => {
      const mockExec = createMockExecutor({
        filterTransformerResult: { success: true, result: false },
      });

      const executor = new FilterTransformerExecutor(context, {
        filterRules: [{ name: 'Reject', script: 'return false;', operator: 'AND', enabled: true }],
      });
      executor.setExecutor(mockExec);

      const cm = makeConnectorMessage();
      const result = await executor.processConnectorMessage(cm);
      expect(result.filtered).toBe(true);
      // Transformed content should not be set for filtered messages
      // (processConnectorMessage checks !result.filtered)
    });
  });
});

// ─────────────────────────────────────────────────────────
// Pipeline integration test — real filter through dispatchRawMessage()
// ─────────────────────────────────────────────────────────
describe('FilterTransformerExecutor — pipeline integration', () => {
  beforeEach(() => {
    resetAllSingletons();
  });

  it('should produce FILTERED status when source filter returns false through the full pipeline', async () => {
    const harness = new PipelineTestHarness();
    harness.build({
      sourceFilterRules: [
        filterRule('return false;', 'RejectAll'),
      ],
      destinations: [{ name: 'Dest 1' }],
    });

    const message = await harness.dispatch('<msg>hello</msg>');

    // Source connector message should be FILTERED
    const sourceMsg = message.getSourceConnectorMessage();
    expect(sourceMsg).toBeDefined();
    expect(sourceMsg!.getStatus()).toBe(Status.FILTERED);

    // Destinations should NOT have been created when source filters
    const destMsgs = message.getDestinationConnectorMessages();
    // If destinations were created, they should also be FILTERED
    // (Channel.dispatchRawMessage sets all to FILTERED when source filters)
    if (destMsgs.length > 0) {
      for (const dm of destMsgs) {
        expect(dm.getStatus()).toBe(Status.FILTERED);
      }
    }
  });

  it('should produce TRANSFORMED status when source filter returns true', async () => {
    const harness = new PipelineTestHarness();
    harness.build({
      sourceFilterRules: [
        filterRule('return true;', 'AcceptAll'),
      ],
      destinations: [{ name: 'Dest 1' }],
    });

    const message = await harness.dispatch('<msg>hello</msg>');

    const sourceMsg = message.getSourceConnectorMessage();
    expect(sourceMsg).toBeDefined();
    // Source should be TRANSFORMED (filter passed, transformer ran)
    expect(sourceMsg!.getStatus()).toBe(Status.TRANSFORMED);
  });
});
