/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/vm/VmReceiverProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/vm/VmDispatcherProperties.java
 *
 * Purpose: Configuration properties for VM (inter-channel) source and destination connectors
 *
 * Key behaviors to replicate:
 * - Channel Reader: Receives messages routed from other channels
 * - Channel Writer: Routes messages to other channels
 * - Map variable propagation between channels
 * - Source channel tracking for message chains
 */

/**
 * Source channel tracking keys used in source map
 */
export const SOURCE_CHANNEL_ID = 'sourceChannelId';
export const SOURCE_CHANNEL_IDS = 'sourceChannelIds';
export const SOURCE_MESSAGE_ID = 'sourceMessageId';
export const SOURCE_MESSAGE_IDS = 'sourceMessageIds';

/**
 * VM Receiver (Source) Properties - "Channel Reader"
 *
 * The VM receiver doesn't have many properties since it receives messages
 * programmatically from other channels via the VMRouter.
 */
export interface VmReceiverProperties {
  /**
   * Whether the source can batch messages
   */
  canBatch: boolean;
}

/**
 * VM Dispatcher (Destination) Properties - "Channel Writer"
 *
 * Properties for routing messages to another channel.
 */
export interface VmDispatcherProperties {
  /**
   * The target channel ID to route messages to.
   * Special value "none" means no routing (message is effectively discarded).
   */
  channelId: string;

  /**
   * Template for the message content to send.
   * Supports variable replacement (e.g., ${message.encodedData}).
   * Default: ${message.encodedData}
   */
  channelTemplate: string;

  /**
   * Map variables to propagate from source to destination channel.
   * These variables are copied from the source channel's maps into
   * the target channel's source map.
   */
  mapVariables: string[];

  /**
   * Whether to validate the response from the target channel
   */
  validateResponse: boolean;

  /**
   * Whether to reattach attachments in the template
   */
  reattachAttachments: boolean;
}

/**
 * Default VM Receiver properties
 */
export function getDefaultVmReceiverProperties(): VmReceiverProperties {
  return {
    canBatch: true,
  };
}

/**
 * Default VM Dispatcher properties
 */
export function getDefaultVmDispatcherProperties(): VmDispatcherProperties {
  return {
    channelId: 'none',
    channelTemplate: '${message.encodedData}',
    mapVariables: [],
    validateResponse: false,
    reattachAttachments: true,
  };
}

/**
 * Build a list of source channel IDs from the source map.
 * Used to track the chain of channels a message has passed through.
 *
 * @param sourceMap The source map from the incoming message
 * @returns Array of channel IDs in the chain, or null if this is the first channel
 */
export function getSourceChannelIds(sourceMap: Map<string, unknown>): string[] | null {
  const sourceChannelId = sourceMap.get(SOURCE_CHANNEL_ID);

  // If no source channel id exists, this is the start of the chain
  if (sourceChannelId === undefined || typeof sourceChannelId !== 'string') {
    return null;
  }

  const sourceChannelIds: string[] = [];
  const existingList = sourceMap.get(SOURCE_CHANNEL_IDS);

  // If a list already exists, copy all items into the new list
  if (existingList === undefined) {
    sourceChannelIds.push(sourceChannelId);
  } else if (Array.isArray(existingList)) {
    try {
      sourceChannelIds.push(...(existingList as string[]));
    } catch {
      sourceChannelIds.push(sourceChannelId);
    }
  } else {
    sourceChannelIds.push(sourceChannelId);
  }

  return sourceChannelIds;
}

/**
 * Build a list of source message IDs from the source map.
 * Used to track the chain of message IDs a message has passed through.
 *
 * @param sourceMap The source map from the incoming message
 * @returns Array of message IDs in the chain, or null if this is the first channel
 */
export function getSourceMessageIds(sourceMap: Map<string, unknown>): number[] | null {
  const sourceMessageId = sourceMap.get(SOURCE_MESSAGE_ID);

  // If no source message id exists, this is the start of the chain
  if (sourceMessageId === undefined || typeof sourceMessageId !== 'number') {
    return null;
  }

  const sourceMessageIds: number[] = [];
  const existingList = sourceMap.get(SOURCE_MESSAGE_IDS);

  // If a list already exists, copy all items into the new list
  if (existingList === undefined) {
    sourceMessageIds.push(sourceMessageId);
  } else if (Array.isArray(existingList)) {
    try {
      sourceMessageIds.push(...(existingList as number[]));
    } catch {
      sourceMessageIds.push(sourceMessageId);
    }
  } else {
    sourceMessageIds.push(sourceMessageId);
  }

  return sourceMessageIds;
}

/**
 * Format VM dispatcher properties as a human-readable string
 */
export function formatVmDispatcherProperties(props: VmDispatcherProperties): string {
  const lines: string[] = [];
  const newLine = '\n';

  lines.push('CHANNEL ID: ' + props.channelId);
  lines.push('');
  lines.push('[MAP VARIABLES]');

  if (props.mapVariables && props.mapVariables.length > 0) {
    for (const variable of props.mapVariables) {
      lines.push(variable);
    }
  }

  lines.push('');
  lines.push('[CONTENT]');
  lines.push(props.channelTemplate);

  return lines.join(newLine);
}
