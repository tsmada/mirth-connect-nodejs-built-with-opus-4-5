import {
  FilterTransformerExecutor,
  FilterTransformerScripts,
} from '../../../../src/donkey/channel/FilterTransformerExecutor';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { SerializationType } from '../../../../src/javascript/runtime/ScriptBuilder';
import { ScriptContext } from '../../../../src/javascript/runtime/ScopeBuilder';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

describe('FilterTransformerExecutor', () => {
  let executor: FilterTransformerExecutor;
  let connectorMessage: ConnectorMessage;
  const context: ScriptContext = {
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Source',
    metaDataId: 0,
  };

  beforeEach(() => {
    // Reset singletons
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    executor = new FilterTransformerExecutor(context);

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

    // Set raw content
    connectorMessage.setContent({
      contentType: ContentType.RAW,
      content: '<root><value>test</value></root>',
      dataType: 'XML',
      encrypted: false,
    });
  });

  describe('constructor', () => {
    it('should create executor with default scripts', () => {
      const exec = new FilterTransformerExecutor(context);
      expect(exec).toBeDefined();
    });

    it('should create executor with provided scripts', () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [{ name: 'Rule1', script: 'return true;', operator: 'AND', enabled: true }],
        transformerSteps: [{ name: 'Step1', script: 'msg;', enabled: true }],
      };
      const exec = new FilterTransformerExecutor(context, scripts);
      expect(exec).toBeDefined();
    });
  });

  describe('executeFilter', () => {
    it('should accept message with no filter rules', async () => {
      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(false);
    });

    it('should accept message when filter returns true', async () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          { name: 'Accept', script: 'return true;', operator: 'AND', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(false); // Not filtered = accepted
    });

    it('should filter message when filter returns false', async () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          { name: 'Reject', script: 'return false;', operator: 'AND', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(true); // Filtered = rejected
    });

    it('should combine filter rules with AND', async () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          { name: 'Rule1', script: 'return true;', operator: 'AND', enabled: true },
          { name: 'Rule2', script: 'return false;', operator: 'AND', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(true); // AND false = filtered
    });

    it('should combine filter rules with OR', async () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          { name: 'Rule1', script: 'return false;', operator: 'AND', enabled: true },
          { name: 'Rule2', script: 'return true;', operator: 'OR', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(false); // OR true = accepted
    });
  });

  describe('executeTransformer', () => {
    it('should return raw content when no transformer steps', async () => {
      const result = await executor.executeTransformer(connectorMessage);
      expect(result.filtered).toBe(false);
      expect(result.transformedData).toBe('<root><value>test</value></root>');
    });

    it('should execute transformer steps', async () => {
      const scripts: FilterTransformerScripts = {
        transformerSteps: [
          { name: 'Set Map', script: '$c("key", "value");', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
        outboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const result = await executor.executeTransformer(connectorMessage);
      expect(result.filtered).toBe(false);
      // Transformer ran, check channel map was updated
      expect(connectorMessage.getChannelMap().get('key')).toBe('value');
    });

    it('should skip disabled transformer steps', async () => {
      const scripts: FilterTransformerScripts = {
        transformerSteps: [
          { name: 'Step1', script: '$c("key1", "value1");', enabled: true },
          { name: 'Step2', script: '$c("key2", "value2");', enabled: false },
        ],
        inboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      await executor.executeTransformer(connectorMessage);
      expect(connectorMessage.getChannelMap().get('key1')).toBe('value1');
      expect(connectorMessage.getChannelMap().get('key2')).toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should run both filter and transformer', async () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          { name: 'Accept', script: 'return true;', operator: 'AND', enabled: true },
        ],
        transformerSteps: [
          { name: 'Transform', script: '$c("executed", "yes");', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
        outboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const result = await executor.execute(connectorMessage);
      expect(result.filtered).toBe(false);
      expect(connectorMessage.getChannelMap().get('executed')).toBe('yes');
    });

    it('should not run transformer when filter rejects', async () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          { name: 'Reject', script: 'return false;', operator: 'AND', enabled: true },
        ],
        transformerSteps: [
          { name: 'Transform', script: '$c("executed", "yes");', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const result = await executor.execute(connectorMessage);
      expect(result.filtered).toBe(true);
      expect(connectorMessage.getChannelMap().get('executed')).toBeUndefined();
    });
  });

  describe('processConnectorMessage', () => {
    it('should update connector message with transformed data', async () => {
      const scripts: FilterTransformerScripts = {
        transformerSteps: [
          { name: 'Transform', script: '$c("key", "value");', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
        outboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const result = await executor.processConnectorMessage(connectorMessage);
      expect(result.filtered).toBe(false);

      // Check transformed content was set
      const transformed = connectorMessage.getTransformedContent();
      expect(transformed).toBeDefined();
    });
  });

  describe('data type handling', () => {
    it('should handle XML inbound type', async () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          {
            name: 'Check XML',
            script: 'return msg !== null && msg !== undefined;',
            operator: 'AND',
            enabled: true,
          },
        ],
        inboundDataType: SerializationType.XML,
      };
      executor.setScripts(scripts);

      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(false); // msg was defined
    });

    it('should handle RAW inbound type', async () => {
      connectorMessage.setContent({
        contentType: ContentType.RAW,
        content: 'plain text message',
        dataType: 'RAW',
        encrypted: false,
      });

      const scripts: FilterTransformerScripts = {
        filterRules: [
          {
            name: 'Check Raw',
            script: 'return typeof msg === "string";',
            operator: 'AND',
            enabled: true,
          },
        ],
        inboundDataType: SerializationType.RAW,
      };
      executor.setScripts(scripts);

      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(false); // msg was string
    });

    it('should handle JSON inbound type', async () => {
      connectorMessage.setContent({
        contentType: ContentType.RAW,
        content: '{"name":"test","value":123}',
        dataType: 'JSON',
        encrypted: false,
      });

      const scripts: FilterTransformerScripts = {
        filterRules: [
          {
            name: 'Check JSON',
            script: 'return msg.name === "test";',
            operator: 'AND',
            enabled: true,
          },
        ],
        inboundDataType: SerializationType.JSON,
      };
      executor.setScripts(scripts);

      const filtered = await executor.executeFilter(connectorMessage);
      expect(filtered).toBe(false); // msg.name was "test"
    });
  });
});
