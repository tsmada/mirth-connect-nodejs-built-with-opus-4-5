/**
 * Tests for ChannelBuilder integration with StepCompiler.
 *
 * These tests use XML-parsed channel config format (with `elements` property)
 * rather than the TypeScript API format (with `steps`/`rules` arrays).
 * ChannelBuilder handles both shapes at runtime — see extractFilterRules()
 * and extractTransformerSteps() for the dual-shape handling.
 *
 * We use `as any` casts because the TypeScript interfaces define the API shape,
 * but the XML-parsed shape (from database channel XML via fast-xml-parser) uses
 * a different structure that ChannelBuilder handles dynamically.
 */
import { buildChannel } from '../../../../src/donkey/channel/ChannelBuilder';
import { Channel as ChannelModel } from '../../../../src/api/models/Channel';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';

/**
 * Helper: extract filter/transformer scripts from a connector's internal executor.
 * The scripts are stored in filterTransformerExecutor, not as a direct property.
 */
function getScripts(connector: SourceConnector | DestinationConnector): {
  filterRules: Array<{ script: string; name: string }>;
  transformerSteps: Array<{ script: string; name: string }>;
} {
  const executor = (connector as any).filterTransformerExecutor;
  return {
    filterRules: executor?.filterRules ?? [],
    transformerSteps: executor?.transformerSteps ?? [],
  };
}

function createChannelConfig(overrides: Partial<ChannelModel> = {}): ChannelModel {
  return {
    id: 'test-channel-id',
    name: 'Test Channel',
    revision: 1,
    enabled: true,
    sourceConnector: {
      metaDataId: 0,
      name: 'Source',
      enabled: true,
      transportName: 'HTTP Listener',
      properties: {},
    },
    destinationConnectors: [],
    properties: {
      clearGlobalChannelMap: true,
      messageStorageMode: 'DEVELOPMENT',
      initialState: DeployedState.STARTED,
    },
    ...overrides,
  };
}

describe('ChannelBuilder — Non-JavaScript Step Compilation', () => {
  describe('MapperStep in transformer', () => {
    it('should compile MapperStep elements without inline script', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            elements: {
              'com.mirth.connect.plugins.mapper.MapperStep': {
                enabled: true,
                variable: 'patientMRN',
                mapping: "msg['PID']['PID.3']['PID.3.1'].toString()",
                defaultValue: "''",
                scope: 'CHANNEL',
              },
            },
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts).toBeDefined();
      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.transformerSteps[0]!.script).toContain("channelMap.put('patientMRN'");
      expect(scripts.transformerSteps[0]!.script).toContain('validate(');
    });

    it('should compile multiple MapperStep elements', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            elements: {
              'com.mirth.connect.plugins.mapper.MapperStep': [
                {
                  enabled: true,
                  variable: 'firstName',
                  mapping: "msg['PID']['PID.5']['PID.5.2'].toString()",
                  defaultValue: "''",
                  scope: 'CHANNEL',
                },
                {
                  enabled: true,
                  variable: 'lastName',
                  mapping: "msg['PID']['PID.5']['PID.5.1'].toString()",
                  defaultValue: "''",
                  scope: 'CHANNEL',
                },
              ],
            },
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts.transformerSteps).toHaveLength(2);
      expect(scripts.transformerSteps[0]!.script).toContain("channelMap.put('firstName'");
      expect(scripts.transformerSteps[1]!.script).toContain("channelMap.put('lastName'");
    });
  });

  describe('MessageBuilderStep in transformer', () => {
    it('should compile MessageBuilderStep elements without inline script', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            elements: {
              'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep': {
                enabled: true,
                messageSegment: "tmp['PID']['PID.3']['PID.3.1']",
                mapping: "'12345'",
                defaultValue: "''",
              },
            },
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts).toBeDefined();
      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.transformerSteps[0]!.script).toContain(
        "tmp['PID']['PID.3']['PID.3.1'] = validate("
      );
    });
  });

  describe('Mixed JavaScriptStep + non-JS steps', () => {
    it('should handle both JavaScriptStep (with script) and MapperStep (without script)', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            elements: {
              'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                enabled: true,
                name: 'JS Step',
                script: "channelMap.put('customVar', 'hello');",
              },
              'com.mirth.connect.plugins.mapper.MapperStep': {
                enabled: true,
                variable: 'mappedVar',
                mapping: "msg['PID']['PID.3'].toString()",
                defaultValue: "''",
                scope: 'CHANNEL',
              },
            },
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts.transformerSteps).toHaveLength(2);
      // JavaScriptStep retains its original script
      expect(scripts.transformerSteps[0]!.script).toContain("channelMap.put('customVar'");
      // MapperStep is compiled
      expect(scripts.transformerSteps[1]!.script).toContain("channelMap.put('mappedVar'");
    });
  });

  describe('RuleBuilderRule in filter', () => {
    it('should compile RuleBuilderRule elements to boolean expressions', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            elements: {
              'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': {
                enabled: true,
                name: 'Check MSH.9',
                field: "msg['MSH']['MSH.9']['MSH.9.1']",
                condition: 'EQUALS',
                values: { string: 'ADT' },
                operator: 'AND',
              },
            },
          } as any,
          transformer: {
            elements: {},
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts).toBeDefined();
      expect(scripts.filterRules).toHaveLength(1);
      expect(scripts.filterRules[0]!.script).toContain("== 'ADT'");
    });

    it('should handle mixed JavaScriptRule + RuleBuilderRule', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            elements: {
              'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': {
                enabled: true,
                name: 'JS Rule',
                script: "return msg['MSH']['MSH.9'] != null;",
                operator: 'AND',
              },
              'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': {
                enabled: true,
                name: 'Check PID exists',
                field: "msg['PID']['PID.3']",
                condition: 'EXISTS',
                operator: 'AND',
              },
            },
          } as any,
          transformer: {
            elements: {},
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts.filterRules).toHaveLength(2);
      // JavaScriptRule retains its script
      expect(scripts.filterRules[0]!.script).toContain("return msg['MSH']['MSH.9']");
      // RuleBuilderRule is compiled
      expect(scripts.filterRules[1]!.script).toContain('.toString().length > 0');
    });
  });

  describe('Disabled steps', () => {
    it('should skip disabled MapperStep elements', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            elements: {
              'com.mirth.connect.plugins.mapper.MapperStep': [
                {
                  enabled: true,
                  variable: 'activeVar',
                  mapping: "'active'",
                  scope: 'CHANNEL',
                },
                {
                  enabled: false,
                  variable: 'disabledVar',
                  mapping: "'disabled'",
                  scope: 'CHANNEL',
                },
              ],
            },
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.transformerSteps[0]!.script).toContain("channelMap.put('activeVar'");
    });

    it('should skip disabled RuleBuilderRule elements', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            elements: {
              'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': [
                {
                  enabled: true,
                  field: "msg['PID']['PID.3']",
                  condition: 'EXISTS',
                  operator: 'AND',
                },
                {
                  enabled: false,
                  field: "msg['PID']['PID.5']",
                  condition: 'EXISTS',
                  operator: 'AND',
                },
              ],
            },
          } as any,
          transformer: {
            elements: {},
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      const channel = buildChannel(config);
      const source = channel.getSourceConnector();
      const scripts = getScripts(source!);

      expect(scripts.filterRules).toHaveLength(1);
    });
  });

  describe('Destination connector non-JS steps', () => {
    it('should compile MapperStep in destination transformer', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'DB Writer',
            enabled: true,
            transportName: 'Database Writer',
            properties: {
              url: 'jdbc:mysql://localhost:3306/test',
              query: 'INSERT INTO patients VALUES (?)',
            },
            transformer: {
              elements: {
                'com.mirth.connect.plugins.mapper.MapperStep': {
                  enabled: true,
                  variable: 'dbField',
                  mapping: "msg['PID']['PID.3'].toString()",
                  defaultValue: "''",
                  scope: 'CONNECTOR',
                },
              },
              inboundDataType: 'HL7V2',
              outboundDataType: 'HL7V2',
            } as any,
          },
        ],
      });

      const channel = buildChannel(config);
      const dests = channel.getDestinationConnectors();

      expect(dests).toHaveLength(1);
      const scripts = getScripts(dests[0]!);
      expect(scripts).toBeDefined();
      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.transformerSteps[0]!.script).toContain("connectorMap.put('dbField'");
    });
  });
});
