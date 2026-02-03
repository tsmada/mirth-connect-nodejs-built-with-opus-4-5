/**
 * JavaScript Step Plugin
 *
 * Provides JavaScript-based transformer steps for Mirth Connect channels.
 * This is the most flexible step type, allowing arbitrary JavaScript
 * to transform message data.
 */

export {
  JavaScriptStep,
  JavaScriptStepData,
  JAVASCRIPT_STEP_PLUGIN_POINT,
  createJavaScriptStep,
  isJavaScriptStep,
  isJavaScriptStepType,
} from './JavaScriptStep.js';
