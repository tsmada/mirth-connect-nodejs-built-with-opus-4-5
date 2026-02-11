/**
 * Parity tests for XMLProxy — text(), elements(), removeChild(), deleteProperty
 */
import { XMLProxy } from '../../../src/javascript/e4x/XMLProxy';

describe('XMLProxy Parity Fixes', () => {
  const sampleXml = `
    <HL7Message>
      <MSH>
        <MSH.1>|</MSH.1>
        <MSH.9>
          <MSH.9.1>ADT</MSH.9.1>
          <MSH.9.2>A01</MSH.9.2>
        </MSH.9>
      </MSH>
      <PID>
        <PID.5>
          <PID.5.1>DOE</PID.5.1>
          <PID.5.2>JOHN</PID.5.2>
        </PID.5>
        <PID.6>
          <PID.6.1>MAIDEN</PID.6.1>
        </PID.6>
      </PID>
      <OBX>
        <OBX.1>1</OBX.1>
      </OBX>
      <OBX>
        <OBX.1>2</OBX.1>
      </OBX>
    </HL7Message>
  `;

  describe('text() method', () => {
    it('should return text content same as toString()', () => {
      const xml = XMLProxy.create('<root>hello</root>');
      expect(xml.text()).toBe(xml.toString());
    });

    it('should return empty string for empty XML', () => {
      const xml = XMLProxy.create('');
      expect(xml.text()).toBe('');
    });

    it('should return concatenated text for nested elements', () => {
      const xml = XMLProxy.create('<root><a>hello</a><b>world</b></root>');
      const text = xml.text();
      expect(text).toContain('hello');
      expect(text).toContain('world');
    });
  });

  describe('elements() method', () => {
    it('should return only element children (no text nodes)', () => {
      const msg = XMLProxy.create(sampleXml);
      // msg wraps the root HL7Message node, so access children directly
      const elements = (msg as any).elements();
      // Should have MSH, PID, OBX, OBX
      expect(elements.length()).toBeGreaterThanOrEqual(4);
    });

    it('should return empty for leaf nodes', () => {
      const xml = XMLProxy.create('<root>just text</root>');
      const elements = xml.elements();
      // Text-only content should have no element children
      expect(elements.length()).toBe(0);
    });
  });

  describe('removeChild(name) method', () => {
    it('should remove all children with given name', () => {
      const msg = XMLProxy.create(sampleXml);
      // msg wraps the root HL7Message node, so access children directly
      const obxBefore = (msg as any).OBX;
      expect(obxBefore.length()).toBe(2);

      // Remove all OBX
      msg.removeChild('OBX');
      const obxAfter = (msg as any).OBX;
      expect(obxAfter.length()).toBe(0);
    });

    it('should not affect other children when removing', () => {
      const msg = XMLProxy.create(sampleXml);

      msg.removeChild('OBX');
      // MSH and PID should still exist
      expect((msg as any).MSH.length()).toBe(1);
      expect((msg as any).PID.length()).toBe(1);
    });
  });

  describe('deleteProperty trap for named properties', () => {
    it('should support delete for named properties (E4X style)', () => {
      const msg = XMLProxy.create(sampleXml);
      const pid = (msg as any).PID;

      // PID.6 should exist before delete
      expect(pid['PID.6'].length()).toBe(1);

      // Delete PID.6
      delete pid['PID.6'];

      // PID.6 should be gone
      expect(pid['PID.6'].length()).toBe(0);
    });

    it('should still support delete by index', () => {
      const msg = XMLProxy.create(sampleXml);
      const obxList = (msg as any).OBX;
      expect(obxList.length()).toBe(2);

      // Delete first OBX by index
      delete obxList[0];
      expect(obxList.length()).toBe(1);
    });
  });

  describe('setAttr via transpiled attribute write', () => {
    it('should set attribute value', () => {
      const xml = XMLProxy.create('<root/>');
      xml.setAttr('version', '2.5');
      expect(xml.attr('version')).toBe('2.5');
    });

    it('should create attribute if it does not exist', () => {
      const xml = XMLProxy.create('<node/>');
      expect(xml.attr('encoding')).toBeUndefined();
      xml.setAttr('encoding', 'UTF-8');
      expect(xml.attr('encoding')).toBe('UTF-8');
    });

    it('should overwrite existing attribute', () => {
      const xml = XMLProxy.create('<node/>');
      xml.setAttr('type', 'A');
      xml.setAttr('type', 'B');
      expect(xml.attr('type')).toBe('B');
    });
  });

  describe('filter() method (Fix 4.1)', () => {
    it('should filter child elements by predicate', () => {
      const msg = XMLProxy.create(sampleXml);
      const obxList = (msg as any).OBX;
      expect(obxList.length()).toBe(2);

      // Filter OBX where OBX.1 == '1'
      const filtered = obxList.filter((item: any) => {
        return item['OBX.1'].toString() === '1';
      });
      expect(filtered.length()).toBe(1);
      expect((filtered as any)[0]['OBX.1'].toString()).toBe('1');
    });

    it('should return empty XMLProxy when nothing matches', () => {
      const msg = XMLProxy.create(sampleXml);
      const obxList = (msg as any).OBX;
      const filtered = obxList.filter(() => false);
      expect(filtered.length()).toBe(0);
    });

    it('should return all elements when predicate always true', () => {
      const msg = XMLProxy.create(sampleXml);
      const obxList = (msg as any).OBX;
      const filtered = obxList.filter(() => true);
      expect(filtered.length()).toBe(2);
    });

    it('should work with complex predicates on nested data', () => {
      const xml = XMLProxy.create(`
        <root>
          <item><code>ABC</code><value>10</value></item>
          <item><code>DEF</code><value>20</value></item>
          <item><code>ABC</code><value>30</value></item>
        </root>
      `);
      const items = (xml as any).item;
      expect(items.length()).toBe(3);

      const abcItems = items.filter((item: any) => {
        return item.code.toString() === 'ABC';
      });
      expect(abcItems.length()).toBe(2);
    });
  });

  describe('comments() and processingInstructions() stubs (Fix 4.2)', () => {
    it('comments() should return an empty XMLProxy', () => {
      const xml = XMLProxy.create('<root><child>text</child></root>');
      const comments = xml.comments();
      expect(comments).toBeDefined();
      expect(comments.length()).toBe(0);
    });

    it('processingInstructions() should return an empty XMLProxy', () => {
      const xml = XMLProxy.create('<root><child>text</child></root>');
      const pis = xml.processingInstructions();
      expect(pis).toBeDefined();
      expect(pis.length()).toBe(0);
    });

    it('comments() should not throw on empty XML', () => {
      const xml = XMLProxy.create('');
      expect(() => xml.comments()).not.toThrow();
    });

    it('processingInstructions() should not throw on empty XML', () => {
      const xml = XMLProxy.create('');
      expect(() => xml.processingInstructions()).not.toThrow();
    });
  });

  describe('children() and attributes() as XMLProxy (Fix 4.3)', () => {
    it('children() should return all child element nodes', () => {
      const msg = XMLProxy.create(sampleXml);
      const kids = msg.children();
      // MSH, PID, OBX, OBX = 4 element children
      expect(kids.length()).toBe(4);
    });

    it('children() should exclude text nodes', () => {
      const xml = XMLProxy.create('<root>text<child>val</child>more text</root>');
      const kids = xml.children();
      // Only the <child> element, not text nodes
      expect(kids.length()).toBe(1);
    });

    it('attributes() should return attribute entries', () => {
      const xml = XMLProxy.create('<root version="2.5" encoding="UTF-8"/>');
      const attrs = xml.attributes();
      // attributes() returns Record<string, string>
      expect(attrs['version']).toBe('2.5');
      expect(attrs['encoding']).toBe('UTF-8');
    });

    it('attributes() should return empty for no attributes', () => {
      const xml = XMLProxy.create('<root/>');
      const attrs = xml.attributes();
      expect(Object.keys(attrs)).toHaveLength(0);
    });
  });

  describe('CDATA preservation (Fix 4.4)', () => {
    it('should preserve CDATA content in toString()', () => {
      const xml = XMLProxy.create('<root><![CDATA[some <special> content & stuff]]></root>');
      const text = xml.toString();
      expect(text).toContain('some <special> content & stuff');
    });

    it('should preserve CDATA in nested elements', () => {
      const xml = XMLProxy.create('<root><data><![CDATA[Hello <World>]]></data></root>');
      const data = (xml as any).data;
      expect(data.toString()).toContain('Hello <World>');
    });

    it('should handle CDATA alongside regular text', () => {
      const xml = XMLProxy.create('<root>before<![CDATA[ <middle> ]]>after</root>');
      const text = xml.toString();
      expect(text).toContain('before');
      expect(text).toContain('<middle>');
      expect(text).toContain('after');
    });

    it('should round-trip CDATA in toXMLString()', () => {
      const xml = XMLProxy.create('<root><![CDATA[keep me]]></root>');
      const xmlStr = xml.toXMLString();
      // Should contain either CDATA or the preserved content
      expect(xmlStr).toContain('keep me');
    });
  });
});
