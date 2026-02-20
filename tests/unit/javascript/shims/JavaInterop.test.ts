/**
 * Tests for Java Interop Shims
 *
 * Validates that the lightweight Node.js implementations of common Java
 * classes behave correctly for real-world Mirth channel usage patterns.
 */

import {
  JavaURL,
  JavaSimpleDateFormat,
  JavaArrayList,
  JavaHashMap,
  JavaHashSet,
  JavaArrays,
  JavaStringBuffer,
  JavaSystem,
  JavaInteger,
  JavaLong,
  JavaSqlDate,
  JavaSqlTimestamp,
  JavaBufferedReader,
  JavaInputStreamReader,
  JavaInputStream,
  JavaOutputStreamWriter,
  JavaDataOutputStream,
  createJavaNamespace,
  createPackagesNamespace,
  JAVA_STRING_SETUP_SCRIPT,
} from '../../../../src/javascript/shims/JavaInterop.js';
import * as vm from 'vm';

// -------------------------------------------------------------------------
// B1: JavaURL
// -------------------------------------------------------------------------
describe('JavaURL', () => {
  it('should parse protocol', () => {
    const url = new JavaURL('https://api.example.com:8443/patients?id=123');
    expect(url.getProtocol()).toBe('https');
  });

  it('should parse host', () => {
    const url = new JavaURL('https://api.example.com:8443/patients');
    expect(url.getHost()).toBe('api.example.com');
  });

  it('should parse port', () => {
    const url = new JavaURL('https://api.example.com:8443/patients');
    expect(url.getPort()).toBe(8443);
  });

  it('should return -1 for default port', () => {
    const url = new JavaURL('https://api.example.com/patients');
    expect(url.getPort()).toBe(-1);
  });

  it('should parse path', () => {
    const url = new JavaURL('https://api.example.com:8443/patients/123');
    expect(url.getPath()).toBe('/patients/123');
  });

  it('should parse query', () => {
    const url = new JavaURL('https://example.com/api?key=val&b=2');
    expect(url.getQuery()).toBe('key=val&b=2');
  });

  it('should return null for no query', () => {
    const url = new JavaURL('https://example.com/api');
    expect(url.getQuery()).toBeNull();
  });

  it('should create HttpURLConnection via openConnection', () => {
    const url = new JavaURL('https://example.com');
    const conn = url.openConnection();
    expect(conn).toBeDefined();
    expect(typeof conn.setRequestMethod).toBe('function');
  });

  it('toString should return original URL', () => {
    const url = new JavaURL('https://example.com/test');
    expect(url.toString()).toBe('https://example.com/test');
  });

  it('should handle malformed URLs gracefully', () => {
    const url = new JavaURL('not-a-url');
    expect(url.getProtocol()).toBe('');
    expect(url.getHost()).toBe('');
    expect(url.getPort()).toBe(-1);
    expect(url.getPath()).toBe('');
  });
});

// -------------------------------------------------------------------------
// B1: JavaHttpURLConnection (via JavaURL.openConnection)
// -------------------------------------------------------------------------
describe('JavaHttpURLConnection', () => {
  it('should set and use request method', () => {
    const url = new JavaURL('https://example.com');
    const conn = url.openConnection();
    conn.setRequestMethod('POST');
    conn.setRequestProperty('Content-Type', 'application/json');
    // No assertion on method directly, but setDoOutput/setDoInput should not throw
    conn.setDoOutput(true);
    conn.setDoInput(true);
    conn.disconnect();
  });

  it('should provide an output stream', () => {
    const url = new JavaURL('https://example.com');
    const conn = url.openConnection();
    const os = conn.getOutputStream();
    expect(typeof os.write).toBe('function');
    os.write('test data');
    os.close();
  });

  it('should support JavaOutputStreamWriter', () => {
    const url = new JavaURL('https://example.com');
    const conn = url.openConnection();
    const writer = new JavaOutputStreamWriter(conn.getOutputStream());
    writer.write('test');
    writer.flush();
    writer.close();
  });

  it('should support JavaDataOutputStream', () => {
    const url = new JavaURL('https://example.com');
    const conn = url.openConnection();
    const dos = new JavaDataOutputStream(conn.getOutputStream());
    dos.writeBytes('test');
    dos.flush();
    dos.close();
  });
});

// -------------------------------------------------------------------------
// B1: JavaBufferedReader / InputStreamReader
// -------------------------------------------------------------------------
describe('JavaBufferedReader', () => {
  it('should read lines from an input stream', () => {
    const stream = new JavaInputStream('line1\nline2\nline3');
    const reader = new JavaInputStreamReader(stream);
    const br = new JavaBufferedReader(reader);

    expect(br.readLine()).toBe('line1');
    expect(br.readLine()).toBe('line2');
    expect(br.readLine()).toBe('line3');
    expect(br.readLine()).toBeNull();
  });

  it('should handle empty input', () => {
    const stream = new JavaInputStream('');
    const reader = new JavaInputStreamReader(stream);
    const br = new JavaBufferedReader(reader);

    expect(br.readLine()).toBe('');
    expect(br.readLine()).toBeNull();
  });

  it('close should be callable', () => {
    const stream = new JavaInputStream('data');
    const reader = new JavaInputStreamReader(stream);
    const br = new JavaBufferedReader(reader);
    br.close(); // no-op, should not throw
  });
});

// -------------------------------------------------------------------------
// B2: JavaSimpleDateFormat
// -------------------------------------------------------------------------
describe('JavaSimpleDateFormat', () => {
  it('should format a date', () => {
    const sdf = new JavaSimpleDateFormat('yyyy-MM-dd');
    const date = new Date(2026, 1, 20); // Feb 20, 2026
    const result = sdf.format(date);
    expect(result).toBe('2026-02-20');
  });

  it('should parse a date string', () => {
    const sdf = new JavaSimpleDateFormat('yyyy-MM-dd');
    const result = sdf.parse('2026-02-20');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // 0-indexed
    expect(result.getDate()).toBe(20);
  });

  it('should handle setLenient without error', () => {
    const sdf = new JavaSimpleDateFormat('yyyy-MM-dd');
    sdf.setLenient(true); // no-op
    sdf.setTimeZone(null); // no-op
  });
});

// -------------------------------------------------------------------------
// B3: JavaArrayList
// -------------------------------------------------------------------------
describe('JavaArrayList', () => {
  it('should construct empty', () => {
    const list = new JavaArrayList();
    expect(list.size()).toBe(0);
    expect(list.isEmpty()).toBe(true);
  });

  it('should construct from array', () => {
    const list = new JavaArrayList([1, 2, 3]);
    expect(list.size()).toBe(3);
    expect(list.get(0)).toBe(1);
  });

  it('should construct with capacity hint (ignored)', () => {
    const list = new JavaArrayList(100);
    expect(list.size()).toBe(0);
  });

  it('should add elements', () => {
    const list = new JavaArrayList<string>();
    list.add('a');
    list.add('b');
    expect(list.size()).toBe(2);
    expect(list.get(0)).toBe('a');
    expect(list.get(1)).toBe('b');
  });

  it('should add at index', () => {
    const list = new JavaArrayList(['a', 'c']);
    list.add(1, 'b');
    expect(list.size()).toBe(3);
    expect(list.get(1)).toBe('b');
    expect(list.get(2)).toBe('c');
  });

  it('should addAll', () => {
    const list = new JavaArrayList<number>();
    list.addAll([1, 2, 3]);
    expect(list.size()).toBe(3);
  });

  it('should set elements', () => {
    const list = new JavaArrayList(['a', 'b']);
    const old = list.set(0, 'z');
    expect(old).toBe('a');
    expect(list.get(0)).toBe('z');
  });

  it('should check contains', () => {
    const list = new JavaArrayList([1, 2, 3]);
    expect(list.contains(2)).toBe(true);
    expect(list.contains(5)).toBe(false);
  });

  it('should remove by index', () => {
    const list = new JavaArrayList(['a', 'b', 'c']);
    const removed = list.remove(1);
    expect(removed).toBe('b');
    expect(list.size()).toBe(2);
  });

  it('should remove by value', () => {
    const list = new JavaArrayList(['a', 'b', 'c']);
    const result = list.remove('b');
    expect(result).toBe(true);
    expect(list.size()).toBe(2);
  });

  it('should return false when removing non-existent value', () => {
    const list = new JavaArrayList(['a']);
    expect(list.remove('z')).toBe(false);
  });

  it('should clear', () => {
    const list = new JavaArrayList([1, 2, 3]);
    list.clear();
    expect(list.size()).toBe(0);
    expect(list.isEmpty()).toBe(true);
  });

  it('should convert to array', () => {
    const list = new JavaArrayList([1, 2, 3]);
    const arr = list.toArray();
    expect(arr).toEqual([1, 2, 3]);
    expect(arr).not.toBe(list); // different reference
  });

  it('should support iteration', () => {
    const list = new JavaArrayList([10, 20, 30]);
    const iter = list.iterator();
    const results: number[] = [];
    for (const val of iter) results.push(val);
    expect(results).toEqual([10, 20, 30]);
  });

  it('should return subList', () => {
    const list = new JavaArrayList([1, 2, 3, 4, 5]);
    const sub = list.subList(1, 3);
    expect(sub.size()).toBe(2);
    expect(sub.get(0)).toBe(2);
    expect(sub.get(1)).toBe(3);
  });
});

// -------------------------------------------------------------------------
// B3: JavaHashMap
// -------------------------------------------------------------------------
describe('JavaHashMap', () => {
  it('should put and get', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 1);
    expect(map.get('a')).toBe(1);
  });

  it('should return null for missing key', () => {
    const map = new JavaHashMap();
    expect(map.get('missing')).toBeNull();
  });

  it('should return previous value on put', () => {
    const map = new JavaHashMap<string, number>();
    expect(map.put('a', 1)).toBeNull();
    expect(map.put('a', 2)).toBe(1);
  });

  it('should check containsKey', () => {
    const map = new JavaHashMap<string, string>();
    map.put('key', 'value');
    expect(map.containsKey('key')).toBe(true);
    expect(map.containsKey('other')).toBe(false);
  });

  it('should check containsValue', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 42);
    expect(map.containsValue(42)).toBe(true);
    expect(map.containsValue(99)).toBe(false);
  });

  it('should remove', () => {
    const map = new JavaHashMap<string, string>();
    map.put('a', 'hello');
    expect(map.remove('a')).toBe('hello');
    expect(map.size()).toBe(0);
  });

  it('should report size and isEmpty', () => {
    const map = new JavaHashMap();
    expect(map.size()).toBe(0);
    expect(map.isEmpty()).toBe(true);
    map.put('x', 1);
    expect(map.size()).toBe(1);
    expect(map.isEmpty()).toBe(false);
  });

  it('should return keySet', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 1);
    map.put('b', 2);
    const keys = map.keySet();
    expect(keys.has('a')).toBe(true);
    expect(keys.has('b')).toBe(true);
  });

  it('should return values', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 1);
    map.put('b', 2);
    const vals = map.values();
    expect(vals).toContain(1);
    expect(vals).toContain(2);
  });

  it('should return entrySet', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 1);
    const entries = map.entrySet();
    expect(entries.length).toBe(1);
    expect(entries[0]!.getKey()).toBe('a');
    expect(entries[0]!.getValue()).toBe(1);
  });

  it('should putAll from another JavaHashMap', () => {
    const map1 = new JavaHashMap<string, number>();
    map1.put('a', 1);
    const map2 = new JavaHashMap<string, number>();
    map2.putAll(map1);
    expect(map2.get('a')).toBe(1);
  });

  it('should clear', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 1);
    map.clear();
    expect(map.size()).toBe(0);
  });

  it('should format toString', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 1);
    expect(map.toString()).toBe('{a=1}');
  });

  it('should construct from another JavaHashMap', () => {
    const original = new JavaHashMap<string, number>();
    original.put('x', 10);
    const copy = new JavaHashMap(original);
    expect(copy.get('x')).toBe(10);
  });

  it('should support iteration via Symbol.iterator', () => {
    const map = new JavaHashMap<string, number>();
    map.put('a', 1);
    map.put('b', 2);
    const entries: [string, number][] = [];
    for (const entry of map) entries.push(entry);
    expect(entries.length).toBe(2);
  });
});

// -------------------------------------------------------------------------
// B3: JavaHashSet
// -------------------------------------------------------------------------
describe('JavaHashSet', () => {
  it('should add elements', () => {
    const set = new JavaHashSet<string>();
    expect(set.add('a')).toBe(true);
    expect(set.add('a')).toBe(false); // already present
    expect(set.size()).toBe(1);
  });

  it('should check contains', () => {
    const set = new JavaHashSet<number>();
    set.add(42);
    expect(set.contains(42)).toBe(true);
    expect(set.contains(99)).toBe(false);
  });

  it('should remove', () => {
    const set = new JavaHashSet<string>();
    set.add('x');
    expect(set.remove('x')).toBe(true);
    expect(set.remove('x')).toBe(false);
    expect(set.size()).toBe(0);
  });

  it('should report isEmpty', () => {
    const set = new JavaHashSet();
    expect(set.isEmpty()).toBe(true);
    set.add('a');
    expect(set.isEmpty()).toBe(false);
  });

  it('should clear', () => {
    const set = new JavaHashSet();
    set.add(1);
    set.add(2);
    set.clear();
    expect(set.size()).toBe(0);
  });

  it('should convert toArray', () => {
    const set = new JavaHashSet<number>();
    set.add(1);
    set.add(2);
    const arr = set.toArray();
    expect(arr.sort()).toEqual([1, 2]);
  });

  it('should support iteration', () => {
    const set = new JavaHashSet<string>();
    set.add('a');
    set.add('b');
    const results: string[] = [];
    for (const val of set) results.push(val);
    expect(results.sort()).toEqual(['a', 'b']);
  });
});

// -------------------------------------------------------------------------
// B3: JavaArrays
// -------------------------------------------------------------------------
describe('JavaArrays', () => {
  it('asList should create from args', () => {
    const list = JavaArrays.asList(1, 2, 3);
    expect(list.size()).toBe(3);
    expect(list.get(0)).toBe(1);
  });

  it('asList should create from array', () => {
    const list = JavaArrays.asList([4, 5, 6]);
    expect(list.size()).toBe(3);
  });

  it('sort should sort in place', () => {
    const arr = [3, 1, 2];
    JavaArrays.sort(arr);
    expect(arr).toEqual([1, 2, 3]);
  });

  it('sort should support comparator', () => {
    const arr = [3, 1, 2];
    JavaArrays.sort(arr, (a, b) => b - a);
    expect(arr).toEqual([3, 2, 1]);
  });

  it('toString should format array', () => {
    expect(JavaArrays.toString([1, 2, 3])).toBe('[1, 2, 3]');
  });
});

// -------------------------------------------------------------------------
// B7: JavaStringBuffer (also used as StringBuilder)
// -------------------------------------------------------------------------
describe('JavaStringBuffer', () => {
  it('should append and toString', () => {
    const sb = new JavaStringBuffer();
    sb.append('hello').append(' ').append('world');
    expect(sb.toString()).toBe('hello world');
  });

  it('should construct with initial string', () => {
    const sb = new JavaStringBuffer('init');
    expect(sb.toString()).toBe('init');
  });

  it('should construct with capacity (ignored)', () => {
    const sb = new JavaStringBuffer(100);
    expect(sb.toString()).toBe('');
  });

  it('should report length', () => {
    const sb = new JavaStringBuffer('abc');
    expect(sb.length()).toBe(3);
  });

  it('should charAt', () => {
    const sb = new JavaStringBuffer('abc');
    expect(sb.charAt(1)).toBe('b');
  });

  it('should substring', () => {
    const sb = new JavaStringBuffer('abcdef');
    expect(sb.substring(2, 4)).toBe('cd');
    expect(sb.substring(2)).toBe('cdef');
  });

  it('should indexOf', () => {
    const sb = new JavaStringBuffer('hello world');
    expect(sb.indexOf('world')).toBe(6);
    expect(sb.indexOf('xyz')).toBe(-1);
  });

  it('should reverse', () => {
    const sb = new JavaStringBuffer('abc');
    sb.reverse();
    expect(sb.toString()).toBe('cba');
  });

  it('should insert', () => {
    const sb = new JavaStringBuffer('ac');
    sb.insert(1, 'b');
    expect(sb.toString()).toBe('abc');
  });

  it('should delete range', () => {
    const sb = new JavaStringBuffer('abcde');
    sb.delete(1, 3);
    expect(sb.toString()).toBe('ade');
  });

  it('should deleteCharAt', () => {
    const sb = new JavaStringBuffer('abc');
    sb.deleteCharAt(1);
    expect(sb.toString()).toBe('ac');
  });

  it('should replace range', () => {
    const sb = new JavaStringBuffer('abcde');
    sb.replace(1, 3, 'XY');
    expect(sb.toString()).toBe('aXYde');
  });

  it('should append various types', () => {
    const sb = new JavaStringBuffer();
    sb.append(42).append(true).append(null);
    expect(sb.toString()).toBe('42truenull');
  });
});

// -------------------------------------------------------------------------
// B8: JavaSystem
// -------------------------------------------------------------------------
describe('JavaSystem', () => {
  it('should get environment variable', () => {
    process.env['TEST_JAVA_INTEROP'] = 'hello';
    expect(JavaSystem.getenv('TEST_JAVA_INTEROP')).toBe('hello');
    delete process.env['TEST_JAVA_INTEROP'];
  });

  it('should return null for missing env var', () => {
    expect(JavaSystem.getenv('NONEXISTENT_VAR_12345')).toBeNull();
  });

  it('should return currentTimeMillis', () => {
    const before = Date.now();
    const result = JavaSystem.currentTimeMillis();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('should return nanoTime', () => {
    const result = JavaSystem.nanoTime();
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('should return lineSeparator', () => {
    expect(JavaSystem.lineSeparator()).toBe('\n');
  });

  it('should return system properties', () => {
    expect(JavaSystem.getProperty('os.name')).toBe(process.platform);
    expect(JavaSystem.getProperty('user.dir')).toBe(process.cwd());
    expect(JavaSystem.getProperty('java.version')).toBe('11.0.0');
    expect(JavaSystem.getProperty('file.separator')).toBe('/');
  });

  it('should return null for unknown property', () => {
    expect(JavaSystem.getProperty('nonexistent.property')).toBeNull();
  });

  it('should throw on System.exit', () => {
    expect(() => JavaSystem.exit(0)).toThrow('System.exit() is not allowed');
  });

  it('should not throw on gc()', () => {
    JavaSystem.gc(); // no-op
  });
});

// -------------------------------------------------------------------------
// java.lang.Integer / Long
// -------------------------------------------------------------------------
describe('JavaInteger', () => {
  it('should parseInt', () => {
    expect(JavaInteger.parseInt('42')).toBe(42);
    expect(JavaInteger.parseInt('FF', 16)).toBe(255);
  });

  it('should valueOf', () => {
    expect(JavaInteger.valueOf(42)).toBe(42);
    expect(JavaInteger.valueOf('42')).toBe(42);
  });
});

describe('JavaLong', () => {
  it('should parseLong', () => {
    expect(JavaLong.parseLong('123456789')).toBe(123456789);
  });

  it('should valueOf', () => {
    expect(JavaLong.valueOf(99)).toBe(99);
  });
});

// -------------------------------------------------------------------------
// java.sql.Date / Timestamp
// -------------------------------------------------------------------------
describe('JavaSqlDate', () => {
  it('should construct from millis', () => {
    const d = new JavaSqlDate(0);
    expect(d.getTime()).toBe(0);
  });

  it('should construct from string', () => {
    const d = new JavaSqlDate('2026-02-20');
    expect(d.getFullYear()).toBe(2026);
  });

  it('should construct with no args', () => {
    const d = new JavaSqlDate();
    expect(d instanceof Date).toBe(true);
  });

  it('valueOf should parse string', () => {
    const d = JavaSqlDate.valueOf('2026-06-15');
    // Use UTC to avoid timezone issues
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5); // June = 5
    expect(d.getUTCDate()).toBe(15);
  });
});

describe('JavaSqlTimestamp', () => {
  it('should construct from millis', () => {
    const ts = new JavaSqlTimestamp(1000);
    expect(ts.getTime()).toBe(1000);
  });

  it('should construct with current time', () => {
    const before = Date.now();
    const ts = new JavaSqlTimestamp();
    const after = Date.now();
    expect(ts.getTime()).toBeGreaterThanOrEqual(before);
    expect(ts.getTime()).toBeLessThanOrEqual(after);
  });

  it('should return nanos', () => {
    const ts = new JavaSqlTimestamp(1500);
    expect(ts.getNanos()).toBe(500 * 1000000); // 500ms in nanos
  });

  it('valueOf should parse string', () => {
    const ts = JavaSqlTimestamp.valueOf('2026-02-20T10:30:00Z');
    expect(ts instanceof Date).toBe(true);
  });
});

// -------------------------------------------------------------------------
// Unsupported classes
// -------------------------------------------------------------------------
describe('Unsupported Java classes', () => {
  it('Runtime should throw with guidance', () => {
    const ns = createJavaNamespace();
    const RuntimeFn = (ns.lang as Record<string, any>).Runtime;
    expect(() => RuntimeFn()).toThrow('java.lang.Runtime is not available');
    expect(() => RuntimeFn()).toThrow('FileUtil');
  });

  it('Thread should throw with guidance', () => {
    const ns = createJavaNamespace();
    const ThreadFn = (ns.lang as Record<string, any>).Thread;
    expect(() => ThreadFn()).toThrow('java.lang.Thread is not available');
    expect(() => ThreadFn()).toThrow('async patterns');
  });

  it('Packages.com.mirth.connect.server.controllers should throw', () => {
    const ns = createJavaNamespace();
    const pkgs = createPackagesNamespace(ns);
    const controllers = (pkgs as any).com.mirth.connect.server.controllers;
    expect(() => controllers.ChannelController()).toThrow('not available');
  });

  it('log4j Logger.getLogger should throw', () => {
    const ns = createJavaNamespace();
    const pkgs = createPackagesNamespace(ns);
    const getLogger = (pkgs as any).org.apache.log4j.Logger.getLogger;
    expect(() => getLogger('test')).toThrow('org.apache.log4j.Logger is not available');
  });
});

// -------------------------------------------------------------------------
// createJavaNamespace structure
// -------------------------------------------------------------------------
describe('createJavaNamespace', () => {
  it('should have all top-level packages', () => {
    const ns = createJavaNamespace();
    expect(ns.net).toBeDefined();
    expect(ns.io).toBeDefined();
    expect(ns.text).toBeDefined();
    expect(ns.util).toBeDefined();
    expect(ns.lang).toBeDefined();
    expect(ns.sql).toBeDefined();
  });

  it('should expose URL in java.net', () => {
    const ns = createJavaNamespace();
    expect((ns.net as any).URL).toBe(JavaURL);
  });

  it('should expose collections in java.util', () => {
    const ns = createJavaNamespace();
    const util = ns.util as Record<string, any>;
    expect(util.ArrayList).toBe(JavaArrayList);
    expect(util.HashMap).toBe(JavaHashMap);
    expect(util.LinkedHashMap).toBe(JavaHashMap);
    expect(util.HashSet).toBe(JavaHashSet);
    expect(util.Arrays).toBe(JavaArrays);
  });

  it('should expose String, Integer, Long, System in java.lang', () => {
    const ns = createJavaNamespace();
    const lang = ns.lang as Record<string, any>;
    expect(lang.String).toBe(String);
    expect(lang.Integer).toBeDefined();
    expect(lang.Long).toBeDefined();
    expect(lang.System).toBe(JavaSystem);
    expect(lang.StringBuilder).toBe(JavaStringBuffer);
    expect(lang.StringBuffer).toBe(JavaStringBuffer);
  });
});

// -------------------------------------------------------------------------
// createPackagesNamespace structure
// -------------------------------------------------------------------------
describe('createPackagesNamespace', () => {
  it('should have java sub-namespace', () => {
    const ns = createJavaNamespace();
    const pkgs = createPackagesNamespace(ns);
    expect((pkgs as any).java).toBe(ns);
  });

  it('should have org.apache.commons.lang3 placeholder', () => {
    const ns = createJavaNamespace();
    const pkgs = createPackagesNamespace(ns);
    expect((pkgs as any).org.apache.commons.lang3).toBeDefined();
    expect((pkgs as any).org.apache.commons.lang).toBeDefined();
  });
});

// -------------------------------------------------------------------------
// B4: Java String.prototype setup (via VM execution)
// -------------------------------------------------------------------------
describe('JAVA_STRING_SETUP_SCRIPT', () => {
  it('should be a non-empty string', () => {
    expect(typeof JAVA_STRING_SETUP_SCRIPT).toBe('string');
    expect(JAVA_STRING_SETUP_SCRIPT.length).toBeGreaterThan(0);
  });

  it('should make equals() work in VM context', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"hello".equals("hello")', context);
    expect(result).toBe(true);
  });

  it('should make equalsIgnoreCase() work', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"Hello".equalsIgnoreCase("hello")', context);
    expect(result).toBe(true);
  });

  it('should make matches() work', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"abc123".matches("[a-z]+[0-9]+")', context);
    expect(result).toBe(true);
  });

  it('should make isEmpty() work', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const empty = vm.runInContext('"".isEmpty()', context);
    const notEmpty = vm.runInContext('"a".isEmpty()', context);
    expect(empty).toBe(true);
    expect(notEmpty).toBe(false);
  });

  it('should make contains() work', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"hello world".contains("world")', context);
    expect(result).toBe(true);
  });

  it('should make replaceAll() work (regex-based)', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"aXbXc".replaceAll("X", "-")', context);
    expect(result).toBe('a-b-c');
  });

  it('should make replaceFirst() work', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"aXbXc".replaceFirst("X", "-")', context);
    expect(result).toBe('a-bXc');
  });

  it('should make getBytes() return a Buffer', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"hello".getBytes()', context);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe('hello');
  });

  it('should make compareTo() work', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    expect(vm.runInContext('"a".compareTo("b")', context)).toBe(-1);
    expect(vm.runInContext('"b".compareTo("a")', context)).toBe(1);
    expect(vm.runInContext('"a".compareTo("a")', context)).toBe(0);
  });

  it('should make toCharArray() work', () => {
    const context = vm.createContext({ Buffer });
    vm.runInContext(JAVA_STRING_SETUP_SCRIPT, context);
    const result = vm.runInContext('"abc".toCharArray()', context);
    expect(result).toEqual(['a', 'b', 'c']);
  });
});
