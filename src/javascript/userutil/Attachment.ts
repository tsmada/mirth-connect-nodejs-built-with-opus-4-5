/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/Attachment.java
 *
 * Purpose: Store and retrieve details about message attachments such as ID, MIME type, and content.
 *
 * Key behaviors to replicate:
 * - Store attachment ID, content (as Buffer/bytes), and MIME type
 * - Support string content with charset encoding
 * - Generate attachment replacement tokens
 */

/**
 * Used to store and retrieve details about message attachments such as the ID, MIME type, and
 * content.
 */
export class Attachment {
  private id: string | undefined;
  private content: Buffer | undefined;
  private type: string | undefined;

  /**
   * Instantiates a new Attachment with no ID, content, or MIME type.
   */
  constructor();

  /**
   * Instantiates a new Attachment.
   *
   * @param id - The unique ID of the attachment.
   * @param content - The content (Buffer/byte array) to store for the attachment.
   * @param type - The MIME type of the attachment.
   */
  constructor(id: string, content: Buffer, type: string);

  /**
   * Instantiates a new Attachment with String data using UTF-8 charset encoding.
   *
   * @param id - The unique ID of the attachment.
   * @param content - The string representation of the attachment content.
   * @param type - The MIME type of the attachment.
   */
  constructor(id: string, content: string, type: string);

  /**
   * Instantiates a new Attachment with String data and a given charset encoding.
   *
   * @param id - The unique ID of the attachment.
   * @param content - The string representation of the attachment content.
   * @param charset - The charset encoding to convert the string to bytes with.
   * @param type - The MIME type of the attachment.
   */
  constructor(id: string, content: string, charset: string, type: string);

  constructor(id?: string, content?: Buffer | string, charsetOrType?: string, type?: string) {
    if (id === undefined) {
      // No-arg constructor
      return;
    }

    this.id = id;

    if (typeof content === 'string') {
      if (type !== undefined) {
        // Four-arg constructor: (id, content, charset, type)
        this.setContentString(content, charsetOrType);
        this.type = type;
      } else {
        // Three-arg constructor with string content: (id, content, type)
        this.setContentString(content);
        this.type = charsetOrType;
      }
    } else if (Buffer.isBuffer(content)) {
      // Three-arg constructor with Buffer content: (id, content, type)
      this.content = content;
      this.type = charsetOrType;
    }
  }

  /**
   * Returns the unique replacement token for the attachment. This token should replace the
   * attachment content in the message string, and will be used to re-attach the attachment
   * content in the outbound message before it is sent to a downstream system.
   *
   * @returns The unique replacement token for the attachment.
   */
  getAttachmentId(): string {
    return `\${ATTACH:${this.id}}`;
  }

  /**
   * Returns the unique ID for the attachment.
   *
   * @returns The unique ID for the attachment.
   */
  getId(): string | undefined {
    return this.id;
  }

  /**
   * Sets the unique ID for the attachment.
   *
   * @param id - The unique ID to use for the attachment.
   */
  setId(id: string): void {
    this.id = id;
  }

  /**
   * Returns the content of the attachment as a Buffer (byte array).
   *
   * @returns The content of the attachment as a Buffer.
   */
  getContent(): Buffer | undefined {
    return this.content;
  }

  /**
   * Returns the content of the attachment as a string, using UTF-8 encoding.
   *
   * @returns The content of the attachment as a string, using UTF-8 encoding.
   */
  getContentString(): string;

  /**
   * Returns the content of the attachment as a string, using the specified charset encoding.
   *
   * @param charset - The charset encoding to convert the content bytes to a string with.
   * @returns The content of the attachment as a string, using the specified charset encoding.
   */
  getContentString(charset: string): string;

  getContentString(charset?: string): string {
    if (this.content === undefined) {
      return '';
    }

    const encoding = charset ?? 'utf-8';
    return this.decodeBuffer(this.content, encoding);
  }

  /**
   * Sets the content of the attachment.
   *
   * @param content - The content (Buffer/byte array) to use for the attachment.
   */
  setContent(content: Buffer): void {
    this.content = content;
  }

  /**
   * Sets the content of the attachment, using UTF-8 encoding.
   *
   * @param content - The string representation of the attachment content.
   */
  setContentString(content: string): void;

  /**
   * Sets the content of the attachment, using the specified charset encoding.
   *
   * @param content - The string representation of the attachment content.
   * @param charset - The charset encoding to convert the string to bytes with.
   */
  setContentString(content: string, charset?: string): void;

  setContentString(content: string, charset?: string): void {
    const encoding = charset ?? 'utf-8';
    this.content = this.encodeString(content, encoding);
  }

  /**
   * Returns the MIME type of the attachment.
   *
   * @returns The MIME type of the attachment.
   */
  getType(): string | undefined {
    return this.type;
  }

  /**
   * Sets the MIME type for the attachment.
   *
   * @param type - The MIME type to set for the attachment.
   */
  setType(type: string): void {
    this.type = type;
  }

  /**
   * Encode a string to a Buffer using the specified charset.
   * Supports common Java charset names.
   */
  private encodeString(str: string, charset: string): Buffer {
    const normalizedCharset = this.normalizeCharset(charset);

    // For UTF-8, use native Buffer encoding
    if (normalizedCharset === 'utf-8' || normalizedCharset === 'utf8') {
      return Buffer.from(str, 'utf-8');
    }

    // For latin1/iso-8859-1, use native Buffer encoding
    if (
      normalizedCharset === 'latin1' ||
      normalizedCharset === 'iso-8859-1' ||
      normalizedCharset === 'iso88591'
    ) {
      return Buffer.from(str, 'latin1');
    }

    // For ASCII, use native Buffer encoding
    if (normalizedCharset === 'ascii' || normalizedCharset === 'us-ascii') {
      return Buffer.from(str, 'ascii');
    }

    // For UTF-16 variants, use TextEncoder if available
    if (normalizedCharset === 'utf-16' || normalizedCharset === 'utf16') {
      // UTF-16 LE (default on most systems)
      return Buffer.from(str, 'utf16le');
    }

    if (normalizedCharset === 'utf-16le' || normalizedCharset === 'utf16le') {
      return Buffer.from(str, 'utf16le');
    }

    // Default to UTF-8
    return Buffer.from(str, 'utf-8');
  }

  /**
   * Decode a Buffer to a string using the specified charset.
   * Supports common Java charset names.
   */
  private decodeBuffer(buffer: Buffer, charset: string): string {
    const normalizedCharset = this.normalizeCharset(charset);

    // For UTF-8, use native Buffer decoding
    if (normalizedCharset === 'utf-8' || normalizedCharset === 'utf8') {
      return buffer.toString('utf-8');
    }

    // For latin1/iso-8859-1, use native Buffer decoding
    if (
      normalizedCharset === 'latin1' ||
      normalizedCharset === 'iso-8859-1' ||
      normalizedCharset === 'iso88591'
    ) {
      return buffer.toString('latin1');
    }

    // For ASCII, use native Buffer decoding
    if (normalizedCharset === 'ascii' || normalizedCharset === 'us-ascii') {
      return buffer.toString('ascii');
    }

    // For UTF-16 variants
    if (
      normalizedCharset === 'utf-16' ||
      normalizedCharset === 'utf16' ||
      normalizedCharset === 'utf-16le' ||
      normalizedCharset === 'utf16le'
    ) {
      return buffer.toString('utf16le');
    }

    // Default to UTF-8
    return buffer.toString('utf-8');
  }

  /**
   * Normalize charset name to lowercase and handle common Java aliases.
   */
  private normalizeCharset(charset: string): string {
    return charset.toLowerCase().replace(/[_-]/g, '');
  }
}
