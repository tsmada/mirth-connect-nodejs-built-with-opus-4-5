/**
 * ChannelDecomposer — Breaks channel XML into a decomposed file tree.
 *
 * Parses Mirth channel XML using fast-xml-parser and extracts:
 * - Channel metadata (channel.yaml)
 * - Source connector properties + scripts
 * - Destination connector properties + scripts (one directory per dest)
 * - Channel-level scripts (deploy, undeploy, preprocess, postprocess)
 *
 * The decomposed form is designed for:
 * - Git-friendly diffs (scripts as .js files, config as YAML)
 * - Environment-specific variable substitution
 * - Human-readable code review
 */

import { XMLParser } from 'fast-xml-parser';
import yaml from 'js-yaml';
import {
  DecomposedChannel,
  ChannelMetadata,
  ConnectorFiles,
  TransformerData,
  TransformerStepData,
  FilterData,
  FilterRuleData,
  ChannelScripts,
  FileTreeEntry,
  DecomposeOptions,
  isDefaultScript,
  sanitizeName,
} from './types.js';
import { SensitiveDataDetector } from './SensitiveDataDetector.js';

/**
 * XML parser configured for Mirth channel XML.
 *
 * Key settings:
 * - ignoreAttributes: false — XStream uses `class` and `version` attrs on many elements
 * - attributeNamePrefix: '@_' — standard prefix to distinguish attrs from child elements
 * - parseTagValue: false — prevent numeric/boolean coercion of text content
 *   (e.g., port "6661" stays string, "true"/"false" stay strings)
 * - trimValues: false — preserve whitespace in scripts
 * - processEntities: false — don't process XML entities (we want raw content)
 * - isArray — force certain elements to always be arrays for consistent handling
 */
function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: false,
    processEntities: false,
    // These elements can appear 0-N times; ensure consistent array handling
    isArray: (name: string) => {
      return [
        'connector',
        'entry',
        'string',
        'rule',
        'metaDataColumn',
        'channelTag',
      ].includes(name);
    },
  });
}

/**
 * Decompose a Mirth channel XML string into a structured representation.
 */
export function decompose(xml: string, options?: DecomposeOptions): DecomposedChannel {
  const parser = createParser();
  const parsed = parser.parse(xml);
  const channel = parsed.channel;

  if (!channel) {
    throw new Error('Invalid channel XML: no <channel> root element found');
  }

  const version = channel['@_version'] || '';

  const metadata = extractMetadata(channel, version);
  const source = extractConnector(channel.sourceConnector, version);
  const destinations = extractDestinations(channel.destinationConnectors, version);
  const scripts = extractChannelScripts(channel);

  const decomposed: DecomposedChannel = {
    metadata,
    source,
    destinations,
    scripts,
    rawXml: xml,
  };

  if (options?.maskSecrets) {
    const detector = new SensitiveDataDetector();
    detector.maskDecomposed(decomposed, metadata.name, options.sensitiveFields);
  }

  return decomposed;
}

/**
 * Convert a DecomposedChannel into an array of FileTreeEntry objects
 * representing the decomposed directory structure.
 */
export function toFileTree(decomposed: DecomposedChannel): FileTreeEntry[] {
  const files: FileTreeEntry[] = [];

  // channel.yaml — core metadata
  files.push({
    path: 'channel.yaml',
    content: yaml.dump(decomposed.metadata, { lineWidth: -1, noRefs: true }),
    type: 'yaml',
  });

  // Source connector
  addConnectorFiles(files, 'source', decomposed.source);

  // Destination connectors
  for (const [name, dest] of decomposed.destinations) {
    addConnectorFiles(files, `destinations/${name}`, dest);
  }

  // Raw XML backbone — needed by the assembler for lossless round-trip reassembly.
  // When importing from git, filesToDecomposed() reads this back into rawXml.
  if (decomposed.rawXml) {
    files.push({
      path: '_raw.xml',
      content: decomposed.rawXml,
      type: 'xml',
    });
  }

  // Channel scripts
  if (decomposed.scripts.deploy && !isDefaultScript(decomposed.scripts.deploy)) {
    files.push({ path: 'scripts/deploy.js', content: decomposed.scripts.deploy, type: 'js' });
  }
  if (decomposed.scripts.undeploy && !isDefaultScript(decomposed.scripts.undeploy)) {
    files.push({ path: 'scripts/undeploy.js', content: decomposed.scripts.undeploy, type: 'js' });
  }
  if (decomposed.scripts.preprocess && !isDefaultScript(decomposed.scripts.preprocess)) {
    files.push({ path: 'scripts/preprocess.js', content: decomposed.scripts.preprocess, type: 'js' });
  }
  if (decomposed.scripts.postprocess && !isDefaultScript(decomposed.scripts.postprocess)) {
    files.push({ path: 'scripts/postprocess.js', content: decomposed.scripts.postprocess, type: 'js' });
  }

  return files;
}

function addConnectorFiles(files: FileTreeEntry[], basePath: string, connector: ConnectorFiles): void {
  // connector.yaml — connector properties (excluding scripts)
  const connectorYaml: Record<string, unknown> = {
    name: connector.name,
    metaDataId: connector.metaDataId,
    transportName: connector.transportName,
    mode: connector.mode,
    enabled: connector.enabled,
    propertiesClass: connector.propertiesClass,
  };
  if (connector.propertiesVersion) {
    connectorYaml.propertiesVersion = connector.propertiesVersion;
  }
  if (connector.waitForPrevious !== undefined) {
    connectorYaml.waitForPrevious = connector.waitForPrevious;
  }
  connectorYaml.properties = connector.properties;

  files.push({
    path: `${basePath}/connector.yaml`,
    content: yaml.dump(connectorYaml, { lineWidth: -1, noRefs: true }),
    type: 'yaml',
  });

  // Transformer steps as individual .js files
  if (connector.transformer) {
    addTransformerFiles(files, basePath, 'transformer', connector.transformer);
  }

  // Response transformer steps
  if (connector.responseTransformer) {
    addTransformerFiles(files, basePath, 'response-transformer', connector.responseTransformer);
  }

  // Filter rules as individual .js files
  if (connector.filter && connector.filter.rules.length > 0) {
    addFilterFiles(files, basePath, connector.filter);
  }
}

function addTransformerFiles(
  files: FileTreeEntry[],
  basePath: string,
  transformerName: string,
  transformer: TransformerData
): void {
  // Transformer metadata (data types, properties)
  const meta: Record<string, unknown> = {};
  if (transformer.version) meta.version = transformer.version;
  if (transformer.inboundDataType) meta.inboundDataType = transformer.inboundDataType;
  if (transformer.outboundDataType) meta.outboundDataType = transformer.outboundDataType;
  if (transformer.inboundProperties) {
    meta.inboundProperties = transformer.inboundProperties;
    if (transformer.inboundPropertiesClass) {
      meta.inboundPropertiesClass = transformer.inboundPropertiesClass;
    }
  }
  if (transformer.outboundProperties) {
    meta.outboundProperties = transformer.outboundProperties;
    if (transformer.outboundPropertiesClass) {
      meta.outboundPropertiesClass = transformer.outboundPropertiesClass;
    }
  }

  files.push({
    path: `${basePath}/${transformerName}.yaml`,
    content: yaml.dump(meta, { lineWidth: -1, noRefs: true }),
    type: 'yaml',
  });

  // Individual step scripts
  for (const step of transformer.steps) {
    const header = buildScriptHeader({
      artifactPath: `${basePath}.${transformerName}.step[${step.sequenceNumber}]`,
      name: step.name,
      sequence: step.sequenceNumber,
      enabled: step.enabled,
      type: step.type,
      typeVersion: step.typeVersion,
    });
    files.push({
      path: `${basePath}/${transformerName}/step-${step.sequenceNumber}-${sanitizeName(step.name)}.js`,
      content: header + step.script,
      type: 'js',
    });
  }
}

function addFilterFiles(files: FileTreeEntry[], basePath: string, filter: FilterData): void {
  const meta: Record<string, unknown> = {};
  if (filter.version) meta.version = filter.version;

  files.push({
    path: `${basePath}/filter.yaml`,
    content: yaml.dump(meta, { lineWidth: -1, noRefs: true }),
    type: 'yaml',
  });

  for (const rule of filter.rules) {
    const header = buildScriptHeader({
      artifactPath: `${basePath}.filter.rule[${rule.sequenceNumber}]`,
      name: rule.name,
      sequence: rule.sequenceNumber,
      enabled: rule.enabled,
      type: rule.type,
      typeVersion: rule.typeVersion,
      operator: rule.operator,
    });
    files.push({
      path: `${basePath}/filter/rule-${rule.sequenceNumber}-${sanitizeName(rule.name)}.js`,
      content: header + rule.script,
      type: 'js',
    });
  }
}

interface ScriptHeaderParams {
  artifactPath: string;
  name: string;
  sequence: number;
  enabled: boolean;
  type: string;
  typeVersion?: string;
  operator?: string;
}

function buildScriptHeader(params: ScriptHeaderParams): string {
  let header = `// @mirth-artifact ${params.artifactPath}\n`;
  header += `// @name ${params.name}\n`;
  header += `// @sequence ${params.sequence}\n`;
  header += `// @enabled ${params.enabled}\n`;
  header += `// @type ${params.type}\n`;
  if (params.typeVersion) {
    header += `// @type-version ${params.typeVersion}\n`;
  }
  if (params.operator) {
    header += `// @operator ${params.operator}\n`;
  }
  header += '\n';
  return header;
}

// ----- Extraction helpers -----

function extractMetadata(channel: Record<string, unknown>, version: string): ChannelMetadata {
  const meta: ChannelMetadata = {
    id: String(channel.id || ''),
    name: String(channel.name || ''),
    version,
    revision: parseInt(String(channel.revision || '1'), 10),
    enabled: channel.enabled !== 'false',
  };
  if (channel.description !== undefined && channel.description !== '') {
    meta.description = String(channel.description);
  }
  if (channel.nextMetaDataId !== undefined) {
    meta.nextMetaDataId = parseInt(String(channel.nextMetaDataId), 10);
  }
  return meta;
}

function extractConnector(connectorXml: Record<string, unknown>, _channelVersion: string): ConnectorFiles {
  const properties = connectorXml.properties as Record<string, unknown> | undefined;
  const propertiesClass = properties?.['@_class'] as string || '';
  const propertiesVersion = properties?.['@_version'] as string | undefined;

  // Extract all properties except the class/version attributes
  const cleanProps = extractProperties(properties || {});

  return {
    name: String(connectorXml.name || ''),
    metaDataId: parseInt(String(connectorXml.metaDataId || '0'), 10),
    transportName: String(connectorXml.transportName || ''),
    mode: String(connectorXml.mode || ''),
    enabled: connectorXml.enabled !== 'false',
    waitForPrevious: connectorXml.waitForPrevious === 'true' ? true :
      connectorXml.waitForPrevious === 'false' ? false : undefined,
    properties: cleanProps,
    propertiesClass,
    propertiesVersion,
    transformer: extractTransformer(connectorXml.transformer as Record<string, unknown> | undefined),
    responseTransformer: extractTransformer(connectorXml.responseTransformer as Record<string, unknown> | undefined),
    filter: extractFilter(connectorXml.filter as Record<string, unknown> | undefined),
  };
}

function extractDestinations(
  destConnectors: Record<string, unknown> | undefined,
  channelVersion: string
): Map<string, ConnectorFiles> {
  const map = new Map<string, ConnectorFiles>();
  if (!destConnectors) return map;

  let connectors = (destConnectors as Record<string, unknown>).connector;
  if (!connectors) return map;
  if (!Array.isArray(connectors)) {
    connectors = [connectors];
  }

  const nameCounters = new Map<string, number>();

  for (const conn of connectors as Record<string, unknown>[]) {
    const connFiles = extractConnector(conn, channelVersion);
    let sanitized = sanitizeName(connFiles.name);

    // Handle duplicate destination names
    const count = nameCounters.get(sanitized) || 0;
    nameCounters.set(sanitized, count + 1);
    if (count > 0) {
      sanitized = `${sanitized}-${count}`;
    }

    map.set(sanitized, connFiles);
  }

  return map;
}

function extractProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    // Skip XML attributes (handled separately)
    if (key.startsWith('@_')) continue;
    result[key] = value;
  }
  return result;
}

function extractTransformer(
  transformerXml: Record<string, unknown> | undefined
): TransformerData | undefined {
  if (!transformerXml) return undefined;

  const version = transformerXml['@_version'] as string | undefined;
  const steps = extractTransformerSteps(transformerXml.elements as Record<string, unknown> | undefined);

  const data: TransformerData = {
    version,
    steps,
  };

  if (transformerXml.inboundDataType !== undefined) {
    data.inboundDataType = String(transformerXml.inboundDataType);
  }
  if (transformerXml.outboundDataType !== undefined) {
    data.outboundDataType = String(transformerXml.outboundDataType);
  }

  // Extract inbound/outbound properties with their class attribute
  if (transformerXml.inboundProperties) {
    const inProps = transformerXml.inboundProperties as Record<string, unknown>;
    data.inboundPropertiesClass = inProps['@_class'] as string | undefined;
    data.inboundProperties = extractProperties(inProps);
  }
  if (transformerXml.outboundProperties) {
    const outProps = transformerXml.outboundProperties as Record<string, unknown>;
    data.outboundPropertiesClass = outProps['@_class'] as string | undefined;
    data.outboundProperties = extractProperties(outProps);
  }

  return data;
}

function extractTransformerSteps(elements: Record<string, unknown> | undefined): TransformerStepData[] {
  if (!elements) return [];

  const steps: TransformerStepData[] = [];

  for (const [typeName, value] of Object.entries(elements)) {
    if (typeName.startsWith('@_')) continue;

    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const stepObj = item as Record<string, unknown>;
      steps.push({
        name: String(stepObj.name || ''),
        sequenceNumber: parseInt(String(stepObj.sequenceNumber || '0'), 10),
        enabled: stepObj.enabled !== 'false',
        type: typeName,
        typeVersion: stepObj['@_version'] as string | undefined,
        script: String(stepObj.script || ''),
      });
    }
  }

  // Sort by sequence number for deterministic output
  steps.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  return steps;
}

function extractFilter(filterXml: Record<string, unknown> | undefined): FilterData | undefined {
  if (!filterXml) return undefined;

  const version = filterXml['@_version'] as string | undefined;
  const rules = extractFilterRules(filterXml.elements as Record<string, unknown> | undefined);

  return { version, rules };
}

function extractFilterRules(elements: Record<string, unknown> | undefined): FilterRuleData[] {
  if (!elements) return [];

  const rules: FilterRuleData[] = [];

  for (const [typeName, value] of Object.entries(elements)) {
    if (typeName.startsWith('@_')) continue;

    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const ruleObj = item as Record<string, unknown>;
      rules.push({
        name: String(ruleObj.name || ''),
        sequenceNumber: parseInt(String(ruleObj.sequenceNumber || '0'), 10),
        enabled: ruleObj.enabled !== 'false',
        type: typeName,
        typeVersion: ruleObj['@_version'] as string | undefined,
        operator: ruleObj.operator ? String(ruleObj.operator) : undefined,
        script: String(ruleObj.script || ''),
      });
    }
  }

  rules.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  return rules;
}

function extractChannelScripts(channel: Record<string, unknown>): ChannelScripts {
  const scripts: ChannelScripts = {};

  if (channel.deployScript !== undefined) {
    scripts.deploy = String(channel.deployScript);
  }
  if (channel.undeployScript !== undefined) {
    scripts.undeploy = String(channel.undeployScript);
  }
  if (channel.preprocessingScript !== undefined) {
    scripts.preprocess = String(channel.preprocessingScript);
  }
  if (channel.postprocessingScript !== undefined) {
    scripts.postprocess = String(channel.postprocessingScript);
  }

  return scripts;
}
