/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/util/ErrorMessageBuilder.java
 *
 * Purpose: Build formatted error messages for logging and display.
 * Used throughout Mirth Connect for consistent error message formatting.
 *
 * Key behaviors to replicate:
 * - Build detailed error messages with type, source line, custom message, and stack trace
 * - Build concise error responses for API/connector responses
 * - Handle Rhino JavaScript errors specially to extract source line
 */

import { EOL } from 'os';

/**
 * Interface for JavaScript errors that may contain source line information.
 * Similar to Mozilla Rhino's RhinoException.
 */
export interface JavaScriptError extends Error {
  lineSource?: string;
  lineNumber?: number;
  columnNumber?: number;
  fileName?: string;
}

/**
 * Check if an error is a JavaScript error with source information.
 */
function isJavaScriptError(error: Error): error is JavaScriptError {
  return 'lineSource' in error || 'lineNumber' in error;
}

/**
 * Get the stack trace from an error, or empty string if not available.
 */
function getStackTrace(error: Error | null | undefined): string {
  if (!error) return '';
  return error.stack || '';
}

/**
 * Check if a string is not blank (not null, undefined, or whitespace only).
 */
function isNotBlank(str: string | null | undefined): str is string {
  return str != null && str.trim().length > 0;
}

/**
 * ErrorMessageBuilder provides static methods to build formatted error messages.
 */
export class ErrorMessageBuilder {
  /**
   * Builds a detailed error message suitable for logging.
   *
   * Format:
   * {errorType} error
   * ERROR SOURCE: {lineSource}  (if available from JavaScript error)
   * ERROR MESSAGE: {customMessage}
   * {stackTrace}
   *
   * @param errorType - The type of error (e.g., "Transformer", "Filter", "Connector")
   * @param customMessage - A custom message describing the error
   * @param error - The error/exception that occurred (optional)
   * @returns The formatted error message
   */
  static buildErrorMessage(
    errorType: string,
    customMessage?: string | null,
    error?: Error | null
  ): string {
    let errorSourceLine: string | undefined;

    // If the exception occurred during script execution, get the line of code
    if (error && isJavaScriptError(error)) {
      errorSourceLine = error.lineSource;
    }

    const builder: string[] = [];
    const stackTrace = getStackTrace(error);

    builder.push(`${errorType} error`);

    if (isNotBlank(errorSourceLine)) {
      builder.push(EOL);
      builder.push('ERROR SOURCE: ');
      builder.push(errorSourceLine);
    }

    if (isNotBlank(customMessage)) {
      builder.push(EOL);
      builder.push('ERROR MESSAGE: ');
      builder.push(customMessage);
    }

    if (isNotBlank(stackTrace)) {
      builder.push(EOL);
      builder.push(stackTrace);
    }

    return builder.join('');
  }

  /**
   * Builds a concise error response suitable for API responses or connector outputs.
   *
   * Format:
   * {customMessage} [{ErrorClass}: {errorMessage}]
   *
   * @param customMessage - A custom message describing the error
   * @param error - The error/exception that occurred (optional)
   * @returns The formatted error response
   */
  static buildErrorResponse(customMessage: string, error?: Error | null): string {
    let responseException = '';

    if (error) {
      const errorName = error.name || error.constructor.name || 'Error';
      const errorMessage = error.message || '';
      responseException = ` [${errorName}: ${errorMessage}]`;
    }

    return customMessage + responseException;
  }

  /**
   * Creates a JavaScript error with source line information.
   * This is useful for creating errors that include script context.
   *
   * @param message - The error message
   * @param lineSource - The source line where the error occurred
   * @param lineNumber - The line number (optional)
   * @param columnNumber - The column number (optional)
   * @param fileName - The file name (optional)
   * @returns An error with JavaScript source information
   */
  static createJavaScriptError(
    message: string,
    lineSource?: string,
    lineNumber?: number,
    columnNumber?: number,
    fileName?: string
  ): JavaScriptError {
    const error = new Error(message) as JavaScriptError;
    error.name = 'JavaScriptError';

    if (lineSource !== undefined) {
      error.lineSource = lineSource;
    }
    if (lineNumber !== undefined) {
      error.lineNumber = lineNumber;
    }
    if (columnNumber !== undefined) {
      error.columnNumber = columnNumber;
    }
    if (fileName !== undefined) {
      error.fileName = fileName;
    }

    return error;
  }
}

// Export shorthand functions for convenience
export const buildErrorMessage = ErrorMessageBuilder.buildErrorMessage;
export const buildErrorResponse = ErrorMessageBuilder.buildErrorResponse;
export const createJavaScriptError = ErrorMessageBuilder.createJavaScriptError;
