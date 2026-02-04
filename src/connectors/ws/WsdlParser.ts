/**
 * WSDL Parser
 *
 * Purpose: Parse WSDL documents to extract service, port, and operation information
 *
 * Key behaviors:
 * - Parse WSDL 1.1 documents
 * - Extract services, ports, operations
 * - Handle imports and includes
 * - Cache parsed results
 */

import { XMLParser } from 'fast-xml-parser';
import {
  DefinitionServiceMap,
  DefinitionPortMap,
  PortInformation,
  createDefinitionServiceMap,
} from './WebServiceDispatcherProperties.js';

/**
 * WSDL Operation information
 */
export interface WsdlOperation {
  /** Operation name */
  name: string;
  /** SOAP action */
  soapAction?: string;
  /** Input message name */
  inputMessage?: string;
  /** Output message name */
  outputMessage?: string;
  /** Documentation */
  documentation?: string;
}

/**
 * WSDL Port/Endpoint information
 */
export interface WsdlPort {
  /** Port name */
  name: string;
  /** Binding name */
  binding: string;
  /** Endpoint location URL */
  location: string;
}

/**
 * WSDL Binding information
 */
export interface WsdlBinding {
  /** Binding name */
  name: string;
  /** Port type name */
  portType: string;
  /** SOAP style (document/rpc) */
  style?: string;
  /** Transport (http) */
  transport?: string;
  /** Operations */
  operations: WsdlOperation[];
}

/**
 * WSDL Service information
 */
export interface WsdlService {
  /** Service name */
  name: string;
  /** Ports in this service */
  ports: WsdlPort[];
}

/**
 * Parsed WSDL document
 */
export interface ParsedWsdl {
  /** Target namespace */
  targetNamespace: string;
  /** Services defined in WSDL */
  services: WsdlService[];
  /** Bindings defined in WSDL */
  bindings: WsdlBinding[];
  /** Definition service map for UI */
  definitionMap: DefinitionServiceMap;
}

/**
 * WSDL fetch options
 */
export interface WsdlFetchOptions {
  /** Username for authentication */
  username?: string;
  /** Password for authentication */
  password?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Follow imports */
  followImports?: boolean;
}

/**
 * Parse WSDL from URL
 */
export async function parseWsdlFromUrl(
  url: string,
  options: WsdlFetchOptions = {}
): Promise<ParsedWsdl> {
  const wsdlContent = await fetchWsdl(url, options);
  return parseWsdlContent(wsdlContent, url, options);
}

/**
 * Fetch WSDL content from URL
 */
async function fetchWsdl(
  url: string,
  options: WsdlFetchOptions
): Promise<string> {
  const headers: Record<string, string> = {};

  if (options.username && options.password) {
    const credentials = Buffer.from(
      `${options.username}:${options.password}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout ?? 30000
  );

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch WSDL: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`WSDL fetch timeout after ${options.timeout ?? 30000}ms`);
    }
    throw error;
  }
}

/**
 * Parse WSDL content
 */
export function parseWsdlContent(
  wsdlContent: string,
  _baseUrl?: string,
  _options?: WsdlFetchOptions
): ParsedWsdl {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(wsdlContent);

  // Find definitions element (could have various prefixes)
  let definitions: Record<string, unknown> | null = null;
  for (const key of Object.keys(parsed)) {
    if (key.toLowerCase().includes('definitions')) {
      definitions = parsed[key] as Record<string, unknown>;
      break;
    }
  }

  if (!definitions) {
    throw new Error('Invalid WSDL: definitions element not found');
  }

  const targetNamespace =
    (definitions['@_targetNamespace'] as string) || '';

  // Parse bindings
  const bindings = parseBindings(definitions);

  // Parse services
  const services = parseServices(definitions);

  // Build definition map for UI
  const definitionMap = buildDefinitionMap(services, bindings);

  return {
    targetNamespace,
    services,
    bindings,
    definitionMap,
  };
}

/**
 * Parse bindings from WSDL definitions
 */
function parseBindings(
  definitions: Record<string, unknown>
): WsdlBinding[] {
  const bindings: WsdlBinding[] = [];

  // Find binding elements (could have wsdl: prefix like wsdl:binding or just binding)
  for (const key of Object.keys(definitions)) {
    // Skip attributes (start with @_)
    if (key.startsWith('@_')) continue;

    // Match 'binding' or 'wsdl:binding' etc.
    const keyLower = key.toLowerCase();
    if (keyLower !== 'binding' && !keyLower.endsWith(':binding')) {
      continue;
    }

    const bindingData = definitions[key];
    const bindingList = Array.isArray(bindingData)
      ? bindingData
      : [bindingData];

    for (const binding of bindingList) {
      if (!binding || typeof binding !== 'object') continue;

      const bindingObj = binding as Record<string, unknown>;
      const name = bindingObj['@_name'] as string;
      const type = bindingObj['@_type'] as string;

      if (!name) continue;

      // Parse port type from type attribute (remove namespace prefix)
      const portType = type?.includes(':') ? type.split(':')[1]! : type;

      // Find SOAP binding info
      let style: string | undefined;
      let transport: string | undefined;

      for (const bindingKey of Object.keys(bindingObj)) {
        if (
          bindingKey.toLowerCase().includes('binding') &&
          bindingKey !== '@_name' &&
          bindingKey !== '@_type'
        ) {
          const soapBinding = bindingObj[bindingKey] as Record<
            string,
            unknown
          >;
          style = soapBinding['@_style'] as string | undefined;
          transport = soapBinding['@_transport'] as string | undefined;
        }
      }

      // Parse operations
      const operations = parseBindingOperations(bindingObj);

      bindings.push({
        name,
        portType: portType || '',
        style,
        transport,
        operations,
      });
    }
  }

  return bindings;
}

/**
 * Parse operations from binding element
 */
function parseBindingOperations(
  binding: Record<string, unknown>
): WsdlOperation[] {
  const operations: WsdlOperation[] = [];

  // Find operation elements (could be 'operation' or 'wsdl:operation' etc.)
  for (const key of Object.keys(binding)) {
    // Skip attributes
    if (key.startsWith('@_')) continue;

    // Match 'operation' or 'wsdl:operation' etc.
    const keyLower = key.toLowerCase();
    if (keyLower !== 'operation' && !keyLower.endsWith(':operation')) continue;

    const opData = binding[key];
    const opList = Array.isArray(opData) ? opData : [opData];

    for (const op of opList) {
      if (!op || typeof op !== 'object') continue;

      const opObj = op as Record<string, unknown>;
      const name = opObj['@_name'] as string;

      if (!name) continue;

      // Find SOAP operation info (soapAction)
      let soapAction: string | undefined;

      for (const opKey of Object.keys(opObj)) {
        if (
          opKey.toLowerCase().includes('operation') &&
          !opKey.startsWith('@_')
        ) {
          const soapOp = opObj[opKey] as Record<string, unknown>;
          soapAction = soapOp['@_soapAction'] as string | undefined;
        }
      }

      operations.push({
        name,
        soapAction,
      });
    }
  }

  return operations;
}

/**
 * Parse services from WSDL definitions
 */
function parseServices(
  definitions: Record<string, unknown>
): WsdlService[] {
  const services: WsdlService[] = [];

  // Find service elements (could be 'service' or 'wsdl:service' etc.)
  for (const key of Object.keys(definitions)) {
    // Skip attributes
    if (key.startsWith('@_')) continue;

    // Match 'service' or 'wsdl:service' etc.
    const keyLower = key.toLowerCase();
    if (keyLower !== 'service' && !keyLower.endsWith(':service')) continue;

    const serviceData = definitions[key];
    const serviceList = Array.isArray(serviceData)
      ? serviceData
      : [serviceData];

    for (const service of serviceList) {
      if (!service || typeof service !== 'object') continue;

      const serviceObj = service as Record<string, unknown>;
      const name = serviceObj['@_name'] as string;

      if (!name) continue;

      // Parse ports
      const ports = parseServicePorts(serviceObj);

      services.push({
        name,
        ports,
      });
    }
  }

  return services;
}

/**
 * Parse ports from service element
 */
function parseServicePorts(
  service: Record<string, unknown>
): WsdlPort[] {
  const ports: WsdlPort[] = [];

  // Find port elements (could be 'port' or 'wsdl:port' etc.)
  for (const key of Object.keys(service)) {
    // Skip attributes
    if (key.startsWith('@_')) continue;

    // Match 'port' or 'wsdl:port' etc.
    const keyLower = key.toLowerCase();
    if (keyLower !== 'port' && !keyLower.endsWith(':port')) continue;

    const portData = service[key];
    const portList = Array.isArray(portData) ? portData : [portData];

    for (const port of portList) {
      if (!port || typeof port !== 'object') continue;

      const portObj = port as Record<string, unknown>;
      const name = portObj['@_name'] as string;
      const binding = portObj['@_binding'] as string;

      if (!name) continue;

      // Find address/location
      let location = '';

      for (const portKey of Object.keys(portObj)) {
        if (
          portKey.toLowerCase().includes('address') &&
          !portKey.startsWith('@_')
        ) {
          const address = portObj[portKey] as Record<string, unknown>;
          location = (address['@_location'] as string) || '';
        }
      }

      // Remove namespace prefix from binding
      const bindingName = binding?.includes(':')
        ? binding.split(':')[1]!
        : binding;

      ports.push({
        name,
        binding: bindingName || '',
        location,
      });
    }
  }

  return ports;
}

/**
 * Build definition map from parsed services and bindings
 */
function buildDefinitionMap(
  services: WsdlService[],
  bindings: WsdlBinding[]
): DefinitionServiceMap {
  const definitionMap = createDefinitionServiceMap();

  // Create a binding lookup map
  const bindingMap = new Map<string, WsdlBinding>();
  for (const binding of bindings) {
    bindingMap.set(binding.name, binding);
  }

  for (const service of services) {
    const portMap: DefinitionPortMap = { map: new Map() };

    for (const port of service.ports) {
      const binding = bindingMap.get(port.binding);
      const operations = binding?.operations.map((op) => op.name) || [];
      const actions = binding?.operations.map((op) => op.soapAction || '') || [];

      const portInfo: PortInformation = {
        operations,
        actions,
        locationURI: port.location,
      };

      portMap.map.set(port.name, portInfo);
    }

    definitionMap.map.set(service.name, portMap);
  }

  return definitionMap;
}

/**
 * Get available operations for a service/port combination
 */
export function getOperations(
  definitionMap: DefinitionServiceMap,
  serviceName: string,
  portName: string
): string[] {
  const serviceMap = definitionMap.map.get(serviceName);
  if (!serviceMap) return [];

  const portInfo = serviceMap.map.get(portName);
  if (!portInfo) return [];

  return portInfo.operations;
}

/**
 * Get SOAP action for an operation
 */
export function getSoapAction(
  definitionMap: DefinitionServiceMap,
  serviceName: string,
  portName: string,
  operationName: string
): string | undefined {
  const serviceMap = definitionMap.map.get(serviceName);
  if (!serviceMap) return undefined;

  const portInfo = serviceMap.map.get(portName);
  if (!portInfo) return undefined;

  const opIndex = portInfo.operations.indexOf(operationName);
  if (opIndex < 0) return undefined;

  return portInfo.actions?.[opIndex];
}

/**
 * Get endpoint location for a service/port combination
 */
export function getEndpointLocation(
  definitionMap: DefinitionServiceMap,
  serviceName: string,
  portName: string
): string | undefined {
  const serviceMap = definitionMap.map.get(serviceName);
  if (!serviceMap) return undefined;

  const portInfo = serviceMap.map.get(portName);
  return portInfo?.locationURI;
}

/**
 * Get list of service names from definition map
 */
export function getServiceNames(
  definitionMap: DefinitionServiceMap
): string[] {
  return Array.from(definitionMap.map.keys());
}

/**
 * Get list of port names for a service
 */
export function getPortNames(
  definitionMap: DefinitionServiceMap,
  serviceName: string
): string[] {
  const serviceMap = definitionMap.map.get(serviceName);
  if (!serviceMap) return [];

  return Array.from(serviceMap.map.keys());
}
