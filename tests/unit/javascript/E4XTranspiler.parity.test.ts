/**
 * Parity tests for E4X transpiler — Wave 8 + Wave 9 fixes
 *
 * Wave 8: attribute write, += append (existing tests)
 * Wave 9: filter predicates, wildcards, bare for-each, comment skipping, namespace variable
 */
import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler';

describe('E4XTranspiler Parity Fixes', () => {
  let transpiler: E4XTranspiler;

  beforeEach(() => {
    transpiler = new E4XTranspiler();
  });

  describe('3.1 - Attribute write transpilation', () => {
    it('should transpile .@attr = value to .setAttr()', () => {
      const input = 'msg.MSH.@version = "2.5"';
      const result = transpiler.transpile(input);
      expect(result.code).toContain("setAttr('version'");
      expect(result.code).toContain('"2.5"');
    });

    it('should transpile attribute write with variable value', () => {
      const input = 'node.@encoding = charset';
      const result = transpiler.transpile(input);
      expect(result.code).toContain("setAttr('encoding', charset)");
    });

    it('should NOT transpile == comparison as write', () => {
      const input = 'if (msg.@version == "2.5") {}';
      const result = transpiler.transpile(input);
      // Should use attr() for read, not setAttr
      expect(result.code).toContain("attr('version')");
      expect(result.code).toContain('==');
      expect(result.code).not.toContain('setAttr');
    });

    it('should NOT transpile === comparison as write', () => {
      const input = 'if (msg.@version === "2.5") {}';
      const result = transpiler.transpile(input);
      expect(result.code).not.toContain('setAttr');
    });

    it('should NOT transpile != comparison as write', () => {
      const input = 'if (msg.@version != "2.5") {}';
      const result = transpiler.transpile(input);
      expect(result.code).not.toContain('setAttr');
    });

    it('should still transpile read-only attribute access', () => {
      const input = 'var v = msg.@version';
      const result = transpiler.transpile(input);
      expect(result.code).toContain("attr('version')");
    });

    it('should handle both read and write in same script', () => {
      const input = `var old = msg.@version;
msg.@version = "2.5";`;
      const result = transpiler.transpile(input);
      expect(result.code).toContain("attr('version')");
      expect(result.code).toContain("setAttr('version'");
    });
  });

  describe('3.2 - E4X append operator (+=)', () => {
    it('should transpile += with XMLProxy.create to append', () => {
      // After XML literal transpilation, the += will be: xml += XMLProxy.create(...)
      const input = "xml += XMLProxy.create('<item/>')";
      const result = transpiler.transpile(input);
      expect(result.code).toContain("xml = xml.append(XMLProxy.create('<item/>'))");
    });

    it('should handle += with complex LHS path', () => {
      const input = "msg.items += XMLProxy.create('<item/>')";
      const result = transpiler.transpile(input);
      expect(result.code).toContain("msg.items = msg.items.append(XMLProxy.create('<item/>'))");
    });

    it('should NOT transpile += for non-XML values', () => {
      const input = 'count += 1';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('count += 1');
    });

    it('should NOT transpile += for string concatenation', () => {
      const input = 'str += " world"';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('str += " world"');
    });
  });

  // ========== Wave 9 fixes below ==========

  describe('3.1w9 - E4X filtering predicates (JRC-ETG-001)', () => {
    it('should transpile simple segment filter predicate', () => {
      const input = "msg.OBX.(OBX.3 == 'WBC')";
      const result = transpiler.transpile(input);
      expect(result.code).toBe(
        "msg.get('OBX').filter(function(__e4x_item) { with(__e4x_item) { return (OBX.3 == 'WBC'); } })"
      );
    });

    it('should transpile nested property access inside predicate', () => {
      const input = "msg.PID.(PID.5.1 == 'Smith')";
      const result = transpiler.transpile(input);
      expect(result.code).toBe(
        "msg.get('PID').filter(function(__e4x_item) { with(__e4x_item) { return (PID.5.1 == 'Smith'); } })"
      );
    });

    it('should transpile predicate with @attr inside expression', () => {
      // @type inside the predicate should be transpiled to .attr('type') by the attribute pass
      const input = "msg.node.(@type == 'urgent')";
      const result = transpiler.transpile(input);
      expect(result.code).toContain("filter(function(__e4x_item)");
      expect(result.code).toContain("attr('type')");
    });

    it('should transpile predicate with complex boolean expression', () => {
      const input = "msg.OBX.(OBX.3 == 'WBC' && OBX.5 > 10)";
      const result = transpiler.transpile(input);
      expect(result.code).toBe(
        "msg.get('OBX').filter(function(__e4x_item) { with(__e4x_item) { return (OBX.3 == 'WBC' && OBX.5 > 10); } })"
      );
    });

    it('should transpile chained access after predicate', () => {
      const input = "msg.OBX.(OBX.3 == 'WBC').OBX_5";
      const result = transpiler.transpile(input);
      expect(result.code).toContain("filter(function(__e4x_item)");
      expect(result.code).toContain(".OBX_5");
    });

    it('should NOT transpile regular parenthesized expressions', () => {
      const input = 'var x = (a + b)';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var x = (a + b)');
    });

    it('should NOT transpile function calls with dot before paren', () => {
      // e.g. obj.method(arg) should not be treated as a predicate
      const input = 'msg.toString()';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('msg.toString()');
    });

    it('should handle predicate inside a for-each loop', () => {
      const input = "for each (var obx in msg.OBX.(OBX.3 == 'WBC')) { process(obx); }";
      const result = transpiler.transpile(input);
      expect(result.code).toContain("filter(function(__e4x_item)");
      expect(result.code).toContain("for (const obx of");
    });
  });

  describe('3.2w9 - E4X wildcard operators (JRC-ETG-002)', () => {
    it('should transpile .@* to .attributes()', () => {
      const input = 'var attrs = node.@*';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var attrs = node.attributes()');
    });

    it('should transpile identifier.* to identifier.children()', () => {
      const input = 'var kids = msg.*';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var kids = msg.children()');
    });

    it('should transpile chained property.* to .children()', () => {
      const input = 'var kids = msg.PID.*';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var kids = msg.PID.children()');
    });

    it('should NOT convert multiplication to children()', () => {
      const input = 'var result = count * 3';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var result = count * 3');
    });

    it('should NOT convert multiplication with parens', () => {
      const input = 'var result = (a + b) * c';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var result = (a + b) * c');
    });

    it('should NOT convert multiplication with spaces', () => {
      const input = 'x = y * z';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('x = y * z');
    });

    it('should handle .@* in iteration', () => {
      const input = 'for each (var a in node.@*) {}';
      const result = transpiler.transpile(input);
      expect(result.code).toContain('node.attributes()');
    });

    it('should handle .* in iteration', () => {
      const input = 'for each (var child in msg.*) {}';
      const result = transpiler.transpile(input);
      expect(result.code).toContain('msg.children()');
    });
  });

  describe('3.3w9 - for each bare variable (JRC-ETG-005)', () => {
    it('should transpile for each (x in expr) without var/let/const', () => {
      const input = 'for each (item in list) { process(item); }';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('for (let item of list) { process(item); }');
    });

    it('should handle bare variable with complex expression', () => {
      const input = "for each (seg in msg.descendants('OBX')) { }";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("for (let seg of msg.descendants('OBX')) { }");
    });

    it('should still handle var/let/const declaration normally', () => {
      const input = 'for each (var x in list) { }';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('for (const x of list) { }');
    });

    it('should handle bare variable in nested loops', () => {
      const input = `for each (seg in msg.children()) {
  for each (field in seg.children()) {
    process(field);
  }
}`;
      const result = transpiler.transpile(input);
      expect(result.code).toContain('for (let seg of msg.children())');
      expect(result.code).toContain('for (let field of seg.children())');
    });
  });

  describe('3.4w9 - isInsideString skips comments (JRC-ETG-006)', () => {
    it('should not transpile E4X inside line comments', () => {
      const input = '// for each (var x in list) { }';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('// for each (var x in list) { }');
    });

    it('should not transpile E4X inside block comments', () => {
      const input = '/* msg..OBX */';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('/* msg..OBX */');
    });

    it('should transpile code after a line comment on next line', () => {
      const input = `// this is a comment
msg..OBX`;
      const result = transpiler.transpile(input);
      expect(result.code).toContain('// this is a comment');
      expect(result.code).toContain("msg.descendants('OBX')");
    });

    it('should transpile code after a block comment', () => {
      const input = '/* comment */ msg..OBX';
      const result = transpiler.transpile(input);
      expect(result.code).toContain('/* comment */');
      expect(result.code).toContain("msg.descendants('OBX')");
    });

    it('should not transpile E4X inside multi-line block comments', () => {
      const input = `/*
 * for each (var x in list) {
 *   msg..OBX
 * }
 */
var a = 1;`;
      const result = transpiler.transpile(input);
      // The for each inside the comment should NOT be transpiled
      expect(result.code).toContain('for each (var x in list)');
      expect(result.code).toContain('var a = 1;');
    });

    it('should handle // inside a string literal (not a comment)', () => {
      const input = 'var url = "http://example.com"; msg..OBX';
      const result = transpiler.transpile(input);
      // The // inside the string is NOT a comment, so msg..OBX should still be transpiled
      expect(result.code).toContain("msg.descendants('OBX')");
    });

    it('should handle /* inside a string literal (not a comment)', () => {
      const input = 'var str = "/* not a comment */"; msg..OBX';
      const result = transpiler.transpile(input);
      expect(result.code).toContain("msg.descendants('OBX')");
    });
  });

  describe('3.5w9 - default xml namespace with variable (JRC-XNH-001)', () => {
    it('should transpile default xml namespace = variable', () => {
      const input = 'default xml namespace = myVar';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace(myVar)');
    });

    it('should transpile default xml namespace = dotted variable', () => {
      const input = 'default xml namespace = config.namespace';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace(config.namespace)');
    });

    it('should still handle string literal namespace', () => {
      const input = 'default xml namespace = "http://example.com"';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace("http://example.com")');
    });

    it('should handle single-quoted string namespace', () => {
      const input = "default xml namespace = 'http://example.com'";
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace("http://example.com")');
    });

    it('should handle namespace variable with extra whitespace', () => {
      const input = 'default  xml  namespace  =  ns';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace(ns)');
    });

    it('should handle namespace followed by semicolon', () => {
      const input = 'default xml namespace = myNs;';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace(myNs);');
    });
  });
});
