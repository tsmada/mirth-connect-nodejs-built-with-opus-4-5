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

  // CPC-W18-018: Attachment resolution tests
  it('should resolve ${variable} in attachmentContents', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([
        ['fileContent', 'base64EncodedPDF=='],
        ['xmlPayload', '<Document>test</Document>'],
      ]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        attachmentContents: ['${fileContent}', '${xmlPayload}', 'literal-content'],
      },
      connectorMessage
    );

    expect(result.attachmentContents).toEqual([
      'base64EncodedPDF==',
      '<Document>test</Document>',
      'literal-content',
    ]);
  });

  it('should resolve ${variable} in attachmentTypes', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([['mimeType', 'application/pdf']]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        attachmentTypes: ['${mimeType}', 'text/xml'],
      },
      connectorMessage
    );

    expect(result.attachmentTypes).toEqual(['application/pdf', 'text/xml']);
  });

  it('should resolve all three attachment arrays together', () => {
    const connectorMessage = createConnectorMessage({
      channelMap: new Map([
        ['attachName', 'report.pdf'],
        ['attachContent', 'JVBERi0='],
        ['attachType', 'application/pdf'],
      ]),
    });

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        attachmentNames: ['${attachName}'],
        attachmentContents: ['${attachContent}'],
        attachmentTypes: ['${attachType}'],
      },
      connectorMessage
    );

    expect(result.attachmentNames).toEqual(['report.pdf']);
    expect(result.attachmentContents).toEqual(['JVBERi0=']);
    expect(result.attachmentTypes).toEqual(['application/pdf']);
  });

  it('should handle empty attachment arrays without errors', () => {
    const connectorMessage = createConnectorMessage();

    const result = dispatcher.replaceConnectorProperties(
      {
        ...dispatcher.getProperties(),
        attachmentNames: [],
        attachmentContents: [],
        attachmentTypes: [],
      },
      connectorMessage
    );

    expect(result.attachmentNames).toEqual([]);
    expect(result.attachmentContents).toEqual([]);
    expect(result.attachmentTypes).toEqual([]);
  });
});

/**
 * CPC-W19-004: useHeadersVariable runtime lookup parity tests.
 * Matches Java WebServiceDispatcher.getHeaders() → HttpUtil.getTableMap() behavior.
 */
describe('WebServiceDispatcher.getHeaders via useHeadersVariable (CPC-W19-004)', () => {
  let dispatcher: WebServiceDispatcher;

  beforeEach(() => {
    dispatcher = new WebServiceDispatcher({ metaDataId: 1 });
  });

  /**
   * Access the private buildHttpHeaders via the public send path.
   * We test indirectly by inspecting the headers that would be built.
   * For direct unit testing, we use a subclass trick to access getHeaders.
   */
  function getHeadersResult(
    props: Partial<import('../../../../src/connectors/ws/WebServiceDispatcherProperties.js').WebServiceDispatcherProperties>,
    connectorMessage: ConnectorMessage
  ): Map<string, string[]> {
    // Access private getHeaders via prototype
    const fullProps = { ...dispatcher.getProperties(), ...props };
    return (dispatcher as any).getHeaders(fullProps, connectorMessage);
  }

  it('should return static headers when useHeadersVariable is false', () => {
    const staticHeaders = new Map<string, string[]>([
      ['X-Custom', ['value1']],
      ['Authorization', ['Bearer tok']],
    ]);

    const connectorMessage = createConnectorMessage();

    const result = getHeadersResult(
      { useHeadersVariable: false, headers: staticHeaders },
      connectorMessage
    );

    expect(result).toBe(staticHeaders);
    expect(result.get('X-Custom')).toEqual(['value1']);
    expect(result.get('Authorization')).toEqual(['Bearer tok']);
  });

  it('should look up headers from connectorMap when useHeadersVariable is true', () => {
    const dynamicHeaders = new Map<string, string>([
      ['X-Dynamic', 'dynValue'],
      ['X-Correlation-ID', 'abc-123'],
    ]);

    const connectorMessage = createConnectorMessage({
      connectorMap: new Map([['myHeaders', dynamicHeaders]]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'myHeaders' },
      connectorMessage
    );

    expect(result.get('X-Dynamic')).toEqual(['dynValue']);
    expect(result.get('X-Correlation-ID')).toEqual(['abc-123']);
  });

  it('should look up headers from channelMap when useHeadersVariable is true', () => {
    const dynamicHeaders = new Map<string, string>([
      ['Content-Type', 'application/xml'],
    ]);

    const connectorMessage = createConnectorMessage({
      channelMap: new Map([['soapHeaders', dynamicHeaders]]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'soapHeaders' },
      connectorMessage
    );

    expect(result.get('Content-Type')).toEqual(['application/xml']);
  });

  it('should look up headers from sourceMap when useHeadersVariable is true', () => {
    const dynamicHeaders = new Map<string, string>([
      ['X-Source-Header', 'fromSource'],
    ]);

    const connectorMessage = createConnectorMessage({
      sourceMap: new Map([['srcHeaders', dynamicHeaders]]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'srcHeaders' },
      connectorMessage
    );

    expect(result.get('X-Source-Header')).toEqual(['fromSource']);
  });

  it('should return empty map when variable not found in any map', () => {
    const connectorMessage = createConnectorMessage();

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'nonExistentVar' },
      connectorMessage
    );

    expect(result.size).toBe(0);
  });

  it('should handle plain object as variable value (not just Map)', () => {
    const connectorMessage = createConnectorMessage({
      connectorMap: new Map([
        ['objHeaders', { 'X-Object-Header': 'objValue', 'Accept': 'text/xml' }],
      ]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'objHeaders' },
      connectorMessage
    );

    expect(result.get('X-Object-Header')).toEqual(['objValue']);
    expect(result.get('Accept')).toEqual(['text/xml']);
  });

  it('should handle array values in the variable map (multi-value headers)', () => {
    const dynamicHeaders = new Map<string, string[]>([
      ['Set-Cookie', ['session=abc', 'lang=en']],
      ['X-Single', ['onlyOne']],
    ]);

    const connectorMessage = createConnectorMessage({
      connectorMap: new Map([['multiHeaders', dynamicHeaders]]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'multiHeaders' },
      connectorMessage
    );

    expect(result.get('Set-Cookie')).toEqual(['session=abc', 'lang=en']);
    expect(result.get('X-Single')).toEqual(['onlyOne']);
  });

  it('should prioritize connectorMap over channelMap (Java MessageMaps.get order)', () => {
    const connectorHeaders = new Map<string, string>([['X-Priority', 'fromConnector']]);
    const channelHeaders = new Map<string, string>([['X-Priority', 'fromChannel']]);

    const connectorMessage = createConnectorMessage({
      connectorMap: new Map([['hdrs', connectorHeaders]]),
      channelMap: new Map([['hdrs', channelHeaders]]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'hdrs' },
      connectorMessage
    );

    expect(result.get('X-Priority')).toEqual(['fromConnector']);
  });

  it('should fall back to channelMap when connectorMap has no match', () => {
    const channelHeaders = new Map<string, string>([['X-Fallback', 'fromChannel']]);

    const connectorMessage = createConnectorMessage({
      connectorMap: new Map([['otherVar', 'notHeaders']]),
      channelMap: new Map([['hdrs', channelHeaders]]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'hdrs' },
      connectorMessage
    );

    expect(result.get('X-Fallback')).toEqual(['fromChannel']);
  });

  it('should return static headers when useHeadersVariable is true but headersVariable is empty', () => {
    const staticHeaders = new Map<string, string[]>([
      ['X-Static', ['staticVal']],
    ]);

    const connectorMessage = createConnectorMessage();

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: '', headers: staticHeaders },
      connectorMessage
    );

    // Empty headersVariable means the condition `props.headersVariable` is falsy,
    // so it falls back to static headers
    expect(result).toBe(staticHeaders);
  });

  it('should handle null/undefined variable value gracefully', () => {
    const connectorMessage = createConnectorMessage({
      connectorMap: new Map([['nullHeaders', null]]),
    });

    const result = getHeadersResult(
      { useHeadersVariable: true, headersVariable: 'nullHeaders' },
      connectorMessage
    );

    expect(result.size).toBe(0);
  });
});
