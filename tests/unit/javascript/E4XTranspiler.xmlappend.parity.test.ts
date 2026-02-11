/**
 * Parity tests for E4X += transpilation with variable RHS (JRC-ETG-002)
 *
 * Java E4X behavior: xml += value appends value as a child node.
 * Node.js equivalent: xml = xml.append(value)
 *
 * The transpiler must convert += to .append() when the LHS is an XML-like
 * identifier (msg, tmp, xml*) and the RHS is a variable or expression,
 * while leaving numeric and string += operations unchanged.
 */
import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler';

describe('E4XTranspiler XML Append with Variable RHS (JRC-ETG-002)', () => {
  let transpiler: E4XTranspiler;

  beforeEach(() => {
    transpiler = new E4XTranspiler();
  });

  describe('variable RHS append', () => {
    it('should transpile msg += someVar to msg.append(someVar)', () => {
      const input = 'msg += someVar';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('msg = msg.append(someVar)');
    });

    it('should transpile msg.PID += newSegment to msg.PID.append(newSegment)', () => {
      const input = 'msg.PID += newSegment';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('msg.PID = msg.PID.append(newSegment)');
    });

    it('should transpile xml += otherXml to xml.append(otherXml)', () => {
      const input = 'xml += otherXml';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('xml = xml.append(otherXml)');
    });

    it('should transpile msg += createNewNode() to msg.append(createNewNode())', () => {
      const input = 'msg += createNewNode()';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('msg = msg.append(createNewNode())');
    });

    it('should transpile tmp += fragment to tmp.append(fragment)', () => {
      const input = 'tmp += fragment';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('tmp = tmp.append(fragment)');
    });

    it('should transpile xmlDoc += childNode to xmlDoc.append(childNode)', () => {
      const input = 'xmlDoc += childNode';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('xmlDoc = xmlDoc.append(childNode)');
    });
  });

  describe('XMLProxy.create RHS still works (existing rule)', () => {
    it('should transpile tmp += XMLProxy.create(...) to tmp.append(...)', () => {
      const input = "tmp += XMLProxy.create('<tag/>')";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("tmp = tmp.append(XMLProxy.create('<tag/>'))");
    });

    it('should transpile msg.items += XMLProxy.create(...) to msg.items.append(...)', () => {
      const input = "msg.items += XMLProxy.create('<item/>')";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("msg.items = msg.items.append(XMLProxy.create('<item/>'))");
    });
  });

  describe('non-XML identifiers are NOT converted', () => {
    it('should NOT convert count += 1 (numeric literal)', () => {
      const input = 'count += 1';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('count += 1');
    });

    it('should NOT convert str += "hello" (string literal)', () => {
      const input = 'str += "hello"';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('str += "hello"');
    });

    it("should NOT convert str += 'world' (single-quoted string literal)", () => {
      const input = "str += 'world'";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("str += 'world'");
    });

    it('should NOT convert i += 10 (non-XML variable with numeric RHS)', () => {
      const input = 'i += 10';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('i += 10');
    });

    it('should NOT convert total += amount (non-XML LHS)', () => {
      const input = 'total += amount';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('total += amount');
    });
  });

  describe('XML-like identifiers with numeric/string RHS are NOT converted', () => {
    it('should NOT convert msg += 1 (numeric literal RHS)', () => {
      const input = 'msg += 1';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('msg += 1');
    });

    it('should NOT convert xml += "text" (string literal RHS)', () => {
      const input = 'xml += "text"';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('xml += "text"');
    });

    it("should NOT convert tmp += 'text' (single-quoted string RHS)", () => {
      const input = "tmp += 'text'";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("tmp += 'text'");
    });
  });

  describe('string literal safety', () => {
    it('should NOT transpile += inside a string literal', () => {
      const input = 'var s = "msg += foo"';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var s = "msg += foo"');
    });

    it('should NOT transpile += inside a single-quoted string', () => {
      const input = "var s = 'xml += bar'";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("var s = 'xml += bar'");
    });

    it('should transpile += outside string but leave string contents alone', () => {
      const input = 'var s = "hello"; msg += newNode';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('var s = "hello"; msg = msg.append(newNode)');
    });
  });

  describe('complex LHS patterns', () => {
    it('should handle bracket access on LHS', () => {
      const input = "msg['PID'] += segment";
      const result = transpiler.transpile(input);
      expect(result.code).toBe("msg['PID'] = msg['PID'].append(segment)");
    });

    it('should handle deep property access on LHS', () => {
      const input = 'msg.PID.PID5 += component';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('msg.PID.PID5 = msg.PID.PID5.append(component)');
    });
  });

  describe('complex RHS expressions', () => {
    it('should handle function call RHS', () => {
      const input = 'msg += buildSegment("NK1", data)';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('msg = msg.append(buildSegment("NK1", data))');
    });

    it('should handle method call on variable RHS', () => {
      const input = 'xml += node.copy()';
      const result = transpiler.transpile(input);
      expect(result.code).toBe('xml = xml.append(node.copy())');
    });
  });
});
