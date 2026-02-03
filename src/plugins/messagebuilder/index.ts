/**
 * Message Builder Plugin
 *
 * Provides message building transformer steps for Mirth Connect channels.
 * Assigns values to message segments with automatic segment creation for
 * both E4X XML and regular JavaScript objects.
 */

export {
  MessageBuilderStep,
  MessageBuilderStepData,
  ReplacementPair,
  IteratorProperties,
  ExprPart,
  MESSAGE_BUILDER_STEP_PLUGIN_POINT,
  createMessageBuilderStep,
  isMessageBuilderStep,
  isMessageBuilderStepType,
} from './MessageBuilderStep.js';
