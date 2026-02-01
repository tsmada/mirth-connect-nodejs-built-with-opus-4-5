/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/message/Message.java
 *
 * Purpose: Represents a complete message with all connector messages
 *
 * Key behaviors to replicate:
 * - Contains source connector message and all destination connector messages
 * - Tracks overall message state
 * - Matches database schema D_M{channelId}
 */

import { ConnectorMessage } from './ConnectorMessage.js';
import { Status } from './Status.js';

export interface MessageData {
  messageId: number;
  serverId: string;
  channelId: string;
  receivedDate: Date;
  processed: boolean;
  originalId?: number;
  importId?: number;
  importChannelId?: string;
}

export class Message {
  private messageId: number;
  private serverId: string;
  private channelId: string;
  private receivedDate: Date;
  private processed: boolean;
  private originalId?: number;
  private importId?: number;
  private importChannelId?: string;

  private connectorMessages: Map<number, ConnectorMessage> = new Map();

  constructor(data: MessageData) {
    this.messageId = data.messageId;
    this.serverId = data.serverId;
    this.channelId = data.channelId;
    this.receivedDate = data.receivedDate;
    this.processed = data.processed;
    this.originalId = data.originalId;
    this.importId = data.importId;
    this.importChannelId = data.importChannelId;
  }

  getMessageId(): number {
    return this.messageId;
  }

  getServerId(): string {
    return this.serverId;
  }

  getChannelId(): string {
    return this.channelId;
  }

  getReceivedDate(): Date {
    return this.receivedDate;
  }

  isProcessed(): boolean {
    return this.processed;
  }

  setProcessed(processed: boolean): void {
    this.processed = processed;
  }

  getOriginalId(): number | undefined {
    return this.originalId;
  }

  getImportId(): number | undefined {
    return this.importId;
  }

  getImportChannelId(): string | undefined {
    return this.importChannelId;
  }

  /**
   * Get connector message by metaDataId.
   * 0 = source connector, 1+ = destination connectors
   */
  getConnectorMessage(metaDataId: number): ConnectorMessage | undefined {
    return this.connectorMessages.get(metaDataId);
  }

  /**
   * Get all connector messages
   */
  getConnectorMessages(): Map<number, ConnectorMessage> {
    return this.connectorMessages;
  }

  /**
   * Add or update a connector message
   */
  setConnectorMessage(metaDataId: number, connectorMessage: ConnectorMessage): void {
    this.connectorMessages.set(metaDataId, connectorMessage);
  }

  /**
   * Get the source connector message (metaDataId = 0)
   */
  getSourceConnectorMessage(): ConnectorMessage | undefined {
    return this.connectorMessages.get(0);
  }

  /**
   * Get all destination connector messages (metaDataId > 0)
   */
  getDestinationConnectorMessages(): ConnectorMessage[] {
    const destinations: ConnectorMessage[] = [];
    for (const [metaDataId, connectorMessage] of this.connectorMessages) {
      if (metaDataId > 0) {
        destinations.push(connectorMessage);
      }
    }
    return destinations;
  }

  /**
   * Get the merged status based on all connector messages
   */
  getMergedStatus(): Status {
    const source = this.getSourceConnectorMessage();
    if (!source) {
      return Status.RECEIVED;
    }

    const destinations = this.getDestinationConnectorMessages();
    if (destinations.length === 0) {
      return source.getStatus();
    }

    // Check for errors first
    for (const dest of destinations) {
      if (dest.getStatus() === Status.ERROR) {
        return Status.ERROR;
      }
    }

    // Check if all sent
    const allSent = destinations.every((d) => d.getStatus() === Status.SENT);
    if (allSent) {
      return Status.SENT;
    }

    // Check for queued
    for (const dest of destinations) {
      if (dest.getStatus() === Status.QUEUED) {
        return Status.QUEUED;
      }
    }

    // Check for filtered
    const allFiltered = destinations.every((d) => d.getStatus() === Status.FILTERED);
    if (allFiltered) {
      return Status.FILTERED;
    }

    return source.getStatus();
  }
}
