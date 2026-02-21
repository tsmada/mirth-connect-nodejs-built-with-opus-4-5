/**
 * StepCompiler - Compiles non-JavaScript transformer steps and filter rules to JavaScript
 *
 * Java Mirth stores structured configuration for drag-and-drop step types:
 * - MapperStep: { variable, mapping, defaultValue, replacements, scope }
 * - MessageBuilderStep: { messageSegment, mapping, defaultValue, replacements }
 * - XsltStep: { sourceXml, resultVariable, template }
 * - RuleBuilderRule: { field, condition, values }
 *
 * These don't have a `script` field — Java compiles them at runtime via getScript().
 * This module bridges that gap by delegating to the existing plugin classes.
 */

import { MapperStep } from '../../plugins/mapper/MapperStep.js';
import { MessageBuilderStep } from '../../plugins/messagebuilder/MessageBuilderStep.js';
import { XsltStep } from '../../plugins/xsltstep/XsltStep.js';

/**
 * Compile a non-JavaScript transformer step to JavaScript.
 * Detects the step type from the XML class name and delegates to the
 * appropriate plugin's getScript() method.
 *
 * @param className The Java class name from channel XML (e.g., 'com.mirth.connect.plugins.mapper.MapperStep')
 * @param stepData The parsed XML step data
 * @returns Compiled JavaScript string, or null for unknown step types
 */
export function compileTransformerStep(
  className: string,
  stepData: Record<string, unknown>
): string | null {
  if (className.includes('MapperStep') || className.includes('Mapper')) {
    // Avoid matching 'MessageBuilder' which also contains no 'Mapper' but could
    // match other patterns — the Mapper class name is specific enough
    if (className.includes('MessageBuilder')) return null;
    const step = MapperStep.fromXML(stepData);
    return step.getScript();
  }
  if (className.includes('MessageBuilderStep') || className.includes('MessageBuilder')) {
    const step = MessageBuilderStep.fromXML(stepData);
    return step.getScript();
  }
  if (className.includes('XsltStep') || className.includes('XSLT')) {
    const step = XsltStep.fromXML(stepData);
    return step.getScript();
  }
  return null; // Unknown step type
}

/**
 * Compile a non-JavaScript filter rule to a boolean JavaScript expression.
 * RuleBuilderRule stores structured config (field, condition, values)
 * and gets compiled to a condition expression.
 *
 * @param className The Java class name from channel XML
 * @param ruleData The parsed XML rule data
 * @returns Compiled JavaScript boolean expression string, or null for unknown rule types
 */
export function compileFilterRule(
  className: string,
  ruleData: Record<string, unknown>
): string | null {
  if (className.includes('RuleBuilderRule') || className.includes('RuleBuilder')) {
    return compileRuleBuilderRule(ruleData);
  }
  return null;
}

/**
 * Validate a field expression from channel XML to prevent code injection.
 * Valid patterns: msg['PID']['PID.5'], msg.PID.PID_5, etc.
 * Rejects: semicolons, braces, newlines, comments (injection vectors).
 */
function validateFieldExpression(field: string): void {
  // Reject empty fields
  if (!field || !field.trim()) {
    throw new Error(`StepCompiler: empty field expression`);
  }

  // Reject injection vectors: semicolons, braces, newlines, comments
  if (/[;{}]|\/\/|\/\*|\n|\r/.test(field)) {
    throw new Error(
      `StepCompiler: invalid field expression "${field.substring(0, 50)}" — ` +
      `contains prohibited characters (;, {, }, //, /*, or newlines)`
    );
  }
}

/**
 * Compile a RuleBuilderRule from its XML config.
 *
 * Java Mirth's RuleBuilderRule.getScript() generates boolean expressions
 * based on 6 condition types:
 * - EXISTS: field has non-empty value
 * - NOT_EXIST: field is empty
 * - EQUALS: field matches one of the values
 * - NOT_EQUAL: field doesn't match any of the values
 * - CONTAINS: field contains one of the values
 * - NOT_CONTAIN: field doesn't contain any of the values
 */
function compileRuleBuilderRule(rule: Record<string, unknown>): string {
  const field = String(rule.field || '');
  validateFieldExpression(field);
  const condition = String(rule.condition || 'EXISTS').toUpperCase();
  const values = extractValues(rule.values);

  const fieldAccess = `${field}.toString()`;

  switch (condition) {
    case 'EXISTS':
      return `${fieldAccess}.length > 0`;
    case 'NOT_EXIST':
      return `!(${fieldAccess}.length > 0)`;
    case 'EQUALS':
      if (values.length === 0) return 'true';
      return values.map((v) => `${fieldAccess} == '${escapeJsString(v)}'`).join(' || ');
    case 'NOT_EQUAL':
      if (values.length === 0) return 'true';
      return values.map((v) => `${fieldAccess} != '${escapeJsString(v)}'`).join(' && ');
    case 'CONTAINS':
      if (values.length === 0) return 'true';
      return values
        .map((v) => `${fieldAccess}.indexOf('${escapeJsString(v)}') >= 0`)
        .join(' || ');
    case 'NOT_CONTAIN':
      if (values.length === 0) return 'true';
      return values
        .map((v) => `${fieldAccess}.indexOf('${escapeJsString(v)}') < 0`)
        .join(' && ');
    default:
      return 'true';
  }
}

/**
 * Extract values array from XML-parsed rule data.
 *
 * fast-xml-parser produces:
 * - { string: 'value' } for single value
 * - { string: ['v1', 'v2'] } for multiple values
 * - undefined/null for no values
 */
function extractValues(values: unknown): string[] {
  if (!values) return [];
  if (Array.isArray(values)) return values.map(String);
  if (typeof values === 'object' && values !== null) {
    const obj = values as Record<string, unknown>;
    // XML parsed format: { string: 'value' } or { string: ['v1', 'v2'] }
    if (obj.string !== undefined) {
      return Array.isArray(obj.string) ? obj.string.map(String) : [String(obj.string)];
    }
  }
  return [];
}

/**
 * Escape a string for use inside a JavaScript single-quoted string literal.
 */
function escapeJsString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
