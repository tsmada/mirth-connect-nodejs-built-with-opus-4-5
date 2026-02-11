import { E4XTranspiler, transpileE4X } from '../../../src/javascript/e4x/E4XTranspiler';

describe('E4XTranspiler', () => {
  let transpiler: E4XTranspiler;

  beforeEach(() => {
    transpiler = new E4XTranspiler();
  });

  describe('for each loops', () => {
    it('should transpile for each with var', () => {
      const input = 'for each (var seg in msg.children()) { process(seg); }';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('for (const seg of msg.children()) { process(seg); }');
    });

    it('should transpile for each with let', () => {
      const input = 'for each (let item in list) { console.log(item); }';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('for (const item of list) { console.log(item); }');
    });

    it('should transpile for each with const', () => {
      const input = 'for each (const x in arr) { sum += x; }';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('for (const x of arr) { sum += x; }');
    });

    it('should handle nested for each loops', () => {
      const input = `
for each (var seg in msg.children()) {
  for each (var field in seg.children()) {
    process(field);
  }
}`;
      const result = transpiler.transpile(input);
      expect(result.code).toContain('for (const seg of msg.children())');
      expect(result.code).toContain('for (const field of seg.children())');
    });

    it('should handle complex collection expressions', () => {
      const input = "for each (var obx in msg.descendants('OBX')) { }";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("for (const obx of msg.descendants('OBX')) { }");
    });
  });

  describe('descendant operator (..)', () => {
    it('should transpile simple descendant access', () => {
      const input = 'msg..OBX';
      const result = transpiler.transpile(input);
      expect(result.code).toBe("msg.descendants('OBX')");
    });

    it('should transpile descendant access on method result', () => {
      const input = 'getMsg()..PID';
      const result = transpiler.transpile(input);
      expect(result.code).toBe("getMsg().descendants('PID')");
    });

    it('should transpile chained descendant access', () => {
      const input = 'msg..OBX..OBX_5';
      const result = transpiler.transpile(input);
      expect(result.code).toBe("msg.descendants('OBX').descendants('OBX_5')");
    });

    it('should not affect spread operator', () => {
      const input = 'const arr = [...items];';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('const arr = [...items];');
    });

    it('should handle descendant on array access result', () => {
      const input = 'messages[0]..OBX';
      const result = transpiler.transpile(input);
      expect(result.code).toBe("messages[0].descendants('OBX')");
    });
  });

  describe('attribute access (@)', () => {
    it('should transpile dot-at notation', () => {
      const input = 'node.@id';
      const result = transpiler.transpile(input);
      expect(result.code).toBe("node.attr('id')");
    });

    it('should transpile bracket-at notation with single quotes', () => {
      const input = "node['@type']";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("node.attr('type')");
    });

    it('should transpile bracket-at notation with double quotes', () => {
      const input = 'node["@class"]';
      const result = transpiler.transpile(input);
      expect(result.code).toBe("node.attr('class')");
    });

    it('should handle multiple attribute accesses', () => {
      const input = 'const id = node.@id; const type = other.@type;';
      const result = transpiler.transpile(input);
      expect(result.code).toBe("const id = node.attr('id'); const type = other.attr('type');");
    });
  });

  describe('default xml namespace', () => {
    it('should transpile with double quotes', () => {
      const input = 'default xml namespace = "http://example.com"';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace("http://example.com")');
    });

    it('should transpile with single quotes', () => {
      const input = "default xml namespace = 'http://example.com'";
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace("http://example.com")');
    });

    it('should handle extra whitespace', () => {
      const input = 'default   xml   namespace   =   "http://example.com"';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('setDefaultXmlNamespace("http://example.com")');
    });
  });

  describe('XML constructor', () => {
    it('should transpile new XML()', () => {
      const input = 'var msg = new XML(rawMessage);';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var msg = XMLProxy.create(rawMessage);');
    });

    it('should transpile XML() function call', () => {
      const input = 'var msg = XML(rawMessage);';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var msg = XMLProxy.create(rawMessage);');
    });

    it('should not transpile XMLProxy or other XML-prefixed identifiers', () => {
      const input = 'var msg = XMLProxy.create(raw);';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var msg = XMLProxy.create(raw);');
    });

    it('should handle new XML with extra whitespace', () => {
      const input = 'var msg = new   XML   (rawMessage);';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var msg = XMLProxy.create(rawMessage);');
    });
  });

  describe('XML literals', () => {
    it('should transpile simple self-closing tag', () => {
      const input = 'var seg = <OBX/>;';
      const result = transpiler.transpile(input);
      expect(result.code).toContain("XMLProxy.create('<OBX/>')");
    });

    it('should transpile simple tag with content', () => {
      const input = 'var seg = <OBX>content</OBX>;';
      const result = transpiler.transpile(input);
      expect(result.code).toContain("XMLProxy.create('<OBX>content</OBX>')");
    });

    it('should transpile tag with attributes', () => {
      const input = 'var seg = <OBX type="test"/>;';
      const result = transpiler.transpile(input);
      expect(result.code).toContain("XMLProxy.create('<OBX type=\"test\"/>')");
    });
  });

  describe('complex real-world patterns', () => {
    it('should handle typical Mirth filter script', () => {
      const input = `
for each (var seg in msg.children()) {
  if (seg.name().toString() == "OBR") {
    var orderId = seg['OBR.2']['OBR.2.1'].toString();
    channelMap.put('orderId', orderId);
  }
}
return true;`;

      const result = transpiler.transpile(input);
      expect(result.code).toContain('for (const seg of msg.children())');
      expect(result.code).toContain('seg.name().toString()');
      expect(result.code).toContain("seg['OBR.2']['OBR.2.1'].toString()");
    });

    it('should handle descendant iteration pattern', () => {
      const input = `
for each (var obx in msg..OBX) {
  var setId = obx['OBX.1']['OBX.1.1'].toString();
  var result = obx['OBX.5']['OBX.5.1'].toString();
  results.push({ setId: setId, result: result });
}`;

      const result = transpiler.transpile(input);
      expect(result.code).toContain("for (const obx of msg.descendants('OBX'))");
    });

    it('should handle XML construction with content', () => {
      const input = `
var newMsg = new XML(rawData);
var pid = newMsg['PID'];
pid.@id = "123";`;

      const result = transpiler.transpile(input);
      expect(result.code).toContain('XMLProxy.create(rawData)');
      expect(result.code).toContain("pid.setAttr('id', \"123\")");
    });
  });

  describe('convenience function', () => {
    it('should transpile using transpileE4X function', () => {
      const input = 'for each (var x in list) { }';
      const result = transpileE4X(input);
      expect(result).toBe('for (const x of list) { }');
    });
  });

  describe('edge cases', () => {
    it('should not modify code inside string literals', () => {
      const input = 'var str = "for each (var x in y) {}";';
      const result = transpiler.transpile(input);
      // String content should not be modified
      expect(result.code).toContain('"for each (var x in y) {}"');
    });

    it('should handle empty input', () => {
      const result = transpiler.transpile('');
      expect(result.code).toBe('');
    });

    it('should preserve non-E4X code', () => {
      const input = `
function processMessage(msg) {
  const result = {};
  result.status = "OK";
  return result;
}`;
      const result = transpiler.transpile(input);
      expect(result.code).toBe(input);
    });
  });
});
