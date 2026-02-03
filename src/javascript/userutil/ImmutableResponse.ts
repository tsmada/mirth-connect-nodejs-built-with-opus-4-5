/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/ImmutableResponse.java
 *
 * Purpose: This class represents a destination response and is used to retrieve details such as
 * the response data, message status, and errors. This is an immutable wrapper around Response
 * that only exposes getter methods.
 *
 * Key behaviors to replicate:
 * - Read-only access to response data
 * - Used in scripts to inspect response without modifying it
 */

import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';

/**
 * ImmutableResponse provides read-only access to a Response object.
 * This is used in scripts to inspect the response without allowing modifications.
 */
export class ImmutableResponse {
  private response: Response;

  /**
   * Instantiates a new ImmutableResponse object.
   *
   * @param response The Response object that this object will reference for retrieving data.
   */
  constructor(response: Response) {
    this.response = response;
  }

  /**
   * Returns the actual response data, as a string.
   *
   * @return The actual response data, as a string.
   */
  getMessage(): string {
    return this.response.getMessage();
  }

  /**
   * Returns the Status (e.g. SENT, QUEUED) of this response, which will be used to set the status
   * of the corresponding connector message.
   *
   * @return The Status (e.g. SENT, QUEUED) of this response.
   */
  getNewMessageStatus(): Status {
    return this.response.getStatus();
  }

  /**
   * Returns the error string associated with this response, if it exists.
   *
   * @return The error string associated with this response, if it exists.
   */
  getError(): string {
    return this.response.getError();
  }

  /**
   * Returns a brief message explaining the reason for the current status.
   *
   * @return A brief message explaining the reason for the current status.
   */
  getStatusMessage(): string {
    return this.response.getStatusMessage();
  }

  /**
   * Returns the underlying Response object.
   * Note: This method is not in the Java API but is useful for internal operations.
   */
  getResponse(): Response {
    return this.response;
  }
}
