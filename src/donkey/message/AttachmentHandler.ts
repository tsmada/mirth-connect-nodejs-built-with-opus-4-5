/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Channel.java (lines 1412-1468)
 *
 * Purpose: Handles attachment extraction and replacement in message content.
 * Before raw content is stored to D_MC, attachments are extracted, stored to D_MA,
 * and replaced with ${ATTACH:id} tokens in the content.
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';

/**
 * Interface for handling attachment extraction from message content.
 *
 * In Java Mirth, attachments are extracted from raw content before storage:
 * 1. Extract binary/large content segments from message
 * 2. Store each as a separate attachment row in D_MA
 * 3. Replace inline content with ${ATTACH:id} tokens
 * 4. Return modified content with tokens
 *
 * Concrete implementations (e.g., DICOMAttachmentHandler, RegexAttachmentHandler)
 * can be wired in via ChannelBuilder based on channel configuration.
 */
export interface AttachmentHandler {
  /**
   * Extract attachments from message content.
   * @param channelId - Channel ID for D_MA storage
   * @param messageId - Message ID for D_MA storage
   * @param connectorMessage - The connector message containing raw content
   * @returns Modified content with attachment tokens, or original content if no attachments found
   */
  extractAttachments(
    channelId: string,
    messageId: number,
    connectorMessage: ConnectorMessage
  ): Promise<string>;
}

/**
 * No-op attachment handler that returns content unchanged.
 * Used when attachment handling is disabled or not configured for the channel.
 */
export class NoOpAttachmentHandler implements AttachmentHandler {
  async extractAttachments(
    _channelId: string,
    _messageId: number,
    connectorMessage: ConnectorMessage
  ): Promise<string> {
    const raw = connectorMessage.getRawContent();
    return raw?.content ?? '';
  }
}
