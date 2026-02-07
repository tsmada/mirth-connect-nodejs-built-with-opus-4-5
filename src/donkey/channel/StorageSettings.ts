/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/StorageSettings.java
 *
 * Purpose: Controls which content types are persisted to D_MC tables at each pipeline stage.
 * Java Mirth maps the channel's messageStorageMode to a specific combination of these flags.
 *
 * Key behaviors:
 * - All flags default to true (DEVELOPMENT mode = store everything)
 * - Lower storage modes progressively disable flags for performance
 * - Used by Channel.ts to gate all insertContent() calls
 */

/**
 * Message storage modes matching Java Mirth's MessageStorageMode enum.
 * Higher values = more content stored.
 *
 * DEVELOPMENT (5): Store everything — all content types, maps, errors
 * PRODUCTION (4): Skip intermediate content (processedRaw, transformed, responseTransformed, processedResponse)
 * RAW (3): Only store raw content + metadata — no maps, no encoded/sent/response
 * METADATA (2): No content at all — only message/connector message rows + statistics
 * DISABLED (1): No storage at all — messages are processed in-memory only
 */
export enum MessageStorageMode {
  DISABLED = 1,
  METADATA = 2,
  RAW = 3,
  PRODUCTION = 4,
  DEVELOPMENT = 5,
}

export class StorageSettings {
  // Master switch — if false, nothing is persisted
  enabled = true;
  // Transaction durability (fsync)
  durable = true;
  // Durability for initial raw message storage specifically
  rawDurable = true;

  // Recovery support
  messageRecoveryEnabled = true;
  // Remove content after message completes processing
  removeContentOnCompletion = false;
  // Only remove content for filtered messages
  removeOnlyFilteredOnCompletion = false;
  // Remove attachments on completion
  removeAttachmentsOnCompletion = false;

  // Attachment and custom metadata
  storeAttachments = true;
  storeCustomMetaData = true;

  // Content type flags
  storeRaw = true;
  storeProcessedRaw = true;
  storeTransformed = true;
  storeSourceEncoded = true;
  storeDestinationEncoded = true;
  storeResponse = true;
  storeSent = true;
  storeResponseTransformed = true;
  storeProcessedResponse = true;
  storeSentResponse = true;

  // Map flags
  storeMaps = true;
  storeResponseMap = true;
  storeMergedResponseMap = true;
}

/**
 * Create StorageSettings from a MessageStorageMode and optional channel properties.
 *
 * Ported from DonkeyEngineController.getStorageSettings() in Java Mirth.
 * The switch/case logic matches Java exactly — each mode disables specific flags.
 */
export function getStorageSettings(
  mode: MessageStorageMode,
  channelProperties?: {
    removeContentOnCompletion?: boolean;
    removeOnlyFilteredOnCompletion?: boolean;
    removeAttachmentsOnCompletion?: boolean;
    storeAttachments?: boolean;
  }
): StorageSettings {
  const s = new StorageSettings();

  // Apply channel property overrides
  if (channelProperties) {
    s.removeContentOnCompletion = channelProperties.removeContentOnCompletion ?? false;
    s.removeOnlyFilteredOnCompletion = channelProperties.removeOnlyFilteredOnCompletion ?? false;
    s.removeAttachmentsOnCompletion = channelProperties.removeAttachmentsOnCompletion ?? false;
    s.storeAttachments = channelProperties.storeAttachments ?? true;
  }

  switch (mode) {
    case MessageStorageMode.PRODUCTION:
      s.storeProcessedRaw = false;
      s.storeTransformed = false;
      s.storeResponseTransformed = false;
      s.storeProcessedResponse = false;
      break;

    case MessageStorageMode.RAW:
      s.messageRecoveryEnabled = false;
      s.durable = false;
      s.storeMaps = false;
      s.storeResponseMap = false;
      s.storeMergedResponseMap = false;
      s.storeProcessedRaw = false;
      s.storeTransformed = false;
      s.storeSourceEncoded = false;
      s.storeDestinationEncoded = false;
      s.storeSent = false;
      s.storeResponseTransformed = false;
      s.storeProcessedResponse = false;
      s.storeResponse = false;
      s.storeSentResponse = false;
      break;

    case MessageStorageMode.METADATA:
      s.messageRecoveryEnabled = false;
      s.durable = false;
      s.rawDurable = false;
      s.storeMaps = false;
      s.storeResponseMap = false;
      s.storeMergedResponseMap = false;
      s.storeRaw = false;
      s.storeProcessedRaw = false;
      s.storeTransformed = false;
      s.storeSourceEncoded = false;
      s.storeDestinationEncoded = false;
      s.storeSent = false;
      s.storeResponseTransformed = false;
      s.storeProcessedResponse = false;
      s.storeResponse = false;
      s.storeSentResponse = false;
      break;

    case MessageStorageMode.DISABLED:
      s.enabled = false;
      s.messageRecoveryEnabled = false;
      s.durable = false;
      s.rawDurable = false;
      s.storeCustomMetaData = false;
      s.storeMaps = false;
      s.storeResponseMap = false;
      s.storeMergedResponseMap = false;
      s.storeRaw = false;
      s.storeProcessedRaw = false;
      s.storeTransformed = false;
      s.storeSourceEncoded = false;
      s.storeDestinationEncoded = false;
      s.storeSent = false;
      s.storeResponseTransformed = false;
      s.storeProcessedResponse = false;
      s.storeResponse = false;
      s.storeSentResponse = false;
      break;

    case MessageStorageMode.DEVELOPMENT:
    default:
      // All defaults are true — store everything
      break;
  }

  return s;
}

/**
 * Parse a messageStorageMode string from channel XML/JSON into the enum.
 */
export function parseMessageStorageMode(mode?: string): MessageStorageMode {
  if (!mode) return MessageStorageMode.DEVELOPMENT;
  switch (mode.toUpperCase()) {
    case 'DISABLED': return MessageStorageMode.DISABLED;
    case 'METADATA': return MessageStorageMode.METADATA;
    case 'RAW': return MessageStorageMode.RAW;
    case 'PRODUCTION': return MessageStorageMode.PRODUCTION;
    case 'DEVELOPMENT': return MessageStorageMode.DEVELOPMENT;
    default: return MessageStorageMode.DEVELOPMENT;
  }
}
