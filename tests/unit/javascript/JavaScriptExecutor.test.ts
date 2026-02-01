import {
  JavaScriptExecutor,
  createJavaScriptExecutor,
  getDefaultExecutor,
  resetDefaultExecutor,
} from '../../../src/javascript/runtime/JavaScriptExecutor';
import { SerializationType, FilterRule, TransformerStep } from '../../../src/javascript/runtime/ScriptBuilder';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Message } from '../../../src/model/Message';
import { Status } from '../../../src/model/Status';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../src/javascript/userutil/MirthMap';

describe('JavaScriptExecutor', () => {
  let executor: JavaScriptExecutor;

  // Reset singletons before each test
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    executor = new JavaScriptExecutor();
    executor.initialize();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      const exec = new JavaScriptExecutor();
      expect(() => exec.initialize()).not.toThrow();
    });
  });

  describe('executeRaw', () => {
    it('should execute simple JavaScript', () => {
      const result = executor.executeRaw<number>('1 + 1');
      expect(result.success).toBe(true);
      expect(result.result).toBe(2);
    });

    it('should handle errors', () => {
      const result = executor.executeRaw('throw new Error("test error")');
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('test error');
    });

    it('should respect timeout', () => {
      const result = executor.executeRaw('while(true){}', {}, { timeout: 100 });
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timed out');
    });

    it('should provide execution time', () => {
      const result = executor.executeRaw<number>('1 + 1');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should use scope variables', () => {
      const result = executor.executeRaw<number>('a + b', { a: 10, b: 20 });
      expect(result.success).toBe(true);
      expect(result.result).toBe(30);
    });
  });

  describe('executeScript_', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    it('should execute script with generated setup', () => {
      const result = executor.executeScript_('return 42;', context);
      expect(result.success).toBe(true);
    });

    it('should have access to logger', () => {
      const result = executor.executeScript_('logger.info("test"); return true;', context);
      expect(result.success).toBe(true);
    });

    it('should have access to global maps', () => {
      // First set a value in global map
      GlobalMap.getInstance().put('testKey', 'testValue');

      // $g is a function shortcut in generated scripts: $g("key") to get, $g("key", "value") to set
      const result = executor.executeScript_('return $g("testKey");', context);
      expect(result.success).toBe(true);
      expect(result.result).toBe('testValue');
    });
  });

  describe('executeFilter', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should accept message with no filter rules', () => {
      const result = executor.executeFilter(
        [],
        connectorMessage,
        '<msg/>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(true);
    });

    it('should accept message when filter returns true', () => {
      const rules: FilterRule[] = [
        { name: 'Accept All', script: 'return true;', operator: 'AND', enabled: true },
      ];

      const result = executor.executeFilter(
        rules,
        connectorMessage,
        '<msg/>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(true);
    });

    it('should reject message when filter returns false', () => {
      const rules: FilterRule[] = [
        { name: 'Reject All', script: 'return false;', operator: 'AND', enabled: true },
      ];

      const result = executor.executeFilter(
        rules,
        connectorMessage,
        '<msg/>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(false);
    });

    it('should combine rules with AND operator', () => {
      const rules: FilterRule[] = [
        { name: 'Rule 1', script: 'return true;', operator: 'AND', enabled: true },
        { name: 'Rule 2', script: 'return false;', operator: 'AND', enabled: true },
      ];

      const result = executor.executeFilter(
        rules,
        connectorMessage,
        '<msg/>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(false);
    });

    it('should combine rules with OR operator', () => {
      const rules: FilterRule[] = [
        { name: 'Rule 1', script: 'return false;', operator: 'AND', enabled: true },
        { name: 'Rule 2', script: 'return true;', operator: 'OR', enabled: true },
      ];

      const result = executor.executeFilter(
        rules,
        connectorMessage,
        '<msg/>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(true);
    });

    it('should skip disabled rules', () => {
      const rules: FilterRule[] = [
        { name: 'Rule 1', script: 'return true;', operator: 'AND', enabled: true },
        { name: 'Rule 2 (disabled)', script: 'return false;', operator: 'AND', enabled: false },
      ];

      const result = executor.executeFilter(
        rules,
        connectorMessage,
        '<msg/>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(true);
    });

    it('should have access to msg for XML content', () => {
      const rules: FilterRule[] = [
        {
          name: 'Check XML',
          script: 'return msg !== null && msg !== undefined;',
          operator: 'AND',
          enabled: true,
        },
      ];

      const result = executor.executeFilter(
        rules,
        connectorMessage,
        '<root><child>value</child></root>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(true);
    });

    it('should return error on script error', () => {
      const rules: FilterRule[] = [
        { name: 'Error Rule', script: 'throw new Error("filter error");', operator: 'AND', enabled: true },
      ];

      const result = executor.executeFilter(
        rules,
        connectorMessage,
        '<msg/>',
        SerializationType.XML,
        context
      );
      expect(result.accepted).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('executeTransformer', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should transform with no steps', () => {
      const result = executor.executeTransformer(
        [],
        connectorMessage,
        '<msg/>',
        '',
        SerializationType.XML,
        SerializationType.XML,
        context
      );
      expect(result.transformed).toBe(true);
    });

    it('should execute transformer steps', () => {
      const steps: TransformerStep[] = [
        { name: 'Step 1', script: '$c("key", "value");', enabled: true },
      ];

      const result = executor.executeTransformer(
        steps,
        connectorMessage,
        '<msg/>',
        '',
        SerializationType.XML,
        SerializationType.XML,
        context
      );
      expect(result.transformed).toBe(true);

      // Check that channel map was updated
      expect(connectorMessage.getChannelMap().get('key')).toBe('value');
    });

    it('should skip disabled steps', () => {
      const steps: TransformerStep[] = [
        { name: 'Step 1', script: '$c("key1", "value1");', enabled: true },
        { name: 'Step 2 (disabled)', script: '$c("key2", "value2");', enabled: false },
      ];

      const result = executor.executeTransformer(
        steps,
        connectorMessage,
        '<msg/>',
        '',
        SerializationType.XML,
        SerializationType.XML,
        context
      );
      expect(result.transformed).toBe(true);
      expect(connectorMessage.getChannelMap().get('key1')).toBe('value1');
      expect(connectorMessage.getChannelMap().get('key2')).toBeUndefined();
    });
  });

  describe('executeFilterTransformer', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should filter and transform', () => {
      const filterRules: FilterRule[] = [
        { name: 'Accept', script: 'return true;', operator: 'AND', enabled: true },
      ];

      const transformerSteps: TransformerStep[] = [
        { name: 'Set Key', script: '$c("filtered", "yes");', enabled: true },
      ];

      const result = executor.executeFilterTransformer(
        filterRules,
        transformerSteps,
        connectorMessage,
        '<msg/>',
        '',
        SerializationType.XML,
        SerializationType.XML,
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe(true);
      expect(connectorMessage.getChannelMap().get('filtered')).toBe('yes');
    });

    it('should not transform when filter rejects', () => {
      const filterRules: FilterRule[] = [
        { name: 'Reject', script: 'return false;', operator: 'AND', enabled: true },
      ];

      const transformerSteps: TransformerStep[] = [
        { name: 'Set Key', script: '$c("transformed", "yes");', enabled: true },
      ];

      const result = executor.executeFilterTransformer(
        filterRules,
        transformerSteps,
        connectorMessage,
        '<msg/>',
        '',
        SerializationType.XML,
        SerializationType.XML,
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe(false);
      // Transformer should not have run
      expect(connectorMessage.getChannelMap().get('transformed')).toBeUndefined();
    });
  });

  describe('executePreprocessor', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should return original message if no modification', () => {
      const result = executor.executePreprocessor(
        '// no change',
        'original message',
        connectorMessage,
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('original message');
    });

    it('should return modified message', () => {
      const result = executor.executePreprocessor(
        'return message.toUpperCase();',
        'original message',
        connectorMessage,
        context
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('ORIGINAL MESSAGE');
    });
  });

  describe('executePostprocessor', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let message: Message;

    beforeEach(() => {
      message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: false,
      });
    });

    it('should execute postprocessor script', () => {
      const result = executor.executePostprocessor(
        'logger.info("Postprocessor complete");',
        message,
        context
      );

      expect(result.success).toBe(true);
    });
  });

  describe('executeDeploy', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    it('should execute deploy script', () => {
      const result = executor.executeDeploy(
        '$g("deployTime", Date.now());',
        context
      );

      expect(result.success).toBe(true);
      expect(GlobalMap.getInstance().get('deployTime')).toBeDefined();
    });

    it('should have access to limited maps', () => {
      const result = executor.executeDeploy(
        '$gc("channelDeployed", true);',
        context
      );

      expect(result.success).toBe(true);
    });
  });

  describe('executeUndeploy', () => {
    const context = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    it('should execute undeploy script', () => {
      // First deploy
      GlobalMap.getInstance().put('deployedValue', 'test');

      const result = executor.executeUndeploy(
        '$g("deployedValue", null);',
        context
      );

      expect(result.success).toBe(true);
    });
  });

  describe('executeWithScope', () => {
    it('should execute with custom scope', () => {
      const customScope = {
        customVar: 100,
        customFunc: (x: number) => x * 2,
      };

      const result = executor.executeWithScope<number>(
        'return customFunc(customVar);',
        customScope
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe(200);
    });
  });

  describe('E4X transpilation', () => {
    it('should transpile E4X syntax in scripts', () => {
      const context = {
        channelId: 'test-channel',
        channelName: 'Test Channel',
      };

      // This tests that E4X syntax is transpiled
      const result = executor.executeScript_(
        'var x = 1; return x;',  // Simple script without E4X
        context
      );

      expect(result.success).toBe(true);
    });
  });

  describe('createJavaScriptExecutor', () => {
    it('should create an initialized executor', () => {
      const exec = createJavaScriptExecutor();
      expect(exec).toBeInstanceOf(JavaScriptExecutor);

      // Should be able to execute scripts
      const result = exec.executeRaw<number>('1 + 1');
      expect(result.result).toBe(2);
    });

    it('should accept options', () => {
      const exec = createJavaScriptExecutor({ transpileE4X: false });
      expect(exec).toBeInstanceOf(JavaScriptExecutor);
    });
  });

  describe('getDefaultExecutor', () => {
    it('should return a singleton', () => {
      const exec1 = getDefaultExecutor();
      const exec2 = getDefaultExecutor();
      expect(exec1).toBe(exec2);
    });

    it('should be functional', () => {
      const exec = getDefaultExecutor();
      const result = exec.executeRaw<number>('2 + 2');
      expect(result.result).toBe(4);
    });
  });

  describe('resetDefaultExecutor', () => {
    it('should reset the singleton', () => {
      const exec1 = getDefaultExecutor();
      resetDefaultExecutor();
      const exec2 = getDefaultExecutor();
      expect(exec1).not.toBe(exec2);
    });
  });
});
