/**
 * XSLT Step Plugin
 *
 * Exports XSLT transformer step for transforming XML messages
 * using XSLT stylesheets.
 */

export {
  XsltStep,
  XsltTransformer,
  XsltIteratorProperties,
  XSLT_STEP_PLUGIN_POINT,
  createXsltStep,
  isXsltStep,
  isXsltStepType,
} from './XsltStep.js';

export {
  XsltStepProperties,
  DEFAULT_XSLT_STEP_PROPERTIES,
  validateXsltStepProperties,
  mergeWithDefaults,
} from './XsltStepProperties.js';
