import { XMLProxy, createXML } from '../../../src/javascript/e4x/XMLProxy';

describe('XMLProxy', () => {
  describe('create', () => {
    it('should create from XML string', () => {
      const xml = XMLProxy.create('<root><child>value</child></root>');
      expect(xml.toString()).toContain('value');
    });

    it('should handle empty string', () => {
      const xml = XMLProxy.create('');
      expect(xml.length()).toBe(0);
    });

    it('should handle invalid XML gracefully', () => {
      const xml = XMLProxy.create('not xml');
      expect(xml.length()).toBe(0);
    });
  });

  describe('property access', () => {
    const sampleXml = `
      <HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
          <MSH.9>
            <MSH.9.1>ADT</MSH.9.1>
            <MSH.9.2>A01</MSH.9.2>
          </MSH.9>
        </MSH>
        <PID>
          <PID.1>1</PID.1>
          <PID.5>
            <PID.5.1>DOE</PID.5.1>
            <PID.5.2>JOHN</PID.5.2>
          </PID.5>
        </PID>
        <OBX>
          <OBX.1>1</OBX.1>
          <OBX.5>Value 1</OBX.5>
        </OBX>
        <OBX>
          <OBX.1>2</OBX.1>
          <OBX.5>Value 2</OBX.5>
        </OBX>
      </HL7Message>
    `;

    it('should access child elements with get()', () => {
      const xml = XMLProxy.create(sampleXml);
      const msh = xml.get('MSH');
      expect(msh.length()).toBe(1);
    });

    it('should access nested elements with chained get()', () => {
      const xml = XMLProxy.create(sampleXml);
      const msgType = xml.get('MSH').get('MSH.9').get('MSH.9.1');
      expect(msgType.toString()).toBe('ADT');
    });

    it('should access deep nested elements', () => {
      const xml = XMLProxy.create(sampleXml);
      const lastName = xml.get('PID').get('PID.5').get('PID.5.1');
      expect(lastName.toString()).toBe('DOE');
    });

    it('should handle array-style access with brackets', () => {
      const xml = XMLProxy.create(sampleXml) as XMLProxy & { [key: string]: XMLProxy };
      // Access first OBX
      const obx = xml['OBX'] as unknown as XMLProxy & { [key: string]: XMLProxy };
      expect(obx.length()).toBe(2);

      // Access specific OBX by index
      const obx1 = obx[0] as unknown as XMLProxy & { [key: string]: XMLProxy };
      expect((obx1['OBX.1'] as XMLProxy).toString()).toBe('1');
    });

    it('should return empty proxy for non-existent elements', () => {
      const xml = XMLProxy.create(sampleXml);
      const nonExistent = xml.get('NONEXISTENT');
      expect(nonExistent.length()).toBe(0);
      expect(nonExistent.toString()).toBe('');
    });
  });

  describe('descendants (.. operator)', () => {
    const nestedXml = `
      <root>
        <level1>
          <OBX>
            <OBX.1>1</OBX.1>
          </OBX>
          <level2>
            <OBX>
              <OBX.1>2</OBX.1>
            </OBX>
          </level2>
        </level1>
        <OBX>
          <OBX.1>3</OBX.1>
        </OBX>
      </root>
    `;

    it('should find all descendants with name', () => {
      const xml = XMLProxy.create(nestedXml);
      const allOBX = xml.descendants('OBX');
      expect(allOBX.length()).toBe(3);
    });

    it('should find descendants at any depth', () => {
      const xml = XMLProxy.create(nestedXml);
      const allOBX = xml.descendants('OBX');

      const values: string[] = [];
      for (const obx of allOBX) {
        values.push(obx.get('OBX.1').toString());
      }
      expect(values).toContain('1');
      expect(values).toContain('2');
      expect(values).toContain('3');
    });
  });

  describe('children()', () => {
    const xml = XMLProxy.create(`
      <parent>
        <child1>A</child1>
        <child2>B</child2>
        <child3>C</child3>
      </parent>
    `);

    it('should iterate over children', () => {
      const children = xml.children();
      expect(children.length()).toBe(3);
    });

    it('should be iterable with for-of', () => {
      const children = xml.children();
      const names: string[] = [];

      for (const child of children) {
        names.push(child.name().toString());
      }

      expect(names).toEqual(['child1', 'child2', 'child3']);
    });
  });

  describe('name()', () => {
    it('should return element name', () => {
      const xml = XMLProxy.create('<MyElement>content</MyElement>');
      expect(xml.name().toString()).toBe('MyElement');
    });

    it('should return localName property', () => {
      const xml = XMLProxy.create('<MyElement>content</MyElement>');
      expect(xml.name().localName).toBe('MyElement');
    });
  });

  describe('toString()', () => {
    it('should return text content', () => {
      const xml = XMLProxy.create('<root>Hello World</root>');
      expect(xml.toString()).toBe('Hello World');
    });

    it('should concatenate nested text', () => {
      const xml = XMLProxy.create('<root><a>Hello</a><b>World</b></root>');
      expect(xml.toString()).toBe('HelloWorld');
    });

    it('should return empty string for empty elements', () => {
      const xml = XMLProxy.create('<root></root>');
      expect(xml.toString()).toBe('');
    });
  });

  describe('toXMLString()', () => {
    it('should return XML string', () => {
      const xml = XMLProxy.create('<root><child>value</child></root>');
      const xmlStr = xml.toXMLString();
      expect(xmlStr).toContain('<root>');
      expect(xmlStr).toContain('<child>');
      expect(xmlStr).toContain('value');
      expect(xmlStr).toContain('</root>');
    });
  });

  describe('length()', () => {
    it('should return number of nodes', () => {
      const xml = XMLProxy.create(`
        <root>
          <item>1</item>
          <item>2</item>
          <item>3</item>
        </root>
      `);
      const items = xml.get('item');
      expect(items.length()).toBe(3);
    });

    it('should return 1 for single node', () => {
      const xml = XMLProxy.create('<single>value</single>');
      expect(xml.length()).toBe(1);
    });

    it('should return 0 for empty proxy', () => {
      const xml = XMLProxy.createEmpty();
      expect(xml.length()).toBe(0);
    });
  });

  describe('hasSimpleContent()', () => {
    it('should return true for text-only elements', () => {
      const xml = XMLProxy.create('<root>just text</root>');
      expect(xml.hasSimpleContent()).toBe(true);
    });

    it('should return false for elements with children', () => {
      const xml = XMLProxy.create('<root><child>text</child></root>');
      expect(xml.hasSimpleContent()).toBe(false);
    });
  });

  describe('attributes', () => {
    const xmlWithAttrs = XMLProxy.create('<element id="123" type="test">content</element>');

    it('should get attribute value', () => {
      expect(xmlWithAttrs.attr('id')).toBe('123');
      expect(xmlWithAttrs.attr('type')).toBe('test');
    });

    it('should return undefined for missing attribute', () => {
      expect(xmlWithAttrs.attr('nonexistent')).toBeUndefined();
    });

    it('should get all attributes', () => {
      const attrs = xmlWithAttrs.attributes();
      expect(attrs).toEqual({ id: '123', type: 'test' });
    });
  });

  describe('modification', () => {
    it('should delete element by index', () => {
      const xml = XMLProxy.create(`
        <root>
          <item>1</item>
          <item>2</item>
          <item>3</item>
        </root>
      `) as XMLProxy & { [key: string]: XMLProxy };

      const items = xml['item'] as XMLProxy;
      expect(items.length()).toBe(3);

      items.deleteAt(0);
      expect(items.length()).toBe(2);
    });

    it('should append XML', () => {
      const xml = XMLProxy.create('<root><item>1</item></root>');
      const items = xml.get('item');

      const newItem = XMLProxy.create('<item>2</item>');
      items.append(newItem);

      expect(items.length()).toBe(2);
    });
  });

  describe('iteration', () => {
    it('should support for-of iteration', () => {
      const xml = XMLProxy.create(`
        <root>
          <seg>A</seg>
          <seg>B</seg>
          <seg>C</seg>
        </root>
      `);

      const values: string[] = [];
      const segs = xml.get('seg');

      for (const seg of segs) {
        values.push(seg.toString());
      }

      expect(values).toEqual(['A', 'B', 'C']);
    });

    it('should work with Array.from', () => {
      const xml = XMLProxy.create(`
        <root>
          <item>1</item>
          <item>2</item>
        </root>
      `);

      const items = Array.from(xml.get('item'));
      expect(items).toHaveLength(2);
    });
  });

  describe('createXML function', () => {
    it('should create XMLProxy from string', () => {
      const xml = createXML('<test>value</test>');
      expect(xml.toString()).toBe('value');
    });
  });

  describe('real Mirth patterns', () => {
    // Test patterns from actual Mirth channels
    const hl7Xml = `
      <HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.9>
            <MSH.9.1>ADT</MSH.9.1>
            <MSH.9.2>A01</MSH.9.2>
          </MSH.9>
        </MSH>
        <OBR>
          <OBR.2>
            <OBR.2.1>ORDER123</OBR.2.1>
          </OBR.2>
        </OBR>
        <OBX>
          <OBX.1><OBX.1.1>1</OBX.1.1></OBX.1>
          <OBX.3><OBX.3.2>Test Name 1</OBX.3.2></OBX.3>
          <OBX.5><OBX.5.1>Result 1</OBX.5.1></OBX.5>
          <OBX.6><OBX.6.1>mg/dL</OBX.6.1></OBX.6>
        </OBX>
        <OBX>
          <OBX.1><OBX.1.1>2</OBX.1.1></OBX.1>
          <OBX.3><OBX.3.2>Test Name 2</OBX.3.2></OBX.3>
          <OBX.5><OBX.5.1>Result 2</OBX.5.1></OBX.5>
          <OBX.6><OBX.6.1>mmol/L</OBX.6.1></OBX.6>
        </OBX>
        <AL1>
          <AL1.3><AL1.3.2>PENICILLIN</AL1.3.2></AL1.3>
        </AL1>
      </HL7Message>
    `;

    it('should support pattern: msg.children() iteration', () => {
      const msg = XMLProxy.create(hl7Xml);
      const segNames: string[] = [];

      for (const seg of msg.children()) {
        segNames.push(seg.name().toString());
      }

      expect(segNames).toContain('MSH');
      expect(segNames).toContain('OBR');
      expect(segNames).toContain('OBX');
      expect(segNames).toContain('AL1');
    });

    it('should support pattern: seg.name().toString() == "OBR"', () => {
      const msg = XMLProxy.create(hl7Xml);

      for (const seg of msg.children()) {
        if (seg.name().toString() === 'OBR') {
          const orderId = seg.get('OBR.2').get('OBR.2.1').toString();
          expect(orderId).toBe('ORDER123');
        }
      }
    });

    it('should support pattern: seg[\'OBX.3\'][\'OBX.3.2\'].toString()', () => {
      const msg = XMLProxy.create(hl7Xml) as XMLProxy & { [key: string]: XMLProxy };

      for (const seg of msg.children()) {
        if (seg.name().toString() === 'OBX') {
          const s = seg as unknown as { [key: string]: { [key: string]: XMLProxy } };
          const obx3 = s['OBX.3'];
          const testName = obx3?.['OBX.3.2']?.toString() ?? '';
          expect(['Test Name 1', 'Test Name 2']).toContain(testName);
        }
      }
    });

    it('should support pattern: msg..AL1 descendant access', () => {
      const msg = XMLProxy.create(hl7Xml);
      const allergies = msg.descendants('AL1');

      for (const al1 of allergies) {
        const allergen = al1.get('AL1.3').get('AL1.3.2').toString();
        expect(allergen.toUpperCase()).toBe('PENICILLIN');
      }
    });

    it('should support pattern: msg..OBX iteration for all OBX segments', () => {
      const msg = XMLProxy.create(hl7Xml);
      const setIds: string[] = [];

      for (const obx of msg.descendants('OBX')) {
        const setId = obx.get('OBX.1').get('OBX.1.1').toString();
        setIds.push(setId);
      }

      expect(setIds).toEqual(['1', '2']);
    });
  });
});
