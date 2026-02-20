/**
 * Java Interop Shims — Node.js implementations of common Java classes
 * used by real-world Mirth Connect channels.
 *
 * In Java Mirth, channels run on Rhino (embedded JavaScript engine) which
 * has direct access to the JVM's class loader via `Packages.java.*`.
 * In Node.js Mirth, there is no JVM — so we provide lightweight shims
 * that replicate the most commonly used Java APIs.
 *
 * Covered:
 *   B1: java.net.URL + HttpURLConnection
 *   B2: java.text.SimpleDateFormat
 *   B3: java.util.ArrayList, HashMap, LinkedHashMap, HashSet, Arrays
 *   B4: String.prototype extensions (equals, matches, getBytes, etc.)
 *   B7: java.lang.StringBuilder / StringBuffer
 *   B8: java.lang.System
 *   java.sql.Date, java.sql.Timestamp
 *   Unsupported class stubs (Runtime, Thread, log4j, controllers)
 */

import { execFileSync } from 'child_process';
import { DateUtil } from '../userutil/DateUtil.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createUnsupported(className: string, guidance: string): (...args: unknown[]) => never {
  const fn = function (): never {
    throw new Error(`${className} is not available in Node.js Mirth. ${guidance}`);
  };
  // Also trap `new UnsupportedClass()` by making the function a constructor
  return fn;
}

// ---------------------------------------------------------------------------
// B1: java.net.URL + HttpURLConnection
// ---------------------------------------------------------------------------

class JavaOutputStream {
  private conn: JavaHttpURLConnection;
  constructor(conn: JavaHttpURLConnection) {
    this.conn = conn;
  }
  write(data: string | number[]): void {
    this.conn._setOutputData(typeof data === 'string' ? data : String.fromCharCode(...data));
  }
  flush(): void { /* no-op */ }
  close(): void { /* no-op */ }
}

class JavaOutputStreamWriter {
  private stream: JavaOutputStream;
  constructor(stream: JavaOutputStream) {
    this.stream = stream;
  }
  write(data: string): void {
    this.stream.write(data);
  }
  flush(): void { /* no-op */ }
  close(): void { /* no-op */ }
}

class JavaDataOutputStream {
  private stream: JavaOutputStream;
  constructor(stream: JavaOutputStream) {
    this.stream = stream;
  }
  writeBytes(data: string): void {
    this.stream.write(data);
  }
  flush(): void { /* no-op */ }
  close(): void { /* no-op */ }
}

class JavaInputStream {
  public data: string;
  constructor(data: string) {
    this.data = data;
  }
}

class JavaInputStreamReader {
  public stream: JavaInputStream;
  constructor(stream: JavaInputStream) {
    this.stream = stream;
  }
}

class JavaBufferedReader {
  private lines: string[];
  private index = 0;
  constructor(reader: JavaInputStreamReader) {
    this.lines = reader.stream.data.split('\n');
  }
  readLine(): string | null {
    return this.index < this.lines.length ? this.lines[this.index++]! : null;
  }
  close(): void { /* no-op */ }
}

interface HttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

class JavaHttpURLConnection {
  private url: string;
  private method = 'GET';
  private headers: Record<string, string> = {};
  private outputData = '';
  private _response: HttpResponse | null = null;

  constructor(url: string) {
    this.url = url;
  }

  setDoOutput(_v: boolean): void { /* no-op: Node.js handles automatically */ }
  setDoInput(_v: boolean): void { /* no-op */ }
  setRequestMethod(m: string): void { this.method = m.toUpperCase(); }
  setRequestProperty(k: string, v: string): void { this.headers[k] = v; }
  addRequestProperty(k: string, v: string): void { this.headers[k] = v; }
  setConnectTimeout(_ms: number): void { /* absorbed into executeSync timeout */ }
  setReadTimeout(_ms: number): void { /* absorbed into executeSync timeout */ }

  getOutputStream(): JavaOutputStream { return new JavaOutputStream(this); }
  getInputStream(): JavaInputStream {
    const resp = this.executeSync();
    return new JavaInputStream(resp.body);
  }
  getResponseCode(): number {
    return this.executeSync().statusCode;
  }
  getResponseMessage(): string {
    return '';
  }
  getHeaderField(name: string): string | null {
    return this.executeSync().headers[name.toLowerCase()] ?? null;
  }
  disconnect(): void { /* no-op */ }

  /** @internal */
  _setOutputData(data: string): void {
    this.outputData = data;
  }

  private executeSync(): HttpResponse {
    if (this._response) return this._response;

    const proto = this.url.startsWith('https') ? 'https' : 'http';
    const script = `
      const http = require('${proto}');
      const options = ${JSON.stringify({ method: this.method, headers: this.headers })};
      const req = http.request('${this.url.replace(/'/g, "\\'")}', options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          process.stdout.write(JSON.stringify({ statusCode: res.statusCode, headers: res.headers, body: data }));
        });
      });
      req.on('error', (e) => {
        process.stdout.write(JSON.stringify({ statusCode: 0, headers: {}, body: e.message }));
      });
      ${this.outputData ? `req.write(${JSON.stringify(this.outputData)});` : ''}
      req.end();
    `;

    try {
      const result = execFileSync(process.execPath, ['-e', script], {
        timeout: 30000,
        encoding: 'utf-8',
      });
      this._response = JSON.parse(result) as HttpResponse;
    } catch {
      this._response = { statusCode: 0, body: '', headers: {} };
    }
    return this._response;
  }
}

class JavaURL {
  private urlStr: string;
  constructor(urlStr: string) {
    this.urlStr = String(urlStr);
  }
  openConnection(): JavaHttpURLConnection {
    return new JavaHttpURLConnection(this.urlStr);
  }
  toString(): string { return this.urlStr; }
  getProtocol(): string {
    try { return new URL(this.urlStr).protocol.replace(':', ''); } catch { return ''; }
  }
  getHost(): string {
    try { return new URL(this.urlStr).hostname; } catch { return ''; }
  }
  getPort(): number {
    try { const p = new URL(this.urlStr).port; return p ? parseInt(p) : -1; } catch { return -1; }
  }
  getPath(): string {
    try { return new URL(this.urlStr).pathname; } catch { return ''; }
  }
  getQuery(): string | null {
    try { return new URL(this.urlStr).search.slice(1) || null; } catch { return null; }
  }
}

// ---------------------------------------------------------------------------
// B2: java.text.SimpleDateFormat
// ---------------------------------------------------------------------------

class JavaSimpleDateFormat {
  private pattern: string;
  constructor(pattern: string) {
    this.pattern = pattern;
  }
  parse(dateStr: string): Date {
    return DateUtil.getDate(this.pattern, dateStr);
  }
  format(date: Date): string {
    return DateUtil.formatDate(this.pattern, date);
  }
  setLenient(_lenient: boolean): void { /* no-op */ }
  setTimeZone(_tz: unknown): void { /* no-op — timezone support is a known limitation */ }
}

// ---------------------------------------------------------------------------
// B3: java.util.ArrayList
// ---------------------------------------------------------------------------

class JavaArrayList<T = unknown> extends Array<T> {
  constructor(initialCapacityOrCollection?: number | T[]) {
    super();
    Object.setPrototypeOf(this, JavaArrayList.prototype);
    if (Array.isArray(initialCapacityOrCollection)) {
      this.push(...initialCapacityOrCollection);
    }
    // number arg = initial capacity hint, ignore in JS
  }
  add(item: T): boolean;
  add(index: number, item: T): void;
  add(indexOrItem: number | T, item?: T): boolean | void {
    if (item !== undefined && typeof indexOrItem === 'number') {
      this.splice(indexOrItem, 0, item);
      return;
    }
    this.push(indexOrItem as T);
    return true;
  }
  addAll(items: T[] | JavaArrayList<T>): boolean {
    this.push(...items);
    return true;
  }
  get(index: number): T { return this[index]!; }
  set(index: number, item: T): T {
    const old = this[index]!;
    this[index] = item;
    return old;
  }
  size(): number { return this.length; }
  isEmpty(): boolean { return this.length === 0; }
  contains(item: T): boolean { return this.includes(item); }
  remove(indexOrItem: number | T): T | boolean {
    if (typeof indexOrItem === 'number') {
      return this.splice(indexOrItem, 1)[0]!;
    }
    const idx = super.indexOf(indexOrItem);
    if (idx >= 0) { this.splice(idx, 1); return true; }
    return false;
  }
  clear(): void { this.length = 0; }
  toArray(): T[] { return [...this]; }
  iterator(): IterableIterator<T> { return this[Symbol.iterator](); }
  subList(from: number, to: number): JavaArrayList<T> {
    return new JavaArrayList(this.slice(from, to));
  }
}

// ---------------------------------------------------------------------------
// B3: java.util.HashMap / LinkedHashMap
// ---------------------------------------------------------------------------

class JavaHashMap<K = unknown, V = unknown> {
  private map = new Map<K, V>();
  constructor(initial?: Map<K, V> | JavaHashMap<K, V>) {
    if (initial instanceof JavaHashMap) {
      for (const [k, v] of initial.map) this.map.set(k, v);
    } else if (initial instanceof Map) {
      for (const [k, v] of initial) this.map.set(k, v);
    }
  }
  put(key: K, value: V): V | null {
    const prev = this.map.get(key) ?? null;
    this.map.set(key, value);
    return prev as V | null;
  }
  get(key: K): V | null { return this.map.get(key) ?? null; }
  containsKey(key: K): boolean { return this.map.has(key); }
  containsValue(value: V): boolean {
    for (const v of this.map.values()) if (v === value) return true;
    return false;
  }
  remove(key: K): V | null {
    const v = this.map.get(key) ?? null;
    this.map.delete(key);
    return v as V | null;
  }
  size(): number { return this.map.size; }
  isEmpty(): boolean { return this.map.size === 0; }
  keySet(): Set<K> { return new Set(this.map.keys()); }
  values(): V[] { return [...this.map.values()]; }
  entrySet(): Array<{ getKey: () => K; getValue: () => V }> {
    return [...this.map.entries()].map(([k, v]) => ({ getKey: () => k, getValue: () => v }));
  }
  putAll(other: JavaHashMap<K, V> | Map<K, V>): void {
    const source = other instanceof JavaHashMap ? other.map : other;
    for (const [k, v] of source) this.map.set(k, v);
  }
  clear(): void { this.map.clear(); }
  toString(): string {
    return `{${[...this.map.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}}`;
  }
  // Support for-in / for-of iteration patterns used in Mirth scripts
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.map[Symbol.iterator]();
  }
}

// ---------------------------------------------------------------------------
// B3: java.util.HashSet
// ---------------------------------------------------------------------------

class JavaHashSet<T = unknown> {
  private set = new Set<T>();
  add(item: T): boolean { const had = this.set.has(item); this.set.add(item); return !had; }
  contains(item: T): boolean { return this.set.has(item); }
  remove(item: T): boolean { return this.set.delete(item); }
  size(): number { return this.set.size; }
  isEmpty(): boolean { return this.set.size === 0; }
  clear(): void { this.set.clear(); }
  toArray(): T[] { return [...this.set]; }
  iterator(): IterableIterator<T> { return this.set[Symbol.iterator](); }
  [Symbol.iterator](): IterableIterator<T> { return this.set[Symbol.iterator](); }
}

// ---------------------------------------------------------------------------
// B3: java.util.Arrays
// ---------------------------------------------------------------------------

const JavaArrays = {
  asList: <T>(...args: T[] | [T[]]): JavaArrayList<T> => {
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] as T[] : args as T[];
    return new JavaArrayList<T>(items);
  },
  sort: <T>(arr: T[], comparator?: (a: T, b: T) => number): void => { arr.sort(comparator); },
  toString: (arr: unknown[]): string => `[${arr.join(', ')}]`,
  copyOf: <T>(original: T[], newLength: number): T[] => original.slice(0, newLength),
  fill: <T>(arr: T[], value: T): void => { arr.fill(value); },
};

// ---------------------------------------------------------------------------
// B7: java.lang.StringBuilder / StringBuffer
// ---------------------------------------------------------------------------

class JavaStringBuffer {
  private parts: string[] = [];
  constructor(initial?: string | number) {
    if (typeof initial === 'string') {
      this.parts.push(initial);
    }
    // number = initial capacity, ignore in JS
  }
  append(str: unknown): JavaStringBuffer { this.parts.push(String(str)); return this; }
  insert(index: number, str: unknown): JavaStringBuffer {
    const current = this.toString();
    this.parts = [current.slice(0, index) + String(str) + current.slice(index)];
    return this;
  }
  delete(start: number, end: number): JavaStringBuffer {
    const current = this.toString();
    this.parts = [current.slice(0, start) + current.slice(end)];
    return this;
  }
  deleteCharAt(index: number): JavaStringBuffer { return this.delete(index, index + 1); }
  replace(start: number, end: number, str: string): JavaStringBuffer {
    const current = this.toString();
    this.parts = [current.slice(0, start) + str + current.slice(end)];
    return this;
  }
  toString(): string { return this.parts.join(''); }
  length(): number { return this.toString().length; }
  charAt(index: number): string { return this.toString().charAt(index); }
  substring(start: number, end?: number): string { return this.toString().substring(start, end); }
  indexOf(str: string, fromIndex?: number): number { return this.toString().indexOf(str, fromIndex); }
  reverse(): JavaStringBuffer {
    this.parts = [this.toString().split('').reverse().join('')];
    return this;
  }
}

// ---------------------------------------------------------------------------
// B8: java.lang.System
// ---------------------------------------------------------------------------

const JavaSystem = {
  getenv: (key: string): string | null => process.env[key] ?? null,
  currentTimeMillis: (): number => Date.now(),
  nanoTime: (): number => Math.floor(performance.now() * 1e6),
  lineSeparator: (): string => '\n',
  getProperty: (key: string): string | null => {
    const props: Record<string, string> = {
      'os.name': process.platform,
      'os.arch': process.arch,
      'user.dir': process.cwd(),
      'user.home': process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
      'file.separator': '/',
      'path.separator': ':',
      'line.separator': '\n',
      'java.version': '11.0.0', // Pretend to be Java 11
      'java.vendor': 'Node.js Runtime',
    };
    return props[key] ?? null;
  },
  exit: (_code: number): void => {
    throw new Error('System.exit() is not allowed in Mirth scripts.');
  },
  gc: (): void => { /* no-op */ },
};

// ---------------------------------------------------------------------------
// java.lang.Integer / Long
// ---------------------------------------------------------------------------

const JavaInteger = {
  parseInt: (s: string, radix?: number): number => parseInt(s, radix ?? 10),
  valueOf: (n: number | string): number => typeof n === 'string' ? parseInt(n, 10) : n,
  MAX_VALUE: 2147483647,
  MIN_VALUE: -2147483648,
  toString: (n: number, radix?: number): string => n.toString(radix),
};

const JavaLong = {
  parseLong: (s: string, radix?: number): number => parseInt(s, radix ?? 10),
  valueOf: (n: number | string): number => typeof n === 'string' ? parseInt(n, 10) : n,
  MAX_VALUE: Number.MAX_SAFE_INTEGER,
  MIN_VALUE: Number.MIN_SAFE_INTEGER,
};

// ---------------------------------------------------------------------------
// java.sql.Date / Timestamp
// ---------------------------------------------------------------------------

class JavaSqlDate extends Date {
  constructor(millis?: number | string) {
    if (typeof millis === 'string') super(millis);
    else if (millis !== undefined) super(millis);
    else super();
  }
  static valueOf(dateStr: string): JavaSqlDate { return new JavaSqlDate(dateStr); }
}

class JavaSqlTimestamp extends Date {
  constructor(millis?: number) { super(millis ?? Date.now()); }
  static valueOf(str: string): JavaSqlTimestamp {
    return new JavaSqlTimestamp(new Date(str).getTime());
  }
  getNanos(): number { return (this.getMilliseconds() % 1000) * 1000000; }
}

// ---------------------------------------------------------------------------
// createJavaNamespace — full java.* package tree
// ---------------------------------------------------------------------------

export function createJavaNamespace(): Record<string, unknown> {
  return {
    net: { URL: JavaURL },
    io: {
      BufferedReader: JavaBufferedReader,
      InputStreamReader: JavaInputStreamReader,
      OutputStreamWriter: JavaOutputStreamWriter,
      DataOutputStream: JavaDataOutputStream,
    },
    text: { SimpleDateFormat: JavaSimpleDateFormat },
    util: {
      ArrayList: JavaArrayList,
      HashMap: JavaHashMap,
      LinkedHashMap: JavaHashMap, // JS Map preserves insertion order
      HashSet: JavaHashSet,
      Arrays: JavaArrays,
      Date: Date, // java.util.Date → native JS Date
    },
    lang: {
      String: String,
      Integer: JavaInteger,
      Long: JavaLong,
      System: JavaSystem,
      StringBuilder: JavaStringBuffer,
      StringBuffer: JavaStringBuffer,
      Runtime: createUnsupported('java.lang.Runtime',
        'Use a destination connector or FileUtil for external processes.'),
      Thread: createUnsupported('java.lang.Thread',
        'Node.js is single-threaded — use async patterns instead.'),
    },
    sql: {
      Date: JavaSqlDate,
      Timestamp: JavaSqlTimestamp,
    },
  };
}

// ---------------------------------------------------------------------------
// createPackagesNamespace — Packages.java / Packages.org / Packages.com tree
// ---------------------------------------------------------------------------

export function createPackagesNamespace(javaNamespace: Record<string, unknown>): Record<string, unknown> {
  return {
    java: javaNamespace,
    org: {
      apache: {
        commons: {
          lang3: { StringUtils: null }, // Filled in by ScopeBuilder
          lang: { StringUtils: null },  // Legacy package
        },
        log4j: {
          Logger: {
            getLogger: createUnsupported(
              'org.apache.log4j.Logger',
              'Use the injected logger object: logger.info(), logger.warn(), logger.error()'
            ),
          },
        },
      },
    },
    com: {
      mirth: {
        connect: {
          server: {
            controllers: new Proxy({}, {
              get: (_target, prop) => createUnsupported(
                `com.mirth.connect.server.controllers.${String(prop)}`,
                'Use the REST API or injected userutil classes instead.'
              ),
            }),
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Java String.prototype setup script (B4)
//
// This string is evaluated inside the VM context before user scripts run.
// It safely extends String.prototype *only inside the sandbox*.
// ---------------------------------------------------------------------------

export const JAVA_STRING_SETUP_SCRIPT = `
  String.prototype.equals = function(other) { return this.valueOf() === String(other); };
  String.prototype.equalsIgnoreCase = function(other) {
    return this.valueOf().toLowerCase() === String(other).toLowerCase();
  };
  String.prototype.compareTo = function(other) {
    var a = this.valueOf(), b = String(other);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  String.prototype.compareToIgnoreCase = function(other) {
    var a = this.valueOf().toLowerCase(), b = String(other).toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  };
  String.prototype.matches = function(regex) {
    return new RegExp('^(?:' + regex + ')$').test(this.valueOf());
  };
  String.prototype.isEmpty = function() { return this.length === 0; };
  String.prototype.contains = function(s) { return this.indexOf(s) !== -1; };
  String.prototype.replaceAll = function(regex, replacement) {
    return this.replace(new RegExp(regex, 'g'), replacement);
  };
  String.prototype.replaceFirst = function(regex, replacement) {
    return this.replace(new RegExp(regex), replacement);
  };
  String.prototype.getBytes = function(charset) {
    return Buffer.from(this.valueOf(), charset || 'utf-8');
  };
  String.prototype.toCharArray = function() {
    return this.valueOf().split('');
  };
  String.prototype.charAt = String.prototype.charAt;
  String.prototype.substring = String.prototype.substring;
  String.prototype.length = String.prototype.length;
`;

// Re-export individual classes for direct import if needed
export {
  JavaURL,
  JavaHttpURLConnection,
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
  JavaOutputStream,
  JavaOutputStreamWriter,
  JavaDataOutputStream,
  JavaInputStream,
};
