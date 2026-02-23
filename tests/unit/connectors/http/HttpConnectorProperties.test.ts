import {
  getDefaultHttpReceiverProperties,
  getDefaultHttpDispatcherProperties,
  isBinaryMimeType,
  HttpReceiverProperties,
  HttpDispatcherProperties,
} from '../../../../src/connectors/http/HttpConnectorProperties';

describe('HttpConnectorProperties', () => {
  describe('getDefaultHttpReceiverProperties', () => {
    it('should return default receiver properties', () => {
      const props = getDefaultHttpReceiverProperties();

      expect(props.host).toBe('0.0.0.0');
      expect(props.port).toBe(80);
      expect(props.contextPath).toBe('');
      expect(props.timeout).toBe(30000);
      expect(props.charset).toBe('UTF-8');
      expect(props.xmlBody).toBe(false);
      expect(props.parseMultipart).toBe(true);
      expect(props.includeMetadata).toBe(false);
      expect(props.binaryMimeTypesRegex).toBe(true);
      expect(props.responseContentType).toBe('text/plain');
      expect(props.responseDataTypeBinary).toBe(false);
      expect(props.responseStatusCode).toBe('');
      expect(props.responseHeaders).toBeInstanceOf(Map);
      expect(props.staticResources).toEqual([]);
    });

    it('should return independent instances', () => {
      const props1 = getDefaultHttpReceiverProperties();
      const props2 = getDefaultHttpReceiverProperties();

      props1.port = 8080;
      expect(props2.port).toBe(80);
    });
  });

  describe('getDefaultHttpDispatcherProperties', () => {
    it('should return default dispatcher properties', () => {
      const props = getDefaultHttpDispatcherProperties();

      expect(props.host).toBe('');
      expect(props.method).toBe('POST');
      expect(props.headers).toBeInstanceOf(Map);
      expect(props.parameters).toBeInstanceOf(Map);
      expect(props.content).toBe('');
      expect(props.contentType).toBe('text/plain');
      expect(props.dataTypeBinary).toBe(false);
      expect(props.charset).toBe('UTF-8');
      expect(props.multipart).toBe(false);
      expect(props.socketTimeout).toBe(30000);
      expect(props.useProxyServer).toBe(false);
      expect(props.proxyAddress).toBe('');
      expect(props.proxyPort).toBe(0);
      expect(props.useAuthentication).toBe(false);
      expect(props.authenticationType).toBe('Basic');
      expect(props.usePreemptiveAuthentication).toBe(false);
      expect(props.username).toBe('');
      expect(props.password).toBe('');
      expect(props.responseXmlBody).toBe(false);
      expect(props.responseParseMultipart).toBe(true);
      expect(props.responseIncludeMetadata).toBe(false);
      expect(props.responseBinaryMimeTypesRegex).toBe(true);
    });

    it('should return independent instances', () => {
      const props1 = getDefaultHttpDispatcherProperties();
      const props2 = getDefaultHttpDispatcherProperties();

      props1.method = 'GET';
      expect(props2.method).toBe('POST');
    });
  });

  describe('isBinaryMimeType', () => {
    describe('with regex pattern', () => {
      const pattern = 'application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*';
      const isRegex = true;

      it('should match image/* types', () => {
        expect(isBinaryMimeType('image/png', pattern, isRegex)).toBe(true);
        expect(isBinaryMimeType('image/jpeg', pattern, isRegex)).toBe(true);
        expect(isBinaryMimeType('image/gif', pattern, isRegex)).toBe(true);
      });

      it('should match video/* types', () => {
        expect(isBinaryMimeType('video/mp4', pattern, isRegex)).toBe(true);
        expect(isBinaryMimeType('video/webm', pattern, isRegex)).toBe(true);
      });

      it('should match audio/* types', () => {
        expect(isBinaryMimeType('audio/mpeg', pattern, isRegex)).toBe(true);
        expect(isBinaryMimeType('audio/wav', pattern, isRegex)).toBe(true);
      });

      it('should match application/* binary types', () => {
        expect(isBinaryMimeType('application/octet-stream', pattern, isRegex)).toBe(true);
        expect(isBinaryMimeType('application/pdf', pattern, isRegex)).toBe(true);
      });

      it('should NOT match application/json', () => {
        expect(isBinaryMimeType('application/json', pattern, isRegex)).toBe(false);
      });

      it('should NOT match application/xml', () => {
        expect(isBinaryMimeType('application/xml', pattern, isRegex)).toBe(false);
      });

      it('should NOT match text/* types', () => {
        expect(isBinaryMimeType('text/plain', pattern, isRegex)).toBe(false);
        expect(isBinaryMimeType('text/html', pattern, isRegex)).toBe(false);
        expect(isBinaryMimeType('text/xml', pattern, isRegex)).toBe(false);
      });
    });

    describe('with prefix list pattern', () => {
      const pattern = 'image/, application/octet-stream, video/, audio/';
      const isRegex = false;

      it('should match image/* types', () => {
        expect(isBinaryMimeType('image/png', pattern, isRegex)).toBe(true);
        expect(isBinaryMimeType('image/jpeg', pattern, isRegex)).toBe(true);
      });

      it('should match video/* types', () => {
        expect(isBinaryMimeType('video/mp4', pattern, isRegex)).toBe(true);
      });

      it('should match audio/* types', () => {
        expect(isBinaryMimeType('audio/mpeg', pattern, isRegex)).toBe(true);
      });

      it('should match exact application/octet-stream', () => {
        expect(isBinaryMimeType('application/octet-stream', pattern, isRegex)).toBe(true);
      });

      it('should NOT match application/json', () => {
        expect(isBinaryMimeType('application/json', pattern, isRegex)).toBe(false);
      });

      it('should NOT match text/* types', () => {
        expect(isBinaryMimeType('text/plain', pattern, isRegex)).toBe(false);
      });
    });

    describe('with simple regex', () => {
      it('should match simple patterns', () => {
        expect(isBinaryMimeType('image/png', 'image/.*', true)).toBe(true);
        expect(isBinaryMimeType('text/plain', 'image/.*', true)).toBe(false);
      });

      it('should match OR patterns', () => {
        expect(isBinaryMimeType('image/png', 'image/.*|video/.*', true)).toBe(true);
        expect(isBinaryMimeType('video/mp4', 'image/.*|video/.*', true)).toBe(true);
        expect(isBinaryMimeType('text/plain', 'image/.*|video/.*', true)).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should handle invalid regex', () => {
        expect(isBinaryMimeType('image/png', '[invalid', true)).toBe(false);
      });

      it('should handle empty pattern', () => {
        expect(isBinaryMimeType('image/png', '', true)).toBe(true); // Empty regex matches everything
        expect(isBinaryMimeType('image/png', '', false)).toBe(false); // Empty prefix matches nothing
      });
    });
  });
});

describe('HttpReceiverProperties interface', () => {
  it('should allow creating custom properties', () => {
    const props: HttpReceiverProperties = {
      host: 'localhost',
      port: 8080,
      contextPath: '/api/v1',
      timeout: 60000,
      charset: 'UTF-8',
      xmlBody: true,
      parseMultipart: false,
      includeMetadata: true,
      binaryMimeTypes: 'application/pdf',
      binaryMimeTypesRegex: false,
      responseContentType: 'application/json',
      responseDataTypeBinary: false,
      responseStatusCode: '201',
      responseHeaders: new Map([['X-Custom', ['value']]]),
      useResponseHeadersVariable: false,
      responseHeadersVariable: '',
      staticResources: [
        {
          contextPath: '/static',
          resourceType: 'DIRECTORY',
          value: '/var/www/static',
          contentType: 'text/plain',
        },
      ],
      maxConnections: 0,
    };

    expect(props.port).toBe(8080);
    expect(props.staticResources?.length).toBe(1);
  });
});

describe('HttpDispatcherProperties interface', () => {
  it('should allow creating custom properties', () => {
    const props: HttpDispatcherProperties = {
      host: 'https://api.example.com',
      method: 'PUT',
      headers: new Map([['Authorization', ['Bearer token']]]),
      parameters: new Map([['id', ['123']]]),
      content: '{"key": "value"}',
      contentType: 'application/json',
      dataTypeBinary: false,
      charset: 'UTF-8',
      multipart: false,
      socketTimeout: 60000,
      useProxyServer: true,
      proxyAddress: 'proxy.example.com',
      proxyPort: 8080,
      useAuthentication: true,
      authenticationType: 'Digest',
      usePreemptiveAuthentication: true,
      username: 'admin',
      password: 'secret',
      responseXmlBody: true,
      responseParseMultipart: true,
      responseIncludeMetadata: true,
      responseBinaryMimeTypes: 'application/pdf',
      responseBinaryMimeTypesRegex: false,
      useHeadersVariable: false,
      headersVariable: '',
      useParametersVariable: false,
      parametersVariable: '',
    };

    expect(props.host).toBe('https://api.example.com');
    expect(props.method).toBe('PUT');
    expect(props.useAuthentication).toBe(true);
    expect(props.authenticationType).toBe('Digest');
  });
});
