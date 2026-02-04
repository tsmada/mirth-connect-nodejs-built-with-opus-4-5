/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v3/HL7V3SerializationProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v3/HL7V3BatchProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v3/HL7V3DataTypeProperties.java
 *
 * Purpose: Properties for HL7v3 XML data type
 *
 * Key behaviors to replicate:
 * - stripNamespaces: boolean option to strip xmlns declarations
 * - Batch processing via JavaScript only (like Raw data type)
 */

/**
 * Split type options for HL7v3 batch processing
 *
 * HL7v3 only supports JavaScript-based batch splitting since the message format
 * can vary significantly between different message types.
 */
export enum HL7V3SplitType {
  JavaScript = 'JavaScript',
}

/**
 * HL7v3 batch processing properties
 */
export interface HL7V3BatchProperties {
  /** Method for splitting batch messages */
  splitType: HL7V3SplitType;
  /** JavaScript code for custom batch splitting */
  batchScript: string;
}

/**
 * HL7v3 serialization properties
 */
export interface HL7V3SerializationProperties {
  /**
   * Strip namespace definitions from the transformed XML message.
   *
   * Will not remove namespace prefixes. If you do not strip namespaces
   * your default XML namespace will be set to the incoming data namespace.
   * If your outbound template namespace is different, you will have to set
   * "default xml namespace = 'namespace';" via JavaScript before template mappings.
   */
  stripNamespaces: boolean;
}

/**
 * HL7v3 data type properties combining serialization and batch properties
 */
export interface HL7V3DataTypeProperties {
  /** Serialization properties */
  serializationProperties: HL7V3SerializationProperties;
  /** Batch processing properties */
  batchProperties: HL7V3BatchProperties;
}

/**
 * Get default HL7v3 batch properties
 */
export function getDefaultHL7V3BatchProperties(): HL7V3BatchProperties {
  return {
    splitType: HL7V3SplitType.JavaScript,
    batchScript: '',
  };
}

/**
 * Get default HL7v3 serialization properties
 */
export function getDefaultHL7V3SerializationProperties(): HL7V3SerializationProperties {
  return {
    stripNamespaces: false,
  };
}

/**
 * Get default HL7v3 data type properties
 */
export function getDefaultHL7V3DataTypeProperties(): HL7V3DataTypeProperties {
  return {
    serializationProperties: getDefaultHL7V3SerializationProperties(),
    batchProperties: getDefaultHL7V3BatchProperties(),
  };
}

/**
 * Property descriptors for HL7v3 serialization properties (for UI generation)
 */
export const HL7V3_SERIALIZATION_PROPERTY_DESCRIPTORS = {
  stripNamespaces: {
    name: 'Strip Namespaces',
    description:
      'Strips namespace definitions from the transformed XML message. Will not remove namespace prefixes. If you do not strip namespaces your default xml namespace will be set to the incoming data namespace. If your outbound template namespace is different, you will have to set "default xml namespace = \'namespace\';" via JavaScript before template mappings.',
    type: 'boolean' as const,
    defaultValue: false,
  },
};

/**
 * Property descriptors for HL7v3 batch properties (for UI generation)
 */
export const HL7V3_BATCH_PROPERTY_DESCRIPTORS = {
  splitType: {
    name: 'Split Batch By',
    description:
      'Select the method for splitting the batch message. This option has no effect unless Process Batch Files is enabled in the connector.\n\nJavaScript: Use JavaScript to split messages.',
    type: 'option' as const,
    options: Object.values(HL7V3SplitType),
  },
  batchScript: {
    name: 'JavaScript',
    description:
      "Enter JavaScript that splits the batch, and returns the next message. This script has access to 'reader', a Java BufferedReader, to read the incoming data stream. The script must return a string containing the next message, or a null/empty string to indicate end of input. This option has no effect unless Process Batch is enabled in the connector.",
    type: 'javascript' as const,
  },
};
