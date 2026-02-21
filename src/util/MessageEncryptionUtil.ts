/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/util/MessageEncryptionUtil.java
 *
 * Purpose: Bulk encrypt/decrypt entire Message objects by iterating all
 * content fields on all ConnectorMessages.
 *
 * Key behaviors to replicate:
 * - Iterate all ConnectorMessages in a Message
 * - For each ConnectorMessage, iterate all ContentType values
 * - Skip already-encrypted content during encrypt, skip already-decrypted during decrypt
 * - Skip empty content strings
 * - No-op when encryption is not enabled (NoOpEncryptor)
 */

import { getEncryptor, isEncryptionEnabled } from '../db/Encryptor.js';
import { ContentType } from '../model/ContentType.js';
import type { Message } from '../model/Message.js';
import type { ConnectorMessage } from '../model/ConnectorMessage.js';

/**
 * All content types that should be encrypted/decrypted.
 * Matches Java's iteration over ContentType.values().
 */
const ALL_CONTENT_TYPES: ContentType[] = [
  ContentType.RAW,
  ContentType.PROCESSED_RAW,
  ContentType.TRANSFORMED,
  ContentType.ENCODED,
  ContentType.SENT,
  ContentType.RESPONSE,
  ContentType.RESPONSE_TRANSFORMED,
  ContentType.PROCESSED_RESPONSE,
  ContentType.CONNECTOR_MAP,
  ContentType.CHANNEL_MAP,
  ContentType.RESPONSE_MAP,
  ContentType.PROCESSING_ERROR,
  ContentType.POSTPROCESSOR_ERROR,
  ContentType.RESPONSE_ERROR,
  ContentType.SOURCE_MAP,
];

export class MessageEncryptionUtil {
  /**
   * Encrypt all content fields on all ConnectorMessages within a Message.
   */
  static encryptMessage(message: Message): void {
    if (!isEncryptionEnabled()) return;

    for (const [, connectorMessage] of message.getConnectorMessages()) {
      MessageEncryptionUtil.encryptConnectorMessage(connectorMessage);
    }
  }

  /**
   * Decrypt all content fields on all ConnectorMessages within a Message.
   */
  static decryptMessage(message: Message): void {
    if (!isEncryptionEnabled()) return;

    for (const [, connectorMessage] of message.getConnectorMessages()) {
      MessageEncryptionUtil.decryptConnectorMessage(connectorMessage);
    }
  }

  /**
   * Encrypt all content fields on a single ConnectorMessage.
   * Skips content that is already encrypted or has an empty content string.
   */
  static encryptConnectorMessage(connectorMessage: ConnectorMessage): void {
    if (!isEncryptionEnabled()) return;

    const encryptor = getEncryptor();

    for (const contentType of ALL_CONTENT_TYPES) {
      const content = connectorMessage.getContent(contentType);
      if (!content || content.encrypted || !content.content) continue;

      connectorMessage.setContent({
        contentType: content.contentType,
        content: encryptor.encrypt(content.content),
        dataType: content.dataType,
        encrypted: true,
      });
    }
  }

  /**
   * Decrypt all content fields on a single ConnectorMessage.
   * Skips content that is not encrypted or has an empty content string.
   */
  static decryptConnectorMessage(connectorMessage: ConnectorMessage): void {
    if (!isEncryptionEnabled()) return;

    const encryptor = getEncryptor();

    for (const contentType of ALL_CONTENT_TYPES) {
      const content = connectorMessage.getContent(contentType);
      if (!content || !content.encrypted || !content.content) continue;

      connectorMessage.setContent({
        contentType: content.contentType,
        content: encryptor.decrypt(content.content),
        dataType: content.dataType,
        encrypted: false,
      });
    }
  }
}
