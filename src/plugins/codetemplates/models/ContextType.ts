/**
 * Context Type Enum
 *
 * Defines the script contexts where code templates can be applied.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/codetemplates/ContextType.java
 */

export enum ContextType {
  GLOBAL_DEPLOY = 'GLOBAL_DEPLOY',
  GLOBAL_UNDEPLOY = 'GLOBAL_UNDEPLOY',
  GLOBAL_PREPROCESSOR = 'GLOBAL_PREPROCESSOR',
  GLOBAL_POSTPROCESSOR = 'GLOBAL_POSTPROCESSOR',
  CHANNEL_DEPLOY = 'CHANNEL_DEPLOY',
  CHANNEL_UNDEPLOY = 'CHANNEL_UNDEPLOY',
  CHANNEL_PREPROCESSOR = 'CHANNEL_PREPROCESSOR',
  CHANNEL_POSTPROCESSOR = 'CHANNEL_POSTPROCESSOR',
  CHANNEL_ATTACHMENT = 'CHANNEL_ATTACHMENT',
  CHANNEL_BATCH = 'CHANNEL_BATCH',
  SOURCE_RECEIVER = 'SOURCE_RECEIVER',
  SOURCE_FILTER_TRANSFORMER = 'SOURCE_FILTER_TRANSFORMER',
  DESTINATION_FILTER_TRANSFORMER = 'DESTINATION_FILTER_TRANSFORMER',
  DESTINATION_DISPATCHER = 'DESTINATION_DISPATCHER',
  DESTINATION_RESPONSE_TRANSFORMER = 'DESTINATION_RESPONSE_TRANSFORMER',
}

/**
 * Get display name for a context type
 */
export function getContextTypeDisplayName(contextType: ContextType): string {
  switch (contextType) {
    case ContextType.GLOBAL_DEPLOY:
    case ContextType.CHANNEL_DEPLOY:
      return 'Deploy Script';
    case ContextType.GLOBAL_UNDEPLOY:
    case ContextType.CHANNEL_UNDEPLOY:
      return 'Undeploy Script';
    case ContextType.GLOBAL_PREPROCESSOR:
    case ContextType.CHANNEL_PREPROCESSOR:
      return 'Preprocessor Script';
    case ContextType.GLOBAL_POSTPROCESSOR:
    case ContextType.CHANNEL_POSTPROCESSOR:
      return 'Postprocessor Script';
    case ContextType.CHANNEL_ATTACHMENT:
      return 'Attachment Script';
    case ContextType.CHANNEL_BATCH:
      return 'Batch Script';
    case ContextType.SOURCE_RECEIVER:
      return 'Receiver Script(s)';
    case ContextType.SOURCE_FILTER_TRANSFORMER:
    case ContextType.DESTINATION_FILTER_TRANSFORMER:
      return 'Filter / Transformer Script';
    case ContextType.DESTINATION_DISPATCHER:
      return 'Dispatcher Script';
    case ContextType.DESTINATION_RESPONSE_TRANSFORMER:
      return 'Response Transformer Script';
    default:
      return contextType;
  }
}

/**
 * Format context type as readable string
 */
export function formatContextType(contextType: ContextType): string {
  return contextType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
