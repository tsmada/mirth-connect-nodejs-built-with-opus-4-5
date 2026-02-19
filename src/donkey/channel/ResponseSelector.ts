/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/ResponseSelector.java
 *
 * Purpose: Select response from multiple destinations for source connector
 *
 * Key behaviors to replicate:
 * - Support for different response selection modes (auto, source transformed, destinations completed)
 * - Status precedence for determining overall status
 * - Response map lookup for named responses
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Message } from '../../model/Message.js';
import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';

/**
 * Response selection modes matching Mirth Connect
 */
export const RESPONSE_NONE = 'None';
export const RESPONSE_AUTO_BEFORE = 'Auto-generate (Before processing)';
export const RESPONSE_SOURCE_TRANSFORMED = 'Auto-generate (After source transformer)';
export const RESPONSE_DESTINATIONS_COMPLETED = 'Auto-generate (Destinations completed)';
export const RESPONSE_POSTPROCESSOR = 'd_postprocessor';

/**
 * Status precedence for determining overall status.
 * Higher index = higher precedence.
 */
export const RESPONSE_STATUS_PRECEDENCE: Status[] = [
  Status.FILTERED,
  Status.QUEUED,
  Status.SENT,
  Status.ERROR,
];

/**
 * Map of status to precedence value
 */
const statusPrecedenceMap: Map<Status, number> = new Map();

// Initialize precedence map - higher index in array = higher precedence
for (let i = 0; i < RESPONSE_STATUS_PRECEDENCE.length; i++) {
  const status = RESPONSE_STATUS_PRECEDENCE[i];
  if (status) {
    statusPrecedenceMap.set(status, i + 1);
  }
}

/**
 * Auto-responder interface for generating responses
 */
export interface AutoResponder {
  getResponse(status: Status, rawContent: string, connectorMessage: ConnectorMessage): Response;
}

/**
 * Default auto-responder that generates basic responses
 */
export class DefaultAutoResponder implements AutoResponder {
  getResponse(status: Status, _rawContent: string, _connectorMessage: ConnectorMessage): Response {
    switch (status) {
      case Status.RECEIVED:
        return new Response({
          status: Status.RECEIVED,
          message: '',
          statusMessage: 'Message received',
        });
      case Status.FILTERED:
        return Response.filtered();
      case Status.SENT:
        return Response.sent();
      case Status.ERROR:
        return Response.error('Processing error');
      case Status.QUEUED:
        return Response.queued();
      default:
        return new Response({
          status,
          message: '',
          statusMessage: `Status: ${status}`,
        });
    }
  }
}

/**
 * Response selector for choosing the appropriate response
 * from message processing for the source connector.
 */
export class ResponseSelector {
  private autoResponder: AutoResponder;
  private numDestinations: number = 0;
  private respondFromName: string | null = null;

  constructor(autoResponder: AutoResponder = new DefaultAutoResponder()) {
    this.autoResponder = autoResponder;
  }

  /**
   * Set the number of destinations
   */
  setNumDestinations(numDestinations: number): void {
    this.numDestinations = numDestinations;
  }

  /**
   * Get the respond from name
   */
  getRespondFromName(): string | null {
    return this.respondFromName;
  }

  /**
   * Set the respond from name
   */
  setRespondFromName(respondFromName: string | null): void {
    this.respondFromName = respondFromName;
  }

  /**
   * Check if this selector can respond (i.e., has a valid response mode)
   */
  canRespond(): boolean {
    return this.respondFromName !== null && this.respondFromName !== RESPONSE_NONE;
  }

  /**
   * Get the appropriate response for the given message
   */
  getResponse(sourceMessage: ConnectorMessage, message: Message): Response | null {
    if (!this.respondFromName) {
      return null;
    }

    const rawContent = sourceMessage.getRawData() ?? '';

    if (this.respondFromName === RESPONSE_AUTO_BEFORE) {
      // Assume a successful status since we're responding before processing
      return this.autoResponder.getResponse(Status.RECEIVED, rawContent, sourceMessage);
    }

    if (this.respondFromName === RESPONSE_SOURCE_TRANSFORMED) {
      // Use the status and content from the source connector message
      return this.autoResponder.getResponse(sourceMessage.getStatus(), rawContent, sourceMessage);
    }

    if (this.respondFromName === RESPONSE_DESTINATIONS_COMPLETED) {
      // Determine status based on destination statuses
      let status: Status = Status.SENT;
      const connectorMessages = message.getConnectorMessages();

      // If not all destinations were processed, it's an error
      // (source message is at metaDataId 0, destinations start at 1)
      const numDestinationMessages = connectorMessages.size - 1;
      if (numDestinationMessages < this.numDestinations) {
        status = Status.ERROR;
      } else {
        // Find the highest precedence status from destinations
        let highestPrecedence: number | null = null;

        for (const [metaDataId, connectorMessage] of connectorMessages) {
          if (metaDataId > 0) {
            const precedence = statusPrecedenceMap.get(connectorMessage.getStatus());
            if (
              precedence !== undefined &&
              (highestPrecedence === null || precedence > highestPrecedence)
            ) {
              status = connectorMessage.getStatus();
              highestPrecedence = precedence;
            }
          }
        }
      }

      // Get merged connector message for response
      const mergedMessage = this.getMergedConnectorMessage(message);
      return this.autoResponder.getResponse(status, rawContent, mergedMessage);
    }

    // Check response map for named response
    const responseMap = sourceMessage.getResponseMap();
    const responseObject = responseMap.get(this.respondFromName);

    if (responseObject !== undefined) {
      if (responseObject instanceof Response) {
        return responseObject;
      } else {
        return new Response({
          status: Status.SENT,
          message: String(responseObject),
        });
      }
    }

    return null;
  }

  /**
   * Create a merged connector message from all destination messages
   */
  private getMergedConnectorMessage(message: Message): ConnectorMessage {
    const sourceMessage = message.getSourceConnectorMessage();
    if (!sourceMessage) {
      throw new Error('No source connector message in message');
    }

    // Create a merged message with combined maps
    const merged = new ConnectorMessage({
      messageId: sourceMessage.getMessageId(),
      metaDataId: 0,
      channelId: sourceMessage.getChannelId(),
      channelName: sourceMessage.getChannelName(),
      connectorName: sourceMessage.getConnectorName(),
      serverId: sourceMessage.getServerId(),
      receivedDate: sourceMessage.getReceivedDate(),
      status: sourceMessage.getStatus(),
    });

    // Copy source map
    for (const [key, value] of sourceMessage.getSourceMap()) {
      merged.getSourceMap().set(key, value);
    }

    // Copy channel map from source
    for (const [key, value] of sourceMessage.getChannelMap()) {
      merged.getChannelMap().set(key, value);
    }

    // Merge channel maps from all destinations
    for (const [metaDataId, connectorMessage] of message.getConnectorMessages()) {
      if (metaDataId > 0) {
        for (const [key, value] of connectorMessage.getChannelMap()) {
          merged.getChannelMap().set(key, value);
        }
      }
    }

    // Merge response maps from all destinations
    for (const [, connectorMessage] of message.getConnectorMessages()) {
      for (const [key, value] of connectorMessage.getResponseMap()) {
        merged.getResponseMap().set(key, value);
      }
    }

    // Copy raw content
    const rawContent = sourceMessage.getRawContent();
    if (rawContent) {
      merged.setContent(rawContent);
    }

    return merged;
  }

  /**
   * Get the auto responder
   */
  getAutoResponder(): AutoResponder {
    return this.autoResponder;
  }

  /**
   * Set the auto responder
   */
  setAutoResponder(autoResponder: AutoResponder): void {
    this.autoResponder = autoResponder;
  }

  /**
   * Get status precedence for a status
   */
  static getStatusPrecedence(status: Status): number | undefined {
    return statusPrecedenceMap.get(status);
  }
}
