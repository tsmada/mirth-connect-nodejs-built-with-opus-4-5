/**
 * Tests for XMLProxy Transformation Quality fixes:
 *
 * Fix 1: Proxy self-reference (_self) — return this returns Proxy, not raw target
 * Fix 2: value.nodes → value.getNodes() in set/setNodeValue
 * Fix 3: append() adds as child for single-root, sibling for XMLList
 * Fix 4: attributes().length() returns count
 * Fix 5: createList() type guard for non-string arguments
 */

import { XMLProxy } from '../../../../src/javascript/e4x/XMLProxy.js';

const SAMPLE_HL7 = `<HL7Message>
  <MSH><MSH.9><MSH.9.1>ADT</MSH.9.1></MSH.9></MSH>
  <PID><PID.5><PID.5.1>Smith</PID.5.1></PID.5></PID>
  <OBX><OBX.3>WBC</OBX.3><OBX.5>7.2</OBX.5></OBX>
</HL7Message>`;

// Cast to any for bracket-access tests — Proxy handles property access at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = (x: XMLProxy): any => x;

describe('XMLProxy TQ Fixes', () => {
  // ─── Fix 1: Proxy self-reference ─────────────────────────────────────────

  describe('Fix 1: Proxy self-reference (return this._self)', () => {
    it('append() returns Proxy — bracket access works after append', () => {
      const msg = XMLProxy.create(SAMPLE_HL7);
      const result = msg.append(XMLProxy.create('<ZZZ><ZZZ.1>test</ZZZ.1></ZZZ>'));

      // If append() returned raw target, bracket access would fail
      expect(p(result)['PID']).toBeDefined();
      expect(p(result)['PID'].toString()).toBe('Smith');
    });

    it('msg = msg.append(x) preserves Proxy behavior', () => {
      let msg = XMLProxy.create(SAMPLE_HL7);
      msg = msg.append(XMLProxy.create('<ZZZ><ZZZ.1>test</ZZZ.1></ZZZ>'));

      // After reassignment, msg should still be a Proxy with E4X behavior
      expect(msg.get('MSH').exists()).toBe(true);
      expect(msg.get('PID').get('PID.5').get('PID.5.1').toString()).toBe('Smith');
      expect(msg.get('ZZZ').get('ZZZ.1').toString()).toBe('test');
    });

    it('insertChildAfter() returns Proxy', () => {
      const msg = XMLProxy.create(SAMPLE_HL7);
      const msh = msg.get('MSH');
      const result = msg.insertChildAfter(msh, XMLProxy.create('<EVN><EVN.1>A01</EVN.1></EVN>'));

      expect(result.get('EVN').exists()).toBe(true);
      expect(result.get('EVN').get('EVN.1').toString()).toBe('A01');
    });

    it('replace() returns Proxy', () => {
      const msg = XMLProxy.create('<root><a>1</a><b>2</b></root>');
      const result = msg.replace('a', XMLProxy.create('<a>replaced</a>'));

      expect(result.get('a').toString()).toBe('replaced');
      expect(result.get('b').toString()).toBe('2');
    });

    it('prependChild() returns Proxy', () => {
      const msg = XMLProxy.create('<root><b>2</b></root>');
      const result = msg.prependChild(XMLProxy.create('<a>1</a>'));

      expect(result.get('a').toString()).toBe('1');
      expect(result.get('b').toString()).toBe('2');
    });

    it('insertChildBefore() returns Proxy', () => {
      const msg = XMLProxy.create('<root><b>2</b></root>');
      const bNode = msg.get('b');
      const result = msg.insertChildBefore(bNode, XMLProxy.create('<a>1</a>'));

      expect(result.get('a').toString()).toBe('1');
      expect(result.get('b').toString()).toBe('2');
    });

    it('method chaining works: msg.append(x).get(child).toString()', () => {
      const msg = XMLProxy.create(SAMPLE_HL7);
      const value = msg.append(XMLProxy.create('<ZZZ><ZZZ.1>chain</ZZZ.1></ZZZ>'))
        .get('ZZZ')
        .get('ZZZ.1')
        .toString();

      expect(value).toBe('chain');
    });

    it('normalize() returns Proxy', () => {
      const msg = XMLProxy.create(SAMPLE_HL7);
      const result = msg.normalize();

      expect(result.get('PID').exists()).toBe(true);
      expect(result.get('PID').toString()).toBe('Smith');
    });

    it('bracket access works on Proxy-returned values', () => {
      const msg = XMLProxy.create(SAMPLE_HL7);
      const result = msg.append(XMLProxy.create('<ZZZ/>'));

      // The core test: bracket access triggers Proxy get trap
      const r = p(result);
      expect(r['PID']).toBeDefined();
      expect(r['MSH']).toBeDefined();
      expect(r['ZZZ']).toBeDefined();
    });
  });

  // ─── Fix 2: value.nodes → value.getNodes() ──────────────────────────────

  describe('Fix 2: value.nodes → value.getNodes() (TQ-XBG-001)', () => {
    it('set() with XMLProxy value assigns correct child content', () => {
      const msg = XMLProxy.create('<root><target>old</target></root>');
      const newValue = XMLProxy.create('<inner>new-content</inner>');

      // set() creates a new child — the XMLProxy value's nodes should be used
      msg.set('newChild', newValue);

      // The new child should contain the inner content
      expect(msg.get('newChild').toXMLString()).toContain('inner');
      expect(msg.get('newChild').toString()).toBe('new-content');
    });

    it('set() with XMLProxy on existing child replaces content correctly', () => {
      const msg = XMLProxy.create('<root><child>old</child></root>');
      const newValue = XMLProxy.create('<sub>replaced</sub>');

      msg.set('child', newValue);

      // The child should now have the new content
      expect(msg.get('child').toString()).toBe('replaced');
    });

    it('set() with XMLProxy on multiple nodes updates all', () => {
      const msg = XMLProxy.create('<root><item><val>1</val></item><item><val>2</val></item></root>');
      const items = msg.get('item');
      const newVal = XMLProxy.create('<data>updated</data>');

      items.set('val', newVal);

      // Both items should be updated
      const allItems = msg.get('item');
      expect(allItems.getIndex(0).get('val').toString()).toBe('updated');
      expect(allItems.getIndex(1).get('val').toString()).toBe('updated');
    });

    it('setNodeValue() with XMLProxy preserves node data', () => {
      const msg = XMLProxy.create('<root><child>old</child></root>');
      const replacement = XMLProxy.create('<inner>data</inner>');

      // This triggers setNodeValue internally
      msg.set('child', replacement);

      const xml = msg.toXMLString();
      expect(xml).toContain('inner');
      expect(xml).toContain('data');
    });
  });

  // ─── Fix 3: append() child vs sibling ────────────────────────────────────

  describe('Fix 3: append() as child for single-root (TQ-XBG-003)', () => {
    it('single-root: msg.append(<ZZZ/>) adds ZZZ as child of root', () => {
      const msg = XMLProxy.create(SAMPLE_HL7);
      msg.append(XMLProxy.create('<ZZZ><ZZZ.1>added</ZZZ.1></ZZZ>'));

      // ZZZ should be findable as a child of root
      expect(msg.get('ZZZ').exists()).toBe(true);
      expect(msg.get('ZZZ').get('ZZZ.1').toString()).toBe('added');
    });

    it('single-root: msg.get(ZZZ) finds appended child', () => {
      const msg = XMLProxy.create('<HL7Message><MSH/></HL7Message>');
      msg.append(XMLProxy.create('<PID><PID.5>Jones</PID.5></PID>'));

      expect(msg.get('PID').get('PID.5').toString()).toBe('Jones');
      expect(msg.get('MSH').exists()).toBe(true);
    });

    it('single-root: appended child visible in toXMLString()', () => {
      const msg = XMLProxy.create('<root><a>1</a></root>');
      msg.append(XMLProxy.create('<b>2</b>'));

      const xml = msg.toXMLString();
      expect(xml).toContain('<b>2</b>');
      expect(xml).toContain('<a>1</a>');
    });

    it('multi-root XMLList: append adds as sibling (existing behavior)', () => {
      // Create a multi-node XMLList (no single root)
      const list = XMLProxy.create('<a>1</a>');
      // Force multi-node by adding at nodes level
      list.getNodes().push(...XMLProxy.create('<b>2</b>').getNodes());

      // Now length > 1, so append should add as sibling
      list.append(XMLProxy.create('<c>3</c>'));
      expect(list.length()).toBe(3);
    });

    it('E4X pattern: msg += <ZZZ/>; set value on appended child', () => {
      let msg = XMLProxy.create(SAMPLE_HL7);
      msg = msg.append(XMLProxy.create('<ZZZ><ZZZ.1/></ZZZ>'));

      // Set value on the appended segment using .set()
      msg.get('ZZZ').set('ZZZ.1', 'test-value');

      expect(msg.get('ZZZ').get('ZZZ.1').toString()).toBe('test-value');
    });

    it('append with string argument works for single-root', () => {
      const msg = XMLProxy.create('<root><a>1</a></root>');
      msg.append('<b>2</b>');

      expect(msg.get('b').toString()).toBe('2');
    });

    it('multiple appends work correctly', () => {
      const msg = XMLProxy.create('<root><a>1</a></root>');
      msg.append(XMLProxy.create('<b>2</b>'));
      msg.append(XMLProxy.create('<c>3</c>'));

      expect(msg.get('a').toString()).toBe('1');
      expect(msg.get('b').toString()).toBe('2');
      expect(msg.get('c').toString()).toBe('3');
    });
  });

  // ─── Fix 4: attributes().length() ────────────────────────────────────────

  describe('Fix 4: attributes().length() (TQ-XBG-004)', () => {
    it('attributes().length() returns attribute count', () => {
      const xml = XMLProxy.create('<element version="2.5" encoding="UTF-8"/>');
      const attrs = xml.attributes();

      expect(attrs.length()).toBe(2);
    });

    it('attributes() still supports property access', () => {
      const xml = XMLProxy.create('<element version="2.5" encoding="UTF-8"/>');
      const attrs = xml.attributes();

      expect(attrs['version']).toBe('2.5');
      expect(attrs['encoding']).toBe('UTF-8');
    });

    it('empty element attributes().length() returns 0', () => {
      const xml = XMLProxy.create('<element/>');
      const attrs = xml.attributes();

      expect(attrs.length()).toBe(0);
    });

    it('empty XMLProxy attributes().length() returns 0', () => {
      const xml = XMLProxy.createEmpty();
      const attrs = xml.attributes();

      expect(attrs.length()).toBe(0);
    });

    it('single attribute length() returns 1', () => {
      const xml = XMLProxy.create('<element id="123"/>');
      expect(xml.attributes().length()).toBe(1);
    });
  });

  // ─── Fix 5: createList() type guard ──────────────────────────────────────

  describe('Fix 5: createList() type guard (TQ-XBG-005)', () => {
    it('createList([]) returns empty XMLProxy without crashing', () => {
      // Passing an array (wrong type) should not throw
      expect(() => XMLProxy.createList([] as unknown as string)).not.toThrow();
      const result = XMLProxy.createList([] as unknown as string);
      expect(result.length()).toBe(0);
    });

    it('createList(undefined) returns empty XMLProxy', () => {
      const result = XMLProxy.createList(undefined);
      expect(result.length()).toBe(0);
    });

    it('createList("") returns empty XMLProxy', () => {
      const result = XMLProxy.createList('');
      expect(result.length()).toBe(0);
    });

    it('createList(null) returns empty XMLProxy', () => {
      const result = XMLProxy.createList(null as unknown as string);
      expect(result.length()).toBe(0);
    });

    it('createList(123) returns empty XMLProxy', () => {
      const result = XMLProxy.createList(123 as unknown as string);
      expect(result.length()).toBe(0);
    });

    it('createList with valid XML string still works', () => {
      const result = XMLProxy.createList('<item>test</item>');
      expect(result.length()).toBe(1);
      expect(result.toString()).toBe('test');
    });
  });
});
