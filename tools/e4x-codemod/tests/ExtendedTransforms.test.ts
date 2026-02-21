import { ExtendedTransforms } from '../core/ExtendedTransforms.js';

describe('ExtendedTransforms', () => {
  let transforms: ExtendedTransforms;

  beforeEach(() => {
    transforms = new ExtendedTransforms();
  });

  // ── Namespace constructor ──────────────────────────────────────────

  describe('Namespace constructor', () => {
    it('transforms 1-arg string: new Namespace("uri") -> { uri: "uri" }', () => {
      const result = transforms.transform('var ns = new Namespace("urn:hl7-org:v3");');
      expect(result.code).toBe('var ns = { uri: "urn:hl7-org:v3" };');
      expect(result.applied).toContain('namespace-constructor');
    });

    it('transforms 2-arg string: new Namespace("prefix", "uri") -> object literal', () => {
      const result = transforms.transform('var ns = new Namespace("hl7", "urn:hl7-org:v3");');
      expect(result.code).toBe('var ns = { prefix: "hl7", uri: "urn:hl7-org:v3" };');
      expect(result.applied).toContain('namespace-constructor');
    });

    it('transforms with variable arguments', () => {
      const result = transforms.transform('var ns = new Namespace(myPrefix, myUri);');
      expect(result.code).toBe('var ns = { prefix: myPrefix, uri: myUri };');
    });

    it('transforms 1-arg variable', () => {
      const result = transforms.transform('var ns = new Namespace(uriVar);');
      expect(result.code).toBe('var ns = { uri: uriVar };');
    });

    it('transforms with single-quoted strings', () => {
      const result = transforms.transform("var ns = new Namespace('urn:hl7-org:v3');");
      expect(result.code).toBe("var ns = { uri: 'urn:hl7-org:v3' };");
    });

    it('generates info-level warning for each transform', () => {
      const result = transforms.transform('var ns = new Namespace("urn:hl7-org:v3");');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]!.severity).toBe('info');
    });
  });

  // ── QName constructor ──────────────────────────────────────────────

  describe('QName constructor', () => {
    it('transforms 2-arg: new QName(ns, "localName") -> object literal', () => {
      const result = transforms.transform('var qn = new QName(hl7Ns, "ClinicalDocument");');
      expect(result.code).toBe('var qn = { namespace: hl7Ns, localName: "ClinicalDocument" };');
      expect(result.applied).toContain('qname-constructor');
    });

    it('transforms 1-arg: new QName("localName") -> object literal', () => {
      const result = transforms.transform('var qn = new QName("localName");');
      expect(result.code).toBe('var qn = { localName: "localName" };');
      expect(result.applied).toContain('qname-constructor');
    });

    it('transforms with variable arguments', () => {
      const result = transforms.transform('var qn = new QName(ns, name);');
      expect(result.code).toBe('var qn = { namespace: ns, localName: name };');
    });

    it('generates info-level warnings', () => {
      const result = transforms.transform('var qn = new QName("localName");');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]!.severity).toBe('info');
    });
  });

  // ── XML settings ───────────────────────────────────────────────────

  describe('XML settings', () => {
    it('comments out XML.ignoreWhitespace', () => {
      const result = transforms.transform('XML.ignoreWhitespace = true;');
      expect(result.code).toContain('/* CODEMOD:');
      expect(result.code).toContain('XML.ignoreWhitespace = true;');
      expect(result.code).toContain('not supported in Node.js runtime');
      expect(result.applied).toContain('xml-settings');
    });

    it('comments out XML.ignoreComments', () => {
      const result = transforms.transform('XML.ignoreComments = false;');
      expect(result.code).toContain('/* CODEMOD:');
      expect(result.code).toContain('XML.ignoreComments = false;');
    });

    it('comments out XML.prettyPrinting', () => {
      const result = transforms.transform('XML.prettyPrinting = true;');
      expect(result.code).toContain('/* CODEMOD:');
      expect(result.code).toContain('XML.prettyPrinting = true;');
    });

    it('preserves indentation', () => {
      const result = transforms.transform('  XML.ignoreWhitespace = true;');
      expect(result.code).toMatch(/^\s{2}\/\* CODEMOD:/);
    });

    it('generates warn-level warnings for XML settings', () => {
      const result = transforms.transform('XML.ignoreWhitespace = true;');
      const xmlWarnings = result.warnings.filter(w => w.message.includes('ignoreWhitespace'));
      expect(xmlWarnings.length).toBe(1);
      expect(xmlWarnings[0]!.severity).toBe('warn');
    });
  });

  // ── importClass ────────────────────────────────────────────────────

  describe('importClass', () => {
    it('prefixes importClass with CODEMOD comment', () => {
      const result = transforms.transform('importClass(java.util.Date);');
      expect(result.code).toContain('/* CODEMOD: importClass deprecated');
      expect(result.code).toContain('importClass(java.util.Date);');
      expect(result.applied).toContain('import-class');
    });

    it('handles importClass with Packages prefix', () => {
      const result = transforms.transform('importClass(Packages.com.mirth.connect.server.util.ServerUtil);');
      expect(result.code).toContain('/* CODEMOD: importClass deprecated');
      expect(result.code).toContain('importClass(Packages.com.mirth.connect.server.util.ServerUtil);');
    });

    it('preserves indentation', () => {
      const result = transforms.transform('  importClass(java.util.Date);');
      expect(result.code).toMatch(/^\s{2}\/\* CODEMOD:/);
    });

    it('generates info-level warning', () => {
      const result = transforms.transform('importClass(java.util.Date);');
      const importWarnings = result.warnings.filter(w => w.message.includes('importClass'));
      expect(importWarnings.length).toBe(1);
      expect(importWarnings[0]!.severity).toBe('info');
    });
  });

  // ── XMLList constructor (detection only) ───────────────────────────

  describe('XMLList constructor', () => {
    it('does not transform but generates info warning', () => {
      const source = 'var list = new XMLList(str);';
      const result = transforms.transform(source);
      // Should NOT be in applied (detection-only)
      expect(result.applied).not.toContain('xmllist-constructor');
      // But should have a warning
      const xmllistWarnings = result.warnings.filter(w => w.message.includes('XMLList'));
      expect(xmllistWarnings.length).toBe(1);
      expect(xmllistWarnings[0]!.severity).toBe('info');
    });
  });

  // ── No transform needed ────────────────────────────────────────────

  describe('no transform needed', () => {
    it('returns unchanged code for plain JavaScript', () => {
      const source = 'var x = JSON.parse(str);\nvar y = x.name;';
      const result = transforms.transform(source);
      expect(result.code).toBe(source);
      expect(result.applied.length).toBe(0);
      expect(result.warnings.length).toBe(0);
    });

    it('returns unchanged code for runtime-handled patterns', () => {
      const source = 'var pid = msg..PID;\nfor each (var x in list) {}';
      const result = transforms.transform(source);
      // Extended transforms should NOT modify runtime patterns
      expect(result.code).toBe(source);
      expect(result.applied.length).toBe(0);
    });
  });

  // ── Mixed patterns ─────────────────────────────────────────────────

  describe('mixed patterns', () => {
    it('transforms extended patterns while leaving runtime patterns untouched', () => {
      const source = [
        'var msg = new XML(str);',
        'var ns = new Namespace("urn:hl7-org:v3");',
        'var pid = msg..PID;',
        'XML.ignoreWhitespace = true;',
      ].join('\n');

      const result = transforms.transform(source);

      // Namespace should be transformed
      expect(result.code).toContain('{ uri: "urn:hl7-org:v3" }');
      // XML setting should be commented
      expect(result.code).toContain('/* CODEMOD:');
      // Runtime patterns should be untouched
      expect(result.code).toContain('new XML(str)');
      expect(result.code).toContain('msg..PID');

      expect(result.applied).toContain('namespace-constructor');
      expect(result.applied).toContain('xml-settings');
    });
  });
});
