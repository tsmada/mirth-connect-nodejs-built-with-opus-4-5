/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/message/Response.java
 *
 * Purpose: Represents a response from a destination connector
 *
 * Key behaviors to replicate:
 * - Status indicates success/failure/queued
 * - Contains response message data
 * - Can include error details
 */

import { Status } from './Status.js';

export interface ResponseData {
  status: Status;
  message?: string;
  statusMessage?: string;
  error?: string;
}

export class Response {
  private status: Status;
  private message: string;
  private statusMessage: string;
  private error: string;

  constructor(data: ResponseData) {
    this.status = data.status;
    this.message = data.message ?? '';
    this.statusMessage = data.statusMessage ?? '';
    this.error = data.error ?? '';
  }

  /**
   * Create a successful response
   */
  static sent(message: string = ''): Response {
    return new Response({
      status: Status.SENT,
      message,
      statusMessage: 'Message successfully sent',
    });
  }

  /**
   * Create a queued response
   */
  static queued(message: string = ''): Response {
    return new Response({
      status: Status.QUEUED,
      message,
      statusMessage: 'Message queued for later delivery',
    });
  }

  /**
   * Create an error response
   */
  static error(error: string, message: string = ''): Response {
    return new Response({
      status: Status.ERROR,
      message,
      statusMessage: 'Error processing message',
      error,
    });
  }

  /**
   * Create a filtered response
   */
  static filtered(message: string = ''): Response {
    return new Response({
      status: Status.FILTERED,
      message,
      statusMessage: 'Message was filtered',
    });
  }

  getStatus(): Status {
    return this.status;
  }

  setStatus(status: Status): void {
    this.status = status;
  }

  getMessage(): string {
    return this.message;
  }

  setMessage(message: string): void {
    this.message = message;
  }

  getStatusMessage(): string {
    return this.statusMessage;
  }

  setStatusMessage(statusMessage: string): void {
    this.statusMessage = statusMessage;
  }

  getError(): string {
    return this.error;
  }

  setError(error: string): void {
    this.error = error;
  }

  /**
   * Check if response indicates success
   */
  isSuccess(): boolean {
    return this.status === Status.SENT;
  }

  /**
   * Check if response indicates an error
   */
  isError(): boolean {
    return this.status === Status.ERROR;
  }

  /**
   * Check if message was filtered
   */
  isFiltered(): boolean {
    return this.status === Status.FILTERED;
  }

  /**
   * Check if message was queued
   */
  isQueued(): boolean {
    return this.status === Status.QUEUED;
  }
}
