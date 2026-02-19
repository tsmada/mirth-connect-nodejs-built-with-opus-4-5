/**
 * ChannelAssembler — Reassembles a decomposed channel back into valid XML.
 *
 * Takes a DecomposedChannel and rebuilds the channel XML that, when parsed,
 * produces an identical object tree to the original. This is the critical
 * round-trip fidelity guarantee.
 *
 * Strategy: Rather than templating raw XML strings, we rebuild the parsed
 * object tree from the decomposed data and then serialize it with XMLBuilder.
 * This avoids fighting whitespace/formatting issues and focuses on semantic
 * fidelity at the parsed object level.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  DecomposedChannel,
  ConnectorFiles,
  TransformerData,
  FilterData,
  AssembleOptions,
} from './types.js';

/**
 * Assemble a DecomposedChannel back into channel XML.
 *
 * The strategy is simple and robust: we re-parse the original rawXml
 * (which is stored in the DecomposedChannel), then overwrite the decomposed
 * fields (scripts, connector properties) from the decomposed data.
 * This guarantees that any XML structure we didn't explicitly decompose
 * is preserved exactly from the original.
 *
 * When variables are provided in options, ${VAR} references in connector
 * properties are resolved.
 */
export function assemble(decomposed: DecomposedChannel, options?: AssembleOptions): string {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: false,
    processEntities: false,
    isArray: (name: string) => {
      return ['connector', 'entry', 'string', 'rule', 'metaDataColumn', 'channelTag'].includes(
        name
      );
    },
  });

  const parsed = parser.parse(decomposed.rawXml);
  const channel = parsed.channel;

  if (!channel) {
    throw new Error('Invalid decomposed channel: rawXml has no <channel> root element');
  }

  // Overwrite metadata fields that could have been modified.
  // Only write fields that were present in the original XML to avoid
  // introducing new elements (e.g., <enabled> at channel level).
  channel.id = decomposed.metadata.id;
  channel.name = decomposed.metadata.name;
  channel.revision = String(decomposed.metadata.revision);
  if (decomposed.metadata.description !== undefined) {
    channel.description = decomposed.metadata.description;
  }
  // Only set enabled if the original XML had it at the channel level
  if ('enabled' in channel && decomposed.metadata.enabled !== undefined) {
    channel.enabled = decomposed.metadata.enabled ? 'true' : 'false';
  }
  if (decomposed.metadata.nextMetaDataId !== undefined) {
    channel.nextMetaDataId = String(decomposed.metadata.nextMetaDataId);
  }

  // Overwrite source connector from decomposed data
  injectConnector(channel.sourceConnector, decomposed.source, options);

  // Overwrite destination connectors from decomposed data
  injectDestinations(channel.destinationConnectors, decomposed.destinations, options);

  // Overwrite channel-level scripts
  if (decomposed.scripts.deploy !== undefined) {
    channel.deployScript = decomposed.scripts.deploy;
  }
  if (decomposed.scripts.undeploy !== undefined) {
    channel.undeployScript = decomposed.scripts.undeploy;
  }
  if (decomposed.scripts.preprocess !== undefined) {
    channel.preprocessingScript = decomposed.scripts.preprocess;
  }
  if (decomposed.scripts.postprocess !== undefined) {
    channel.postprocessingScript = decomposed.scripts.postprocess;
  }

  // Check if original had XML declaration before we strip it
  const hasXmlDecl = decomposed.rawXml.trimStart().startsWith('<?xml');

  // Remove ?xml processing instruction from parsed tree — XMLBuilder
  // doesn't handle PI declarations well, so we manage it ourselves
  delete parsed['?xml'];

  // Rebuild XML from the modified parsed tree
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: false,
    processEntities: false,
  });

  const xmlOutput = builder.build(parsed);

  if (hasXmlDecl) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlOutput}`;
  }
  return xmlOutput;
}

/**
 * Inject decomposed connector data back into the parsed connector object.
 */
function injectConnector(
  connectorXml: Record<string, unknown>,
  connector: ConnectorFiles,
  options?: AssembleOptions
): void {
  // Restore basic fields
  connectorXml.name = connector.name;
  connectorXml.metaDataId = String(connector.metaDataId);
  connectorXml.transportName = connector.transportName;
  connectorXml.mode = connector.mode;
  connectorXml.enabled = connector.enabled ? 'true' : 'false';
  if (connector.waitForPrevious !== undefined) {
    connectorXml.waitForPrevious = connector.waitForPrevious ? 'true' : 'false';
  }

  // Restore properties — rebuild the properties object with class/version attrs
  const propsObj: Record<string, unknown> = {
    '@_class': connector.propertiesClass,
  };
  if (connector.propertiesVersion) {
    propsObj['@_version'] = connector.propertiesVersion;
  }

  // Merge decomposed properties back, resolving variables if needed
  const resolvedProps = options?.variables
    ? resolveVariables(connector.properties, options.variables)
    : connector.properties;

  for (const [key, value] of Object.entries(resolvedProps)) {
    propsObj[key] = value;
  }
  connectorXml.properties = propsObj;

  // Restore transformer
  if (connector.transformer) {
    injectTransformer(connectorXml.transformer as Record<string, unknown>, connector.transformer);
  }

  // Restore response transformer
  if (connector.responseTransformer) {
    injectTransformer(
      connectorXml.responseTransformer as Record<string, unknown>,
      connector.responseTransformer
    );
  }

  // Restore filter
  if (connector.filter) {
    injectFilter(connectorXml.filter as Record<string, unknown>, connector.filter);
  }
}

function injectTransformer(
  transformerXml: Record<string, unknown>,
  transformer: TransformerData
): void {
  if (!transformerXml) return;

  // Rebuild elements from steps
  if (transformer.steps.length > 0) {
    const elements: Record<string, unknown> = {};
    for (const step of transformer.steps) {
      const stepObj: Record<string, unknown> = {
        name: step.name,
        sequenceNumber: String(step.sequenceNumber),
        enabled: step.enabled ? 'true' : 'false',
        script: step.script,
      };
      if (step.typeVersion) {
        stepObj['@_version'] = step.typeVersion;
      }

      // Group by type (XStream uses fully-qualified class names as element names)
      if (elements[step.type]) {
        // Multiple steps of the same type — make an array
        if (!Array.isArray(elements[step.type])) {
          elements[step.type] = [elements[step.type]];
        }
        (elements[step.type] as unknown[]).push(stepObj);
      } else {
        elements[step.type] = stepObj;
      }
    }
    transformerXml.elements = elements;
  }

  // Data type properties (inbound/outbound data types and their configs)
  // are NOT overwritten here. Since we re-parse the raw XML, they're
  // already present from the original. The decomposer extracts them for
  // informational purposes (diff/display), but the assembler preserves
  // the originals to maintain exact attribute fidelity (@_class, @_version).
}

function injectFilter(filterXml: Record<string, unknown>, filter: FilterData): void {
  if (!filterXml) return;

  if (filter.rules.length > 0) {
    const elements: Record<string, unknown> = {};
    for (const rule of filter.rules) {
      const ruleObj: Record<string, unknown> = {
        name: rule.name,
        sequenceNumber: String(rule.sequenceNumber),
        enabled: rule.enabled ? 'true' : 'false',
        script: rule.script,
      };
      if (rule.typeVersion) {
        ruleObj['@_version'] = rule.typeVersion;
      }
      if (rule.operator) {
        ruleObj.operator = rule.operator;
      }

      if (elements[rule.type]) {
        if (!Array.isArray(elements[rule.type])) {
          elements[rule.type] = [elements[rule.type]];
        }
        (elements[rule.type] as unknown[]).push(ruleObj);
      } else {
        elements[rule.type] = ruleObj;
      }
    }
    filterXml.elements = elements;
  }
}

function injectDestinations(
  destConnectors: Record<string, unknown>,
  destinations: Map<string, ConnectorFiles>,
  options?: AssembleOptions
): void {
  if (!destConnectors) return;

  let connectors = destConnectors.connector;
  if (!connectors) return;
  if (!Array.isArray(connectors)) {
    connectors = [connectors];
    destConnectors.connector = connectors;
  }

  const destEntries = Array.from(destinations.values());

  for (let i = 0; i < (connectors as unknown[]).length && i < destEntries.length; i++) {
    injectConnector((connectors as Record<string, unknown>[])[i]!, destEntries[i]!, options);
  }
}

/**
 * Resolve ${VAR} and ${VAR:default} references in property values.
 */
function resolveVariables(
  obj: Record<string, unknown>,
  variables: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveValue(value, variables);
  }
  return result;
}

function resolveValue(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /\$\{([^}:]+)(?::([^}]*))?\}/g,
      (_match, varName: string, defaultVal: string) => {
        return variables[varName] ?? defaultVal ?? _match;
      }
    );
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, variables));
  }
  if (value && typeof value === 'object') {
    return resolveVariables(value as Record<string, unknown>, variables);
  }
  return value;
}
