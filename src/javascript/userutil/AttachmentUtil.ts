/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/AttachmentUtil.java
 *
 * Purpose: Provides utility methods for creating, retrieving, and re-attaching message attachments.
 *
 * Key behaviors to replicate:
 * - Retrieve attachments by message ID and attachment ID
 * - Create and store attachments
 * - Re-attach attachment content into messages (replace ${ATTACH:id} tokens)
 * - Support Base64 encoding/decoding
 * - Get attachments from source channel via sourceMap
 */

import { v4 as uuidv4 } from 'uuid';
import { Attachment } from './Attachment.js';
import {
  getAttachmentIds,
  getAttachments,
  getAttachment as getAttachmentFromDb,
  insertAttachment as insertAttachmentToDb,
  updateAttachment as updateAttachmentToDb,
  AttachmentRow,
} from '../../db/DonkeyDao.js';

/**
 * Interface for connector message data needed by AttachmentUtil.
 * This is a minimal interface to avoid tight coupling with ConnectorMessage.
 */
export interface ImmutableConnectorMessage {
  getChannelId(): string;
  getMessageId(): number;
  getSourceMap(): Map<string, unknown>;
  getRawData?(): string | null;
  getEncodedData?(): string | null;
}

/**
 * Attachment token pattern: ${ATTACH:id}
 * Matches alphanumeric IDs with dashes (UUIDs, custom IDs)
 */
const ATTACHMENT_TOKEN_PATTERN = /\$\{ATTACH:([\w-]+)\}/gi;

/**
 * Expanded token pattern: ${ATTACH:channelId:messageId:attachmentId}
 */
const EXPANDED_TOKEN_PATTERN = /\$\{ATTACH:([\w-]+):(\d+):([\w-]+)\}/gi;

/**
 * Provides utility methods for creating, retrieving, and re-attaching message attachments.
 */
export class AttachmentUtil {
  private constructor() {
    // Private constructor - static utility class
  }

  // ==========================================================================
  // Re-attach Methods
  // ==========================================================================

  /**
   * Replaces any unique attachment tokens (e.g. "${ATTACH:id}") with the corresponding attachment
   * content, and returns the full post-replacement message as a byte array.
   *
   * @param raw - The raw message string to replace tokens from.
   * @param connectorMessage - The ConnectorMessage associated with this message.
   * @param charsetEncoding - If binary mode is not used, the resulting byte array will be encoded using this charset.
   * @param binary - If enabled, the raw data is assumed to be Base64 encoded. The resulting byte array will be the raw Base64 decoded bytes.
   * @returns The resulting message as a Buffer, with all applicable attachment content re-inserted.
   */
  static async reAttachMessageBytes(
    raw: string,
    connectorMessage: ImmutableConnectorMessage,
    charsetEncoding: string,
    binary: boolean
  ): Promise<Buffer> {
    return this.reAttachMessageBytesEx(raw, connectorMessage, charsetEncoding, binary, true, false);
  }

  /**
   * Replaces any unique attachment tokens (e.g. "${ATTACH:id}") with the corresponding attachment
   * content, and returns the full post-replacement message as a byte array.
   *
   * @param raw - The raw message string to replace tokens from.
   * @param connectorMessage - The ConnectorMessage associated with this message.
   * @param charsetEncoding - If binary mode is not used, the resulting byte array will be encoded using this charset.
   * @param binary - If enabled, the raw data is assumed to be Base64 encoded.
   * @param reattach - If true, attachment tokens will be replaced with the actual attachment content.
   * @param localOnly - If true, only local attachment tokens will be replaced.
   * @returns The resulting message as a Buffer, with all applicable attachment content re-inserted.
   */
  static async reAttachMessageBytesEx(
    raw: string,
    connectorMessage: ImmutableConnectorMessage,
    charsetEncoding: string,
    binary: boolean,
    reattach: boolean,
    localOnly: boolean
  ): Promise<Buffer> {
    if (binary) {
      // In binary mode, first decode the Base64, then replace tokens in the decoded content
      const decoded = Buffer.from(raw, 'base64');
      const decodedString = decoded.toString((charsetEncoding as BufferEncoding) || 'utf-8');

      if (!reattach) {
        // Just expand local tokens to expanded format
        const expanded = this.expandLocalTokens(
          decodedString,
          connectorMessage.getChannelId(),
          connectorMessage.getMessageId()
        );
        return Buffer.from(expanded, (charsetEncoding as BufferEncoding) || 'utf-8');
      }

      const reattached = await this.reAttachMessageInternal(
        decodedString,
        connectorMessage.getChannelId(),
        connectorMessage.getMessageId(),
        localOnly
      );
      return Buffer.from(reattached, (charsetEncoding as BufferEncoding) || 'utf-8');
    }

    if (!reattach) {
      // Just expand local tokens
      const expanded = this.expandLocalTokens(
        raw,
        connectorMessage.getChannelId(),
        connectorMessage.getMessageId()
      );
      return Buffer.from(expanded, (charsetEncoding as BufferEncoding) || 'utf-8');
    }

    const reattached = await this.reAttachMessageInternal(
      raw,
      connectorMessage.getChannelId(),
      connectorMessage.getMessageId(),
      localOnly
    );
    return Buffer.from(reattached, (charsetEncoding as BufferEncoding) || 'utf-8');
  }

  /**
   * Replaces any unique attachment tokens (e.g. "${ATTACH:id}") with the corresponding attachment
   * content, and returns the full post-replacement message.
   *
   * @param connectorMessage - The ConnectorMessage associated with this message.
   * @returns The resulting message with all applicable attachment content re-inserted.
   */
  static async reAttachMessage(connectorMessage: ImmutableConnectorMessage): Promise<string>;

  /**
   * Replaces any unique attachment tokens (e.g. "${ATTACH:id}") with the corresponding attachment
   * content, and returns the full post-replacement message.
   *
   * @param raw - The raw message string to replace tokens from.
   * @param connectorMessage - The ConnectorMessage associated with this message.
   * @returns The resulting message with all applicable attachment content re-inserted.
   */
  static async reAttachMessage(
    raw: string,
    connectorMessage: ImmutableConnectorMessage
  ): Promise<string>;

  static async reAttachMessage(
    rawOrConnectorMessage: string | ImmutableConnectorMessage,
    connectorMessage?: ImmutableConnectorMessage
  ): Promise<string> {
    if (typeof rawOrConnectorMessage === 'string') {
      // Called with (raw, connectorMessage)
      const raw = rawOrConnectorMessage;
      const msg = connectorMessage!;
      return this.reAttachMessageInternal(raw, msg.getChannelId(), msg.getMessageId(), false);
    }

    // Called with (connectorMessage)
    const msg = rawOrConnectorMessage;
    const raw = msg.getEncodedData?.() ?? msg.getRawData?.() ?? '';
    return this.reAttachMessageInternal(raw, msg.getChannelId(), msg.getMessageId(), false);
  }

  // ==========================================================================
  // Get Attachment IDs
  // ==========================================================================

  /**
   * Returns a List of attachment IDs associated with the current channel / message.
   *
   * @param connectorMessage - The ConnectorMessage associated with this message.
   * @returns A list of attachment IDs associated with the current channel / message.
   */
  static async getMessageAttachmentIds(
    connectorMessage: ImmutableConnectorMessage
  ): Promise<string[]>;

  /**
   * Returns a List of attachment IDs associated with the current channel / message.
   *
   * @param channelId - The ID of the channel the attachments are associated with.
   * @param messageId - The ID of the message the attachments are associated with.
   * @returns A list of attachment IDs associated with the current channel / message.
   */
  static async getMessageAttachmentIds(channelId: string, messageId: number): Promise<string[]>;

  static async getMessageAttachmentIds(
    connectorMessageOrChannelId: ImmutableConnectorMessage | string,
    messageId?: number
  ): Promise<string[]> {
    if (typeof connectorMessageOrChannelId === 'string') {
      return getAttachmentIds(connectorMessageOrChannelId, messageId!);
    }

    const msg = connectorMessageOrChannelId;
    return getAttachmentIds(msg.getChannelId(), msg.getMessageId());
  }

  // ==========================================================================
  // Get Attachments
  // ==========================================================================

  /**
   * Retrieves all attachments associated with a connector message.
   *
   * @param connectorMessage - The ConnectorMessage associated with this message.
   * @param base64Decode - If true, the content will be Base64 decoded.
   * @returns A list of attachments associated with the connector message.
   */
  static async getMessageAttachments(
    connectorMessage: ImmutableConnectorMessage,
    base64Decode?: boolean
  ): Promise<Attachment[]>;

  /**
   * Retrieves all attachments associated with a specific channel/message ID.
   *
   * @param channelId - The ID of the channel to retrieve the attachments from.
   * @param messageId - The ID of the message to retrieve the attachments from.
   * @param base64Decode - If true, the content will be Base64 decoded.
   * @returns A list of attachments associated with the channel/message ID.
   */
  static async getMessageAttachments(
    channelId: string,
    messageId: number,
    base64Decode?: boolean
  ): Promise<Attachment[]>;

  static async getMessageAttachments(
    connectorMessageOrChannelId: ImmutableConnectorMessage | string,
    messageIdOrBase64Decode?: number | boolean,
    base64Decode?: boolean
  ): Promise<Attachment[]> {
    let channelId: string;
    let messageId: number;
    let decode: boolean;

    if (typeof connectorMessageOrChannelId === 'string') {
      channelId = connectorMessageOrChannelId;
      messageId = messageIdOrBase64Decode as number;
      decode = base64Decode ?? false;
    } else {
      const msg = connectorMessageOrChannelId;
      channelId = msg.getChannelId();
      messageId = msg.getMessageId();
      decode = (messageIdOrBase64Decode as boolean) ?? false;
    }

    const rows = await getAttachments(channelId, messageId);
    return this.convertRowsToAttachments(rows, decode);
  }

  // ==========================================================================
  // Get Single Attachment
  // ==========================================================================

  /**
   * Retrieves an attachment from the current channel/message ID.
   *
   * @param connectorMessage - The ConnectorMessage associated with this message.
   * @param attachmentId - The ID of the attachment to retrieve.
   * @param base64Decode - If true, the content will be Base64 decoded.
   * @returns The attachment associated with the given IDs, or null if none was found.
   */
  static async getMessageAttachment(
    connectorMessage: ImmutableConnectorMessage,
    attachmentId: string,
    base64Decode?: boolean
  ): Promise<Attachment | null>;

  /**
   * Retrieves an attachment from a specific channel/message ID.
   *
   * @param channelId - The ID of the channel to retrieve the attachment from.
   * @param messageId - The ID of the message to retrieve the attachment from.
   * @param attachmentId - The ID of the attachment to retrieve.
   * @param base64Decode - If true, the content will be Base64 decoded.
   * @returns The attachment associated with the given IDs, or null if none was found.
   */
  static async getMessageAttachment(
    channelId: string,
    messageId: number,
    attachmentId: string,
    base64Decode?: boolean
  ): Promise<Attachment | null>;

  static async getMessageAttachment(
    connectorMessageOrChannelId: ImmutableConnectorMessage | string,
    attachmentIdOrMessageId: string | number,
    base64DecodeOrAttachmentId?: boolean | string,
    base64Decode?: boolean
  ): Promise<Attachment | null> {
    let channelId: string;
    let messageId: number;
    let attachmentId: string;
    let decode: boolean;

    if (typeof connectorMessageOrChannelId === 'string') {
      channelId = connectorMessageOrChannelId;
      messageId = attachmentIdOrMessageId as number;
      attachmentId = base64DecodeOrAttachmentId as string;
      decode = base64Decode ?? false;
    } else {
      const msg = connectorMessageOrChannelId;
      channelId = msg.getChannelId();
      messageId = msg.getMessageId();
      attachmentId = attachmentIdOrMessageId as string;
      decode = (base64DecodeOrAttachmentId as boolean) ?? false;
    }

    const rows = await getAttachmentFromDb(channelId, messageId, attachmentId);
    if (rows.length === 0) {
      return null;
    }

    const attachments = this.convertRowsToAttachments(rows, decode);
    const attachment = attachments[0];

    // Java returns null if the attachment ID doesn't match (for some reason)
    if (attachment && attachment.getId() !== attachmentId) {
      return null;
    }

    return attachment ?? null;
  }

  // ==========================================================================
  // Get Attachments from Source Channel
  // ==========================================================================

  /**
   * Retrieves attachments from an upstream channel that sent a message to the current channel.
   *
   * @param connectorMessage - The ConnectorMessage associated with this message.
   *                          The channel ID and message ID will be retrieved from the source map.
   * @param base64Decode - If true, the content will be Base64 decoded.
   * @returns A list of attachments associated with the source channel/message IDs.
   */
  static async getMessageAttachmentsFromSourceChannel(
    connectorMessage: ImmutableConnectorMessage,
    base64Decode: boolean = false
  ): Promise<Attachment[]> {
    const sourceMap = connectorMessage.getSourceMap();

    try {
      let sourceChannelId = sourceMap.get('sourceChannelId') as string | undefined;
      let sourceMessageId = sourceMap.get('sourceMessageId') as number | undefined;

      // Check for list of source channel/message IDs (for multi-hop routing)
      const sourceChannelIds = sourceMap.get('sourceChannelIds') as string[] | undefined;
      const sourceMessageIds = sourceMap.get('sourceMessageIds') as number[] | undefined;

      if (
        sourceChannelIds &&
        sourceChannelIds.length > 0 &&
        sourceMessageIds &&
        sourceMessageIds.length > 0
      ) {
        sourceChannelId = sourceChannelIds[0];
        sourceMessageId = sourceMessageIds[0];
      }

      if (sourceChannelId && sourceMessageId !== undefined) {
        const rows = await getAttachments(sourceChannelId, sourceMessageId);
        return this.convertRowsToAttachments(rows, base64Decode);
      }
    } catch {
      // Silently ignore errors (matching Java behavior)
    }

    return [];
  }

  // ==========================================================================
  // Add Attachment (to list, not database)
  // ==========================================================================

  /**
   * Creates an Attachment and adds it to the provided list.
   *
   * @param attachments - The list of attachments to add to.
   * @param content - The attachment content (must be a string or Buffer).
   * @param type - The MIME type of the attachment.
   * @param base64Encode - If true, the content will be Base64 encoded.
   * @returns The attachment added to the list.
   */
  static addAttachment(
    attachments: Attachment[],
    content: string | Buffer,
    type: string,
    base64Encode: boolean = false
  ): Attachment {
    const attachment = this.createAttachmentObject(content, type, base64Encode);
    attachments.push(attachment);
    return attachment;
  }

  // ==========================================================================
  // Create Attachment (to database)
  // ==========================================================================

  /**
   * Creates an attachment associated with a given connector message, and inserts it into the
   * database.
   *
   * @param connectorMessage - The connector message to be associated with the attachment.
   * @param content - The attachment content (must be a string or Buffer).
   * @param type - The MIME type of the attachment.
   * @param base64Encode - If true, the content will be Base64 encoded.
   * @returns The attachment that was created and inserted.
   */
  static async createAttachment(
    connectorMessage: ImmutableConnectorMessage,
    content: string | Buffer,
    type: string,
    base64Encode: boolean = false
  ): Promise<Attachment> {
    const attachment = this.createAttachmentObject(content, type, base64Encode);

    await insertAttachmentToDb(
      connectorMessage.getChannelId(),
      connectorMessage.getMessageId(),
      attachment.getId()!,
      attachment.getType() ?? null,
      attachment.getContent()!
    );

    return attachment;
  }

  // ==========================================================================
  // Update Attachment
  // ==========================================================================

  /**
   * Updates an attachment associated with a given connector message.
   *
   * @param connectorMessage - The connector message to be associated with the attachment.
   * @param attachmentId - The unique ID of the attachment to update.
   * @param content - The attachment content (must be a string or Buffer).
   * @param type - The MIME type of the attachment.
   * @param base64Encode - If true, the content will be Base64 encoded.
   * @returns The attachment that was updated.
   */
  static async updateAttachment(
    connectorMessage: ImmutableConnectorMessage,
    attachmentId: string,
    content: string | Buffer,
    type: string,
    base64Encode?: boolean
  ): Promise<Attachment>;

  /**
   * Updates an attachment associated with a given connector message.
   *
   * @param connectorMessage - The connector message to be associated with the attachment.
   * @param attachment - The Attachment object to update.
   * @param base64Encode - If true, the content will be Base64 encoded.
   * @returns The attachment that was updated.
   */
  static async updateAttachment(
    connectorMessage: ImmutableConnectorMessage,
    attachment: Attachment,
    base64Encode?: boolean
  ): Promise<Attachment>;

  /**
   * Updates an attachment associated with a given connector message.
   *
   * @param channelId - The ID of the channel the attachment is associated with.
   * @param messageId - The ID of the message the attachment is associated with.
   * @param attachment - The Attachment object to update.
   * @param base64Encode - If true, the content will be Base64 encoded.
   * @returns The attachment that was updated.
   */
  static async updateAttachment(
    channelId: string,
    messageId: number,
    attachment: Attachment,
    base64Encode?: boolean
  ): Promise<Attachment>;

  /**
   * Updates an attachment associated with a given connector message.
   *
   * @param channelId - The ID of the channel the attachment is associated with.
   * @param messageId - The ID of the message the attachment is associated with.
   * @param attachmentId - The unique ID of the attachment to update.
   * @param content - The attachment content (must be a string or Buffer).
   * @param type - The MIME type of the attachment.
   * @param base64Encode - If true, the content will be Base64 encoded.
   * @returns The attachment that was updated.
   */
  static async updateAttachment(
    channelId: string,
    messageId: number,
    attachmentId: string,
    content: string | Buffer,
    type: string,
    base64Encode?: boolean
  ): Promise<Attachment>;

  static async updateAttachment(
    connectorMessageOrChannelId: ImmutableConnectorMessage | string,
    attachmentIdOrMessageIdOrAttachment: string | number | Attachment,
    contentOrAttachmentOrBase64Encode: string | Buffer | Attachment | boolean | undefined,
    typeOrBase64Encode?: string | Buffer | boolean,
    base64EncodeOrContent?: boolean | string | Buffer,
    typeParam?: string | boolean
  ): Promise<Attachment> {
    let channelId: string;
    let messageId: number;
    let attachmentId: string;
    let content: string | Buffer;
    let type: string;
    let base64Encode: boolean;

    // Parse the complex overloads
    if (typeof connectorMessageOrChannelId === 'string') {
      // Channel ID based calls
      channelId = connectorMessageOrChannelId;
      messageId = attachmentIdOrMessageIdOrAttachment as number;

      if (contentOrAttachmentOrBase64Encode instanceof Attachment) {
        // (channelId, messageId, attachment, base64Encode?)
        const attachment = contentOrAttachmentOrBase64Encode;
        attachmentId = attachment.getId()!;
        content = attachment.getContent()!;
        type = attachment.getType()!;
        base64Encode = (typeOrBase64Encode as boolean) ?? false;
      } else {
        // (channelId, messageId, attachmentId, content, type, base64Encode?)
        attachmentId = contentOrAttachmentOrBase64Encode as string;
        content = typeOrBase64Encode as string | Buffer;
        type = base64EncodeOrContent as string;
        base64Encode = (typeParam as unknown as boolean) ?? false;
      }
    } else {
      // ImmutableConnectorMessage based calls
      const msg = connectorMessageOrChannelId;
      channelId = msg.getChannelId();
      messageId = msg.getMessageId();

      if (attachmentIdOrMessageIdOrAttachment instanceof Attachment) {
        // (connectorMessage, attachment, base64Encode?)
        const attachment = attachmentIdOrMessageIdOrAttachment;
        attachmentId = attachment.getId()!;
        content = attachment.getContent()!;
        type = attachment.getType()!;
        base64Encode = (contentOrAttachmentOrBase64Encode as boolean) ?? false;
      } else {
        // (connectorMessage, attachmentId, content, type, base64Encode?)
        attachmentId = attachmentIdOrMessageIdOrAttachment as string;
        content = contentOrAttachmentOrBase64Encode as string | Buffer;
        type = typeOrBase64Encode as string;
        base64Encode = (base64EncodeOrContent as boolean) ?? false;
      }
    }

    // Create the attachment object
    const attachment = this.createAttachmentObjectWithId(attachmentId, content, type, base64Encode);

    await updateAttachmentToDb(
      channelId,
      messageId,
      attachment.getId()!,
      attachment.getType() ?? null,
      attachment.getContent()!
    );

    return attachment;
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Internal method to re-attach content by replacing tokens with attachment data.
   */
  private static async reAttachMessageInternal(
    raw: string,
    channelId: string,
    messageId: number,
    localOnly: boolean
  ): Promise<string> {
    let result = raw;

    // First, handle local tokens ${ATTACH:attachmentId}
    const localMatches = [...raw.matchAll(ATTACHMENT_TOKEN_PATTERN)];
    for (const match of localMatches) {
      const attachmentId = match[1];
      const token = match[0];

      try {
        const attachment = await this.getMessageAttachment(
          channelId,
          messageId,
          attachmentId!,
          false
        );

        if (attachment && attachment.getContent()) {
          result = result.replace(token, attachment.getContentString());
        }
      } catch {
        // Leave token as-is if attachment retrieval fails
      }
    }

    // Then, handle expanded tokens ${ATTACH:channelId:messageId:attachmentId}
    if (!localOnly) {
      const expandedMatches = [...result.matchAll(EXPANDED_TOKEN_PATTERN)];
      for (const match of expandedMatches) {
        const expandedChannelId = match[1]!;
        const expandedMessageId = parseInt(match[2]!, 10);
        const attachmentId = match[3]!;
        const token = match[0];

        try {
          const attachment = await this.getMessageAttachment(
            expandedChannelId,
            expandedMessageId,
            attachmentId,
            false
          );

          if (attachment && attachment.getContent()) {
            result = result.replace(token, attachment.getContentString());
          }
        } catch {
          // Leave token as-is if attachment retrieval fails
        }
      }
    }

    return result;
  }

  /**
   * Expand local tokens to expanded format (for cross-channel reference).
   */
  private static expandLocalTokens(raw: string, channelId: string, messageId: number): string {
    return raw.replace(ATTACHMENT_TOKEN_PATTERN, (_match, attachmentId) => {
      return `\${ATTACH:${channelId}:${messageId}:${attachmentId}}`;
    });
  }

  /**
   * Convert database rows to Attachment objects.
   * Handles segmented attachments by concatenating segments.
   */
  private static convertRowsToAttachments(
    rows: AttachmentRow[],
    base64Decode: boolean
  ): Attachment[] {
    // Group rows by attachment ID (for segmented attachments)
    const attachmentMap = new Map<string, AttachmentRow[]>();

    for (const row of rows) {
      if (!attachmentMap.has(row.ID)) {
        attachmentMap.set(row.ID, []);
      }
      attachmentMap.get(row.ID)!.push(row);
    }

    // Convert each group to an Attachment
    const attachments: Attachment[] = [];

    for (const [id, segments] of attachmentMap) {
      // Sort by segment ID and concatenate
      segments.sort((a, b) => a.SEGMENT_ID - b.SEGMENT_ID);

      const buffers = segments.filter((s) => s.ATTACHMENT !== null).map((s) => s.ATTACHMENT!);

      let content = buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0);

      // Base64 decode if requested
      if (base64Decode && content.length > 0) {
        try {
          content = Buffer.from(content.toString('utf-8'), 'base64');
        } catch {
          // If decode fails, use original content
        }
      }

      const type = segments[0]?.TYPE ?? undefined;
      const attachment = new Attachment(id, content, type ?? '');
      attachments.push(attachment);
    }

    return attachments;
  }

  /**
   * Create an attachment object with a generated UUID.
   */
  private static createAttachmentObject(
    content: string | Buffer,
    type: string,
    base64Encode: boolean
  ): Attachment {
    const id = uuidv4();
    return this.createAttachmentObjectWithId(id, content, type, base64Encode);
  }

  /**
   * Create an attachment object with a specific ID.
   */
  private static createAttachmentObjectWithId(
    id: string,
    content: string | Buffer,
    type: string,
    base64Encode: boolean
  ): Attachment {
    let contentBuffer: Buffer;

    if (typeof content === 'string') {
      contentBuffer = Buffer.from(content, 'utf-8');
    } else {
      contentBuffer = content;
    }

    // Base64 encode if requested
    if (base64Encode) {
      contentBuffer = Buffer.from(contentBuffer.toString('base64'), 'utf-8');
    }

    return new Attachment(id, contentBuffer, type);
  }
}
