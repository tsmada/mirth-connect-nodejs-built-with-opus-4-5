import * as fs from 'fs';
import * as path from 'path';
import { ScriptTransformer } from '../core/ScriptTransformer.js';
import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler.js';
import type { ScriptLocation } from '../types.js';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name), 'utf-8');

const makeLocation = (name: string): ScriptLocation => ({
  channelName: 'Test Channel',
  scriptType: 'transformer',
  filePath: `test/${name}`,
});

describe('ScriptTransformer', () => {
  let transformer: ScriptTransformer;

  beforeEach(() => {
    transformer = new ScriptTransformer();
  });

  // ── No-E4X passthrough ─────────────────────────────────────────────

  describe('no-E4X scripts', () => {
    it('passes through unchanged', () => {
      const source = readFixture('no-e4x.js');
      const result = transformer.transform(source, makeLocation('no-e4x.js'));

      expect(result.changed).toBe(false);
      expect(result.transformed).toBe(source);
      expect(result.transformedPatterns.length).toBe(0);
      expect(result.warnings.length).toBe(0);
      expect(result.untransformablePatterns.length).toBe(0);
    });

    it('preserves location metadata', () => {
      const location = makeLocation('test.js');
      const result = transformer.transform('var x = 1;', location);
      expect(result.location).toBe(location);
    });
  });

  // ── Runtime-only patterns ──────────────────────────────────────────

  describe('runtime-only patterns', () => {
    it('output matches E4XTranspiler.transpile() for simple patterns', () => {
      const source = 'var pid = msg..PID;\nvar v = msg.@version;';
      const result = transformer.transform(source, makeLocation('simple.js'));

      const directTranspiler = new E4XTranspiler();
      const directResult = directTranspiler.transpile(source);

      expect(result.transformed).toBe(directResult.code);
      expect(result.changed).toBe(true);
    });

    it('transforms for-each loops', () => {
      const source = 'for each (var x in msg..OBX) { logger.info(x); }';
      const result = transformer.transform(source, makeLocation('foreach.js'));

      expect(result.transformed).toContain('for (const x of');
      expect(result.transformed).not.toContain('for each');
      expect(result.changed).toBe(true);
    });

    it('tracks runtime pattern types in transformedPatterns', () => {
      const source = 'var pid = msg..PID;\nfor each (var x in list) {}';
      const result = transformer.transform(source, makeLocation('multi.js'));

      expect(result.transformedPatterns).toContain('descendant-access');
      expect(result.transformedPatterns).toContain('for-each');
    });
  });

  // ── Extended patterns ──────────────────────────────────────────────

  describe('extended patterns', () => {
    it('transforms Namespace constructor before runtime transpiler', () => {
      const source = 'var ns = new Namespace("urn:hl7-org:v3");';
      const result = transformer.transform(source, makeLocation('namespace.js'));

      expect(result.transformed).toContain('{ uri: "urn:hl7-org:v3" }');
      expect(result.changed).toBe(true);
      expect(result.transformedPatterns).toContain('namespace-constructor');
    });

    it('transforms XML settings', () => {
      const source = 'XML.ignoreWhitespace = true;';
      const result = transformer.transform(source, makeLocation('settings.js'));

      expect(result.transformed).toContain('/* CODEMOD:');
      expect(result.changed).toBe(true);
    });

    it('applies extended transforms THEN runtime transforms', () => {
      const source = [
        'var ns = new Namespace("urn:hl7-org:v3");',
        'var msg = new XML(str);',
        'var pid = msg..PID;',
      ].join('\n');

      const result = transformer.transform(source, makeLocation('mixed.js'));

      // Extended: Namespace -> object literal
      expect(result.transformed).toContain('{ uri: "urn:hl7-org:v3" }');
      // Runtime: new XML -> XMLProxy.create
      expect(result.transformed).toContain('XMLProxy.create(str)');
      // Runtime: descendants
      expect(result.transformed).toContain("descendants('PID')");

      expect(result.transformedPatterns).toContain('namespace-constructor');
      expect(result.transformedPatterns).toContain('xml-constructor');
      expect(result.transformedPatterns).toContain('descendant-access');
    });
  });

  // ── Warnings collection ────────────────────────────────────────────

  describe('warnings collection', () => {
    it('collects warnings from extended transforms', () => {
      const source = 'XML.ignoreWhitespace = true;\nimportClass(java.util.Date);';
      const result = transformer.transform(source, makeLocation('warnings.js'));

      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    });

    it('includes line numbers in warnings', () => {
      const source = 'var x = 1;\nXML.ignoreWhitespace = true;';
      const result = transformer.transform(source, makeLocation('line-nums.js'));

      const xmlWarning = result.warnings.find(w => w.message.includes('ignoreWhitespace'));
      expect(xmlWarning).toBeDefined();
      expect(xmlWarning!.line).toBe(2);
    });
  });

  // ── Untransformable patterns ───────────────────────────────────────

  describe('untransformable patterns', () => {
    it('reports no untransformable patterns for clean transforms', () => {
      const source = 'var pid = msg..PID;';
      const result = transformer.transform(source, makeLocation('clean.js'));
      expect(result.untransformablePatterns.length).toBe(0);
    });
  });

  // ── Full fixture files ─────────────────────────────────────────────

  describe('full fixture: unsupported-patterns.js', () => {
    it('transforms all extended patterns and runtime patterns', () => {
      const source = readFixture('unsupported-patterns.js');
      const result = transformer.transform(source, makeLocation('unsupported-patterns.js'));

      expect(result.changed).toBe(true);
      // Namespace constructor transformed
      expect(result.transformed).toContain('{ uri: "urn:hl7-org:v3" }');
      // QName constructor transformed
      expect(result.transformed).toContain('localName: "ClinicalDocument"');
      // XML settings commented out
      expect(result.transformed).toContain('/* CODEMOD:');
      // importClass annotated
      expect(result.transformed).toContain('/* CODEMOD: importClass deprecated');
      // Runtime patterns also transformed
      expect(result.transformed).toContain("descendants('PID')");
    });
  });
});
