import { XMLProxy } from '../../../../src/javascript/e4x/XMLProxy';

describe('XMLProxy E4X Methods', () => {
  describe('copy()', () => {
    it('should create a deep clone of the XML node', () => {
      const xml = XMLProxy.create('<root><child>value</child></root>') as XMLProxy & Record<string, any>;
      const clone = xml.copy() as XMLProxy & Record<string, any>;

      expect(clone.toXMLString()).toBe(xml.toXMLString());

      // Modify original — clone should not be affected
      // Use 'as any' to bypass TS type check — Proxy set trap handles this at runtime
      (xml as any)['child'] = 'modified';
      // clone is complex (has <child> element), so toString() returns XML per E4X spec
      expect(clone.text()).toBe('value');
    });

    it('should return empty proxy for empty XML', () => {
      const xml = XMLProxy.create('');
      const clone = xml.copy();
      expect(clone.toXMLString()).toBe('');
      expect(clone.length()).toBe(0);
    });
  });

  describe('replace()', () => {
    it('should replace a named child element with a new value', () => {
      const xml = XMLProxy.create('<root><a>1</a><b>2</b></root>') as XMLProxy & Record<string, any>;
      xml.replace('a', '99');
      expect((xml['a'] as XMLProxy).toString()).toBe('99');
      // b should be unchanged
      expect((xml['b'] as XMLProxy).toString()).toBe('2');
    });

    it('should replace a child with XMLProxy value', () => {
      const xml = XMLProxy.create('<root><a>1</a></root>') as XMLProxy & Record<string, any>;
      const newChild = XMLProxy.create('<a><nested>deep</nested></a>');
      xml.replace('a', newChild);
      expect(xml.toXMLString()).toContain('nested');
    });

    it('should return self when property does not exist', () => {
      const xml = XMLProxy.create('<root><a>1</a></root>') as XMLProxy & Record<string, any>;
      const result = xml.replace('nonexistent', 'value');
      expect(result.toXMLString()).toContain('<a>1</a>');
    });

    it('should return self for empty XML', () => {
      const xml = XMLProxy.create('');
      const result = xml.replace('a', 'value');
      expect(result.length()).toBe(0);
    });
  });

  describe('insertChildBefore()', () => {
    it('should insert new child before reference child', () => {
      const xml = XMLProxy.create('<root><b>2</b><c>3</c></root>') as XMLProxy & Record<string, any>;
      const refChild = xml.get('b');
      const newChild = XMLProxy.create('<a>1</a>');
      xml.insertChildBefore(refChild, newChild);

      const xmlStr = xml.toXMLString();
      const aIdx = xmlStr.indexOf('<a>');
      const bIdx = xmlStr.indexOf('<b>');
      expect(aIdx).toBeGreaterThanOrEqual(0);
      expect(aIdx).toBeLessThan(bIdx);
    });

    it('should prepend when reference child is empty', () => {
      const xml = XMLProxy.create('<root><b>2</b></root>') as XMLProxy & Record<string, any>;
      const emptyRef = XMLProxy.create('');
      const newChild = XMLProxy.create('<a>1</a>');
      xml.insertChildBefore(emptyRef, newChild);

      const xmlStr = xml.toXMLString();
      const aIdx = xmlStr.indexOf('<a>');
      const bIdx = xmlStr.indexOf('<b>');
      expect(aIdx).toBeLessThan(bIdx);
    });
  });

  describe('prependChild()', () => {
    it('should insert child at the beginning of children', () => {
      const xml = XMLProxy.create('<root><b>2</b><c>3</c></root>') as XMLProxy & Record<string, any>;
      const newChild = XMLProxy.create('<a>1</a>');
      xml.prependChild(newChild);

      const xmlStr = xml.toXMLString();
      const aIdx = xmlStr.indexOf('<a>');
      const bIdx = xmlStr.indexOf('<b>');
      expect(aIdx).toBeGreaterThanOrEqual(0);
      expect(aIdx).toBeLessThan(bIdx);
    });

    it('should accept string argument', () => {
      const xml = XMLProxy.create('<root><b>2</b></root>') as XMLProxy & Record<string, any>;
      xml.prependChild('<a>1</a>');

      const xmlStr = xml.toXMLString();
      expect(xmlStr).toContain('<a>');
      const aIdx = xmlStr.indexOf('<a>');
      const bIdx = xmlStr.indexOf('<b>');
      expect(aIdx).toBeLessThan(bIdx);
    });

    it('should return self for empty XML', () => {
      const xml = XMLProxy.create('');
      const result = xml.prependChild('<a>1</a>');
      expect(result.length()).toBe(0);
    });
  });

  describe('contains()', () => {
    it('should return true when XML contains a matching node', () => {
      const xml = XMLProxy.create('<root><a>1</a><b>2</b></root>') as XMLProxy & Record<string, any>;
      const children = xml.children();

      // children() returns element nodes; check first one matches <a>1</a>
      const firstChild = children.getIndex(0);
      expect(firstChild.toXMLString()).toContain('<a>');
      expect(children.contains(firstChild)).toBe(true);
    });

    it('should return false when XML does not contain the value', () => {
      const xml = XMLProxy.create('<root><a>1</a></root>') as XMLProxy & Record<string, any>;
      const other = XMLProxy.create('<b>2</b>');
      const children = xml.children();
      expect(children.contains(other)).toBe(false);
    });

    it('should compare primitive values by string representation', () => {
      const xml = XMLProxy.create('<root>hello</root>');
      expect(xml.contains('hello')).toBe(true);
      expect(xml.contains('world')).toBe(false);
    });
  });

  describe('nodeKind()', () => {
    it('should return "element" for element nodes', () => {
      const xml = XMLProxy.create('<root><child>val</child></root>');
      expect(xml.nodeKind()).toBe('element');
    });

    it('should return "element" for empty XML', () => {
      const xml = XMLProxy.create('');
      expect(xml.nodeKind()).toBe('element');
    });
  });

  describe('localName()', () => {
    it('should return the local name without namespace prefix', () => {
      const xml = XMLProxy.create('<root><child>val</child></root>');
      expect(xml.localName()).toBe('root');
    });

    it('should strip namespace prefix', () => {
      const xml = XMLProxy.create('<ns:element xmlns:ns="http://example.com">val</ns:element>');
      expect(xml.localName()).toBe('element');
    });

    it('should return empty string for empty XML', () => {
      const xml = XMLProxy.create('');
      expect(xml.localName()).toBe('');
    });

    it('should return full name when no prefix exists', () => {
      const xml = XMLProxy.create('<simple>val</simple>');
      expect(xml.localName()).toBe('simple');
    });
  });

  describe('normalize()', () => {
    it('should return self (noop for fast-xml-parser)', () => {
      const xml = XMLProxy.create('<root><child>val</child></root>');
      const result = xml.normalize();
      expect(result.toXMLString()).toBe(xml.toXMLString());
    });

    it('should return self for empty XML', () => {
      const xml = XMLProxy.create('');
      const result = xml.normalize();
      expect(result.toXMLString()).toBe(xml.toXMLString());
      expect(result.length()).toBe(0);
    });
  });

  describe('toJSON()', () => {
    it('should return a JSON-compatible object for simple XML', () => {
      const xml = XMLProxy.create('<root><name>John</name></root>');
      const json = xml.toJSON() as Record<string, unknown>;
      expect(json).toBeDefined();
      expect(json).not.toBeNull();
    });

    it('should return null for empty XML', () => {
      const xml = XMLProxy.create('');
      expect(xml.toJSON()).toBeNull();
    });

    it('should include attributes with @ prefix', () => {
      const xml = XMLProxy.create('<root version="2.0"><child>val</child></root>');
      const json = xml.toJSON() as Record<string, unknown>;
      expect(json).toBeDefined();
      expect(json['@version']).toBe('2.0');
    });

    it('should handle multiple sibling elements', () => {
      const xml = XMLProxy.create('<root><a>1</a><b>2</b></root>');
      const json = xml.toJSON() as Record<string, unknown>;
      expect(json).toBeDefined();
      expect(json).not.toBeNull();
    });
  });
});
