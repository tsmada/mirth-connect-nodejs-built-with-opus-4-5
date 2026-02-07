/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/DestinationChain.java
 *
 * Purpose: Chain of destination connectors for sequential message processing
 *
 * Key behaviors to replicate:
 * - Process messages through a chain of destinations
 * - Handle status transitions and error handling
 * - Create next message in chain after each destination
 * - Support for waitForPrevious patterns
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { DestinationConnector } from './DestinationConnector.js';

/**
 * Provider interface for destination chain dependencies
 */
export interface DestinationChainProvider {
  getChannelId(): string;
  getChannelName(): string;
  getMetaDataIds(): number[];
  getDestinationConnectors(): Map<number, DestinationConnector>;
  getChainId(): number;
  getServerId(): string;
}

/**
 * Result of chain execution
 */
export interface DestinationChainResult {
  messages: ConnectorMessage[];
  errors: Error[];
}

/**
 * Destination chain for processing messages through multiple destination connectors.
 * Destinations in a chain are processed sequentially, with each destination
 * potentially modifying the message for the next destination.
 */
export class DestinationChain {
  private chainProvider: DestinationChainProvider;
  private message: ConnectorMessage | null = null;
  private enabledMetaDataIds: number[];
  private name: string;

  constructor(chainProvider: DestinationChainProvider) {
    this.chainProvider = chainProvider;
    this.enabledMetaDataIds = [...chainProvider.getMetaDataIds()];
    this.name = `Destination Chain Thread on ${chainProvider.getChannelId()}`;
  }

  /**
   * Set the message to process through the chain
   */
  setMessage(message: ConnectorMessage): void {
    this.message = message;
  }

  /**
   * Get the message
   */
  getMessage(): ConnectorMessage | null {
    return this.message;
  }

  /**
   * Get enabled metadata IDs
   */
  getEnabledMetaDataIds(): number[] {
    return this.enabledMetaDataIds;
  }

  /**
   * Set enabled metadata IDs
   */
  setEnabledMetaDataIds(enabledMetaDataIds: number[]): void {
    this.enabledMetaDataIds = enabledMetaDataIds;
  }

  /**
   * Set the chain name
   */
  setName(name: string): void {
    this.name = name;
  }

  /**
   * Get the chain name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Execute the destination chain
   */
  async call(): Promise<ConnectorMessage[]> {
    return this.doCall();
  }

  /**
   * Internal implementation of chain execution
   */
  private async doCall(): Promise<ConnectorMessage[]> {
    const messages: ConnectorMessage[] = [];

    if (!this.message) {
      throw new Error('No message set for destination chain');
    }

    let message = this.message;
    const startMetaDataId = this.enabledMetaDataIds.indexOf(message.getMetaDataId());
    let stopChain = false;

    // The message must be associated with one of the destinations in this chain
    if (startMetaDataId === -1) {
      throw new Error(
        `Message metadata ID ${message.getMetaDataId()} is not in the destination chain's list of enabled metadata IDs`
      );
    }

    // Loop through each metaDataId in the chain
    for (
      let i = startMetaDataId;
      i < this.enabledMetaDataIds.length && !stopChain;
      i++
    ) {
      const metaDataId = this.enabledMetaDataIds[i]!;
      const nextMetaDataId =
        i + 1 < this.enabledMetaDataIds.length
          ? this.enabledMetaDataIds[i + 1]!
          : null;

      let nextMessage: ConnectorMessage | null = null;
      const destinationConnector = this.chainProvider
        .getDestinationConnectors()
        .get(metaDataId!);

      if (!destinationConnector) {
        throw new Error(
          `No destination connector found for metadata ID ${metaDataId}`
        );
      }

      try {
        switch (message.getStatus()) {
          case Status.RECEIVED:
            // Transform and process the message
            await this.transformAndProcess(
              destinationConnector,
              message
            );

            // If error occurred in filter/transformer without sending, stop chain
            if (
              message.getStatus() === Status.ERROR &&
              !message.getSentContent()
            ) {
              stopChain = true;
            }
            break;

          case Status.PENDING:
            // Process pending message
            await this.processPending(destinationConnector, message);
            break;

          case Status.SENT:
            // Already sent, nothing to do
            break;

          default:
            throw new Error(
              `Received message with invalid status: ${message.getStatus()}`
            );
        }
      } catch (error) {
        // Error in processing - update status and continue
        stopChain = true;
        message.setStatus(Status.ERROR);
        message.setProcessingError(String(error));
      }

      // Create next message in chain if there is one
      if (nextMetaDataId !== null && !stopChain) {
        const nextDestinationConnector = this.chainProvider
          .getDestinationConnectors()
          .get(nextMetaDataId);

        if (nextDestinationConnector) {
          nextMessage = this.createNextMessage(
            message,
            nextMetaDataId,
            nextDestinationConnector
          );
        }
      }

      // Add to queue if message is QUEUED
      if (message.getStatus() === Status.QUEUED) {
        const queue = destinationConnector.getQueue();
        if (queue) {
          queue.add(message);
        }
      }

      messages.push(message);

      // Set next message for next iteration
      if (nextMessage !== null) {
        message = nextMessage;
      }
    }

    return messages;
  }

  /**
   * Transform and process a message through a destination connector
   */
  private async transformAndProcess(
    connector: DestinationConnector,
    message: ConnectorMessage
  ): Promise<void> {
    // Execute filter
    const filtered = await connector.executeFilter(message);
    if (filtered) {
      message.setStatus(Status.FILTERED);
      return;
    }

    // Execute transformer
    await connector.executeTransformer(message);
    message.setStatus(Status.TRANSFORMED);

    // Send to destination (unless queued)
    if (connector.isQueueEnabled() && !connector.shouldSendFirst()) {
      message.setStatus(Status.QUEUED);
    } else {
      try {
        await connector.send(message);
        message.setStatus(Status.SENT);
        message.setSendDate(new Date());
      } catch (error) {
        if (connector.isQueueEnabled()) {
          message.setStatus(Status.QUEUED);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Process a pending message
   */
  private async processPending(
    connector: DestinationConnector,
    message: ConnectorMessage
  ): Promise<void> {
    try {
      await connector.send(message);
      message.setStatus(Status.SENT);
      message.setSendDate(new Date());
    } catch (error) {
      if (connector.isQueueEnabled()) {
        message.setStatus(Status.QUEUED);
      } else {
        message.setStatus(Status.ERROR);
        message.setProcessingError(String(error));
      }
    }
  }

  /**
   * Create the next message in the chain
   */
  private createNextMessage(
    currentMessage: ConnectorMessage,
    nextMetaDataId: number,
    nextConnector: DestinationConnector
  ): ConnectorMessage {
    const nextMessage = new ConnectorMessage({
      messageId: currentMessage.getMessageId(),
      metaDataId: nextMetaDataId,
      channelId: this.chainProvider.getChannelId(),
      channelName: this.chainProvider.getChannelName(),
      connectorName: nextConnector.getName(),
      serverId: this.chainProvider.getServerId(),
      receivedDate: new Date(),
      status: Status.RECEIVED,
    });

    // Copy source map (read-only, shared reference)
    for (const [key, value] of currentMessage.getSourceMap()) {
      nextMessage.getSourceMap().set(key, value);
    }

    // Copy channel map (mutable, new instance)
    for (const [key, value] of currentMessage.getChannelMap()) {
      nextMessage.getChannelMap().set(key, value);
    }

    // Copy response map (mutable, new instance)
    for (const [key, value] of currentMessage.getResponseMap()) {
      nextMessage.getResponseMap().set(key, value);
    }

    // Copy current destination's ENCODED output as next destination's RAW input
    // This matches Java Mirth DestinationChain.java behavior where each destination
    // in a chain receives the previous destination's encoded output
    const encodedContent = currentMessage.getEncodedContent();
    if (encodedContent) {
      nextMessage.setContent({
        contentType: ContentType.RAW,
        content: encodedContent.content,
        dataType: encodedContent.dataType,
        encrypted: encodedContent.encrypted,
      });
    } else {
      // Fallback to raw content if no encoded content exists (e.g., filter-only destination)
      const rawContent = currentMessage.getRawContent();
      if (rawContent) {
        nextMessage.setContent({
          contentType: ContentType.RAW,
          content: rawContent.content,
          dataType: rawContent.dataType,
          encrypted: rawContent.encrypted,
        });
      }
    }

    return nextMessage;
  }

  /**
   * Get the chain ID
   */
  getChainId(): number {
    return this.chainProvider.getChainId();
  }
}
