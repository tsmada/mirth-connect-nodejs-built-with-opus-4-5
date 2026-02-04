/**
 * Tests for SoapBuilder - SOAP envelope construction and parsing
 */

import {
  buildSoapEnvelope,
  buildSoapFaultEnvelope,
  parseSoapEnvelope,
  extractSoapBodyContent,
  detectSoapVersion,
  getSoapContentType,
  SoapVersion,
  SOAP_NAMESPACES,
} from '../../../../src/connectors/ws/SoapBuilder.js';

describe('SoapBuilder', () => {
  describe('buildSoapEnvelope', () => {
    it('should build a SOAP 1.1 envelope', () => {
      const body = '<GetStockPrice><StockName>IBM</StockName></GetStockPrice>';
      const envelope = buildSoapEnvelope(body, {
        version: SoapVersion.SOAP_1_1,
      });

      expect(envelope).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(envelope).toContain('soap:Envelope');
      expect(envelope).toContain(SOAP_NAMESPACES.SOAP_1_1_ENVELOPE);
      expect(envelope).toContain('soap:Body');
      expect(envelope).toContain('<GetStockPrice>');
      expect(envelope).toContain('<StockName>IBM</StockName>');
    });

    it('should build a SOAP 1.2 envelope', () => {
      const body = '<GetStockPrice><StockName>MSFT</StockName></GetStockPrice>';
      const envelope = buildSoapEnvelope(body, {
        version: SoapVersion.SOAP_1_2,
      });

      expect(envelope).toContain('soap:Envelope');
      expect(envelope).toContain(SOAP_NAMESPACES.SOAP_1_2_ENVELOPE);
      expect(envelope).toContain('soap:Body');
      expect(envelope).toContain('<GetStockPrice>');
    });

    it('should include headers when provided', () => {
      const body = '<TestOperation/>';
      const envelope = buildSoapEnvelope(body, {
        version: SoapVersion.SOAP_1_1,
        headers: [
          {
            localName: 'Security',
            namespace: 'http://security.example.com',
            prefix: 'sec',
            content: '<Token>abc123</Token>',
            mustUnderstand: true,
          },
        ],
      });

      expect(envelope).toContain('soap:Header');
      expect(envelope).toContain('sec:Security');
      expect(envelope).toContain('xmlns:sec="http://security.example.com"');
      expect(envelope).toContain('soap:mustUnderstand="1"');
      expect(envelope).toContain('<Token>abc123</Token>');
    });

    it('should include custom namespaces', () => {
      const body = '<ns:MyOperation xmlns:ns="http://example.com/ns"/>';
      const envelope = buildSoapEnvelope(body, {
        namespaces: {
          custom: 'http://custom.namespace.com',
        },
      });

      expect(envelope).toContain('xmlns:custom="http://custom.namespace.com"');
    });

    it('should include encoding style when provided', () => {
      const body = '<Test/>';
      const envelope = buildSoapEnvelope(body, {
        encodingStyle: SOAP_NAMESPACES.SOAP_1_1_ENCODING,
      });

      expect(envelope).toContain(
        `soap:encodingStyle="${SOAP_NAMESPACES.SOAP_1_1_ENCODING}"`
      );
    });
  });

  describe('buildSoapFaultEnvelope', () => {
    it('should build a SOAP 1.1 fault', () => {
      const envelope = buildSoapFaultEnvelope(
        {
          faultCode: 'soap:Client',
          faultString: 'Invalid input',
          faultActor: 'http://example.com/actor',
          detail: '<ErrorCode>100</ErrorCode>',
        },
        { version: SoapVersion.SOAP_1_1 }
      );

      expect(envelope).toContain('soap:Fault');
      expect(envelope).toContain('<faultcode>soap:Client</faultcode>');
      expect(envelope).toContain('<faultstring>Invalid input</faultstring>');
      expect(envelope).toContain(
        '<faultactor>http://example.com/actor</faultactor>'
      );
      expect(envelope).toContain('<detail><ErrorCode>100</ErrorCode></detail>');
    });

    it('should build a SOAP 1.2 fault', () => {
      const envelope = buildSoapFaultEnvelope(
        {
          faultCode: 'Sender',
          faultString: 'Invalid request',
          detail: '<Info>Additional info</Info>',
        },
        { version: SoapVersion.SOAP_1_2 }
      );

      expect(envelope).toContain('soap:Fault');
      expect(envelope).toContain('soap:Code');
      expect(envelope).toContain('<soap:Value>Sender</soap:Value>');
      expect(envelope).toContain('soap:Reason');
      expect(envelope).toContain('<soap:Text xml:lang="en">Invalid request</soap:Text>');
      expect(envelope).toContain('soap:Detail');
    });
  });

  describe('parseSoapEnvelope', () => {
    it('should parse a SOAP 1.1 envelope', () => {
      const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${SOAP_NAMESPACES.SOAP_1_1_ENVELOPE}">
  <soap:Body>
    <GetStockPriceResponse>
      <Price>34.5</Price>
    </GetStockPriceResponse>
  </soap:Body>
</soap:Envelope>`;

      const result = parseSoapEnvelope(envelope);

      expect(result.version).toBe(SoapVersion.SOAP_1_1);
      expect(result.isFault).toBe(false);
      expect(result.body).toContain('GetStockPriceResponse');
      expect(result.body).toContain('Price');
    });

    it('should parse a SOAP 1.2 envelope', () => {
      const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${SOAP_NAMESPACES.SOAP_1_2_ENVELOPE}">
  <soap:Body>
    <Response>OK</Response>
  </soap:Body>
</soap:Envelope>`;

      const result = parseSoapEnvelope(envelope);

      expect(result.version).toBe(SoapVersion.SOAP_1_2);
      expect(result.isFault).toBe(false);
    });

    it('should detect SOAP 1.1 fault', () => {
      const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${SOAP_NAMESPACES.SOAP_1_1_ENVELOPE}">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>Internal Error</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

      const result = parseSoapEnvelope(envelope);

      expect(result.isFault).toBe(true);
      expect(result.fault).toBeDefined();
      expect(result.fault?.faultCode).toBe('soap:Server');
      expect(result.fault?.faultString).toBe('Internal Error');
    });

    it('should extract headers', () => {
      const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${SOAP_NAMESPACES.SOAP_1_1_ENVELOPE}">
  <soap:Header>
    <TransactionId>12345</TransactionId>
  </soap:Header>
  <soap:Body>
    <Data>test</Data>
  </soap:Body>
</soap:Envelope>`;

      const result = parseSoapEnvelope(envelope);

      expect(result.headers.length).toBeGreaterThan(0);
    });

    it('should throw on invalid envelope', () => {
      const invalid = '<NotAnEnvelope><Content/></NotAnEnvelope>';

      expect(() => parseSoapEnvelope(invalid)).toThrow(
        'Invalid SOAP envelope'
      );
    });
  });

  describe('extractSoapBodyContent', () => {
    it('should extract body content without wrapper', () => {
      const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="${SOAP_NAMESPACES.SOAP_1_1_ENVELOPE}">
  <soap:Body>
    <MyOperation>
      <Param1>value1</Param1>
    </MyOperation>
  </soap:Body>
</soap:Envelope>`;

      const body = extractSoapBodyContent(envelope);

      expect(body).toContain('MyOperation');
      expect(body).toContain('Param1');
      expect(body).toContain('value1');
    });
  });

  describe('detectSoapVersion', () => {
    it('should detect SOAP 1.1', () => {
      const envelope = `<soap:Envelope xmlns:soap="${SOAP_NAMESPACES.SOAP_1_1_ENVELOPE}"/>`;
      expect(detectSoapVersion(envelope)).toBe(SoapVersion.SOAP_1_1);
    });

    it('should detect SOAP 1.2', () => {
      const envelope = `<soap:Envelope xmlns:soap="${SOAP_NAMESPACES.SOAP_1_2_ENVELOPE}"/>`;
      expect(detectSoapVersion(envelope)).toBe(SoapVersion.SOAP_1_2);
    });

    it('should default to SOAP 1.1', () => {
      const envelope = '<unknown/>';
      expect(detectSoapVersion(envelope)).toBe(SoapVersion.SOAP_1_1);
    });
  });

  describe('getSoapContentType', () => {
    it('should return text/xml for SOAP 1.1', () => {
      const contentType = getSoapContentType(SoapVersion.SOAP_1_1);
      expect(contentType).toBe('text/xml; charset=utf-8');
    });

    it('should return application/soap+xml for SOAP 1.2', () => {
      const contentType = getSoapContentType(SoapVersion.SOAP_1_2);
      expect(contentType).toBe('application/soap+xml; charset=utf-8');
    });

    it('should include action for SOAP 1.2', () => {
      const contentType = getSoapContentType(
        SoapVersion.SOAP_1_2,
        'http://example.com/action'
      );
      expect(contentType).toBe(
        'application/soap+xml; charset=utf-8; action="http://example.com/action"'
      );
    });
  });
});
