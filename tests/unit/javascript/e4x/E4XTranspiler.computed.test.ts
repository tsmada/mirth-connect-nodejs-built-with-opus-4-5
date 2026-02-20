/**
 * Tests for E4X transpiler computed attributes, computed tag names,
 * and empty XMLList literal support.
 *
 * A1: Computed XML Attributes <tag attr={variable}/>
 * A2: Computed Tag Names <{expr}>content</{expr}>
 * A3: Empty XMLList Literal <></>
 */

import { E4XTranspiler } from '../../../../src/javascript/e4x/E4XTranspiler.js';

describe('E4XTranspiler computed features', () => {
  let transpiler: E4XTranspiler;

  beforeEach(() => {
    transpiler = new E4XTranspiler();
  });

  describe('A1: Computed attributes in self-closing tags', () => {
    it('should handle single computed attribute', () => {
      const input = 'var x = <column name={columnName}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain("XMLProxy.create('<column' + ' name=\"' + String(columnName) + '\"' + '/>')");
    });

    it('should handle multiple computed attributes', () => {
      const input = 'var x = <columns name={columnName} type={type}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(columnName)');
      expect(result).toContain('String(type)');
      expect(result).toContain("'/>'");
    });

    it('should handle mixed static and computed attributes', () => {
      const input = 'var x = <field static="val" dynamic={expr}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain("' static=\"val\"'");
      expect(result).toContain('String(expr)');
      expect(result).toContain("'/>'");
    });

    it('should handle computed attribute with method call expression', () => {
      const input = 'var x = <tag attr={obj.method("arg")}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(obj.method("arg"))');
    });

    it('should handle computed attribute with complex expression', () => {
      const input = 'var x = <tag name={firstName + " " + lastName}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(firstName + " " + lastName)');
    });

    it('should NOT transpile computed attrs inside strings', () => {
      const input = 'var s = "<tag attr={expr}/>";';
      const result = transpiler.transpile(input).code;
      // Should remain as a string literal, untouched
      expect(result).toContain('"<tag attr={expr}/>"');
      expect(result).not.toContain('String(expr)');
    });

    it('should still handle static self-closing tags normally', () => {
      const input = 'var x = <br/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain("XMLProxy.create('<br/>')");
    });

    it('should handle self-closing tag with only static attributes', () => {
      const input = 'var x = <field name="PID" type="string"/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain("XMLProxy.create('<field name=\"PID\" type=\"string\"/>')");
    });
  });

  describe('A1: Computed attributes in open/close tags', () => {
    it('should handle computed attribute with text content', () => {
      const input = 'var x = <tag attr={expr}>hello</tag>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(expr)');
      expect(result).toContain('hello');
      expect(result).toContain("'</tag>'");
    });

    it('should handle computed attribute with embedded content expression', () => {
      const input = 'var x = <tag attr={a}>{value}</tag>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(a)');
      expect(result).toContain('String(value)');
    });

    it('should handle multiple computed attrs in open/close tag', () => {
      const input = 'var x = <row id={rowId} class={cls}>content</row>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(rowId)');
      expect(result).toContain('String(cls)');
      expect(result).toContain("'content'");
    });
  });

  describe('A2: Computed tag names', () => {
    it('should handle computed tag name with text content', () => {
      const input = 'var x = <{tagName}>hello</{tagName}>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(tagName)');
      expect(result).toContain("'hello'");
      expect(result).toContain("XMLProxy.create(");
    });

    it('should handle computed tag name with method call', () => {
      const input = 'var x = <{child.name()}>text</{child.name()}>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(child.name())');
      expect(result).toContain("'text'");
    });

    it('should handle computed tag name with embedded content expression', () => {
      const input = 'var x = <{name}>{value}</{name}>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(name)');
      expect(result).toContain('String(value)');
    });

    it('should NOT transpile computed tag names inside strings', () => {
      const input = 'var s = "<{expr}>content</{expr}>";';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('"<{expr}>content</{expr}>"');
    });

    it('should handle computed tag name with complex expression', () => {
      const input = 'var x = <{getTag("field")}>data</{getTag("field")}>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(getTag("field"))');
    });
  });

  describe('A3: Empty XMLList literal', () => {
    it('should convert <></> to XMLProxy.createList()', () => {
      const input = 'var children = <></>;';
      const result = transpiler.transpile(input).code;
      expect(result).toBe('var children = XMLProxy.createList();');
    });

    it('should handle <></> with whitespace inside', () => {
      const input = 'var x = <>  </>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('XMLProxy.createList()');
    });

    it('should NOT convert <></> inside strings', () => {
      const input = 'var s = "<></>";';
      const result = transpiler.transpile(input).code;
      expect(result).toBe('var s = "<></>";');
    });

    it('should handle multiple <></> in same line', () => {
      const input = 'var a = <></>; var b = <></>;';
      const result = transpiler.transpile(input).code;
      const matches = result.match(/XMLProxy\.createList\(\)/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle computed attrs with no spaces around =', () => {
      const input = 'var x = <tag name={val}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(val)');
    });

    it('should handle computed attr value with nested braces', () => {
      const input = 'var x = <tag data={JSON.stringify({a: 1})}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(JSON.stringify({a: 1}))');
    });

    it('should handle computed attr value with ternary expression', () => {
      const input = 'var x = <tag cls={active ? "on" : "off"}/>;';
      const result = transpiler.transpile(input).code;
      expect(result).toContain('String(active ? "on" : "off")');
    });
  });
});
