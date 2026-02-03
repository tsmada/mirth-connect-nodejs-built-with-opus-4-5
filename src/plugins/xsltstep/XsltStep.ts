/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/xsltstep/XsltStep.java
 *
 * Purpose: XSLT transformer step that transforms XML using XSLT stylesheets
 *
 * Key behaviors to replicate:
 * - Takes source XML from a configurable expression (default: msg)
 * - Applies XSLT transformation using the configured stylesheet
 * - Stores result in channelMap with configurable variable name
 * - Supports iterator mode for batch processing
 *
 * In Java Mirth, the XsltStep generates JavaScript code that uses
 * javax.xml.transform.TransformerFactory. In Node.js, we use
 * xslt-processor for pure JavaScript XSLT processing.
 */

import { Xslt, XmlParser } from 'xslt-processor';
import { XsltStepProperties, mergeWithDefaults } from './XsltStepProperties.js';

export const XSLT_STEP_PLUGIN_POINT = 'XSLT Step';

/**
 * Iterator properties for batch processing
 */
export interface XsltIteratorProperties {
  indexVariable: string;
}

/**
 * XSLT Transformer Step
 *
 * Transforms XML messages using XSLT stylesheets. The transformation
 * is performed during step execution and the result is stored in
 * the channel map.
 */
export class XsltStep {
  private sequenceNumber: number;
  private name: string;
  private enabled: boolean;
  private sourceXml: string;
  private resultVariable: string;
  private template: string;
  private useCustomFactory: boolean;
  private customFactory: string;

  /**
   * Plugin point identifier
   */
  static readonly PLUGIN_POINT = XSLT_STEP_PLUGIN_POINT;

  constructor(props: XsltStepProperties = {}) {
    const merged = mergeWithDefaults(props);
    this.sequenceNumber = merged.sequenceNumber;
    this.name = merged.name;
    this.enabled = merged.enabled;
    this.sourceXml = merged.sourceXml;
    this.resultVariable = merged.resultVariable;
    this.template = merged.template;
    this.useCustomFactory = merged.useCustomFactory;
    this.customFactory = merged.customFactory;
  }

  /**
   * Copy constructor for cloning
   */
  static fromStep(step: XsltStep): XsltStep {
    return new XsltStep({
      sequenceNumber: step.sequenceNumber,
      name: step.name,
      enabled: step.enabled,
      sourceXml: step.sourceXml,
      resultVariable: step.resultVariable,
      template: step.template,
      useCustomFactory: step.useCustomFactory,
      customFactory: step.customFactory,
    });
  }

  // Getters and setters

  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  setSequenceNumber(sequenceNumber: number): void {
    this.sequenceNumber = sequenceNumber;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getSourceXml(): string {
    return this.sourceXml;
  }

  setSourceXml(sourceXml: string): void {
    this.sourceXml = sourceXml;
  }

  getResultVariable(): string {
    return this.resultVariable;
  }

  setResultVariable(resultVariable: string): void {
    this.resultVariable = resultVariable;
  }

  getTemplate(): string {
    return this.template;
  }

  setTemplate(template: string): void {
    this.template = template;
  }

  isUseCustomFactory(): boolean {
    return this.useCustomFactory;
  }

  setUseCustomFactory(useCustomFactory: boolean): void {
    this.useCustomFactory = useCustomFactory;
  }

  getCustomFactory(): string {
    return this.customFactory;
  }

  setCustomFactory(customFactory: string): void {
    this.customFactory = customFactory;
  }

  /**
   * Get the step type identifier
   */
  getType(): string {
    return XSLT_STEP_PLUGIN_POINT;
  }

  /**
   * Clone this step
   */
  clone(): XsltStep {
    return XsltStep.fromStep(this);
  }

  /**
   * Generate JavaScript code for this transformation step
   *
   * The Java implementation generates JavaScript that uses javax.xml.transform.
   * In our Node.js implementation, we generate code that calls our
   * XsltTransformer utility.
   *
   * @param _loadFiles Whether to load external script files (not used)
   */
  getScript(_loadFiles: boolean = false): string {
    const script = this.getTransformationScript();
    return script + `channelMap.put('${this.resultVariable}', resultVar);\n`;
  }

  /**
   * Generate the transformation script portion
   */
  private getTransformationScript(): string {
    // In Java, sourceXml and template are JavaScript expressions
    // that evaluate to strings. We preserve that pattern.
    const sourceExpr = this.sourceXml || 'msg.toString()';
    const templateExpr = this.template || "''";

    // Generate script that uses our XsltTransformer
    const lines: string[] = [
      `var xsltTemplate = ${templateExpr};`,
      `var sourceVar = ${sourceExpr};`,
      `var resultVar = XsltTransformer.transform(sourceVar, xsltTemplate);`,
    ];

    return lines.join('\n') + '\n';
  }

  /**
   * Generate pre-script for iterator processing
   */
  getPreScript(
    _loadFiles: boolean = false,
    _ancestors: XsltIteratorProperties[] = []
  ): string {
    const identifier = convertIdentifier(this.resultVariable);
    return `var _${identifier} = Lists.list();`;
  }

  /**
   * Generate iteration script for batch processing
   */
  getIterationScript(
    _loadFiles: boolean = false,
    _ancestors: XsltIteratorProperties[] = []
  ): string {
    const identifier = convertIdentifier(this.resultVariable);
    const script = this.getTransformationScript();
    return script + `_${identifier}.add(resultVar);\n`;
  }

  /**
   * Generate post-script for iterator processing
   */
  getPostScript(
    _loadFiles: boolean = false,
    _ancestors: XsltIteratorProperties[] = []
  ): string {
    const identifier = convertIdentifier(this.resultVariable);
    return `channelMap.put('${this.resultVariable}', _${identifier}.toArray());\n`;
  }

  /**
   * Get response variables set by this step
   * XSLT steps don't set response variables directly
   */
  getResponseVariables(): string[] {
    return [];
  }

  /**
   * Get purged properties for analytics/logging
   */
  getPurgedProperties(): Record<string, unknown> {
    return {
      sequenceNumber: this.sequenceNumber,
      enabled: this.enabled,
      templateLines: countLines(this.template),
      useCustomFactory: this.useCustomFactory,
    };
  }

  /**
   * Serialize to plain object
   */
  toJSON(): XsltStepProperties & { type: string } {
    return {
      sequenceNumber: this.sequenceNumber,
      name: this.name,
      enabled: this.enabled,
      sourceXml: this.sourceXml,
      resultVariable: this.resultVariable,
      template: this.template,
      useCustomFactory: this.useCustomFactory,
      customFactory: this.customFactory,
      type: this.getType(),
    };
  }

  /**
   * Create from XML/JSON data (used in channel imports)
   */
  static fromXML(data: Record<string, unknown>): XsltStep {
    return new XsltStep({
      sequenceNumber: typeof data.sequenceNumber === 'number' ? data.sequenceNumber : 0,
      name: typeof data.name === 'string' ? data.name : '',
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
      sourceXml: typeof data.sourceXml === 'string' ? data.sourceXml : '',
      resultVariable: typeof data.resultVariable === 'string' ? data.resultVariable : '',
      template: typeof data.template === 'string' ? data.template : '',
      useCustomFactory: typeof data.useCustomFactory === 'boolean' ? data.useCustomFactory : false,
      customFactory: typeof data.customFactory === 'string' ? data.customFactory : '',
    });
  }
}

/**
 * XSLT Transformer utility for runtime transformation
 *
 * This class provides the actual XSLT transformation logic using
 * the xslt-processor library.
 */
export class XsltTransformer {
  private static xsltProcessor = new Xslt();
  private static xmlParser = new XmlParser();

  /**
   * Transform XML using an XSLT stylesheet
   *
   * @param sourceXml Source XML string to transform
   * @param xsltStylesheet XSLT stylesheet string
   * @param parameters Optional parameters to pass to the stylesheet
   * @returns Transformed XML string
   * @throws Error if transformation fails
   */
  static async transform(
    sourceXml: string,
    xsltStylesheet: string,
    parameters?: Array<{ name: string; value: string; namespaceUri?: string }>
  ): Promise<string> {
    try {
      // Create a new processor instance with parameters if provided
      const xslt = parameters && parameters.length > 0
        ? new Xslt({ parameters })
        : this.xsltProcessor;

      // Parse input documents
      const xmlDoc = this.xmlParser.xmlParse(sourceXml);
      const xsltDoc = this.xmlParser.xmlParse(xsltStylesheet);

      // Perform transformation
      const result = await xslt.xsltProcess(xmlDoc, xsltDoc);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`XSLT transformation failed: ${message}`);
    }
  }

  /**
   * Synchronous transform (uses internal async but waits)
   * This is provided for compatibility with the script execution model
   * where synchronous execution is expected.
   *
   * Note: In a real implementation, the JavaScript runtime would need
   * to handle async operations. This is a placeholder that shows the intent.
   */
  static transformSync(
    sourceXml: string,
    xsltStylesheet: string,
    parameters?: Array<{ name: string; value: string; namespaceUri?: string }>
  ): string {
    // For synchronous operation, we need to use a blocking approach
    // This is a simplified implementation - in practice, the runtime
    // would need to properly await the async result
    let result = '';
    let error: Error | null = null;

    // Start the async operation
    this.transform(sourceXml, xsltStylesheet, parameters)
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        error = e instanceof Error ? e : new Error(String(e));
      });

    // In a real implementation, we'd use a proper synchronization mechanism
    // For now, throw immediately if there's an error in the sync path
    if (error) {
      throw error;
    }

    return result;
  }
}

/**
 * Helper: Count lines in a string
 */
function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

/**
 * Helper: Convert identifier to valid JavaScript variable name
 * Replaces invalid characters with underscores
 */
function convertIdentifier(name: string): string {
  if (!name) return '_unnamed';
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Factory function to create an XSLT step
 */
export function createXsltStep(
  name: string,
  resultVariable: string,
  template: string = '',
  sourceXml: string = ''
): XsltStep {
  return new XsltStep({
    name,
    resultVariable,
    template,
    sourceXml,
    enabled: true,
  });
}

/**
 * Check if a step object is an XSLT step
 */
export function isXsltStep(step: unknown): step is XsltStep {
  return step instanceof XsltStep;
}

/**
 * Check if step data represents an XSLT step type
 */
export function isXsltStepType(data: { type?: string }): boolean {
  return data.type === XSLT_STEP_PLUGIN_POINT;
}
