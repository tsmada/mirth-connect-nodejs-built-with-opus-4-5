/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/message/ConnectorMessage.java
 *
 * Purpose: Represents a single connector's view of a message
 *
 * Key behaviors to replicate:
 * - Tracks status, content, and maps for one connector
 * - metaDataId 0 = source, 1+ = destinations
 * - Matches database schema D_MM{channelId}
 */

import { ContentType } from './ContentType.js';
import { Status } from './Status.js';

export interface MessageContent {
  contentType: ContentType;
  content: string;
  dataType: string;
  encrypted: boolean;
}

export interface ConnectorMessageData {
  messageId: number;
  metaDataId: number;
  channelId: string;
  channelName: string;
  connectorName: string;
  serverId: string;
  receivedDate: Date;
  status: Status;
  sendAttempts?: number;
  sendDate?: Date;
  responseDate?: Date;
  errorCode?: number;
  orderId?: number;
}

export class ConnectorMessage {
  private messageId: number;
  private metaDataId: number;
  private channelId: string;
  private channelName: string;
  private connectorName: string;
  private serverId: string;
  private receivedDate: Date;
  private status: Status;
  private sendAttempts: number;
  private sendDate?: Date;
  private responseDate?: Date;
  private errorCode?: number;
  private orderId?: number;

  // Message content at various stages
  private content: Map<ContentType, MessageContent> = new Map();

  // Map variables
  private sourceMap: Map<string, unknown> = new Map();
  private connectorMap: Map<string, unknown> = new Map();
  private channelMap: Map<string, unknown> = new Map();
  private responseMap: Map<string, unknown> = new Map();

  // Destination name → metaDataId mapping (for ResponseMap $r('name') lookups)
  private destinationIdMap?: Map<string, number>;

  // Processing errors
  private processingError?: string;
  private postProcessorError?: string;
  private responseError?: string;

  constructor(data: ConnectorMessageData) {
    this.messageId = data.messageId;
    this.metaDataId = data.metaDataId;
    this.channelId = data.channelId;
    this.channelName = data.channelName;
    this.connectorName = data.connectorName;
    this.serverId = data.serverId;
    this.receivedDate = data.receivedDate;
    this.status = data.status;
    this.sendAttempts = data.sendAttempts ?? 0;
    this.sendDate = data.sendDate;
    this.responseDate = data.responseDate;
    this.errorCode = data.errorCode;
    this.orderId = data.orderId;
  }

  getMessageId(): number {
    return this.messageId;
  }

  getMetaDataId(): number {
    return this.metaDataId;
  }

  getChannelId(): string {
    return this.channelId;
  }

  getChannelName(): string {
    return this.channelName;
  }

  getConnectorName(): string {
    return this.connectorName;
  }

  getServerId(): string {
    return this.serverId;
  }

  getReceivedDate(): Date {
    return this.receivedDate;
  }

  getStatus(): Status {
    return this.status;
  }

  setStatus(status: Status): void {
    this.status = status;
  }

  getSendAttempts(): number {
    return this.sendAttempts;
  }

  setSendAttempts(attempts: number): void {
    this.sendAttempts = attempts;
  }

  incrementSendAttempts(): void {
    this.sendAttempts++;
  }

  getSendDate(): Date | undefined {
    return this.sendDate;
  }

  setSendDate(date: Date): void {
    this.sendDate = date;
  }

  getResponseDate(): Date | undefined {
    return this.responseDate;
  }

  setResponseDate(date: Date): void {
    this.responseDate = date;
  }

  getErrorCode(): number | undefined {
    return this.errorCode;
  }

  setErrorCode(code: number): void {
    this.errorCode = code;
  }

  getOrderId(): number | undefined {
    return this.orderId;
  }

  // Content methods
  getContent(contentType: ContentType): MessageContent | undefined {
    return this.content.get(contentType);
  }

  setContent(messageContent: MessageContent): void {
    this.content.set(messageContent.contentType, messageContent);
  }

  getRawContent(): MessageContent | undefined {
    return this.content.get(ContentType.RAW);
  }

  /**
   * Get the raw data as a string
   */
  getRawData(): string | null {
    const content = this.getRawContent();
    return content ? content.content : null;
  }

  /**
   * Get the processed raw data (after attachment handling)
   * For now, returns the same as raw data
   */
  getProcessedRawData(): string | null {
    return this.getRawData();
  }

  /**
   * Set the raw data
   */
  setRawData(data: string, dataType: string = 'RAW'): void {
    this.setContent({
      contentType: ContentType.RAW,
      content: data,
      dataType,
      encrypted: false,
    });
  }

  getTransformedContent(): MessageContent | undefined {
    return this.content.get(ContentType.TRANSFORMED);
  }

  /**
   * Get the transformed data as a string
   */
  getTransformedData(): string | null {
    const content = this.getTransformedContent();
    return content ? content.content : null;
  }

  /**
   * Set the transformed data
   */
  setTransformedData(data: string, dataType: string = 'XML'): void {
    this.setContent({
      contentType: ContentType.TRANSFORMED,
      content: data,
      dataType,
      encrypted: false,
    });
  }

  getEncodedContent(): MessageContent | undefined {
    return this.content.get(ContentType.ENCODED);
  }

  getSentContent(): MessageContent | undefined {
    return this.content.get(ContentType.SENT);
  }

  getResponseContent(): MessageContent | undefined {
    return this.content.get(ContentType.RESPONSE);
  }

  /**
   * Get the response transformed data
   */
  getResponseTransformedData(): string | null {
    const content = this.content.get(ContentType.RESPONSE_TRANSFORMED);
    return content ? content.content : null;
  }

  // Map accessors
  getSourceMap(): Map<string, unknown> {
    return this.sourceMap;
  }

  getConnectorMap(): Map<string, unknown> {
    return this.connectorMap;
  }

  getChannelMap(): Map<string, unknown> {
    return this.channelMap;
  }

  getResponseMap(): Map<string, unknown> {
    return this.responseMap;
  }

  getDestinationIdMap(): Map<string, number> | undefined {
    return this.destinationIdMap;
  }

  setDestinationIdMap(map: Map<string, number>): void {
    this.destinationIdMap = map;
  }

  // Error handling
  getProcessingError(): string | undefined {
    return this.processingError;
  }

  setProcessingError(error: string): void {
    this.processingError = error;
  }

  getPostProcessorError(): string | undefined {
    return this.postProcessorError;
  }

  setPostProcessorError(error: string): void {
    this.postProcessorError = error;
  }

  getResponseError(): string | undefined {
    return this.responseError;
  }

  setResponseError(error: string): void {
    this.responseError = error;
  }

  /**
   * Compute a bitmask encoding which error types are present on this connector message.
   * Ported from Java Mirth ConnectorMessage.getErrorCode():
   *   bit 0 (1) = processing error
   *   bit 1 (2) = postprocessor error
   *   bit 2 (4) = response error
   */
  updateErrorCode(): number {
    let errorCode = 0;
    if (this.processingError) errorCode |= 1;
    if (this.postProcessorError) errorCode |= 2;
    if (this.responseError) errorCode |= 4;
    this.errorCode = errorCode;
    return errorCode;
  }

  /**
   * Check if this is a source connector message
   */
  isSource(): boolean {
    return this.metaDataId === 0;
  }

  /**
   * Create a copy for a destination connector
   */
  clone(destinationMetaDataId: number, destinationName: string): ConnectorMessage {
    const clone = new ConnectorMessage({
      messageId: this.messageId,
      metaDataId: destinationMetaDataId,
      channelId: this.channelId,
      channelName: this.channelName,
      connectorName: destinationName,
      serverId: this.serverId,
      receivedDate: new Date(),
      status: Status.RECEIVED,
    });

    // Copy channel map (shared between connectors)
    for (const [key, value] of this.channelMap) {
      clone.channelMap.set(key, value);
    }

    // Copy source map (needed for destination scripts to access $s('key'))
    for (const [key, value] of this.sourceMap) {
      clone.sourceMap.set(key, value);
    }

    // Copy response map
    for (const [key, value] of this.responseMap) {
      clone.responseMap.set(key, value);
    }

    return clone;
  }
}
