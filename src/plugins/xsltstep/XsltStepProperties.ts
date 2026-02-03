/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/xsltstep/XsltStep.java
 *
 * Purpose: Configuration properties for XSLT transformer step
 *
 * Properties from Java:
 * - sourceXml: Expression for input XML (default: msg)
 * - resultVariable: Map variable name for storing result
 * - template: XSLT stylesheet content
 * - useCustomFactory: Whether to use a custom transformer factory (not used in Node.js)
 * - customFactory: Custom factory class name (not used in Node.js)
 */

/**
 * Configuration properties for an XSLT transformer step
 */
export interface XsltStepProperties {
  /**
   * Sequence number for ordering steps in transformer
   */
  sequenceNumber?: number;

  /**
   * Display name for the step
   */
  name?: string;

  /**
   * Whether this step is enabled
   */
  enabled?: boolean;

  /**
   * Expression that evaluates to the source XML string
   * In Java Mirth, this is a JavaScript expression like "msg" or "msg.toString()"
   * Default: empty string (uses msg.toString())
   */
  sourceXml?: string;

  /**
   * Name of the map variable to store the transformation result
   * The result will be stored in channelMap with this key
   */
  resultVariable?: string;

  /**
   * XSLT stylesheet content or expression that evaluates to stylesheet
   * This can be a literal XSLT string wrapped in quotes, or a JavaScript
   * expression that returns the stylesheet
   */
  template?: string;

  /**
   * Whether to use a custom TransformerFactory (Java-specific, not used in Node.js)
   * Kept for compatibility with channel imports
   */
  useCustomFactory?: boolean;

  /**
   * Custom TransformerFactory class name (Java-specific, not used in Node.js)
   * Kept for compatibility with channel imports
   */
  customFactory?: string;
}

/**
 * Default values for XSLT step properties
 */
export const DEFAULT_XSLT_STEP_PROPERTIES: Required<Omit<XsltStepProperties, 'sequenceNumber'>> = {
  name: '',
  enabled: true,
  sourceXml: '',
  resultVariable: '',
  template: '',
  useCustomFactory: false,
  customFactory: '',
};

/**
 * Validate XSLT step properties
 * @param props Properties to validate
 * @returns Array of validation error messages, empty if valid
 */
export function validateXsltStepProperties(props: XsltStepProperties): string[] {
  const errors: string[] = [];

  if (!props.resultVariable || props.resultVariable.trim() === '') {
    errors.push('Result variable name is required');
  }

  if (!props.template || props.template.trim() === '') {
    errors.push('XSLT template is required');
  }

  return errors;
}

/**
 * Merge provided properties with defaults
 */
export function mergeWithDefaults(props: XsltStepProperties): Required<XsltStepProperties> {
  return {
    sequenceNumber: props.sequenceNumber ?? 0,
    name: props.name ?? DEFAULT_XSLT_STEP_PROPERTIES.name,
    enabled: props.enabled ?? DEFAULT_XSLT_STEP_PROPERTIES.enabled,
    sourceXml: props.sourceXml ?? DEFAULT_XSLT_STEP_PROPERTIES.sourceXml,
    resultVariable: props.resultVariable ?? DEFAULT_XSLT_STEP_PROPERTIES.resultVariable,
    template: props.template ?? DEFAULT_XSLT_STEP_PROPERTIES.template,
    useCustomFactory: props.useCustomFactory ?? DEFAULT_XSLT_STEP_PROPERTIES.useCustomFactory,
    customFactory: props.customFactory ?? DEFAULT_XSLT_STEP_PROPERTIES.customFactory,
  };
}
