/**
 * Tests for XMLProxy.child() method (E4X child() API).
 *
 * C1: child(index) returns child by position
 *     child(name) returns child by name (equivalent to .get())
 */

import { XMLProxy } from '../../../../src/javascript/e4x/XMLProxy.js';

describe('XMLProxy.child()', () => {
  it('should return first child by index 0', () => {
    const xml = XMLProxy.create('<root><PID>patient</PID><PV1>visit</PV1></root>');
    const child = xml.child(0);
    expect(child.name().toString()).toBe('PID');
    expect(child.toString()).toBe('patient');
  });

  it('should return second child by index 1', () => {
    const xml = XMLProxy.create('<root><PID>patient</PID><PV1>visit</PV1></root>');
    const child = xml.child(1);
    expect(child.name().toString()).toBe('PV1');
    expect(child.toString()).toBe('visit');
  });

  it('should return child by name (equivalent to .get())', () => {
    const xml = XMLProxy.create('<root><PID>patient</PID><PV1>visit</PV1></root>');
    const child = xml.child('PID');
    expect(child.toString()).toBe('patient');
  });

  it('should return empty XMLProxy for out-of-bounds index', () => {
    const xml = XMLProxy.create('<root><PID>patient</PID></root>');
    const child = xml.child(999);
    expect(child.length()).toBe(0);
    expect(child.toString()).toBe('');
  });

  it('should support chaining child(0).name()', () => {
    const xml = XMLProxy.create('<root><MSH>header</MSH><PID>patient</PID></root>');
    const name = xml.child(0).name().toString();
    expect(name).toBe('MSH');
  });

  it('should support nested child(i).child(j)', () => {
    const xml = XMLProxy.create('<root><PID><PID.3>id</PID.3><PID.5>name</PID.5></PID></root>');
    const pid = xml.child(0); // PID
    const pid5 = pid.child(1); // PID.5
    expect(pid5.toString()).toBe('name');
  });

  it('should prioritize .child() method over XML element named "child"', () => {
    // If a node has a child element literally named "child",
    // the method call .child(0) should still work as a method
    const xml = XMLProxy.create('<root><child>element</child></root>');
    // .child(0) should call the method (returns first child element)
    const firstChild = xml.child(0);
    expect(firstChild.name().toString()).toBe('child');
    expect(firstChild.toString()).toBe('element');
  });

  it('should return empty for .child() on empty XMLProxy', () => {
    const xml = XMLProxy.createEmpty();
    expect(xml.child(0).length()).toBe(0);
    expect(xml.child('anything').length()).toBe(0);
  });
});
