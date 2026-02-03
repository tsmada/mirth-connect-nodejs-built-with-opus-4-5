/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/javascriptstep/JavaScriptStep.java
 *
 * Purpose: Execute JavaScript transformer steps
 *
 * Key behaviors to replicate:
 * - Contains user-defined script for transformation logic
 * - Can modify msg, tmp, and map variables
 * - Supports response variable extraction
 */

export const JAVASCRIPT_STEP_PLUGIN_POINT = 'JavaScript';

/**
 * Interface for JavaScript step data
 */
export interface JavaScriptStepData {
  sequenceNumber?: number;
  name?: string;
  script?: string;
  enabled?: boolean;
}

/**
 * JavaScript transformer step
 *
 * This is the most flexible step type, allowing arbitrary JavaScript
 * code to transform messages, map variables, and modify output.
 */
export class JavaScriptStep {
  private sequenceNumber: number;
  private name: string;
  private script: string;
  private enabled: boolean;

  /**
   * Plugin point identifier
   */
  static readonly PLUGIN_POINT = JAVASCRIPT_STEP_PLUGIN_POINT;

  constructor(data: JavaScriptStepData = {}) {
    this.sequenceNumber = data.sequenceNumber ?? 0;
    this.name = data.name ?? '';
    this.script = data.script ?? '';
    this.enabled = data.enabled ?? true;
  }

  /**
   * Copy constructor for cloning
   */
  static fromStep(step: JavaScriptStep): JavaScriptStep {
    return new JavaScriptStep({
      sequenceNumber: step.sequenceNumber,
      name: step.name,
      script: step.script,
      enabled: step.enabled,
    });
  }

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

  /**
   * Get the JavaScript code to execute
   * @param _loadFiles Whether to load external script files (not used in this implementation)
   */
  getScript(_loadFiles: boolean = false): string {
    return this.script;
  }

  setScript(script: string): void {
    this.script = script;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get the step type identifier
   */
  getType(): string {
    return JAVASCRIPT_STEP_PLUGIN_POINT;
  }

  /**
   * Clone this step
   */
  clone(): JavaScriptStep {
    return JavaScriptStep.fromStep(this);
  }

  /**
   * Get response variables used by this step
   * Scans script for $r() usage patterns
   */
  getResponseVariables(): string[] {
    return getResponseVariables(this.script);
  }

  /**
   * Get purged properties for analytics/logging
   */
  getPurgedProperties(): Record<string, unknown> {
    return {
      sequenceNumber: this.sequenceNumber,
      enabled: this.enabled,
      scriptLines: countLines(this.script),
    };
  }

  /**
   * Serialize to plain object
   */
  toJSON(): JavaScriptStepData & { type: string } {
    return {
      sequenceNumber: this.sequenceNumber,
      name: this.name,
      script: this.script,
      enabled: this.enabled,
      type: this.getType(),
    };
  }

  /**
   * Create from XML/JSON data (used in channel imports)
   */
  static fromXML(data: Record<string, unknown>): JavaScriptStep {
    return new JavaScriptStep({
      sequenceNumber: typeof data.sequenceNumber === 'number' ? data.sequenceNumber : 0,
      name: typeof data.name === 'string' ? data.name : '',
      script: typeof data.script === 'string' ? data.script : '',
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
    });
  }
}

/**
 * Helper: Count lines in a script
 */
function countLines(script: string): number {
  if (!script) return 0;
  return script.split('\n').length;
}

/**
 * Helper: Extract response variables from script
 * Looks for patterns like $r('key') or responseMap.put('key', ...)
 */
function getResponseVariables(script: string): string[] {
  if (!script) return [];

  const variables: string[] = [];

  // Match $r('key', value) pattern
  const rPattern = /\$r\s*\(\s*['"]([^'"]+)['"]\s*,/g;
  let match;
  while ((match = rPattern.exec(script)) !== null) {
    if (match[1] && !variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  // Match responseMap.put('key', value) pattern
  const mapPattern = /responseMap\s*\.\s*put\s*\(\s*['"]([^'"]+)['"]\s*,/g;
  while ((match = mapPattern.exec(script)) !== null) {
    if (match[1] && !variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  return variables;
}

/**
 * Factory function to create JavaScript step
 */
export function createJavaScriptStep(name: string, script: string = ''): JavaScriptStep {
  return new JavaScriptStep({
    name,
    script,
    enabled: true,
  });
}

/**
 * Check if a step object is a JavaScript step
 */
export function isJavaScriptStep(step: unknown): step is JavaScriptStep {
  return step instanceof JavaScriptStep;
}

/**
 * Check if step data represents a JavaScript step type
 */
export function isJavaScriptStepType(data: { type?: string }): boolean {
  return data.type === JAVASCRIPT_STEP_PLUGIN_POINT;
}
