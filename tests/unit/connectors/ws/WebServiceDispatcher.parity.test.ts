/**
 * Parity tests for WebServiceDispatcher - CPC-RCP-003
 * Tests replaceConnectorProperties() variable resolution matching Java behavior.
 */

import {
  WebServiceDispatcher,
} from '../../../../src/connectors/ws/WebServiceDispatcher.js';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage.js';
import { ContentType } from '../../../../src/model/ContentType.js';
import { Status } from '../../../../src/model/Status.js';

function createConnectorMessage(
  maps?: {
    channelMap?: Map<string, unknown>;
    sourceMap?: Map<string, unknown>;
    connectorMap?: Map<string, unknown>;
    rawData?: string;
    encodedData?: string;
  }
): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'WS Sender',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (maps?.channelMap) {
    for (const [k, v] of maps.channelMap) {
      msg.getChannelMap().set(k, v);
    }
  }
  if (maps?.sourceMap) {
    for (const [k, v] of maps.sourceMap) {
      msg.getSourceMap().set(k, v);
    }
  }
  if (maps?.connectorMap) {
    for (const [k, v] of maps.connectorMap) {
      msg.getConnectorMap().set(k, v);
    }
  }
  if (maps?.rawData) {
    msg.setRawData(maps.rawData);
  }
  if (maps?.encodedData) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: maps.encodedData,
      dataType: 'XML',
      encrypted: false,
    });
  }

  return msg;
}

describe('WebServiceDispatcher.replaceConnectorProperties (CPC-RCP-003)', () => {
  let dispatcher: WebServiceDispatcher;

  beforeEach(() => {
    dispatcher = new WebServiceDispatcher({ metaDataId: 1 });
  });

  it('should resolve ${variable} in wsdlUrl', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([['wsdlEndpoint', 'http://example.com/ws?wsdl']]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        wsdlUrl: '${wsdlEndpoint}',
      },
      connectorMessage
    );

    expect(result.wsdlUrl).toBe('http://example.com/ws?wsdl');
  });

  it('should resolve ${variable} in service and port', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([
        ['svcName', 'PatientService'],
        ['portName', 'PatientPort'],
      ]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        service: '${svcName}',
        port: '${portName}',
      },
      connectorMessage
    );

    expect(result.service).toBe('PatientService');
    expect(result.port).toBe('PatientPort');
  });

  it('should resolve ${variable} in locationURI and soapAction', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([
        ['targetUrl', 'http://remote:8080/service'],
        ['action', 'urn:processMessage'],
      ]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        locationURI: '${targetUrl}',
        soapAction: '${action}',
      },
      connectorMessage
    );

    expect(result.locationURI).toBe('http://remote:8080/service');
    expect(result.soapAction).toBe('urn:processMessage');
  });

  it('should resolve ${variable} in envelope', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([['patientId', 'P12345']]),
    });

    const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body><GetPatient><id>\${patientId}</id></GetPatient></soap:Body>
    </soap:Envelope>`;

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        envelope,
      },
      connectorMessage
    );

    expect(result.envelope).toContain('P12345');
    expect(result.envelope).not.toContain('${patientId}');
  });

  it('should resolve ${variable} in username and password', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([
        ['wsUser', 'soapAdmin'],
        ['wsPass', 's3cret!'],
      ]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        username: '${wsUser}',
        password: '${wsPass}',
      },
      connectorMessage
    );

    expect(result.username).toBe('soapAdmin');
    expect(result.password).toBe('s3cret!');
  });

  it('should resolve ${variable} in header names and values', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([
        ['headerName', 'X-Custom-Auth'],
        ['headerVal', 'Bearer tok123'],
      ]),
    });

    const headers = new Map<string, string[]>([
      ['${headerName}', ['${headerVal}']],
    ]);

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        headers,
      },
      connectorMessage
    );

    expect(result.headers.has('X-Custom-Auth')).toBe(true);
    expect(result.headers.get('X-Custom-Auth')).toEqual(['Bearer tok123']);
  });

  it('should resolve ${variable} in attachment names', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([['attachName', 'report.pdf']]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        attachmentNames: ['${attachName}', 'static.txt'],
      },
      connectorMessage
    );

    expect(result.attachmentNames).toEqual(['report.pdf', 'static.txt']);
  });

  it('should leave unresolved variables as-is', () => {
    const connectorMessage = createConnectorMessage();

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        wsdlUrl: '${unknownVar}',
        envelope: 'literal text',
      },
      connectorMessage
    );

    expect(result.wsdlUrl).toBe('${unknownVar}');
    expect(result.envelope).toBe('literal text');
  });

  it('should resolve ${message.encodedData}', () => {
    const connectorMessage = createConnectorMessage({
      encodedData: '<Patient><ID>123</ID></Patient>',
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        envelope: '<Body>${message.encodedData}</Body>',
      },
      connectorMessage
    );

    expect(result.envelope).toBe('<Body><Patient><ID>123</ID></Patient></Body>');
  });

  it('should resolve ${message.rawData}', () => {
    const connectorMessage = createConnectorMessage({
      rawData: 'MSH|^~\\&|SENDING|FACILITY',
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        envelope: '<Msg>${message.rawData}</Msg>',
      },
      connectorMessage
    );

    expect(result.envelope).toBe('<Msg>MSH|^~\\&|SENDING|FACILITY</Msg>');
  });

  it('should check sourceMap and connectorMap as fallbacks', () => {
    const connectorMessage = createConnectorMessage({
      sourceMap: new Map([['fromSource', 'sourceVal']]),
      connectorMap: new Map([['fromConnector', 'connectorVal']]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        wsdlUrl: '${fromSource}',
        soapAction: '${fromConnector}',
      },
      connectorMessage
    );

    expect(result.wsdlUrl).toBe('sourceVal');
    expect(result.soapAction).toBe('connectorVal');
  });

  it('should handle empty strings without errors', () => {
    const connectorMessage = createConnectorMessage();

    const result = dispatcher.replaceConnectorProperties(
      dispatcher.getProperties(),
      connectorMessage
    );

    // All defaults are empty strings — should pass through unchanged
    expect(result.wsdlUrl).toBe('');
    expect(result.envelope).toBe('');
    expect(result.username).toBe('');
  });

  it('should handle multiple variables in a single field', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([
        ['host', 'example.com'],
        ['path', '/ws/patient'],
      ]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        locationURI: 'http://${host}${path}',
      },
      connectorMessage
    );

    expect(result.locationURI).toBe('http://example.com/ws/patient');
  });

  it('should not mutate the original properties object', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([['url', 'http://resolved.com']]),
    });

    const original = {
      ...dispatcher.getProperties(),
      wsdlUrl: '${url}',
    };

    dispatcher.replaceConnectorProperties(original, connectorMessage);

    // Original should be unchanged
    expect(original.wsdlUrl).toBe('${url}');
  });

  it('should prioritize channelMap over sourceMap', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([['myVar', 'fromChannel']]),
      sourceMap: new Map([['myVar', 'fromSource']]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        wsdlUrl: '${myVar}',
      },
      connectorMessage
    );

    expect(result.wsdlUrl).toBe('fromChannel');
  });
});
