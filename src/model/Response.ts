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

  /**
   * Multi-overload constructor matching Java's Response class.
   *
   * Supported forms:
   *   new Response()                                    → status=null, message=""
   *   new Response("message")                           → status=null, message="message"
   *   new Response(SENT, "message")                     → positional
   *   new Response(SENT, "message", "statusMsg")        → positional
   *   new Response(SENT, "message", "statusMsg", "err") → positional
   *   new Response(otherResponse)                       → copy constructor
   *   new Response({ status, message, ... })            → existing Node.js object form
   */
  constructor(
    first?: Status | ResponseData | string | Response,
    second?: string,
    third?: string,
    fourth?: string
  ) {
    if (first === undefined || first === null) {
      // new Response() — Java: chains to Response("") → Response(null, "")
      this.status = null as unknown as Status;
      this.message = '';
      this.statusMessage = '';
      this.error = '';
    } else if (first instanceof Response) {
      // Copy constructor: new Response(otherResponse)
      this.status = first.getStatus();
      this.message = first.getMessage();
      this.statusMessage = first.getStatusMessage();
      this.error = first.getError();
    } else if (typeof first === 'object' && first !== null && 'status' in first && !(first instanceof Response)) {
      // Object form: new Response({ status, message, ... }) — existing Node.js internal callers
      const data = first as ResponseData;
      this.status = data.status;
      this.message = data.message ?? '';
      this.statusMessage = data.statusMessage ?? '';
      this.error = data.error ?? '';
    } else if (typeof first === 'string' && second === undefined) {
      // new Response("message") — Java: chains to Response(null, message)
      this.status = null as unknown as Status;
      this.message = first;
      this.statusMessage = '';
      this.error = '';
    } else {
      // Positional: new Response(Status, message, statusMessage, error)
      this.status = first as Status;
      this.message = second == null ? '' : second;
      this.statusMessage = third ?? '';
      this.error = fourth ?? '';
    }
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
