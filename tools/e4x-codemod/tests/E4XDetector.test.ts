import * as fs from 'fs';
import * as path from 'path';
import { E4XDetector } from '../core/E4XDetector.js';
import type { E4XPatternType } from '../types.js';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name), 'utf-8');

describe('E4XDetector', () => {
  let detector: E4XDetector;

  beforeEach(() => {
    detector = new E4XDetector();
  });

  // ── hasE4X quick check ─────────────────────────────────────────────

  describe('hasE4X()', () => {
    it('returns true for scripts with E4X syntax', () => {
      const source = readFixture('simple-e4x.js');
      expect(detector.hasE4X(source)).toBe(true);
    });

    it('returns true for scripts with only unsupported patterns', () => {
      const source = 'var ns = new Namespace("urn:hl7-org:v3");';
      expect(detector.hasE4X(source)).toBe(true);
    });

    it('returns false for plain JavaScript', () => {
      const source = readFixture('no-e4x.js');
      expect(detector.hasE4X(source)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(detector.hasE4X('')).toBe(false);
    });

    it('detects descendant access', () => {
      expect(detector.hasE4X('var x = msg..PID;')).toBe(true);
    });

    it('detects for each', () => {
      expect(detector.hasE4X('for each (var x in list) {}')).toBe(true);
    });

    it('detects new XML constructor', () => {
      expect(detector.hasE4X('var m = new XML(str);')).toBe(true);
    });

    it('detects attribute access', () => {
      expect(detector.hasE4X('var v = msg.@version;')).toBe(true);
    });

    it('detects default xml namespace', () => {
      expect(detector.hasE4X('default xml namespace = "uri";')).toBe(true);
    });

    it('detects importClass', () => {
      expect(detector.hasE4X('importClass(java.util.Date);')).toBe(true);
    });

    it('detects XML settings', () => {
      expect(detector.hasE4X('XML.ignoreWhitespace = true;')).toBe(true);
      expect(detector.hasE4X('XML.prettyPrinting = false;')).toBe(true);
    });
  });

  // ── detect() - simple-e4x.js ──────────────────────────────────────

  describe('detect() with simple-e4x.js', () => {
    let patterns: ReturnType<E4XDetector['detect']>;

    beforeEach(() => {
      patterns = detector.detect(readFixture('simple-e4x.js'));
    });

    it('detects xml-constructor pattern', () => {
      const found = patterns.filter(p => p.type === 'xml-constructor');
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found[0]!.runtimeHandled).toBe(true);
      expect(found[0]!.confidence).toBe('definite');
    });

    it('detects descendant-access pattern', () => {
      const found = patterns.filter(p => p.type === 'descendant-access');
      expect(found.length).toBeGreaterThanOrEqual(2); // msg..PID and msg..OBX
      expect(found[0]!.runtimeHandled).toBe(true);
    });

    it('detects attribute-read pattern', () => {
      const found = patterns.filter(p => p.type === 'attribute-read');
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found[0]!.runtimeHandled).toBe(true);
    });

    it('detects xml-literal pattern', () => {
      const found = patterns.filter(p => p.type === 'xml-literal');
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found[0]!.confidence).toBe('likely');
      expect(found[0]!.runtimeHandled).toBe(true);
    });

    it('detects for-each pattern', () => {
      const found = patterns.filter(p => p.type === 'for-each');
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found[0]!.runtimeHandled).toBe(true);
      expect(found[0]!.confidence).toBe('definite');
    });

    it('detects attribute-write pattern', () => {
      const found = patterns.filter(p => p.type === 'attribute-write');
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found[0]!.runtimeHandled).toBe(true);
    });

    it('detects default-namespace pattern', () => {
      const found = patterns.filter(p => p.type === 'default-namespace');
      expect(found.length).toBe(1);
      expect(found[0]!.runtimeHandled).toBe(true);
    });

    it('marks all patterns as runtime-handled', () => {
      for (const p of patterns) {
        expect(p.runtimeHandled).toBe(true);
      }
    });

    it('includes correct line numbers', () => {
      // "var msg = new XML(" is on line 2
      const xmlCtor = patterns.find(p => p.type === 'xml-constructor');
      expect(xmlCtor).toBeDefined();
      expect(xmlCtor!.line).toBe(2);
    });
  });

  // ── detect() - unsupported-patterns.js ─────────────────────────────

  describe('detect() with unsupported-patterns.js', () => {
    let patterns: ReturnType<E4XDetector['detect']>;

    beforeEach(() => {
      patterns = detector.detect(readFixture('unsupported-patterns.js'));
    });

    it('detects namespace-constructor pattern', () => {
      const found = patterns.filter(p => p.type === 'namespace-constructor');
      expect(found.length).toBeGreaterThanOrEqual(2); // 1-arg and 2-arg
      expect(found[0]!.runtimeHandled).toBe(false);
      expect(found[0]!.confidence).toBe('definite');
    });

    it('detects qname-constructor pattern', () => {
      const found = patterns.filter(p => p.type === 'qname-constructor');
      expect(found.length).toBeGreaterThanOrEqual(2);
      expect(found[0]!.runtimeHandled).toBe(false);
    });

    it('detects xml-settings pattern', () => {
      const found = patterns.filter(p => p.type === 'xml-settings');
      expect(found.length).toBe(3); // ignoreWhitespace, ignoreComments, prettyPrinting
      expect(found[0]!.runtimeHandled).toBe(false);
    });

    it('detects import-class pattern', () => {
      const found = patterns.filter(p => p.type === 'import-class');
      expect(found.length).toBe(2); // two importClass calls
      expect(found[0]!.runtimeHandled).toBe(false);
    });

    it('also detects runtime-handled patterns in mixed scripts', () => {
      // The file has msg..PID, msg.@version, new XML(
      const runtimePatterns = patterns.filter(p => p.runtimeHandled);
      expect(runtimePatterns.length).toBeGreaterThan(0);
    });

    it('has both runtime and non-runtime patterns', () => {
      const runtimeCount = patterns.filter(p => p.runtimeHandled).length;
      const extendedCount = patterns.filter(p => !p.runtimeHandled).length;
      expect(runtimeCount).toBeGreaterThan(0);
      expect(extendedCount).toBeGreaterThan(0);
    });
  });

  // ── detect() - no-e4x.js (false positive prevention) ──────────────

  describe('detect() with no-e4x.js', () => {
    let patterns: ReturnType<E4XDetector['detect']>;

    beforeEach(() => {
      patterns = detector.detect(readFixture('no-e4x.js'));
    });

    it('detects 0 patterns in plain JavaScript', () => {
      expect(patterns.length).toBe(0);
    });

    it('does not confuse comparison operators with xml-literal', () => {
      // "patientName.length > 5" should NOT trigger xml-literal
      const xmlLiterals = patterns.filter(p => p.type === 'xml-literal');
      expect(xmlLiterals.length).toBe(0);
    });

    it('does not confuse template literals with E4X', () => {
      // `Hello ${patientName}` should NOT trigger any pattern
      expect(patterns.length).toBe(0);
    });

    it('does not confuse regex with E4X', () => {
      // /^[A-Z]{2}\d+$/ should NOT trigger any pattern
      expect(patterns.length).toBe(0);
    });
  });

  // ── detect() - complex-e4x.js ─────────────────────────────────────

  describe('detect() with complex-e4x.js', () => {
    let patterns: ReturnType<E4XDetector['detect']>;

    beforeEach(() => {
      patterns = detector.detect(readFixture('complex-e4x.js'));
    });

    it('detects filter-predicate pattern', () => {
      const found = patterns.filter(p => p.type === 'filter-predicate');
      expect(found.length).toBeGreaterThanOrEqual(1);
    });

    it('detects wildcard-attribute pattern', () => {
      const found = patterns.filter(p => p.type === 'wildcard-attribute');
      expect(found.length).toBeGreaterThanOrEqual(1);
    });

    it('detects wildcard-element pattern', () => {
      const found = patterns.filter(p => p.type === 'wildcard-element');
      expect(found.length).toBeGreaterThanOrEqual(1);
    });

    it('detects delete-property pattern', () => {
      const found = patterns.filter(p => p.type === 'delete-property');
      expect(found.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── String/comment immunity ────────────────────────────────────────

  describe('string and comment immunity', () => {
    it('ignores patterns inside single-quoted strings', () => {
      const source = "var x = 'msg..PID is descendant access';";
      const patterns = detector.detect(source);
      expect(patterns.filter(p => p.type === 'descendant-access').length).toBe(0);
    });

    it('ignores patterns inside double-quoted strings', () => {
      const source = 'var x = "new XML(str)";';
      const patterns = detector.detect(source);
      expect(patterns.filter(p => p.type === 'xml-constructor').length).toBe(0);
    });

    it('ignores patterns inside line comments', () => {
      const source = '// var x = msg..PID;';
      const patterns = detector.detect(source);
      expect(patterns.filter(p => p.type === 'descendant-access').length).toBe(0);
    });

    it('ignores patterns inside block comments', () => {
      const source = '/* msg..PID */ var y = 1;';
      const patterns = detector.detect(source);
      expect(patterns.filter(p => p.type === 'descendant-access').length).toBe(0);
    });

    it('ignores patterns inside multi-line block comments', () => {
      const source = '/*\nmsg..PID\nnew XML(str)\n*/ var y = 1;';
      const patterns = detector.detect(source);
      expect(patterns.length).toBe(0);
    });

    it('detects patterns after block comment ends', () => {
      const source = '/* comment */ var x = msg..PID;';
      const patterns = detector.detect(source);
      expect(patterns.filter(p => p.type === 'descendant-access').length).toBe(1);
    });
  });

  // ── Confidence levels ──────────────────────────────────────────────

  describe('confidence levels', () => {
    it('assigns definite confidence to unambiguous patterns', () => {
      const definiteTypes: E4XPatternType[] = [
        'descendant-access', 'attribute-read', 'for-each', 'xml-constructor',
        'default-namespace', 'namespace-constructor', 'qname-constructor',
        'xml-settings', 'import-class', 'wildcard-attribute', 'delete-property',
      ];
      for (const type of definiteTypes) {
        const rule = (E4XDetector as any).PATTERN_RULES.find(
          (r: any) => r.type === type
        );
        if (rule) {
          expect(rule.confidence).toBe('definite');
        }
      }
    });

    it('assigns likely confidence to potentially ambiguous patterns', () => {
      const likelyTypes: E4XPatternType[] = [
        'xml-literal', 'filter-predicate', 'xml-append', 'wildcard-element',
      ];
      for (const type of likelyTypes) {
        const rule = (E4XDetector as any).PATTERN_RULES.find(
          (r: any) => r.type === type
        );
        if (rule) {
          expect(rule.confidence).toBe('likely');
        }
      }
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty source', () => {
      expect(detector.detect('').length).toBe(0);
    });

    it('handles source with only whitespace', () => {
      expect(detector.detect('   \n\n   ').length).toBe(0);
    });

    it('detects multiple patterns on the same line', () => {
      const source = 'var x = msg..PID.@version;';
      const patterns = detector.detect(source);
      const types = patterns.map(p => p.type);
      expect(types).toContain('descendant-access');
      expect(types).toContain('attribute-read');
    });

    it('provides correct column numbers', () => {
      const source = 'var x = msg..PID;';
      const patterns = detector.detect(source);
      const desc = patterns.find(p => p.type === 'descendant-access');
      expect(desc).toBeDefined();
      // "msg..PID" starts at index 8
      expect(desc!.column).toBe(8);
    });

    it('does not double-detect attribute-write and attribute-read at same location', () => {
      const source = 'msg.@version = "2.5";';
      const patterns = detector.detect(source);
      // Should detect attribute-write (which includes .@version =)
      const writes = patterns.filter(p => p.type === 'attribute-write');
      expect(writes.length).toBe(1);
    });
  });
});
