/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/ResponseFactory.java
 *
 * Purpose: Provides methods to create Response objects. This is a utility class with static
 * factory methods for common response types.
 *
 * Key behaviors to replicate:
 * - Static factory methods for SENT, ERROR, FILTERED, QUEUED responses
 * - Used in scripts to create responses in a type-safe way
 */

import { Response, ResponseData } from '../../model/Response.js';
import { Status } from '../../model/Status.js';

/**
 * Provides methods to create Response objects.
 */
export class ResponseFactory {
  /**
   * Private constructor - this class should not be instantiated.
   */
  private constructor() {}

  /**
   * Returns a Response representing a successfully sent message.
   *
   * @param message The response data to store.
   * @return The instantiated Response object.
   */
  static getSentResponse(message: string): Response {
    return new Response({
      status: Status.SENT,
      message,
      statusMessage: 'Message successfully sent',
    });
  }

  /**
   * Returns a Response representing an erred message.
   *
   * @param message The response data to store.
   * @return The instantiated Response object.
   */
  static getErrorResponse(message: string): Response {
    return new Response({
      status: Status.ERROR,
      message,
      statusMessage: 'Error processing message',
    });
  }

  /**
   * Returns a Response representing a filtered message.
   *
   * @param message The response data to store.
   * @return The instantiated Response object.
   */
  static getFilteredResponse(message: string): Response {
    return new Response({
      status: Status.FILTERED,
      message,
      statusMessage: 'Message was filtered',
    });
  }

  /**
   * Returns a Response representing a queued message.
   *
   * @param message The response data to store.
   * @return The instantiated Response object.
   */
  static getQueuedResponse(message: string): Response {
    return new Response({
      status: Status.QUEUED,
      message,
      statusMessage: 'Message queued for later delivery',
    });
  }

  /**
   * Create a Response with a custom status and message.
   * Note: This method is an extension to the Java API.
   *
   * @param status The status to use for the response.
   * @param message The response data to store.
   * @param statusMessage Optional brief message explaining the reason for the status.
   * @param error Optional error string if applicable.
   * @return The instantiated Response object.
   */
  static createResponse(
    status: Status,
    message: string,
    statusMessage?: string,
    error?: string
  ): Response {
    const data: ResponseData = {
      status,
      message,
      statusMessage,
      error,
    };
    return new Response(data);
  }
}
