/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/FileUtil.java
 *
 * Purpose: File read/write utilities for Mirth scripts
 *
 * Key behaviors to replicate:
 * - write(fileName, append, data) - Write string or bytes to file
 * - read(fileName) - Read file as string
 * - readBytes(fileName) - Read file as byte array
 * - encode(data) - Base64 encode bytes
 * - decode(data) - Base64 decode string
 * - deleteFile(file) - Delete a file
 * - rtfToPlainText(message, replaceLinebreaksWith) - Convert RTF to plain text
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Provides file utility methods.
 * @see org.apache.commons.io.FileUtils
 */
export class FileUtil {
  private constructor() {
    // Private constructor - static utility class
  }

  /**
   * Writes a string to a specified file, creating the file if it does not exist.
   *
   * @param fileName - The pathname string of the file to write to.
   * @param append - If true, the data will be added to the end of the file rather than overwriting.
   * @param data - The content to write to the file (string or Buffer).
   * @throws Error if an I/O error occurred.
   */
  static write(fileName: string, append: boolean, data: string | Buffer): void {
    const dir = path.dirname(fileName);

    // Create parent directories if they don't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const flag = append ? 'a' : 'w';
    fs.writeFileSync(fileName, data, { flag });
  }

  /**
   * Decodes a Base64 string into a Buffer (byte array).
   *
   * @param data - The Base64 string to decode.
   * @returns The decoded data as a Buffer.
   */
  static decode(data: string): Buffer {
    return Buffer.from(data, 'base64');
  }

  /**
   * Encodes binary data into a Base64 string.
   * Uses chunked encoding (76 characters per line) to match Java's Base64.encodeBase64Chunked.
   *
   * @param data - The binary data to encode (Buffer).
   * @returns The encoded Base64 string with line breaks.
   */
  static encode(data: Buffer): string {
    const base64 = data.toString('base64');
    // Match Java's encodeBase64Chunked - 76 chars per line with CRLF
    const chunks: string[] = [];
    for (let i = 0; i < base64.length; i += 76) {
      chunks.push(base64.substring(i, i + 76));
    }
    return chunks.join('\r\n') + (chunks.length > 0 ? '\r\n' : '');
  }

  /**
   * Returns the contents of the file as a Buffer (byte array).
   *
   * @param fileName - The pathname string of the file to read from.
   * @returns The Buffer representation of the file.
   * @throws Error if an I/O error occurred.
   */
  static readBytes(fileName: string): Buffer {
    return fs.readFileSync(fileName);
  }

  /**
   * Returns the contents of the file as a string, using UTF-8 encoding.
   *
   * @param fileName - The pathname string of the file to read from.
   * @returns The string representation of the file.
   * @throws Error if an I/O error occurred.
   */
  static read(fileName: string): string {
    return fs.readFileSync(fileName, 'utf-8');
  }

  /**
   * Deletes a specified file.
   * In Rhino and E4X 'delete' is a keyword, so File.delete() can't be
   * called within Mirth directly.
   *
   * @param filePath - The path to the file to delete.
   * @returns true if the file was successfully deleted; false otherwise.
   * @throws Error if the security manager denies access to delete the file.
   */
  static deleteFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Converts an RTF into plain text.
   *
   * Note: This is a simplified implementation that strips RTF control codes.
   * The Java version uses Swing's RTFEditorKit which provides more complete RTF parsing.
   *
   * @param message - The RTF message to convert.
   * @param replaceLinebreaksWith - If not null, any line breaks in the converted message
   *                                will be replaced with this string.
   * @returns The converted plain text message.
   */
  static rtfToPlainText(message: string, replaceLinebreaksWith: string | null = null): string {
    // Simple RTF to plain text conversion
    // This matches the basic behavior of Java's RTFEditorKit for common cases

    let text = message;

    // Remove RTF header (just the initial rtf1 and its parameters, not the content)
    text = text.replace(/^\{\\rtf\d?\s*/i, '');

    // Remove font table (handle nested braces)
    text = text.replace(/\{\\fonttbl[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, '');

    // Remove color table
    text = text.replace(/\{\\colortbl[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, '');

    // Remove stylesheet
    text = text.replace(/\{\\stylesheet[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, '');

    // Remove info blocks
    text = text.replace(/\{\\info[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, '');

    // Handle line breaks and paragraphs
    text = text.replace(/\\par\s*/g, '\n');
    text = text.replace(/\\line\s*/g, '\n');

    // Handle special characters (hex encoded)
    text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    // Handle unicode characters
    text = text.replace(/\\u(-?\d+)\??/g, (_, code) => {
      const codePoint = parseInt(code, 10);
      // Handle negative unicode values (used for values > 32767)
      const actualCode = codePoint < 0 ? codePoint + 65536 : codePoint;
      return String.fromCharCode(actualCode);
    });

    // Remove remaining RTF control words (but not the text after them)
    text = text.replace(/\\[a-z]+\d*\s?/gi, '');

    // Remove curly braces
    text = text.replace(/[{}]/g, '');

    // Remove multiple spaces
    text = text.replace(/ +/g, ' ');

    // Trim
    text = text.trim();

    // Replace line breaks if specified
    if (replaceLinebreaksWith !== null) {
      text = text.replace(/\n/g, replaceLinebreaksWith);
    }

    return text;
  }
}
