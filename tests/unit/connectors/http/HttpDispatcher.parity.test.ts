import { HttpDispatcher } from '../../../../src/connectors/http/HttpDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { getDefaultHttpDispatcherProperties } from '../../../../src/connectors/http/HttpConnectorProperties';

/**
 * Parity tests for HTTP Dispatcher - Wave 17 findings:
 * - CPC-RCP-001: replaceConnectorProperties + resolveVariables
 * - CPC-MCP-001: useHeadersVariable / useParametersVariable
 */

function createConnectorMessage(overrides?: Partial<{
  channelMap: Map<string, unknown>;
  sourceMap: Map<string, unknown>;
  connectorMap: Map<string, unknown>;
  rawData: string;
  encodedData: string;
}>): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'HTTP Sender',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (overrides?.channelMap) {
    for (const [k, v] of overrides.channelMap) {
      msg.getChannelMap().set(k, v);
    }
  }
  if (overrides?.sourceMap) {
    for (const [k, v] of overrides.sourceMap) {
      msg.getSourceMap().set(k, v);
    }
  }
  if (overrides?.connectorMap) {
    for (const [k, v] of overrides.connectorMap) {
      msg.getConnectorMap().set(k, v);
    }
  }
  if (overrides?.rawData) {
    msg.setContent({
      contentType: ContentType.RAW,
      content: overrides.rawData,
      dataType: 'RAW',
      encrypted: false,
    });
  }
  if (overrides?.encodedData) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: overrides.encodedData,
      dataType: 'HL7V2',
      encrypted: false,
    });
  }
  return msg;
}

describe('HttpDispatcher Parity (Wave 17)', () => {
  describe('CPC-RCP-001: replaceConnectorProperties', () => {
    let dispatcher: HttpDispatcher;

    beforeEach(() => {
      dispatcher = new HttpDispatcher({
        name: 'Test HTTP Sender',
        metaDataId: 1,
      });
    });

    it('should resolve ${variable} in host from channelMap', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        host: 'https://${targetHost}/api/v1',
      };
      const msg = createConnectorMessage({
        channelMap: new Map([['targetHost', 'api.example.com']]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('https://api.example.com/api/v1');
    });

    it('should resolve ${variable} in content from channelMap', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        content: '{"patientId": "${pid}"}',
      };
      const msg = createConnectorMessage({
        channelMap: new Map([['pid', '12345']]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.content).toBe('{"patientId": "12345"}');
    });

    it('should resolve ${message.encodedData} from encoded content', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        content: '${message.encodedData}',
      };
      const msg = createConnectorMessage({
        encodedData: 'MSH|^~\\&|SENDING|FACILITY',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.content).toBe('MSH|^~\\&|SENDING|FACILITY');
    });

    it('should resolve ${message.rawData} from raw content', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        content: '${message.rawData}',
      };
      const msg = createConnectorMessage({
        rawData: 'RAW_MESSAGE_CONTENT',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.content).toBe('RAW_MESSAGE_CONTENT');
    });

    it('should fall back to rawData when encodedData not available', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        content: '${message.encodedData}',
      };
      const msg = createConnectorMessage({
        rawData: 'FALLBACK_RAW',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.content).toBe('FALLBACK_RAW');
    });

    it('should resolve username and password', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        username: '${apiUser}',
        password: '${apiPass}',
        useAuthentication: true,
      };
      const msg = createConnectorMessage({
        channelMap: new Map([
          ['apiUser', 'admin'],
          ['apiPass', 's3cret'],
        ]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.username).toBe('admin');
      expect(resolved.password).toBe('s3cret');
    });

    it('should resolve contentType and charset', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        contentType: '${ct}',
        charset: '${cs}',
      };
      const msg = createConnectorMessage({
        channelMap: new Map([
          ['ct', 'application/json'],
          ['cs', 'UTF-16'],
        ]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.contentType).toBe('application/json');
      expect(resolved.charset).toBe('UTF-16');
    });

    it('should resolve proxyAddress and proxyPort', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        proxyAddress: '${proxyHost}',
        proxyPort: 0,
      };
      const msg = createConnectorMessage({
        channelMap: new Map([['proxyHost', 'proxy.internal.com']]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.proxyAddress).toBe('proxy.internal.com');
    });

    it('should resolve header values', () => {
      const headers = new Map<string, string[]>();
      headers.set('X-Custom', ['${headerVal}']);
      headers.set('X-Static', ['static-value']);

      const props = {
        ...getDefaultHttpDispatcherProperties(),
        headers,
      };
      const msg = createConnectorMessage({
        channelMap: new Map([['headerVal', 'resolved-header']]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.headers.get('X-Custom')).toEqual(['resolved-header']);
      expect(resolved.headers.get('X-Static')).toEqual(['static-value']);
    });

    it('should resolve parameter values', () => {
      const parameters = new Map<string, string[]>();
      parameters.set('id', ['${patientId}']);
      parameters.set('format', ['json']);

      const props = {
        ...getDefaultHttpDispatcherProperties(),
        parameters,
      };
      const msg = createConnectorMessage({
        channelMap: new Map([['patientId', 'P-001']]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.parameters.get('id')).toEqual(['P-001']);
      expect(resolved.parameters.get('format')).toEqual(['json']);
    });

    it('should leave unresolved variables as-is', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        host: 'https://${unknownVar}/api',
      };
      const msg = createConnectorMessage();

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('https://${unknownVar}/api');
    });

    it('should not modify templates without ${} placeholders', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        host: 'https://static.example.com/api',
        content: 'plain content',
      };
      const msg = createConnectorMessage();

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('https://static.example.com/api');
      expect(resolved.content).toBe('plain content');
    });

    it('should check sourceMap when channelMap has no match', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        host: 'https://${fromSource}/api',
      };
      const msg = createConnectorMessage({
        sourceMap: new Map([['fromSource', 'source-host.com']]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('https://source-host.com/api');
    });

    it('should check connectorMap as last fallback', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        host: 'https://${fromConnector}/api',
      };
      const msg = createConnectorMessage({
        connectorMap: new Map([['fromConnector', 'connector-host.com']]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('https://connector-host.com/api');
    });

    it('should not mutate original properties', () => {
      const originalHost = 'https://${host}/api';
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        host: originalHost,
      };
      const msg = createConnectorMessage({
        channelMap: new Map([['host', 'resolved.com']]),
      });

      dispatcher.replaceConnectorProperties(props, msg);
      // Original object should be unchanged (spread clone)
      expect(props.host).toBe(originalHost);
    });

    it('should resolve multiple variables in a single string', () => {
      const props = {
        ...getDefaultHttpDispatcherProperties(),
        host: 'https://${host}:${port}/api/${version}',
      };
      const msg = createConnectorMessage({
        channelMap: new Map([
          ['host', 'api.example.com'],
          ['port', '8443'],
          ['version', 'v2'],
        ]),
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('https://api.example.com:8443/api/v2');
    });
  });

  describe('CPC-MCP-001: variable headers and parameters', () => {
    it('should include useHeadersVariable and useParametersVariable in default properties', () => {
      const defaults = getDefaultHttpDispatcherProperties();
      expect(defaults.useHeadersVariable).toBe(false);
      expect(defaults.headersVariable).toBe('');
      expect(defaults.useParametersVariable).toBe(false);
      expect(defaults.parametersVariable).toBe('');
    });

    it('should create dispatcher with variable header properties', () => {
      const dispatcher = new HttpDispatcher({
        name: 'Test',
        metaDataId: 1,
        properties: {
          useHeadersVariable: true,
          headersVariable: 'myHeaders',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useHeadersVariable).toBe(true);
      expect(props.headersVariable).toBe('myHeaders');
    });

    it('should create dispatcher with variable parameter properties', () => {
      const dispatcher = new HttpDispatcher({
        name: 'Test',
        metaDataId: 1,
        properties: {
          useParametersVariable: true,
          parametersVariable: 'myParams',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useParametersVariable).toBe(true);
      expect(props.parametersVariable).toBe('myParams');
    });
  });
});
