/**
 * Edge case tests for E4X transpiler bug fixes.
 *
 * BUG 1: Self-closing tag indexOf vs regex offset
 * BUG 2: processXMLTag first-match-in-string skips all
 * BUG 3: convertEmbeddedToConcat brace tracker ignores string literals
 * BUG 4: Attribute write regex overcapture
 * BUG 5: Missing backtick escape in escapeForString
 */

import { E4XTranspiler } from '../../../../src/javascript/e4x/E4XTranspiler.js';

describe('E4XTranspiler edge cases', () => {
  let transpiler: E4XTranspiler;

  beforeEach(() => {
    transpiler = new E4XTranspiler();
  });

  describe('BUG 1 — self-closing tag indexOf vs regex offset', () => {
    it('should transpile only the bare self-closing tag when same tag appears inside a string first', () => {
      // The same <br/> appears inside a string AND outside.
      // With indexOf, the second occurrence gets the wrong position check.
      const code = 'var s = "<br/>"; var x = <br/>';
      const result = transpiler.transpile(code).code;

      // The string literal should be untouched
      expect(result).toContain('"<br/>"');
      // The bare XML tag should be transpiled
      expect(result).toContain("XMLProxy.create('<br/>')");
    });

    it('should transpile both bare self-closing tags when none are in strings', () => {
      const code = 'var a = <br/>; var b = <br/>';
      const result = transpiler.transpile(code).code;

      // Both should be transpiled — count occurrences of XMLProxy.create
      const matches = result.match(/XMLProxy\.create/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    });

    it('should leave self-closing tag untouched when only inside a string', () => {
      const code = "var s = '<item attr=\"val\"/>';";
      const result = transpiler.transpile(code).code;

      // Should remain as-is inside the string
      expect(result).toContain("'<item attr=\"val\"/>'");
      expect(result).not.toContain('XMLProxy.create');
    });

    it('should handle self-closing tag inside double-quoted string with bare one after', () => {
      const code = 'var s = "<PID/>"; var xml = <PID/>';
      const result = transpiler.transpile(code).code;

      expect(result).toContain('"<PID/>"');
      expect(result).toContain("XMLProxy.create('<PID/>')");
    });
  });

  describe('BUG 2 — processXMLTag skips all after string-interior match', () => {
    it('should transpile bare XML tag even when same tag appears inside a string first', () => {
      // Opening/closing tag inside string first, then a bare one
      const code = 'var s = "<msg>hello</msg>"; var x = <msg>world</msg>';
      const result = transpiler.transpile(code).code;

      // The string literal should be untouched
      expect(result).toContain('"<msg>hello</msg>"');
      // The bare XML tag should be transpiled
      expect(result).toContain("XMLProxy.create('<msg>world</msg>')");
    });

    it('should transpile a bare XML tag when a different tag is inside a string', () => {
      const code = "var s = '<root>data</root>'; var x = <item>value</item>";
      const result = transpiler.transpile(code).code;

      expect(result).toContain("'<root>data</root>'");
      expect(result).toContain("XMLProxy.create('<item>value</item>')");
    });

    it('should transpile XML tags after multiple string-interior XML snippets', () => {
      const code = 'var a = "<a>1</a>"; var b = "<b>2</b>"; var c = <c>3</c>';
      const result = transpiler.transpile(code).code;

      expect(result).toContain('"<a>1</a>"');
      expect(result).toContain('"<b>2</b>"');
      expect(result).toContain("XMLProxy.create('<c>3</c>')");
    });

    it('should transpile embedded expressions in tag after string-interior tag', () => {
      const code = 'var s = "<PID>test</PID>"; var x = <PID>{value}</PID>';
      const result = transpiler.transpile(code).code;

      expect(result).toContain('"<PID>test</PID>"');
      expect(result).toContain('XMLProxy.create');
      expect(result).toContain('String(value)');
    });
  });

  describe('BUG 3 — brace tracker ignores string literals in convertEmbeddedToConcat', () => {
    it('should handle braces inside double-quoted strings within expressions', () => {
      // The } inside "value}" should NOT close the expression
      const code = '<tag>{format("value}")}</tag>';
      const result = transpiler.transpile(code).code;

      expect(result).toContain('String(format("value}"))');
      // Should have proper tag wrapping
      expect(result).toContain("XMLProxy.create('<tag>'");
      expect(result).toContain("'</tag>')");
    });

    it('should handle braces inside single-quoted strings within expressions', () => {
      const code = "<tag>{format('val}ue')}</tag>";
      const result = transpiler.transpile(code).code;

      expect(result).toContain("String(format('val}ue'))");
    });

    it('should handle escaped quotes inside strings within expressions', () => {
      const code = '<tag>{format("val\\"}")}</tag>';
      const result = transpiler.transpile(code).code;

      // The escaped quote should not end the string tracking
      expect(result).toContain('String(format("val\\"}")');
    });

    it('should handle nested braces in object literals within expressions', () => {
      const code = '<tag>{JSON.stringify({a: 1})}</tag>';
      const result = transpiler.transpile(code).code;

      expect(result).toContain('String(JSON.stringify({a: 1}))');
    });

    it('should handle backtick template literals inside expressions', () => {
      const code = '<tag>{`hello ${name}`}</tag>';
      const result = transpiler.transpile(code).code;

      // The expression should be captured as a whole
      expect(result).toContain('String(`hello ${name}`)');
    });

    it('should handle multiple expressions with string-interior braces', () => {
      const code = '<root>{format("a}")}-{format("b}")}</root>';
      const result = transpiler.transpile(code).code;

      expect(result).toContain('String(format("a}"))');
      expect(result).toContain('String(format("b}"))');
    });
  });

  describe('BUG 4 — attribute write regex overcapture', () => {
    it('should correctly capture value terminated by semicolon', () => {
      const code = 'msg.@version = "2.5";';
      const result = transpiler.transpile(code).code;

      expect(result).toContain("setAttr('version', \"2.5\")");
      // Should NOT capture the semicolon as part of the value
      expect(result).toMatch(/setAttr\('version', "2\.5"\)/);
    });

    it('should correctly capture value terminated by newline', () => {
      const code = 'msg.@version = "2.5"\nmsg.@type = "ADT"';
      const result = transpiler.transpile(code).code;

      expect(result).toContain("setAttr('version', \"2.5\")");
      expect(result).toContain("setAttr('type', \"ADT\")");
    });

    it('should correctly capture value terminated by closing paren', () => {
      const code = 'foo(msg.@id = "123")';
      const result = transpiler.transpile(code).code;

      expect(result).toContain("setAttr('id', \"123\")");
    });

    it('should not match equality checks (==, !=)', () => {
      const code = 'if (msg.@version == "2.5") {}';
      const result = transpiler.transpile(code).code;

      // Should become attr() read, not setAttr()
      expect(result).not.toContain('setAttr');
      expect(result).toContain("attr('version')");
    });
  });

  describe('BUG 5 — missing backtick escape in escapeForString', () => {
    it('should escape backticks in XML content', () => {
      const code = '<tag>hello `world`</tag>';
      const result = transpiler.transpile(code).code;

      // Backticks should be escaped in the string literal
      expect(result).toContain('\\`world\\`');
      expect(result).toContain('XMLProxy.create');
    });

    it('should escape backticks in self-closing tag attributes', () => {
      const code = '<item name="`test`"/>';
      const result = transpiler.transpile(code).code;

      expect(result).toContain('\\`test\\`');
    });

    it('should handle backticks alongside other escaped characters', () => {
      const code = "<tag>line1\\nline2 `code`</tag>";
      const result = transpiler.transpile(code).code;

      expect(result).toContain('\\`code\\`');
      expect(result).toContain('XMLProxy.create');
    });
  });
});
