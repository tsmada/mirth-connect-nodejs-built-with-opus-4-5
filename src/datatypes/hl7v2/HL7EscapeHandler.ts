/**
 * HL7v2 escape sequence handler.
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/XMLEncodedHL7Handler.java
 *
 * Handles the 6 standard HL7v2 escape sequences:
 *   \F\ = field separator       \S\ = component separator
 *   \R\ = repetition separator  \T\ = subcomponent separator
 *   \E\ = escape character      \X{hex}\ = hex-encoded bytes
 */

export class HL7EscapeHandler {
  private readonly escapeChar: string;
  private readonly fieldSep: string;
  private readonly compSep: string;
  private readonly repSep: string;
  private readonly subSep: string;

  constructor(
    escapeChar: string = '\\',
    fieldSep: string = '|',
    compSep: string = '^',
    repSep: string = '~',
    subSep: string = '&'
  ) {
    this.escapeChar = escapeChar;
    this.fieldSep = fieldSep;
    this.compSep = compSep;
    this.repSep = repSep;
    this.subSep = subSep;
  }

  /**
   * Escape special HL7 characters in text to their escape sequences.
   * E.g., "A|B" -> "A\F\B" (with default delimiters)
   *
   * Order: escape char FIRST to avoid double-escaping.
   */
  escape(text: string): string {
    const e = this.escapeChar;

    // Escape the escape character first
    let result = text.replaceAll(this.escapeChar, `${e}E${e}`);

    // Then escape delimiters
    result = result.replaceAll(this.fieldSep, `${e}F${e}`);
    result = result.replaceAll(this.compSep, `${e}S${e}`);
    result = result.replaceAll(this.repSep, `${e}R${e}`);
    result = result.replaceAll(this.subSep, `${e}T${e}`);

    return result;
  }

  /**
   * Unescape HL7 escape sequences back to their literal characters.
   * E.g., "A\F\B" -> "A|B" (with default delimiters)
   *
   * Order: \E\ LAST so restored escape chars don't interfere.
   * Unknown sequences are left as-is.
   */
  unescape(text: string): string {
    const e = this.escapeRegex(this.escapeChar);

    // Build a regex that matches all known escape sequences in one pass
    // Pattern: \X{hex}\ or \F\ or \S\ or \R\ or \T\ or \E\ or unknown \...\
    const pattern = new RegExp(
      `${e}(F|S|R|T|E|X[0-9A-Fa-f]+)${e}`,
      'g'
    );

    return text.replace(pattern, (_match: string, code: string) => {
      switch (code) {
        case 'F':
          return this.fieldSep;
        case 'S':
          return this.compSep;
        case 'R':
          return this.repSep;
        case 'T':
          return this.subSep;
        case 'E':
          return this.escapeChar;
        default:
          // Hex escape: \X{hexPairs}\
          if (code.startsWith('X')) {
            const hexStr = code.substring(1);
            if (hexStr.length > 0 && hexStr.length % 2 === 0) {
              return Buffer.from(hexStr, 'hex').toString('utf-8');
            }
          }
          // Unknown or malformed — return as-is
          return _match;
      }
    });
  }

  /** Escape regex special characters in a string for use in RegExp. */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
