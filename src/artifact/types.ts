/**
 * Core types for the Mirth channel artifact management system.
 *
 * These types support decomposing channel XML into diffable file trees
 * and reassembling them back into valid channel XML.
 */

export interface DecomposedChannel {
  metadata: ChannelMetadata;
  source: ConnectorFiles;
  destinations: Map<string, ConnectorFiles>;
  scripts: ChannelScripts;
  rawXml: string;
}

export interface ChannelMetadata {
  id: string;
  name: string;
  version: string;
  revision: number;
  enabled: boolean;
  description?: string;
  nextMetaDataId?: number;
}

export interface ConnectorFiles {
  name: string;
  metaDataId: number;
  transportName: string;
  mode: string;
  enabled: boolean;
  waitForPrevious?: boolean;
  properties: Record<string, unknown>;
  propertiesClass: string;
  propertiesVersion?: string;
  transformer?: TransformerData;
  responseTransformer?: TransformerData;
  filter?: FilterData;
}

export interface TransformerData {
  version?: string;
  steps: TransformerStepData[];
  inboundDataType?: string;
  outboundDataType?: string;
  inboundProperties?: Record<string, unknown>;
  inboundPropertiesClass?: string;
  outboundProperties?: Record<string, unknown>;
  outboundPropertiesClass?: string;
}

export interface TransformerStepData {
  name: string;
  sequenceNumber: number;
  enabled: boolean;
  type: string;
  typeVersion?: string;
  script: string;
}

export interface FilterData {
  version?: string;
  rules: FilterRuleData[];
}

export interface FilterRuleData {
  name: string;
  sequenceNumber: number;
  enabled: boolean;
  type: string;
  typeVersion?: string;
  operator?: string;
  script: string;
}

export interface ChannelScripts {
  deploy?: string;
  undeploy?: string;
  preprocess?: string;
  postprocess?: string;
}

export interface DecomposeOptions {
  maskSecrets?: boolean;
  sensitiveFields?: string[];
}

export interface AssembleOptions {
  variables?: Record<string, string>;
}

export interface FileTreeEntry {
  path: string;
  content: string;
  type: 'yaml' | 'js' | 'xml';
}

export interface SensitiveField {
  path: string;
  fieldName: string;
  transportType: string;
  parameterName: string;
  originalValue?: string;
}

/**
 * Default/empty scripts that should be treated as absent.
 * Java Mirth sets these when the user hasn't written a script.
 */
const DEFAULT_SCRIPTS = [
  '',
  'return message;',
  'return;',
  '// This script executes once when the channel is deployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;',
  '// This script executes once when the channel is undeployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;',
];

/**
 * Check if a script is a default/empty one that doesn't need extraction.
 */
export function isDefaultScript(script: string | undefined): boolean {
  if (!script) return true;
  const trimmed = script.trim();
  return DEFAULT_SCRIPTS.some((d) => trimmed === d.trim());
}

/**
 * Sanitize a name for use as a filesystem path component.
 * e.g., "Dest 1 - Send HTTP" -> "dest-1-send-http"
 */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
