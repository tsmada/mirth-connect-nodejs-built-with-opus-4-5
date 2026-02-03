/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/HTTPUtil.java
 *
 * Purpose: HTTP utility methods for parsing headers and body content
 *
 * Key behaviors to replicate:
 * - parseHeaders(str) - Parse HTTP headers block into Map
 * - httpBodyToXml(body, contentType) - Serialize HTTP body to XML
 */

import { XMLBuilder } from 'fast-xml-parser';

/**
 * Provides HTTP utility methods.
 */
export class HTTPUtil {
  private constructor() {
    // Private constructor - static utility class
  }

  /**
   * Converts a block of HTTP header fields into a Map containing each header key and value.
   *
   * @param str - The block of HTTP header fields to convert.
   * @returns A Map containing header key-value pairs.
   * @throws Error if the header string could not be parsed.
   */
  static parseHeaders(str: string): Map<string, string> {
    const headersMap = new Map<string, string>();

    if (!str || str.trim() === '') {
      return headersMap;
    }

    // Split by CRLF or LF
    const lines = str.split(/\r?\n/);

    for (const line of lines) {
      // Skip empty lines
      if (line.trim() === '') {
        continue;
      }

      // Find the first colon
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        continue; // Invalid header line, skip
      }

      const name = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      if (name) {
        headersMap.set(name, value);
      }
    }

    return headersMap;
  }

  /**
   * Serializes an HTTP request body into XML. Multipart requests will also automatically be
   * parsed into separate XML nodes.
   *
   * @param httpBody - The request body/payload to parse (string or Buffer).
   * @param contentType - The MIME content type of the request.
   * @returns The serialized XML string.
   */
  static httpBodyToXml(
    httpBody: string | Buffer,
    contentType: string
  ): string {
    const parsedContentType = HTTPUtil.getContentType(contentType);
    const mimeType = parsedContentType.mimeType;

    // Convert Buffer to string if necessary
    const bodyStr =
      httpBody instanceof Buffer
        ? httpBody.toString(parsedContentType.charset || 'utf-8')
        : httpBody;

    // Check if multipart
    if (mimeType.startsWith('multipart/')) {
      return HTTPUtil.multipartToXml(bodyStr as string, contentType);
    }

    // For non-multipart, wrap in HttpBody element
    return HTTPUtil.contentToXml(bodyStr as string, parsedContentType, true);
  }

  /**
   * Parses a content type string into its components.
   */
  private static getContentType(contentType: string): {
    mimeType: string;
    charset: BufferEncoding | undefined;
    boundary: string | undefined;
  } {
    try {
      if (!contentType) {
        return { mimeType: 'text/plain', charset: 'utf-8', boundary: undefined };
      }

      // Parse content type header
      const parts = contentType.split(';').map((p) => p.trim());
      const mimeType = parts[0]?.toLowerCase() || 'text/plain';

      let charset: BufferEncoding | undefined;
      let boundary: string | undefined;

      for (let i = 1; i < parts.length; i++) {
        const param = parts[i];
        if (!param) continue;

        const eqIndex = param.indexOf('=');
        if (eqIndex === -1) continue;

        const key = param.substring(0, eqIndex).trim().toLowerCase();
        let value = param.substring(eqIndex + 1).trim();

        // Remove quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        }

        if (key === 'charset') {
          charset = value.toLowerCase() as BufferEncoding;
        } else if (key === 'boundary') {
          boundary = value;
        }
      }

      return { mimeType, charset, boundary };
    } catch {
      return { mimeType: 'text/plain', charset: 'utf-8', boundary: undefined };
    }
  }

  /**
   * Converts content to XML representation.
   */
  private static contentToXml(
    content: string,
    _contentType: { mimeType: string; charset: BufferEncoding | undefined },
    _includeContentType: boolean
  ): string {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: false,
    });

    const xmlObj = {
      HttpBody: {
        '#text': content,
      },
    };

    return builder.build(xmlObj);
  }

  /**
   * Parses multipart content and converts to XML.
   */
  private static multipartToXml(body: string, contentType: string): string {
    const { boundary } = HTTPUtil.getContentType(contentType);

    if (!boundary) {
      // No boundary found, treat as plain content
      return HTTPUtil.contentToXml(
        body,
        { mimeType: 'text/plain', charset: 'utf-8' },
        true
      );
    }

    const parts = HTTPUtil.parseMultipart(body, boundary);

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: false,
    });

    const xmlObj = {
      HttpBody: {
        Parts: {
          Part: parts.map((part) => ({
            '@_contentType': part.contentType || 'text/plain',
            ...(part.name && { '@_name': part.name }),
            ...(part.filename && { '@_filename': part.filename }),
            '#text': part.content,
          })),
        },
      },
    };

    return builder.build(xmlObj);
  }

  /**
   * Parses multipart body into parts.
   */
  private static parseMultipart(
    body: string,
    boundary: string
  ): Array<{
    name?: string;
    filename?: string;
    contentType?: string;
    content: string;
  }> {
    const parts: Array<{
      name?: string;
      filename?: string;
      contentType?: string;
      content: string;
    }> = [];

    // Split by boundary
    const delimiter = '--' + boundary;
    const endDelimiter = delimiter + '--';

    // Remove end delimiter
    let content = body.replace(endDelimiter, '').trim();

    // Split by delimiter
    const rawParts = content.split(delimiter);

    for (const rawPart of rawParts) {
      const trimmed = rawPart.trim();
      if (!trimmed) continue;

      // Split headers from content (empty line separates them)
      const headerEndIndex = trimmed.indexOf('\r\n\r\n');
      const headerEndIndexLF = trimmed.indexOf('\n\n');

      let headersStr: string;
      let partContent: string;

      if (headerEndIndex !== -1) {
        headersStr = trimmed.substring(0, headerEndIndex);
        partContent = trimmed.substring(headerEndIndex + 4);
      } else if (headerEndIndexLF !== -1) {
        headersStr = trimmed.substring(0, headerEndIndexLF);
        partContent = trimmed.substring(headerEndIndexLF + 2);
      } else {
        // No headers, entire thing is content
        partContent = trimmed;
        headersStr = '';
      }

      // Parse part headers
      const partHeaders = HTTPUtil.parseHeaders(headersStr);

      // Extract content-disposition
      const contentDisposition = partHeaders.get('Content-Disposition') || '';
      let name: string | undefined;
      let filename: string | undefined;

      // Parse content-disposition for name and filename
      const nameMatch = contentDisposition.match(/name="([^"]+)"/);
      if (nameMatch) {
        name = nameMatch[1];
      }

      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }

      const partContentType = partHeaders.get('Content-Type');

      parts.push({
        name,
        filename,
        contentType: partContentType,
        content: partContent,
      });
    }

    return parts;
  }
}
