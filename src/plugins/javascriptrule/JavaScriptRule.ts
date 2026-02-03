/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/javascriptrule/JavaScriptRule.java
 *
 * Purpose: Execute JavaScript filter rules
 *
 * Key behaviors to replicate:
 * - Extends Rule with JavaScript execution
 * - Contains user-defined script for filter logic
 * - Returns true/false to accept/reject messages
 */

import { RuleOperator } from '../../model/Rule.js';

export const JAVASCRIPT_RULE_PLUGIN_POINT = 'JavaScript';

/**
 * Interface for JavaScript rule data
 */
export interface JavaScriptRuleData {
  sequenceNumber?: number;
  name?: string;
  script?: string;
  enabled?: boolean;
  operator?: RuleOperator;
}

/**
 * JavaScript filter rule
 *
 * This is the most flexible rule type, allowing arbitrary JavaScript
 * code to determine whether a message should be filtered (rejected)
 * or accepted for further processing.
 */
export class JavaScriptRule {
  private sequenceNumber: number;
  private name: string;
  private script: string;
  private enabled: boolean;
  private operator: RuleOperator;

  /**
   * Plugin point identifier
   */
  static readonly PLUGIN_POINT = JAVASCRIPT_RULE_PLUGIN_POINT;

  constructor(data: JavaScriptRuleData = {}) {
    this.sequenceNumber = data.sequenceNumber ?? 0;
    this.name = data.name ?? '';
    this.script = data.script ?? '';
    this.enabled = data.enabled ?? true;
    this.operator = data.operator ?? 'AND';
  }

  /**
   * Copy constructor for cloning
   */
  static fromRule(rule: JavaScriptRule): JavaScriptRule {
    return new JavaScriptRule({
      sequenceNumber: rule.sequenceNumber,
      name: rule.name,
      script: rule.script,
      enabled: rule.enabled,
      operator: rule.operator,
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

  getOperator(): RuleOperator {
    return this.operator;
  }

  setOperator(operator: RuleOperator): void {
    this.operator = operator;
  }

  /**
   * Get the rule type identifier
   */
  getType(): string {
    return JAVASCRIPT_RULE_PLUGIN_POINT;
  }

  /**
   * Clone this rule
   */
  clone(): JavaScriptRule {
    return JavaScriptRule.fromRule(this);
  }

  /**
   * Get response variables used by this rule
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
      operator: this.operator,
      scriptLines: countLines(this.script),
    };
  }

  /**
   * Serialize to plain object
   */
  toJSON(): JavaScriptRuleData & { type: string } {
    return {
      sequenceNumber: this.sequenceNumber,
      name: this.name,
      script: this.script,
      enabled: this.enabled,
      operator: this.operator,
      type: this.getType(),
    };
  }

  /**
   * Create from XML/JSON data (used in channel imports)
   */
  static fromXML(data: Record<string, unknown>): JavaScriptRule {
    return new JavaScriptRule({
      sequenceNumber: typeof data.sequenceNumber === 'number' ? data.sequenceNumber : 0,
      name: typeof data.name === 'string' ? data.name : '',
      script: typeof data.script === 'string' ? data.script : '',
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
      operator: isValidOperator(data.operator) ? data.operator : 'AND',
    });
  }
}

/**
 * Helper: Check if value is a valid operator
 */
function isValidOperator(value: unknown): value is RuleOperator {
  return value === 'AND' || value === 'OR' || value === 'NONE';
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
 * Factory function to create JavaScript rule
 */
export function createJavaScriptRule(
  name: string,
  script: string = '',
  operator: RuleOperator = 'AND'
): JavaScriptRule {
  return new JavaScriptRule({
    name,
    script,
    operator,
    enabled: true,
  });
}

/**
 * Check if a rule object is a JavaScript rule
 */
export function isJavaScriptRule(rule: unknown): rule is JavaScriptRule {
  return rule instanceof JavaScriptRule;
}

/**
 * Check if rule data represents a JavaScript rule type
 */
export function isJavaScriptRuleType(data: { type?: string }): boolean {
  return data.type === JAVASCRIPT_RULE_PLUGIN_POINT;
}
