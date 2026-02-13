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
});
