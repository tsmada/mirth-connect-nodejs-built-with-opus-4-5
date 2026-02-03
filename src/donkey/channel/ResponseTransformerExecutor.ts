/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/ResponseTransformerExecutor.java
 *
 * Purpose: Execute response transformers on destination responses
 *
 * Key behaviors to replicate:
 * - Transform response content based on data types
 * - Support for inbound/outbound serialization types
 * - Store transformed and processed response content
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { ContentType } from '../../model/ContentType.js';
import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';

/**
 * Serialization type for data transformation
 */
export enum SerializationType {
  RAW = 'RAW',
  XML = 'XML',
  JSON = 'JSON',
}

/**
 * Response transformer interface
 */
export interface ResponseTransformer {
  /**
   * Transform the response
   * @param response The response to transform
   * @param connectorMessage The connector message context
   * @returns The transformed content
   */
  doTransform(response: Response, connectorMessage: ConnectorMessage): string;
}

/**
 * Data type interface for serialization
 */
export interface DataType {
  getType(): string;
  getSerializationType(): SerializationType;
  toXML(content: string): string;
  toJSON(content: string): string;
  fromXML(content: string): string;
  fromJSON(content: string): string;
}

/**
 * Simple data type implementation
 */
export class SimpleDataType implements DataType {
  private type: string;
  private serializationType: SerializationType;

  constructor(type: string, serializationType: SerializationType = SerializationType.RAW) {
    this.type = type;
    this.serializationType = serializationType;
  }

  getType(): string {
    return this.type;
  }

  getSerializationType(): SerializationType {
    return this.serializationType;
  }

  toXML(content: string): string {
    // In real implementation, this would serialize based on data type
    return content;
  }

  toJSON(content: string): string {
    // In real implementation, this would serialize based on data type
    return content;
  }

  fromXML(content: string): string {
    // In real implementation, this would deserialize based on data type
    return content;
  }

  fromJSON(content: string): string {
    // In real implementation, this would deserialize based on data type
    return content;
  }
}

/**
 * Storage settings for response transformer
 */
export interface ResponseStorageSettings {
  isStoreResponseTransformed(): boolean;
  isStoreProcessedResponse(): boolean;
}

/**
 * Default storage settings
 */
export class DefaultResponseStorageSettings implements ResponseStorageSettings {
  isStoreResponseTransformed(): boolean {
    return true;
  }

  isStoreProcessedResponse(): boolean {
    return true;
  }
}

/**
 * Response transformer executor for processing destination responses.
 * Handles serialization/deserialization between data types.
 */
export class ResponseTransformerExecutor {
  private inbound: DataType;
  private outbound: DataType;
  private responseTransformer: ResponseTransformer | null = null;

  constructor(inbound: DataType, outbound: DataType) {
    this.inbound = inbound;
    this.outbound = outbound;
  }

  /**
   * Get inbound data type
   */
  getInbound(): DataType {
    return this.inbound;
  }

  /**
   * Set inbound data type
   */
  setInbound(inbound: DataType): void {
    this.inbound = inbound;
  }

  /**
   * Get outbound data type
   */
  getOutbound(): DataType {
    return this.outbound;
  }

  /**
   * Set outbound data type
   */
  setOutbound(outbound: DataType): void {
    this.outbound = outbound;
  }

  /**
   * Get response transformer
   */
  getResponseTransformer(): ResponseTransformer | null {
    return this.responseTransformer;
  }

  /**
   * Set response transformer
   */
  setResponseTransformer(responseTransformer: ResponseTransformer | null): void {
    this.responseTransformer = responseTransformer;
  }

  /**
   * Run the response transformer on a message
   */
  async runResponseTransformer(
    connectorMessage: ConnectorMessage,
    response: Response,
    queueEnabled: boolean,
    storageSettings: ResponseStorageSettings = new DefaultResponseStorageSettings()
  ): Promise<void> {
    let processedResponseContent: string | null = null;

    if (this.isActive(response)) {
      let responseTransformedContent: string | null = null;

      // Pre-transformation setup based on inbound serialization type
      switch (this.inbound.getSerializationType()) {
        case SerializationType.RAW:
          // Raw content used directly
          break;
        case SerializationType.JSON:
          responseTransformedContent = this.inbound.toJSON(response.getMessage());
          this.setResponseTransformedContent(
            connectorMessage,
            responseTransformedContent,
            SerializationType.JSON
          );
          break;
        case SerializationType.XML:
        default:
          responseTransformedContent = this.inbound.toXML(response.getMessage());
          this.setResponseTransformedContent(
            connectorMessage,
            responseTransformedContent,
            SerializationType.XML
          );
          break;
      }

      // Perform transformation
      try {
        if (this.responseTransformer) {
          responseTransformedContent = this.responseTransformer.doTransform(
            response,
            connectorMessage
          );
          this.setResponseTransformedContent(
            connectorMessage,
            responseTransformedContent,
            this.outbound.getSerializationType()
          );
        }
      } catch (error) {
        throw error;
      }

      // Fix response status based on queue settings
      this.fixResponseStatus(response, queueEnabled);

      // Post transformation: Determine processed response content
      switch (this.outbound.getSerializationType()) {
        case SerializationType.RAW:
          processedResponseContent = responseTransformedContent;
          break;
        case SerializationType.JSON:
          processedResponseContent = responseTransformedContent
            ? this.outbound.fromJSON(responseTransformedContent)
            : null;
          break;
        case SerializationType.XML:
        default:
          processedResponseContent = responseTransformedContent
            ? this.outbound.fromXML(responseTransformedContent)
            : null;
          break;
      }

      if (processedResponseContent !== null) {
        this.setProcessedResponse(
          response,
          connectorMessage,
          processedResponseContent,
          storageSettings
        );
      }
    } else {
      // No active transformer, but may need to process content
      if (response.getMessage()) {
        // Check if content was modified without serializing
        const content = response.getMessage();
        if (content) {
          processedResponseContent = content;
          this.setProcessedResponse(
            response,
            connectorMessage,
            processedResponseContent,
            storageSettings
          );
        }
      }
    }
  }

  /**
   * Check if transformer is active for the response
   */
  isActive(response: Response): boolean {
    return (
      this.responseTransformer !== null &&
      (response.getMessage().length > 0 ||
        this.inbound.getSerializationType() === SerializationType.RAW)
    );
  }

  /**
   * Set the response transformed content on the connector message
   */
  private setResponseTransformedContent(
    connectorMessage: ConnectorMessage,
    transformedContent: string,
    serializationType: SerializationType
  ): void {
    connectorMessage.setContent({
      contentType: ContentType.RESPONSE_TRANSFORMED,
      content: transformedContent,
      dataType: serializationType.toString(),
      encrypted: false,
    });
  }

  /**
   * Set the processed response on the connector message
   */
  private setProcessedResponse(
    response: Response,
    connectorMessage: ConnectorMessage,
    processedResponseContent: string,
    _storageSettings: ResponseStorageSettings
  ): void {
    response.setMessage(processedResponseContent);

    // Store as processed response content
    connectorMessage.setContent({
      contentType: ContentType.PROCESSED_RESPONSE,
      content: JSON.stringify({
        status: response.getStatus(),
        message: processedResponseContent,
        statusMessage: response.getStatusMessage(),
        error: response.getError(),
      }),
      dataType: this.outbound.getType(),
      encrypted: false,
    });
  }

  /**
   * Fix the response status based on queue enabled setting
   */
  private fixResponseStatus(response: Response, queueEnabled: boolean): void {
    // If queue is enabled and status is ERROR, change to QUEUED
    if (queueEnabled && response.getStatus() === Status.ERROR) {
      response.setStatus(Status.QUEUED);
    }
  }
}
