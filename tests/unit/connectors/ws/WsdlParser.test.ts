/**
 * Tests for WsdlParser - WSDL parsing utilities
 */

import {
  parseWsdlContent,
  getOperations,
  getSoapAction,
  getEndpointLocation,
  getServiceNames,
  getPortNames,
} from '../../../../src/connectors/ws/WsdlParser.js';

describe('WsdlParser', () => {
  // Sample WSDL for testing
  const sampleWsdl = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:tns="http://example.com/stockquote"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             targetNamespace="http://example.com/stockquote"
             name="StockQuoteService">

  <types>
    <xsd:schema>
      <xsd:element name="GetStockPrice" type="xsd:string"/>
      <xsd:element name="GetStockPriceResponse" type="xsd:decimal"/>
    </xsd:schema>
  </types>

  <message name="GetStockPriceInput">
    <part name="parameters" element="tns:GetStockPrice"/>
  </message>

  <message name="GetStockPriceOutput">
    <part name="parameters" element="tns:GetStockPriceResponse"/>
  </message>

  <portType name="StockQuotePortType">
    <operation name="GetStockPrice">
      <input message="tns:GetStockPriceInput"/>
      <output message="tns:GetStockPriceOutput"/>
    </operation>
  </portType>

  <binding name="StockQuoteSoapBinding" type="tns:StockQuotePortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="GetStockPrice">
      <soap:operation soapAction="http://example.com/GetStockPrice"/>
      <input>
        <soap:body use="literal"/>
      </input>
      <output>
        <soap:body use="literal"/>
      </output>
    </operation>
  </binding>

  <service name="StockQuoteService">
    <port name="StockQuotePort" binding="tns:StockQuoteSoapBinding">
      <soap:address location="http://www.example.com/stockquote"/>
    </port>
  </service>

</definitions>`;

  // Multi-service WSDL
  const multiServiceWsdl = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:tns="http://example.com/multiservice"
             targetNamespace="http://example.com/multiservice"
             name="MultiService">

  <portType name="OrderPortType">
    <operation name="GetOrder"/>
    <operation name="CreateOrder"/>
  </portType>

  <portType name="CustomerPortType">
    <operation name="GetCustomer"/>
  </portType>

  <binding name="OrderBinding" type="tns:OrderPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="GetOrder">
      <soap:operation soapAction="http://example.com/GetOrder"/>
    </operation>
    <operation name="CreateOrder">
      <soap:operation soapAction="http://example.com/CreateOrder"/>
    </operation>
  </binding>

  <binding name="CustomerBinding" type="tns:CustomerPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="GetCustomer">
      <soap:operation soapAction="http://example.com/GetCustomer"/>
    </operation>
  </binding>

  <service name="OrderService">
    <port name="OrderPort" binding="tns:OrderBinding">
      <soap:address location="http://www.example.com/orders"/>
    </port>
  </service>

  <service name="CustomerService">
    <port name="CustomerPort" binding="tns:CustomerBinding">
      <soap:address location="http://www.example.com/customers"/>
    </port>
  </service>

</definitions>`;

  describe('parseWsdlContent', () => {
    it('should parse basic WSDL', () => {
      const result = parseWsdlContent(sampleWsdl);

      expect(result.targetNamespace).toBe('http://example.com/stockquote');
      expect(result.services.length).toBe(1);
      expect(result.bindings.length).toBe(1);
    });

    it('should parse services correctly', () => {
      const result = parseWsdlContent(sampleWsdl);

      expect(result.services[0]!.name).toBe('StockQuoteService');
      expect(result.services[0]!.ports.length).toBe(1);
      expect(result.services[0]!.ports[0]!.name).toBe('StockQuotePort');
      expect(result.services[0]!.ports[0]!.binding).toBe('StockQuoteSoapBinding');
      expect(result.services[0]!.ports[0]!.location).toBe(
        'http://www.example.com/stockquote'
      );
    });

    it('should parse bindings correctly', () => {
      const result = parseWsdlContent(sampleWsdl);

      expect(result.bindings[0]!.name).toBe('StockQuoteSoapBinding');
      expect(result.bindings[0]!.portType).toBe('StockQuotePortType');
      expect(result.bindings[0]!.style).toBe('document');
      expect(result.bindings[0]!.transport).toBe(
        'http://schemas.xmlsoap.org/soap/http'
      );
    });

    it('should parse operations correctly', () => {
      const result = parseWsdlContent(sampleWsdl);

      expect(result.bindings[0]!.operations.length).toBe(1);
      expect(result.bindings[0]!.operations[0]!.name).toBe('GetStockPrice');
      expect(result.bindings[0]!.operations[0]!.soapAction).toBe(
        'http://example.com/GetStockPrice'
      );
    });

    it('should build definition map correctly', () => {
      const result = parseWsdlContent(sampleWsdl);

      expect(result.definitionMap.map.has('StockQuoteService')).toBe(true);

      const serviceMap = result.definitionMap.map.get('StockQuoteService');
      expect(serviceMap?.map.has('StockQuotePort')).toBe(true);

      const portInfo = serviceMap?.map.get('StockQuotePort');
      expect(portInfo?.operations).toContain('GetStockPrice');
      expect(portInfo?.locationURI).toBe('http://www.example.com/stockquote');
    });

    it('should handle multiple services', () => {
      const result = parseWsdlContent(multiServiceWsdl);

      expect(result.services.length).toBe(2);
      expect(getServiceNames(result.definitionMap)).toEqual(
        expect.arrayContaining(['OrderService', 'CustomerService'])
      );
    });

    it('should handle multiple ports and operations', () => {
      const result = parseWsdlContent(multiServiceWsdl);

      const operations = getOperations(
        result.definitionMap,
        'OrderService',
        'OrderPort'
      );
      expect(operations).toContain('GetOrder');
      expect(operations).toContain('CreateOrder');
    });

    it('should throw on invalid WSDL', () => {
      const invalidWsdl = '<notWsdl><content/></notWsdl>';

      expect(() => parseWsdlContent(invalidWsdl)).toThrow(
        'definitions element not found'
      );
    });
  });

  describe('getOperations', () => {
    it('should return operations for valid service/port', () => {
      const result = parseWsdlContent(sampleWsdl);
      const operations = getOperations(
        result.definitionMap,
        'StockQuoteService',
        'StockQuotePort'
      );

      expect(operations).toEqual(['GetStockPrice']);
    });

    it('should return empty array for invalid service', () => {
      const result = parseWsdlContent(sampleWsdl);
      const operations = getOperations(
        result.definitionMap,
        'NonExistent',
        'Port'
      );

      expect(operations).toEqual([]);
    });

    it('should return empty array for invalid port', () => {
      const result = parseWsdlContent(sampleWsdl);
      const operations = getOperations(
        result.definitionMap,
        'StockQuoteService',
        'NonExistent'
      );

      expect(operations).toEqual([]);
    });
  });

  describe('getSoapAction', () => {
    it('should return SOAP action for valid operation', () => {
      const result = parseWsdlContent(sampleWsdl);
      const action = getSoapAction(
        result.definitionMap,
        'StockQuoteService',
        'StockQuotePort',
        'GetStockPrice'
      );

      expect(action).toBe('http://example.com/GetStockPrice');
    });

    it('should return undefined for invalid operation', () => {
      const result = parseWsdlContent(sampleWsdl);
      const action = getSoapAction(
        result.definitionMap,
        'StockQuoteService',
        'StockQuotePort',
        'NonExistent'
      );

      expect(action).toBeUndefined();
    });
  });

  describe('getEndpointLocation', () => {
    it('should return endpoint location for valid service/port', () => {
      const result = parseWsdlContent(sampleWsdl);
      const location = getEndpointLocation(
        result.definitionMap,
        'StockQuoteService',
        'StockQuotePort'
      );

      expect(location).toBe('http://www.example.com/stockquote');
    });

    it('should return undefined for invalid service/port', () => {
      const result = parseWsdlContent(sampleWsdl);
      const location = getEndpointLocation(
        result.definitionMap,
        'NonExistent',
        'Port'
      );

      expect(location).toBeUndefined();
    });
  });

  describe('getServiceNames', () => {
    it('should return all service names', () => {
      const result = parseWsdlContent(multiServiceWsdl);
      const names = getServiceNames(result.definitionMap);

      expect(names).toHaveLength(2);
      expect(names).toContain('OrderService');
      expect(names).toContain('CustomerService');
    });
  });

  describe('getPortNames', () => {
    it('should return port names for a service', () => {
      const result = parseWsdlContent(sampleWsdl);
      const names = getPortNames(result.definitionMap, 'StockQuoteService');

      expect(names).toEqual(['StockQuotePort']);
    });

    it('should return empty array for invalid service', () => {
      const result = parseWsdlContent(sampleWsdl);
      const names = getPortNames(result.definitionMap, 'NonExistent');

      expect(names).toEqual([]);
    });
  });
});
