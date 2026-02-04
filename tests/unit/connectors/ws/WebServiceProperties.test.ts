/**
 * Tests for WebService Properties
 */

import {
  SoapBinding,
  getSoapBindingValue,
  getSoapBindingName,
  parseSoapBinding,
  getDefaultWebServiceReceiverProperties,
  getServicePath,
} from '../../../../src/connectors/ws/WebServiceReceiverProperties.js';

import {
  getDefaultWebServiceDispatcherProperties,
  formatWebServiceDispatcherProperties,
  getAttachmentEntries,
  createDefinitionServiceMap,
  WEBSERVICE_DEFAULT_DROPDOWN,
} from '../../../../src/connectors/ws/WebServiceDispatcherProperties.js';

describe('WebServiceReceiverProperties', () => {
  describe('SoapBinding enum', () => {
    it('should have correct enum values', () => {
      expect(SoapBinding.DEFAULT).toBe('DEFAULT');
      expect(SoapBinding.SOAP11HTTP).toBe('SOAP11HTTP');
      expect(SoapBinding.SOAP12HTTP).toBe('SOAP12HTTP');
    });
  });

  describe('getSoapBindingValue', () => {
    it('should return null for DEFAULT', () => {
      expect(getSoapBindingValue(SoapBinding.DEFAULT)).toBeNull();
    });

    it('should return SOAP 1.1 namespace for SOAP11HTTP', () => {
      expect(getSoapBindingValue(SoapBinding.SOAP11HTTP)).toBe(
        'http://schemas.xmlsoap.org/wsdl/soap/http'
      );
    });

    it('should return SOAP 1.2 namespace for SOAP12HTTP', () => {
      expect(getSoapBindingValue(SoapBinding.SOAP12HTTP)).toBe(
        'http://www.w3.org/2003/05/soap/bindings/HTTP/'
      );
    });
  });

  describe('getSoapBindingName', () => {
    it('should return display names', () => {
      expect(getSoapBindingName(SoapBinding.DEFAULT)).toBe('Default');
      expect(getSoapBindingName(SoapBinding.SOAP11HTTP)).toBe('SOAP 1.1');
      expect(getSoapBindingName(SoapBinding.SOAP12HTTP)).toBe('SOAP 1.2');
    });
  });

  describe('parseSoapBinding', () => {
    it('should parse display names to enum', () => {
      expect(parseSoapBinding('Default')).toBe(SoapBinding.DEFAULT);
      expect(parseSoapBinding('SOAP 1.1')).toBe(SoapBinding.SOAP11HTTP);
      expect(parseSoapBinding('SOAP 1.2')).toBe(SoapBinding.SOAP12HTTP);
    });

    it('should return DEFAULT for unknown names', () => {
      expect(parseSoapBinding('Unknown')).toBe(SoapBinding.DEFAULT);
    });
  });

  describe('getDefaultWebServiceReceiverProperties', () => {
    it('should return default properties', () => {
      const props = getDefaultWebServiceReceiverProperties();

      expect(props.host).toBe('0.0.0.0');
      expect(props.port).toBe(8081);
      expect(props.processingThreads).toBe(1);
      expect(props.className).toBe(
        'com.mirth.connect.connectors.ws.DefaultAcceptMessage'
      );
      expect(props.serviceName).toBe('Mirth');
      expect(props.soapBinding).toBe(SoapBinding.DEFAULT);
    });
  });

  describe('getServicePath', () => {
    it('should return service path', () => {
      const props = getDefaultWebServiceReceiverProperties();
      expect(getServicePath(props)).toBe('/services/Mirth');
    });

    it('should use custom service name', () => {
      const props = {
        ...getDefaultWebServiceReceiverProperties(),
        serviceName: 'MyService',
      };
      expect(getServicePath(props)).toBe('/services/MyService');
    });
  });
});

describe('WebServiceDispatcherProperties', () => {
  describe('getDefaultWebServiceDispatcherProperties', () => {
    it('should return default properties', () => {
      const props = getDefaultWebServiceDispatcherProperties();

      expect(props.wsdlUrl).toBe('');
      expect(props.service).toBe('');
      expect(props.port).toBe('');
      expect(props.operation).toBe(WEBSERVICE_DEFAULT_DROPDOWN);
      expect(props.locationURI).toBe('');
      expect(props.socketTimeout).toBe(30000);
      expect(props.useAuthentication).toBe(false);
      expect(props.username).toBe('');
      expect(props.password).toBe('');
      expect(props.envelope).toBe('');
      expect(props.oneWay).toBe(false);
      expect(props.headers).toEqual(new Map());
      expect(props.useHeadersVariable).toBe(false);
      expect(props.useMtom).toBe(false);
      expect(props.attachmentNames).toEqual([]);
      expect(props.soapAction).toBe('');
    });
  });

  describe('createDefinitionServiceMap', () => {
    it('should create empty definition map', () => {
      const map = createDefinitionServiceMap();
      expect(map.map).toBeInstanceOf(Map);
      expect(map.map.size).toBe(0);
    });
  });

  describe('formatWebServiceDispatcherProperties', () => {
    it('should format properties as string', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      props.wsdlUrl = 'http://example.com/service?wsdl';
      props.service = 'TestService';
      props.port = 'TestPort';
      props.soapAction = 'http://example.com/action';

      const formatted = formatWebServiceDispatcherProperties(props);

      expect(formatted).toContain('WSDL URL: http://example.com/service?wsdl');
      expect(formatted).toContain('SERVICE: TestService');
      expect(formatted).toContain('PORT / ENDPOINT: TestPort');
      expect(formatted).toContain('SOAP ACTION: http://example.com/action');
      expect(formatted).toContain('[ATTACHMENTS]');
      expect(formatted).toContain('[CONTENT]');
    });

    it('should include username when set', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      props.username = 'admin';

      const formatted = formatWebServiceDispatcherProperties(props);
      expect(formatted).toContain('USERNAME: admin');
    });

    it('should show headers variable when used', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      props.useHeadersVariable = true;
      props.headersVariable = 'myHeaders';

      const formatted = formatWebServiceDispatcherProperties(props);
      expect(formatted).toContain("[HEADERS]");
      expect(formatted).toContain("Using variable 'myHeaders'");
    });

    it('should show custom headers', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      props.headers = new Map([
        ['Content-Type', ['application/xml']],
        ['X-Custom', ['value1', 'value2']],
      ]);

      const formatted = formatWebServiceDispatcherProperties(props);
      expect(formatted).toContain('[HEADERS]');
      expect(formatted).toContain('Content-Type: application/xml');
      expect(formatted).toContain('X-Custom: value1');
      expect(formatted).toContain('X-Custom: value2');
    });

    it('should show attachments', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      props.attachmentNames = ['file1.pdf', 'file2.xml'];
      props.attachmentTypes = ['application/pdf', 'application/xml'];

      const formatted = formatWebServiceDispatcherProperties(props);
      expect(formatted).toContain('file1.pdf (application/pdf)');
      expect(formatted).toContain('file2.xml (application/xml)');
    });
  });

  describe('getAttachmentEntries', () => {
    it('should return empty array when no attachments', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      const entries = getAttachmentEntries(props);
      expect(entries).toEqual([]);
    });

    it('should return attachment entries', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      props.attachmentNames = ['attach1', 'attach2'];
      props.attachmentContents = ['content1', 'content2'];
      props.attachmentTypes = ['text/plain', 'application/xml'];

      const entries = getAttachmentEntries(props);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        name: 'attach1',
        content: 'content1',
        mimeType: 'text/plain',
      });
      expect(entries[1]).toEqual({
        name: 'attach2',
        content: 'content2',
        mimeType: 'application/xml',
      });
    });

    it('should handle mismatched array lengths', () => {
      const props = getDefaultWebServiceDispatcherProperties();
      props.attachmentNames = ['attach1', 'attach2', 'attach3'];
      props.attachmentContents = ['content1'];
      props.attachmentTypes = ['text/plain'];

      const entries = getAttachmentEntries(props);

      expect(entries).toHaveLength(3);
      expect(entries[0]!.mimeType).toBe('text/plain');
      expect(entries[1]!.mimeType).toBe('application/octet-stream');
      expect(entries[2]!.mimeType).toBe('application/octet-stream');
    });
  });
});
