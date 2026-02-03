/**
 * Mirth Connect Plugins
 *
 * Exports all plugin modules for the Mirth Connect Node.js runtime.
 */

// Code Templates Plugin
export * from './codetemplates/index.js';

// Data Pruner Plugin
export * from './datapruner/index.js';

// JavaScript Rule Plugin (Filter rules)
export * from './javascriptrule/index.js';

// JavaScript Step Plugin (Transformer steps)
export * from './javascriptstep/index.js';

// Mapper Plugin (Variable mapping)
// Note: ReplacementPair and IteratorProperties are also in messagebuilder
// Import from './mapper/index.js' or './messagebuilder/index.js' directly if needed
export {
  MapperStep,
  MapperStepData,
  MapperScope,
  ReplacementPair,
  IteratorProperties,
  MAPPER_STEP_PLUGIN_POINT,
  SCOPE_MAP_NAMES,
  SCOPE_LABELS,
  createMapperStep,
  isMapperStep,
  isMapperStepType,
  getScopeFromString,
  getScopeLabel,
} from './mapper/index.js';

// Message Builder Plugin (Segment building)
// Note: Has its own ReplacementPair and IteratorProperties types (identical structure)
// Import directly from './messagebuilder/index.js' if you need MessageBuilder-specific types
export {
  MessageBuilderStep,
  MessageBuilderStepData,
  ExprPart,
  MESSAGE_BUILDER_STEP_PLUGIN_POINT,
  createMessageBuilderStep,
  isMessageBuilderStep,
  isMessageBuilderStepType,
} from './messagebuilder/index.js';
