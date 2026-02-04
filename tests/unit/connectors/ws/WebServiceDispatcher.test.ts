/**
 * Tests for WebServiceDispatcher
 */

import {
  WebServiceDispatcher,
  SoapFaultError,
} from '../../../../src/connectors/ws/WebServiceDispatcher.js';
import '../../../../src/connectors/ws/WebServiceDispatcherProperties.js';

describe('WebServiceDispatcher', () => {
  describe('constructor', () => {
    it('should create dispatcher with default properties', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('Web Service Sender');
      expect(dispatcher.getTransportName()).toBe('WS');
      expect(dispatcher.getMetaDataId()).toBe(1);

      const props = dispatcher.getProperties();
      expect(props.wsdlUrl).toBe('');
      expect(props.socketTimeout).toBe(30000);
    });

    it('should create dispatcher with custom properties', () => {
      const dispatcher = new WebServiceDispatcher({
        name: 'Custom WS Sender',
        metaDataId: 2,
        properties: {
          wsdlUrl: 'http://example.com/service?wsdl',
          service: 'TestService',
          port: 'TestPort',
          socketTimeout: 60000,
        },
      });

      expect(dispatcher.getName()).toBe('Custom WS Sender');

      const props = dispatcher.getProperties();
      expect(props.wsdlUrl).toBe('http://example.com/service?wsdl');
      expect(props.service).toBe('TestService');
      expect(props.port).toBe('TestPort');
      expect(props.socketTimeout).toBe(60000);
    });

    it('should create dispatcher with queue settings', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        queueEnabled: true,
        queueSendFirst: false,
        retryCount: 3,
        retryIntervalMillis: 5000,
      });

      // Queue settings are passed to parent class
      expect(dispatcher).toBeDefined();
    });
  });

  describe('setProperties', () => {
    it('should update properties', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
      });

      dispatcher.setProperties({
        wsdlUrl: 'http://new.example.com/service?wsdl',
        useAuthentication: true,
        username: 'admin',
        password: 'secret',
      });

      const props = dispatcher.getProperties();
      expect(props.wsdlUrl).toBe('http://new.example.com/service?wsdl');
      expect(props.useAuthentication).toBe(true);
      expect(props.username).toBe('admin');
      expect(props.password).toBe('secret');
    });

    it('should preserve existing properties when updating', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        properties: {
          wsdlUrl: 'http://example.com/service?wsdl',
          service: 'TestService',
        },
      });

      dispatcher.setProperties({
        port: 'TestPort',
      });

      const props = dispatcher.getProperties();
      expect(props.wsdlUrl).toBe('http://example.com/service?wsdl');
      expect(props.service).toBe('TestService');
      expect(props.port).toBe('TestPort');
    });
  });

  describe('SoapFaultError', () => {
    it('should create fault error with message', () => {
      const error = new SoapFaultError('Invalid request');

      expect(error.message).toBe('Invalid request');
      expect(error.name).toBe('SoapFaultError');
      expect(error.faultCode).toBeUndefined();
      expect(error.responseXml).toBeUndefined();
    });

    it('should create fault error with all properties', () => {
      const responseXml = '<soap:Fault><faultstring>Error</faultstring></soap:Fault>';
      const error = new SoapFaultError(
        'Operation failed',
        'soap:Server',
        responseXml
      );

      expect(error.message).toBe('Operation failed');
      expect(error.faultCode).toBe('soap:Server');
      expect(error.responseXml).toBe(responseXml);
    });

    it('should be instance of Error', () => {
      const error = new SoapFaultError('Test error');
      expect(error).toBeInstanceOf(Error);
    });
  });
});

describe('WebServiceDispatcher integration', () => {
  // These tests would require mocking HTTP requests
  // or running against a real SOAP service

  describe('MTOM handling', () => {
    it('should configure MTOM attachments', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        properties: {
          useMtom: true,
          attachmentNames: ['file.pdf'],
          attachmentContents: ['base64content'],
          attachmentTypes: ['application/pdf'],
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useMtom).toBe(true);
      expect(props.attachmentNames).toContain('file.pdf');
    });
  });

  describe('Authentication configuration', () => {
    it('should configure basic authentication', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        properties: {
          useAuthentication: true,
          username: 'testuser',
          password: 'testpass',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useAuthentication).toBe(true);
      expect(props.username).toBe('testuser');
      expect(props.password).toBe('testpass');
    });
  });

  describe('Headers configuration', () => {
    it('should configure custom headers', () => {
      const headers = new Map<string, string[]>([
        ['X-Custom-Header', ['value1']],
        ['X-Another-Header', ['value2', 'value3']],
      ]);

      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        properties: {
          headers,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.headers.get('X-Custom-Header')).toEqual(['value1']);
      expect(props.headers.get('X-Another-Header')).toEqual(['value2', 'value3']);
    });

    it('should configure headers from variable', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        properties: {
          useHeadersVariable: true,
          headersVariable: 'customHeaders',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useHeadersVariable).toBe(true);
      expect(props.headersVariable).toBe('customHeaders');
    });
  });

  describe('One-way operations', () => {
    it('should configure one-way operation', () => {
      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        properties: {
          oneWay: true,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.oneWay).toBe(true);
    });
  });

  describe('SOAP envelope', () => {
    it('should configure custom SOAP envelope', () => {
      const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <CustomOperation>
            <Param>value</Param>
          </CustomOperation>
        </soap:Body>
      </soap:Envelope>`;

      const dispatcher = new WebServiceDispatcher({
        metaDataId: 1,
        properties: {
          envelope,
          soapAction: 'http://example.com/CustomOperation',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.envelope).toContain('CustomOperation');
      expect(props.soapAction).toBe('http://example.com/CustomOperation');
    });
  });
});
