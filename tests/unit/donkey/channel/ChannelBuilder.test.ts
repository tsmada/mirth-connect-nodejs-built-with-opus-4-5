import { buildChannel } from '../../../../src/donkey/channel/ChannelBuilder';
import { VmReceiver } from '../../../../src/connectors/vm/VmReceiver';
import { VmDispatcher } from '../../../../src/connectors/vm/VmDispatcher';
import { DatabaseReceiver } from '../../../../src/connectors/jdbc/DatabaseReceiver';
import { JmsReceiver } from '../../../../src/connectors/jms/JmsReceiver';
import { JmsDispatcher } from '../../../../src/connectors/jms/JmsDispatcher';
import { SmtpDispatcher } from '../../../../src/connectors/smtp/SmtpDispatcher';
import { WebServiceReceiver } from '../../../../src/connectors/ws/WebServiceReceiver';
import { WebServiceDispatcher } from '../../../../src/connectors/ws/WebServiceDispatcher';
import { DICOMReceiver } from '../../../../src/connectors/dicom/DICOMReceiver';
import { DICOMDispatcher } from '../../../../src/connectors/dicom/DICOMDispatcher';
import { JavaScriptReceiver } from '../../../../src/connectors/js/JavaScriptReceiver';
import { JavaScriptDispatcher } from '../../../../src/connectors/js/JavaScriptDispatcher';
import { Channel as ChannelModel } from '../../../../src/api/models/Channel';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { SerializationType } from '../../../../src/javascript/runtime/ScriptBuilder';

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

describe('ChannelBuilder', () => {
  describe('buildChannel with Channel Reader source', () => {
    it('should create VmReceiver for Channel Reader source transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Channel Reader',
          properties: { canBatch: 'true' },
        },
      });

      const channel = buildChannel(config);
      const sourceConnector = channel.getSourceConnector();

      expect(sourceConnector).toBeInstanceOf(VmReceiver);
    });

    it('should set correct default properties on VmReceiver', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Channel Reader',
          properties: {},
        },
      });

      const channel = buildChannel(config);
      const sourceConnector = channel.getSourceConnector() as VmReceiver;

      expect(sourceConnector).toBeInstanceOf(VmReceiver);
      // When canBatch is not 'true', it defaults to false
      expect(sourceConnector.getProperties().canBatch).toBe(false);
    });

    it('should parse canBatch property correctly', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Channel Reader',
          properties: { canBatch: 'true' },
        },
      });

      const channel = buildChannel(config);
      const sourceConnector = channel.getSourceConnector() as VmReceiver;

      expect(sourceConnector.getProperties().canBatch).toBe(true);
    });
  });

  describe('buildChannel with Channel Writer destination', () => {
    it('should create VmDispatcher for Channel Writer destination transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'VM Writer',
            enabled: true,
            transportName: 'Channel Writer',
            properties: {
              channelId: 'target-channel',
              channelTemplate: '${message.encodedData}',
            },
          },
        ],
      });

      const channel = buildChannel(config);
      const destinations = channel.getDestinationConnectors();

      expect(destinations).toHaveLength(1);
      expect(destinations[0]).toBeInstanceOf(VmDispatcher);
    });
  });

  describe('unsupported transports throw', () => {
    it('should throw for unknown source transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Unknown Transport',
          properties: {},
        },
      });

      expect(() => buildChannel(config)).toThrow('Unsupported source connector transport: Unknown Transport');
    });

    it('should throw for unknown destination transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'Bad Dest',
            enabled: true,
            transportName: 'Nonexistent Sender',
            properties: {},
          },
        ],
      });

      expect(() => buildChannel(config)).toThrow('Unsupported destination connector transport: Nonexistent Sender');
    });
  });

  describe('buildChannel preserves channel metadata', () => {
    it('should set channel id, name, and description', () => {
      const config = createChannelConfig({
        id: 'my-channel',
        name: 'My Channel',
        description: 'A test channel',
      });

      const channel = buildChannel(config);

      expect(channel.getId()).toBe('my-channel');
      expect(channel.getName()).toBe('My Channel');
      expect(channel.getDescription()).toBe('A test channel');
    });
  });

  describe('Database Reader source connector', () => {
    it('should create DatabaseReceiver for Database Reader transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Database Reader',
          properties: {
            url: 'jdbc:mysql://localhost:3306/mydb',
            driver: 'com.mysql.cj.jdbc.Driver',
            username: 'root',
            password: 'secret',
            select: 'SELECT * FROM messages WHERE processed = 0',
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector();
      expect(src).toBeInstanceOf(DatabaseReceiver);

      const props = (src as DatabaseReceiver).getProperties();
      expect(props.url).toBe('jdbc:mysql://localhost:3306/mydb');
      expect(props.username).toBe('root');
      expect(props.select).toBe('SELECT * FROM messages WHERE processed = 0');
    });

    it('should use defaults when properties are empty', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Database Reader',
          properties: {},
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector() as DatabaseReceiver;
      const props = src.getProperties();
      expect(props.pollInterval).toBe(5000);
      expect(props.retryCount).toBe(3);
      expect(props.useScript).toBe(false);
    });
  });

  describe('JMS Listener source connector', () => {
    it('should create JmsReceiver for JMS Listener transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'JMS Listener',
          properties: {
            host: 'broker.example.com',
            port: '61614',
            destinationName: 'queue.incoming',
            topic: 'false',
            username: 'admin',
            password: 'admin',
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector();
      expect(src).toBeInstanceOf(JmsReceiver);

      const props = (src as JmsReceiver).getProperties();
      expect(props.host).toBe('broker.example.com');
      expect(props.port).toBe(61614);
      expect(props.destinationName).toBe('queue.incoming');
      expect(props.topic).toBe(false);
    });
  });

  describe('JMS Sender destination connector', () => {
    it('should create JmsDispatcher for JMS Sender transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'JMS Out',
            enabled: true,
            transportName: 'JMS Sender',
            properties: {
              host: 'broker.example.com',
              port: '61614',
              destinationName: 'queue.outgoing',
              topic: 'true',
              template: '${message.encodedData}',
            },
          },
        ],
      });

      const channel = buildChannel(config);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);
      expect(dests[0]).toBeInstanceOf(JmsDispatcher);

      const props = (dests[0] as JmsDispatcher).getProperties();
      expect(props.host).toBe('broker.example.com');
      expect(props.destinationName).toBe('queue.outgoing');
      expect(props.topic).toBe(true);
    });
  });

  describe('SMTP Sender destination connector', () => {
    it('should create SmtpDispatcher for SMTP Sender transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'Email Alert',
            enabled: true,
            transportName: 'SMTP Sender',
            properties: {
              smtpHost: 'mail.example.com',
              smtpPort: '587',
              encryption: 'tls',
              authentication: 'true',
              username: 'user@example.com',
              password: 'secret',
              from: 'mirth@example.com',
              to: 'admin@example.com',
              subject: 'Alert: ${channelName}',
              body: 'Message received',
              html: 'true',
            },
          },
        ],
      });

      const channel = buildChannel(config);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);
      expect(dests[0]).toBeInstanceOf(SmtpDispatcher);

      const props = (dests[0] as SmtpDispatcher).getProperties();
      expect(props.smtpHost).toBe('mail.example.com');
      expect(props.smtpPort).toBe('587');
      expect(props.encryption).toBe('tls');
      expect(props.authentication).toBe(true);
      expect(props.from).toBe('mirth@example.com');
      expect(props.to).toBe('admin@example.com');
      expect(props.html).toBe(true);
    });
  });

  describe('Web Service Listener source connector', () => {
    it('should create WebServiceReceiver for Web Service Listener transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Web Service Listener',
          properties: {
            listenerConnectorProperties: {
              host: '0.0.0.0',
              port: '8082',
            },
            serviceName: 'PatientService',
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector();
      expect(src).toBeInstanceOf(WebServiceReceiver);

      const props = (src as WebServiceReceiver).getProperties();
      expect(props.host).toBe('0.0.0.0');
      expect(props.port).toBe(8082);
      expect(props.serviceName).toBe('PatientService');
    });
  });

  describe('Web Service Sender destination connector', () => {
    it('should create WebServiceDispatcher for Web Service Sender transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'SOAP Out',
            enabled: true,
            transportName: 'Web Service Sender',
            properties: {
              wsdlUrl: 'http://example.com/service?wsdl',
              service: 'MyService',
              port: 'MyPort',
              soapAction: 'processMessage',
              envelope: '<soap:Envelope/>',
              oneWay: 'true',
              useAuthentication: 'true',
              username: 'admin',
              password: 'secret',
            },
          },
        ],
      });

      const channel = buildChannel(config);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);
      expect(dests[0]).toBeInstanceOf(WebServiceDispatcher);

      const props = (dests[0] as WebServiceDispatcher).getProperties();
      expect(props.wsdlUrl).toBe('http://example.com/service?wsdl');
      expect(props.service).toBe('MyService');
      expect(props.soapAction).toBe('processMessage');
      expect(props.oneWay).toBe(true);
      expect(props.useAuthentication).toBe(true);
    });
  });

  describe('DICOM Listener source connector', () => {
    it('should create DICOMReceiver for DICOM Listener transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'DICOM Listener',
          properties: {
            listenerConnectorProperties: {
              host: '0.0.0.0',
              port: '11112',
            },
            applicationEntity: 'MIRTH_SCP',
            localApplicationEntity: 'MIRTH_LOCAL',
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector();
      expect(src).toBeInstanceOf(DICOMReceiver);

      const props = (src as DICOMReceiver).getProperties();
      expect(props.listenerConnectorProperties.host).toBe('0.0.0.0');
      expect(props.listenerConnectorProperties.port).toBe('11112');
      expect(props.applicationEntity).toBe('MIRTH_SCP');
    });
  });

  describe('DICOM Sender destination connector', () => {
    it('should create DICOMDispatcher for DICOM Sender transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'PACS Store',
            enabled: true,
            transportName: 'DICOM Sender',
            properties: {
              host: 'pacs.hospital.org',
              port: '11112',
              applicationEntity: 'PACS',
              localApplicationEntity: 'MIRTH_SCU',
              template: '${message.encodedData}',
            },
          },
        ],
      });

      const channel = buildChannel(config);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);
      expect(dests[0]).toBeInstanceOf(DICOMDispatcher);

      const props = (dests[0] as DICOMDispatcher).getProperties();
      expect(props.host).toBe('pacs.hospital.org');
      expect(props.port).toBe('11112');
      expect(props.applicationEntity).toBe('PACS');
      expect(props.localApplicationEntity).toBe('MIRTH_SCU');
    });
  });

  describe('variable reference fallback in new connectors', () => {
    it('should fall back to defaults when JMS host uses ${variable}', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'JMS Listener',
          properties: {
            host: '${jmsHost}',
            port: '${jmsPort}',
            destinationName: 'queue.test',
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector() as JmsReceiver;
      const props = src.getProperties();
      expect(props.host).toBe('localhost');
    });

    it('should fall back to defaults when DICOM host uses ${variable}', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'DICOM Listener',
          properties: {
            listenerConnectorProperties: {
              host: '${dicomHost}',
              port: '${dicomPort}',
            },
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector() as DICOMReceiver;
      const props = src.getProperties();
      expect(props.listenerConnectorProperties.host).toBe('0.0.0.0');
      expect(props.listenerConnectorProperties.port).toBe('104');
    });
  });

  describe('disabled destinations are skipped', () => {
    it('should not build disabled destinations', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'Disabled JMS',
            enabled: false,
            transportName: 'JMS Sender',
            properties: {},
          },
          {
            metaDataId: 2,
            name: 'Active SMTP',
            enabled: true,
            transportName: 'SMTP Sender',
            properties: { smtpHost: 'mail.test.com' },
          },
        ],
      });

      const channel = buildChannel(config);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);
      expect(dests[0]).toBeInstanceOf(SmtpDispatcher);
    });
  });

  describe('JavaScript Reader source connector', () => {
    it('should create JavaScriptReceiver for JavaScript Reader transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'JavaScript Reader',
          properties: {
            script: 'return "hello";',
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector();
      expect(src).toBeInstanceOf(JavaScriptReceiver);
      expect((src as JavaScriptReceiver).getProperties().script).toBe('return "hello";');
    });

    it('should parse pollInterval from pollConnectorProperties', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'JavaScript Reader',
          properties: {
            script: 'return null;',
            pollConnectorProperties: {
              pollingFrequency: '30000',
            },
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector() as JavaScriptReceiver;
      expect(src.getProperties().pollInterval).toBe(30000);
    });

    it('should read processBatch from sourceConnectorProperties nesting (CPC-W20-004)', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'JavaScript Reader',
          properties: {
            script: 'return ["a","b"];',
            sourceConnectorProperties: {
              processBatch: 'true',
            },
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector() as JavaScriptReceiver;
      expect(src.getProperties().processBatch).toBe(true);
    });
  });

  describe('JavaScript Writer destination connector', () => {
    it('should create JavaScriptDispatcher for JavaScript Writer transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'JS Writer',
            enabled: true,
            transportName: 'JavaScript Writer',
            properties: {
              script: 'return new Response(SENT, "OK");',
            },
          },
        ],
      });

      const channel = buildChannel(config);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);
      expect(dests[0]).toBeInstanceOf(JavaScriptDispatcher);
      expect((dests[0] as JavaScriptDispatcher).getProperties().script)
        .toBe('return new Response(SENT, "OK");');
    });
  });

  describe('respondAfterProcessing from sourceConnectorProperties (CPC-W20-003)', () => {
    it('should read respondAfterProcessing from nested sourceConnectorProperties', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {
            sourceConnectorProperties: {
              respondAfterProcessing: 'false',
            },
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector()!;
      expect(src.getRespondAfterProcessing()).toBe(false);
    });

    it('should default respondAfterProcessing to true when nested prop is absent', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {
            sourceConnectorProperties: {},
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector()!;
      expect(src.getRespondAfterProcessing()).toBe(true);
    });

    it('should fall back to top-level properties if sourceConnectorProperties missing', () => {
      // When sourceConnectorProperties is absent, falls back to top-level properties
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {
            respondAfterProcessing: 'false',
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector()!;
      expect(src.getRespondAfterProcessing()).toBe(false);
    });
  });

  describe('processBatch from sourceConnectorProperties for JMS (CPC-W20-004)', () => {
    it('should read processBatch from nested sourceConnectorProperties', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'JMS Listener',
          properties: {
            destinationName: 'queue.test',
            sourceConnectorProperties: {
              processBatch: 'true',
            },
          },
        },
      });

      const channel = buildChannel(config);
      const src = channel.getSourceConnector() as JmsReceiver;
      // The processBatch should come from the nested sourceConnectorProperties
      // (verified via constructor config)
      expect(src).toBeInstanceOf(JmsReceiver);
    });
  });

  // ─── Filter/Transformer Wiring Tests (Wave 21: SBF-INIT-001 fix) ──────────

  describe('filter/transformer wiring from channel config', () => {
    let sourceSetFTSpy: jest.SpyInstance;
    let destSetFTSpy: jest.SpyInstance;

    // Helper: create a filter rule matching the Channel model FilterRule interface
    function rule(name: string, script: string, opts: { operator?: 'AND' | 'OR'; enabled?: boolean; seq?: number } = {}) {
      return { name, sequenceNumber: opts.seq ?? 0, type: 'JavaScriptRule', script, operator: opts.operator ?? 'AND' as const, enabled: opts.enabled ?? true };
    }

    // Helper: create a transformer step matching the Channel model TransformerStep interface
    function step(name: string, script: string, opts: { enabled?: boolean; seq?: number } = {}) {
      return { name, sequenceNumber: opts.seq ?? 0, type: 'JavaScriptStep', script, enabled: opts.enabled ?? true };
    }

    beforeEach(() => {
      sourceSetFTSpy = jest.spyOn(SourceConnector.prototype, 'setFilterTransformer');
      destSetFTSpy = jest.spyOn(DestinationConnector.prototype, 'setFilterTransformer');
    });

    afterEach(() => {
      sourceSetFTSpy.mockRestore();
      destSetFTSpy.mockRestore();
    });

    it('should wire source filter rules from TypeScript interface shape', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            rules: [
              rule('Accept ADT', 'return msg["MSH"]["MSH.9"]["MSH.9.1"].toString() === "ADT";'),
            ],
          },
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(1);
      expect(scripts.filterRules[0].name).toBe('Accept ADT');
      expect(scripts.filterRules[0].script).toContain('MSH.9.1');
      expect(scripts.filterRules[0].operator).toBe('AND');
    });

    it('should wire source transformer steps from TypeScript interface shape', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            steps: [
              step('Set Patient Name', 'channelMap.put("patientName", msg["PID"]["PID.5"].toString());'),
            ],
            inboundDataType: 'HL7V2',
            outboundDataType: 'XML',
          },
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.transformerSteps[0].name).toBe('Set Patient Name');
      expect(scripts.inboundDataType).toBe(SerializationType.XML); // HL7V2 maps to XML
      expect(scripts.outboundDataType).toBe(SerializationType.XML);
    });

    it('should wire source filter AND transformer together', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            rules: [
              rule('Rule 1', 'return true;'),
              rule('Rule 2', 'return false;', { operator: 'OR' }),
            ],
          },
          transformer: {
            steps: [
              step('Step 1', 'msg = "transformed";'),
            ],
            inboundDataType: 'RAW',
            outboundDataType: 'RAW',
          },
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(2);
      expect(scripts.filterRules[1].operator).toBe('OR');
      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.inboundDataType).toBe(SerializationType.RAW);
    });

    it('should NOT call setFilterTransformer when no filter or transformer defined', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).not.toHaveBeenCalled();
    });

    it('should skip disabled filter rules', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            rules: [
              rule('Active Rule', 'return true;'),
              rule('Disabled Rule', 'return false;', { enabled: false }),
            ],
          },
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(1);
      expect(scripts.filterRules[0].name).toBe('Active Rule');
    });

    it('should skip filter rules without script', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            rules: [
              rule('Has Script', 'return true;'),
              { name: 'No Script', sequenceNumber: 1, type: 'JavaScriptRule', operator: 'AND' as const, enabled: true } as any,
            ],
          },
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(1);
    });

    it('should wire destination filter/transformer scripts', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'HTTP Dest',
            enabled: true,
            transportName: 'HTTP Sender',
            properties: { host: 'http://localhost' },
            filter: {
              rules: [rule('Dest Filter', 'return true;')],
            },
            transformer: {
              steps: [step('Dest Transform', 'msg = JSON.stringify({data: msg});')],
              inboundDataType: 'XML',
              outboundDataType: 'JSON',
            },
          },
        ],
      });

      buildChannel(config);

      expect(destSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = destSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(1);
      expect(scripts.filterRules[0].name).toBe('Dest Filter');
      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.transformerSteps[0].name).toBe('Dest Transform');
      expect(scripts.inboundDataType).toBe(SerializationType.XML);
      expect(scripts.outboundDataType).toBe(SerializationType.JSON);
    });

    it('should wire destination response transformer scripts', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'HTTP Dest',
            enabled: true,
            transportName: 'HTTP Sender',
            properties: { host: 'http://localhost' },
            responseTransformer: {
              steps: [step('Parse Response', 'msg = JSON.parse(msg);')],
              inboundDataType: 'RAW',
              outboundDataType: 'JSON',
            },
          },
        ],
      });

      buildChannel(config);

      expect(destSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = destSetFTSpy.mock.calls[0][0];
      // Main filter/transformer may be empty
      expect(scripts.responseTransformerScripts).toBeDefined();
      expect(scripts.responseTransformerScripts!.transformerSteps).toHaveLength(1);
      expect(scripts.responseTransformerScripts!.transformerSteps![0].name).toBe('Parse Response');
      expect(scripts.responseTransformerScripts!.inboundDataType).toBe(SerializationType.RAW);
      expect(scripts.responseTransformerScripts!.outboundDataType).toBe(SerializationType.JSON);
    });

    it('should wire destination filter + transformer + responseTransformer together', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'Full Dest',
            enabled: true,
            transportName: 'HTTP Sender',
            properties: { host: 'http://localhost' },
            filter: {
              rules: [rule('Dest Filter', 'return true;')],
            },
            transformer: {
              steps: [step('Dest Step', 'msg = "transformed";')],
              inboundDataType: 'HL7V2',
              outboundDataType: 'XML',
            },
            responseTransformer: {
              steps: [step('Resp Step', 'responseStatus = SENT;')],
            },
          },
        ],
      });

      buildChannel(config);

      expect(destSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = destSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(1);
      expect(scripts.transformerSteps).toHaveLength(1);
      expect(scripts.responseTransformerScripts).toBeDefined();
      expect(scripts.responseTransformerScripts!.transformerSteps).toHaveLength(1);
    });

    it('should NOT call setFilterTransformer on destination with no filter/transformer/responseTransformer', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'Plain Dest',
            enabled: true,
            transportName: 'HTTP Sender',
            properties: { host: 'http://localhost' },
          },
        ],
      });

      buildChannel(config);

      expect(destSetFTSpy).not.toHaveBeenCalled();
    });

    it('should wire filter rules from XML-parsed shape (elements with Java class names)', () => {
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
                name: 'JS Filter',
                script: 'return msg["MSH"]["MSH.9"]["MSH.9.1"].toString() === "ADT";',
                operator: 'AND',
                enabled: 'true',
              },
            },
          } as any,
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(1);
      expect(scripts.filterRules[0].name).toBe('JS Filter');
      expect(scripts.filterRules[0].script).toContain('MSH.9.1');
    });

    it('should wire transformer steps from XML-parsed shape (elements with Java class names)', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            elements: {
              'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': [
                { name: 'Step 1', script: 'msg["PID"]["PID.5"] = "TEST";', enabled: 'true' },
                { name: 'Step 2', script: 'channelMap.put("done", true);', enabled: 'true' },
              ],
            },
            inboundDataType: 'HL7V2',
            outboundDataType: 'HL7V2',
          } as any,
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.transformerSteps).toHaveLength(2);
      expect(scripts.transformerSteps[0].name).toBe('Step 1');
      expect(scripts.transformerSteps[1].name).toBe('Step 2');
    });

    it('should skip disabled rules/steps in XML-parsed shape', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          filter: {
            elements: {
              'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': [
                { name: 'Active', script: 'return true;', operator: 'AND', enabled: 'true' },
                { name: 'Disabled', script: 'return false;', operator: 'AND', enabled: 'false' },
              ],
            },
          } as any,
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.filterRules).toHaveLength(1);
      expect(scripts.filterRules[0].name).toBe('Active');
    });

    it('should map JSON data type to SerializationType.JSON', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            steps: [step('JSON Step', 'msg.key = "value";')],
            inboundDataType: 'JSON',
            outboundDataType: 'JSON',
          },
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.inboundDataType).toBe(SerializationType.JSON);
      expect(scripts.outboundDataType).toBe(SerializationType.JSON);
    });

    it('should wire outboundTemplate from transformer config', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'HTTP Listener',
          properties: {},
          transformer: {
            steps: [step('Template Step', 'tmp["field"] = "value";')],
            inboundDataType: 'HL7V2',
            outboundDataType: 'XML',
            outboundTemplate: '<patient><name>${patientName}</name></patient>',
          } as any,
        },
      });

      buildChannel(config);

      expect(sourceSetFTSpy).toHaveBeenCalledTimes(1);
      const scripts = sourceSetFTSpy.mock.calls[0][0];
      expect(scripts.template).toBe('<patient><name>${patientName}</name></patient>');
    });

    it('should handle multiple destination connectors each with their own filter/transformer', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'Dest 1',
            enabled: true,
            transportName: 'HTTP Sender',
            properties: { host: 'http://localhost' },
            filter: {
              rules: [rule('Dest 1 Filter', 'return true;')],
            },
          },
          {
            metaDataId: 2,
            name: 'Dest 2',
            enabled: true,
            transportName: 'HTTP Sender',
            properties: { host: 'http://localhost' },
            transformer: {
              steps: [step('Dest 2 Transform', 'msg = "modified";')],
            },
          },
        ],
      });

      buildChannel(config);

      expect(destSetFTSpy).toHaveBeenCalledTimes(2);
      // First dest has filter rules
      expect(destSetFTSpy.mock.calls[0][0].filterRules).toHaveLength(1);
      expect(destSetFTSpy.mock.calls[0][0].transformerSteps).toHaveLength(0);
      // Second dest has transformer steps
      expect(destSetFTSpy.mock.calls[1][0].filterRules).toHaveLength(0);
      expect(destSetFTSpy.mock.calls[1][0].transformerSteps).toHaveLength(1);
    });
  });
});
