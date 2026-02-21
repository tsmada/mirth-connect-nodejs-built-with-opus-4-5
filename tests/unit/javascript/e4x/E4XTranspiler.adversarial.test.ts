/**
 * Adversarial tests for E4X transpiler edge cases:
 * - P1-1: Double-quote escaping in XML attribute values
 * - P1-2: Template literal ${...} interpolation zones
 * - P1-3: Regex literal detection (avoid transpiling inside /regex/)
 *
 * These tests target specific bugs in escapeForString and isInsideStringOrComment.
 */

import { E4XTranspiler } from '../../../../src/javascript/e4x/E4XTranspiler.js';

describe('E4XTranspiler adversarial', () => {
  let transpiler: E4XTranspiler;

  beforeEach(() => {
    transpiler = new E4XTranspiler();
  });

  // --- P1-1: Double-quote escaping in XML attribute values ---

  describe('P1-1: double-quote escaping in computed attr tags', () => {
    it('should escape double quotes in static attribute values via &quot;', () => {
      // When source E4X has single-quoted attribute containing double quotes,
      // the computed attr path wraps values in double quotes. Without &quot;
      // escaping, the output XML is malformed: title="He said "hello""
      const input = `var x = <tag title='He said "hello"' dynamic={someVar}/>;`;
      const result = transpiler.transpile(input).code;

      // The static attribute value should contain &quot; not raw "
      expect(result).toContain('&quot;');
      expect(result).toContain('He said &quot;hello&quot;');
      // The dynamic attribute should still use String() conversion
      expect(result).toContain('String(someVar)');
    });

    it('should preserve existing &quot; entities in attribute values', () => {
      // If the source already has &quot; entities, they should survive round-trip.
      // The &amp; in &quot; gets escaped to \\&quot; by escapeForString's \\ rule,
      // but the original & passes through escapeForString unchanged (it doesn't
      // escape &), so &quot; is preserved in the output.
      const input = `var x = <tag value='pre&quot;post' dynamic={v}/>;`;
      const result = transpiler.transpile(input).code;

      // &quot; in the original should be preserved
      expect(result).toContain('XMLProxy.create');
      expect(result).toContain('&quot;');
      // The generated code wraps in single-quoted JS strings with escaped inner quotes.
      // The actual result contains: ' value="pre&quot;post"' (JS single-quoted string)
      // where the " are literal in the output (not backslash-escaped at the JS level,
      // because the outer string uses single quotes).
      expect(result).toContain('value="pre&quot;post"');
    });
  });

  // --- P1-2: Template literal ${...} interpolation zones ---

  describe('P1-2: template literal interpolation zones', () => {
    it('should transpile E4X property access inside template literal interpolation', () => {
      // E4X inside `${...}` is CODE, not string. msg.PID should be transpiled.
      // Before the fix, isInsideStringOrComment treated backtick strings as
      // monolithic, so ${msg.PID} was "inside a string" and skipped.
      const input = 'var s = `Patient: ${msg..PID}`;';
      const result = transpiler.transpile(input).code;

      // The descendant access inside ${...} should be transpiled
      expect(result).toContain("descendants('PID')");
    });

    it('should transpile attribute access inside template literal interpolation', () => {
      const input = 'var s = `Version: ${msg.@version}`;';
      const result = transpiler.transpile(input).code;

      // The attribute access inside ${...} should be transpiled
      expect(result).toContain("attr('version')");
    });

    it('should handle nested template literals inside interpolation', () => {
      // Nested template: `${`${msg..PID}`}` — the inner ${} is code
      const input = 'var s = `outer ${`inner ${msg..PID}`}`;';
      const result = transpiler.transpile(input).code;

      // The descendant access in the nested interpolation should be transpiled
      expect(result).toContain("descendants('PID')");
    });
  });

  // --- P1-3: Regex literal detection ---

  describe('P1-3: regex literal detection', () => {
    it('should NOT transpile E4X-like patterns inside regex literals', () => {
      // /msg\.PID/ is a regex literal — the .PID inside should NOT be
      // transpiled as E4X property access
      const input = 'var re = /msg\\.PID/;';
      const result = transpiler.transpile(input).code;

      // The regex should be left untouched — no .get('PID') or similar
      expect(result).toBe(input);
    });

    it('should NOT transpile E4X-like patterns inside regex with flags', () => {
      const input = "var re = /msg\\.attr\\('version'\\)/gi;";
      const result = transpiler.transpile(input).code;

      // The regex content should not be transpiled
      expect(result).toBe(input);
    });

    it('should treat / as division when preceded by an identifier (not regex)', () => {
      // count = x / msg..PID.length() — the / here is division, not regex start
      // msg..PID should still be transpiled since it's code, not inside a regex
      const input = "var result = x / msg..PID;";
      const result = transpiler.transpile(input).code;

      // msg..PID should be transpiled as descendant access
      expect(result).toContain("descendants('PID')");
      // The division operator should remain
      expect(result).toContain('/ ');
    });
  });

  // --- Combined / cross-cutting scenarios ---

  describe('combined scenarios', () => {
    it('should transpile E4X outside string but NOT inside string (same pattern)', () => {
      // The string contains "<OBX/>" which should NOT be transpiled.
      // The code reference msg.OBX should be transpiled.
      const input = 'var s = "<OBX/>"; var x = msg..OBX;';
      const result = transpiler.transpile(input).code;

      // The string literal should be preserved as-is
      expect(result).toContain('"<OBX/>"');
      // The code reference should be transpiled
      expect(result).toContain("descendants('OBX')");
    });

    it('should NOT transpile E4X inside multiline block comment', () => {
      const input = '/* msg..OBX */ var x = 1;';
      const result = transpiler.transpile(input).code;

      // msg..OBX is inside a block comment, should not be transpiled
      expect(result).not.toContain("descendants('OBX')");
      // The comment should remain intact
      expect(result).toContain('/* msg..OBX */');
    });
  });
});
