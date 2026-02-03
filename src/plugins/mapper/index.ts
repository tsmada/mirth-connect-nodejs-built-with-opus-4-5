/**
 * Mapper Plugin
 *
 * Provides variable mapping transformer steps for Mirth Connect channels.
 * Maps values from message data to channel/global/response maps with
 * support for default values and regex replacements.
 */

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
} from './MapperStep.js';
