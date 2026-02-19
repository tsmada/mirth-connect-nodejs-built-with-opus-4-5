/**
 * SensitiveDataDetector — Transport-type-aware credential detection.
 *
 * Scans connector properties for sensitive fields (passwords, tokens, keys)
 * based on the transport type and field naming patterns. Generates
 * parameterized variable names using UPPER_SNAKE convention for
 * environment-based substitution.
 */

import { DecomposedChannel, SensitiveField, sanitizeName } from './types.js';

/**
 * Fields considered sensitive by default, regardless of transport type.
 * These are matched case-insensitively against property names.
 */
const GENERIC_SENSITIVE_PATTERNS = [
  'password',
  'secret',
  'token',
  'credential',
  'passphrase',
  'apikey',
  'api_key',
  'apiKey',
];

/**
 * Additional sensitive fields for specific transport types.
 * Key is the connector properties class suffix (after the last dot).
 */
const TRANSPORT_SENSITIVE_FIELDS: Record<string, string[]> = {
  // Database connectors
  JdbcConnectorProperties: ['username', 'password', 'url'],
  DatabaseReceiverProperties: ['username', 'password', 'url'],
  DatabaseDispatcherProperties: ['username', 'password', 'url'],

  // SFTP/FTP connectors
  SftpSchemeProperties: ['username', 'password', 'keyFile', 'passPhrase'],
  FileReceiverProperties: ['username', 'password'],
  FileDispatcherProperties: ['username', 'password'],

  // SMTP connector
  SmtpDispatcherProperties: ['smtpHost', 'username', 'password'],

  // JMS connector
  JmsReceiverProperties: ['username', 'password'],
  JmsDispatcherProperties: ['username', 'password'],

  // HTTP connector
  HttpDispatcherProperties: ['username', 'password'],
  HttpReceiverProperties: ['username', 'password'],

  // WebService connector
  WebServiceReceiverProperties: ['username', 'password'],
  WebServiceDispatcherProperties: ['username', 'password'],
};

export class SensitiveDataDetector {
  /**
   * Detect sensitive fields in a decomposed channel.
   */
  detect(decomposed: DecomposedChannel, additionalFields?: string[]): SensitiveField[] {
    return this.scanAll(decomposed, decomposed.metadata.name, additionalFields);
  }

  /**
   * Mask sensitive values in a decomposed channel in-place,
   * replacing them with ${PARAM_NAME} references.
   */
  maskDecomposed(
    decomposed: DecomposedChannel,
    channelName: string,
    additionalFields?: string[]
  ): SensitiveField[] {
    const fields = this.scanAll(decomposed, channelName, additionalFields);

    for (const field of fields) {
      this.replaceFieldValue(decomposed, field);
    }

    return fields;
  }

  private scanAll(
    decomposed: DecomposedChannel,
    channelName: string,
    additionalFields?: string[]
  ): SensitiveField[] {
    const results: SensitiveField[] = [];

    this.scanConnector(
      decomposed.source,
      'sourceConnector',
      channelName,
      results,
      additionalFields
    );

    for (const [destName, dest] of decomposed.destinations) {
      this.scanConnector(dest, `destinations.${destName}`, channelName, results, additionalFields);
    }

    return results;
  }

  private scanConnector(
    connector: {
      properties: Record<string, unknown>;
      propertiesClass: string;
      transportName: string;
    },
    basePath: string,
    channelName: string,
    results: SensitiveField[],
    additionalFields?: string[]
  ): void {
    const transportType = connector.transportName;
    const classShortName = this.getClassShortName(connector.propertiesClass);
    const extraFields = TRANSPORT_SENSITIVE_FIELDS[classShortName] || [];

    this.scanProperties(
      connector.properties,
      `${basePath}.properties`,
      transportType,
      channelName,
      basePath,
      [...extraFields, ...(additionalFields || [])],
      results
    );
  }

  private scanProperties(
    props: Record<string, unknown>,
    path: string,
    transportType: string,
    channelName: string,
    connectorPath: string,
    extraFields: string[],
    results: SensitiveField[]
  ): void {
    for (const [key, value] of Object.entries(props)) {
      const fieldPath = `${path}.${key}`;

      if (typeof value === 'string' && value !== '' && this.isSensitive(key, extraFields)) {
        // Don't flag values that are already parameterized
        if (value.startsWith('${') && value.endsWith('}')) continue;
        // Don't flag template/placeholder values
        if (value.startsWith('{{') && value.endsWith('}}')) continue;

        results.push({
          path: fieldPath,
          fieldName: key,
          transportType,
          parameterName: this.generateParamName(channelName, connectorPath, key),
          originalValue: value,
        });
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.scanProperties(
          value as Record<string, unknown>,
          fieldPath,
          transportType,
          channelName,
          connectorPath,
          extraFields,
          results
        );
      }
    }
  }

  private isSensitive(fieldName: string, extraFields: string[]): boolean {
    const lower = fieldName.toLowerCase();

    // Check generic patterns
    for (const pattern of GENERIC_SENSITIVE_PATTERNS) {
      if (lower.includes(pattern.toLowerCase())) return true;
    }

    // Check transport-specific fields (exact match)
    for (const extra of extraFields) {
      if (fieldName === extra) return true;
    }

    return false;
  }

  private generateParamName(channelName: string, connectorPath: string, fieldName: string): string {
    const channelPart = sanitizeName(channelName).replace(/-/g, '_').toUpperCase();
    const connectorPart = connectorPath
      .replace(/^(sourceConnector|destinations\.)/, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase();

    const fieldPart = fieldName
      .replace(/([A-Z])/g, '_$1')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase();

    if (connectorPart) {
      return `${channelPart}_${connectorPart}_${fieldPart}`;
    }
    return `${channelPart}_${fieldPart}`;
  }

  private getClassShortName(className: string): string {
    const parts = className.split('.');
    return parts[parts.length - 1] || className;
  }

  private replaceFieldValue(decomposed: DecomposedChannel, field: SensitiveField): void {
    // Parse the path to find the right property to replace
    const parts = field.path.split('.');

    // Navigate to the containing object
    let target: Record<string, unknown> | undefined;

    if (parts[0] === 'sourceConnector') {
      target = decomposed.source.properties;
      // Navigate deeper if needed
      const propParts = parts.slice(2); // skip "sourceConnector.properties"
      target = this.navigateToParent(target, propParts);
    } else if (parts[0] === 'destinations') {
      const destName = parts[1]!;
      const dest = decomposed.destinations.get(destName);
      if (!dest) return;
      target = dest.properties;
      const propParts = parts.slice(3); // skip "destinations.name.properties"
      target = this.navigateToParent(target, propParts);
    }

    if (target && parts.length > 0) {
      const lastKey = parts[parts.length - 1]!;
      if (lastKey in target) {
        target[lastKey] = `\${${field.parameterName}}`;
      }
    }
  }

  private navigateToParent(obj: Record<string, unknown>, parts: string[]): Record<string, unknown> {
    let current = obj;
    // Navigate to the parent of the last part
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (current[part] && typeof current[part] === 'object') {
        current = current[part] as Record<string, unknown>;
      } else {
        return current;
      }
    }
    return current;
  }
}
