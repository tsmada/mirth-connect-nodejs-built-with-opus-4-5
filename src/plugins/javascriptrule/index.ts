/**
 * JavaScript Rule Plugin
 *
 * Provides JavaScript-based filter rules for Mirth Connect channels.
 * This is the most flexible rule type, allowing arbitrary JavaScript
 * to determine message acceptance.
 */

export {
  JavaScriptRule,
  JavaScriptRuleData,
  JAVASCRIPT_RULE_PLUGIN_POINT,
  createJavaScriptRule,
  isJavaScriptRule,
  isJavaScriptRuleType,
} from './JavaScriptRule.js';
