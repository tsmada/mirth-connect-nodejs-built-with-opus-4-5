import { HL7EscapeHandler } from '../../../../src/datatypes/hl7v2/HL7EscapeHandler.js';

describe('HL7EscapeHandler', () => {
  let handler: HL7EscapeHandler;

  beforeEach(() => {
    handler = new HL7EscapeHandler();
  });

  // --- escape() tests ---

  describe('escape()', () => {
    it('should escape field separator | to \\F\\', () => {
      expect(handler.escape('A|B')).toBe('A\\F\\B');
    });

    it('should escape component separator ^ to \\S\\', () => {
      expect(handler.escape('A^B')).toBe('A\\S\\B');
    });

    it('should escape repetition separator ~ to \\R\\', () => {
      expect(handler.escape('A~B')).toBe('A\\R\\B');
    });

    it('should escape subcomponent separator & to \\T\\', () => {
      expect(handler.escape('A&B')).toBe('A\\T\\B');
    });

    it('should escape the escape character \\ to \\E\\', () => {
      expect(handler.escape('A\\B')).toBe('A\\E\\B');
    });

    it('should leave text with no special chars unchanged', () => {
      expect(handler.escape('Hello World 123')).toBe('Hello World 123');
    });

    it('should escape multiple special chars in one string', () => {
      expect(handler.escape('A|B^C~D&E\\F')).toBe(
        'A\\F\\B\\S\\C\\R\\D\\T\\E\\E\\F'
      );
    });

    it('should escape the escape char before delimiters to prevent double-escaping', () => {
      // The string "\\|" should become "\\E\\\\F\\" not "\\E\\F\\"
      // i.e., the \ becomes \E\ and then | becomes \F\
      const result = handler.escape('\\|');
      expect(result).toBe('\\E\\\\F\\');
      // Round-trip should recover original
      expect(handler.unescape(result)).toBe('\\|');
    });
  });

  // --- unescape() tests ---

  describe('unescape()', () => {
    it('should unescape \\F\\ to |', () => {
      expect(handler.unescape('A\\F\\B')).toBe('A|B');
    });

    it('should unescape \\S\\ to ^', () => {
      expect(handler.unescape('A\\S\\B')).toBe('A^B');
    });

    it('should unescape \\R\\ to ~', () => {
      expect(handler.unescape('A\\R\\B')).toBe('A~B');
    });

    it('should unescape \\T\\ to &', () => {
      expect(handler.unescape('A\\T\\B')).toBe('A&B');
    });

    it('should unescape \\E\\ to \\', () => {
      expect(handler.unescape('A\\E\\B')).toBe('A\\B');
    });

    it('should unescape \\X0D\\ to carriage return', () => {
      expect(handler.unescape('A\\X0D\\B')).toBe('A\rB');
    });

    it('should unescape \\X0A\\ to newline', () => {
      expect(handler.unescape('A\\X0A\\B')).toBe('A\nB');
    });

    it('should unescape \\X0A0D\\ to \\n\\r (multi-byte hex)', () => {
      expect(handler.unescape('A\\X0A0D\\B')).toBe('A\n\rB');
    });

    it('should unescape \\X414243\\ to ABC', () => {
      expect(handler.unescape('\\X414243\\')).toBe('ABC');
    });

    it('should handle mixed escape sequences', () => {
      expect(handler.unescape('A\\F\\B\\S\\C\\X41\\D')).toBe('A|B^CAD');
    });

    it('should leave unknown sequences as-is', () => {
      // Odd-length hex (not valid hex pairs) won't match the regex
      expect(handler.unescape('A\\Z\\B')).toBe('A\\Z\\B');
    });

    it('should leave text with no escape sequences unchanged', () => {
      expect(handler.unescape('Hello World 123')).toBe('Hello World 123');
    });
  });

  // --- Round-trip tests ---

  describe('round-trip', () => {
    it('should return original after escape then unescape', () => {
      const original = 'Patient|Name^First~Repeat&Sub\\Escape';
      expect(handler.unescape(handler.escape(original))).toBe(original);
    });

    it('should handle empty string round-trip', () => {
      expect(handler.unescape(handler.escape(''))).toBe('');
    });

    it('should handle string with only special chars', () => {
      const original = '|^~&\\';
      expect(handler.unescape(handler.escape(original))).toBe(original);
    });
  });

  // --- Custom encoding characters ---

  describe('custom encoding characters', () => {
    it('should work with custom delimiters', () => {
      const custom = new HL7EscapeHandler('#', '!', '@', '%', '$');
      expect(custom.escape('A!B')).toBe('A#F#B');
      expect(custom.escape('A@B')).toBe('A#S#B');
      expect(custom.escape('A%B')).toBe('A#R#B');
      expect(custom.escape('A$B')).toBe('A#T#B');
      expect(custom.escape('A#B')).toBe('A#E#B');
    });

    it('should unescape with custom delimiters', () => {
      const custom = new HL7EscapeHandler('#', '!', '@', '%', '$');
      expect(custom.unescape('A#F#B')).toBe('A!B');
      expect(custom.unescape('A#S#B')).toBe('A@B');
      expect(custom.unescape('A#R#B')).toBe('A%B');
      expect(custom.unescape('A#T#B')).toBe('A$B');
      expect(custom.unescape('A#E#B')).toBe('A#B');
    });

    it('should round-trip with custom delimiters', () => {
      const custom = new HL7EscapeHandler('#', '!', '@', '%', '$');
      const original = 'Test!Value@Here%Now$End#Done';
      expect(custom.unescape(custom.escape(original))).toBe(original);
    });
  });
});
