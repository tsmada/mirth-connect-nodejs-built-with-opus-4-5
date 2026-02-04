/**
 * Tests for WebServiceReceiver
 */

import {
  WebServiceReceiver,
} from '../../../../src/connectors/ws/WebServiceReceiver.js';
import {
  SoapBinding,
} from '../../../../src/connectors/ws/WebServiceReceiverProperties.js';

describe('WebServiceReceiver', () => {
  describe('constructor', () => {
    it('should create receiver with default properties', () => {
      const receiver = new WebServiceReceiver({});

      expect(receiver.getName()).toBe('Web Service Listener');
      expect(receiver.getTransportName()).toBe('WS');

      const props = receiver.getProperties();
      expect(props.host).toBe('0.0.0.0');
      expect(props.port).toBe(8081);
      expect(props.serviceName).toBe('Mirth');
      expect(props.soapBinding).toBe(SoapBinding.DEFAULT);
    });

    it('should create receiver with custom properties', () => {
      const receiver = new WebServiceReceiver({
        name: 'Custom WS Listener',
        properties: {
          host: 'localhost',
          port: 9090,
          serviceName: 'MyService',
          soapBinding: SoapBinding.SOAP12HTTP,
        },
      });

      expect(receiver.getName()).toBe('Custom WS Listener');

      const props = receiver.getProperties();
      expect(props.host).toBe('localhost');
      expect(props.port).toBe(9090);
      expect(props.serviceName).toBe('MyService');
      expect(props.soapBinding).toBe(SoapBinding.SOAP12HTTP);
    });
  });

  describe('setProperties', () => {
    it('should update properties', () => {
      const receiver = new WebServiceReceiver({});

      receiver.setProperties({
        port: 8888,
        serviceName: 'UpdatedService',
      });

      const props = receiver.getProperties();
      expect(props.port).toBe(8888);
      expect(props.serviceName).toBe('UpdatedService');
    });

    it('should preserve existing properties', () => {
      const receiver = new WebServiceReceiver({
        properties: {
          host: '127.0.0.1',
          serviceName: 'OriginalService',
        },
      });

      receiver.setProperties({
        port: 7777,
      });

      const props = receiver.getProperties();
      expect(props.host).toBe('127.0.0.1');
      expect(props.serviceName).toBe('OriginalService');
      expect(props.port).toBe(7777);
    });
  });

  describe('getEndpointUrl', () => {
    it('should return correct endpoint URL', () => {
      const receiver = new WebServiceReceiver({
        properties: {
          host: 'localhost',
          port: 8080,
          serviceName: 'TestService',
        },
      });

      expect(receiver.getEndpointUrl()).toBe(
        'http://localhost:8080/services/TestService'
      );
    });

    it('should use localhost for 0.0.0.0', () => {
      const receiver = new WebServiceReceiver({
        properties: {
          host: '0.0.0.0',
          port: 8081,
          serviceName: 'Mirth',
        },
      });

      expect(receiver.getEndpointUrl()).toBe(
        'http://localhost:8081/services/Mirth'
      );
    });
  });

  describe('getWsdlUrl', () => {
    it('should return correct WSDL URL', () => {
      const receiver = new WebServiceReceiver({
        properties: {
          host: 'localhost',
          port: 8080,
          serviceName: 'TestService',
        },
      });

      expect(receiver.getWsdlUrl()).toBe(
        'http://localhost:8080/services/TestService?wsdl'
      );
    });
  });

  describe('isRunning', () => {
    it('should be false initially', () => {
      const receiver = new WebServiceReceiver({});
      expect(receiver.isRunning()).toBe(false);
    });
  });

  describe('Authentication configuration', () => {
    it('should configure basic authentication', () => {
      const credentials = new Map([
        ['admin', 'password123'],
        ['user', 'userpass'],
      ]);

      const receiver = new WebServiceReceiver({
        properties: {
          authProperties: {
            authType: 'BASIC',
            realm: '/services/Mirth',
            credentials,
          },
        },
      });

      const props = receiver.getProperties();
      expect(props.authProperties?.authType).toBe('BASIC');
      expect(props.authProperties?.realm).toBe('/services/Mirth');
      expect(props.authProperties?.credentials?.get('admin')).toBe('password123');
    });

    it('should configure no authentication', () => {
      const receiver = new WebServiceReceiver({
        properties: {
          authProperties: {
            authType: 'NONE',
          },
        },
      });

      const props = receiver.getProperties();
      expect(props.authProperties?.authType).toBe('NONE');
    });
  });

  describe('SOAP binding configuration', () => {
    it('should configure SOAP 1.1 binding', () => {
      const receiver = new WebServiceReceiver({
        properties: {
          soapBinding: SoapBinding.SOAP11HTTP,
        },
      });

      const props = receiver.getProperties();
      expect(props.soapBinding).toBe(SoapBinding.SOAP11HTTP);
    });

    it('should configure SOAP 1.2 binding', () => {
      const receiver = new WebServiceReceiver({
        properties: {
          soapBinding: SoapBinding.SOAP12HTTP,
        },
      });

      const props = receiver.getProperties();
      expect(props.soapBinding).toBe(SoapBinding.SOAP12HTTP);
    });
  });
});

describe('WebServiceReceiver integration', () => {
  // Note: These integration tests require a channel to be set on the receiver.
  // In a real test environment, you would mock the channel.

  it('should create receiver for integration testing', () => {
    const receiver = new WebServiceReceiver({
      properties: {
        host: '127.0.0.1',
        port: 9999, // Use high port for tests
        serviceName: 'TestService',
      },
    });
    expect(receiver).toBeDefined();
    expect(receiver.isRunning()).toBe(false);
  });
});
