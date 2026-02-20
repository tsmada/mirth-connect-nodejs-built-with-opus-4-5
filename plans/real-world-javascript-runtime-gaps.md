# Plan: Real-World JavaScript Runtime Gap Discovery & Remediation

<!-- Completed: 2026-02-20 | Status: Implemented -->
<!-- Original: crystalline-mixing-robin.md -->

## Context

The Node.js Mirth engine has been validated through 15+ automated scanning waves (js-runtime-checker, connector-parity-checker, etc.) and deep functional validation on Kubernetes. However, **all prior testing used synthetic test cases** — patterns we anticipated. Real-world Mirth channels found on GitHub use JavaScript patterns that our synthetic tests never exercised.

Research from 20+ GitHub sources (nextgenhealthcare/connect-examples, RSNA, SwissTPH, AWS samples, community gists) reveals **3 categories of undiscovered gaps** that would break production channels.

### Why Not Native Java Interop (N-API / JNI)?

Investigated and **rejected** — the `vm.createContext()` sandbox is the dealbreaker:

| Approach | Why Rejected |
|----------|-------------|
| `java` (node-java, JNI/NAN) | N-API objects can't cross VM context boundary; broken on Apple Silicon; Node.js 20 only recently supported |
| `java-bridge` (Rust/napi-rs) | Same VM boundary issue — objects created by native addons hold references to the outer V8 Context; constructors throw TypeError inside `vm.createContext()` |
| `java-caller` (subprocess) | 50–200ms per call latency — 1000x too slow for per-message script execution |
| GraalVM polyglot | Requires replacing V8 runtime entirely, invalidating 22 waves of parity calibration; +500MB–1GB memory |

**The V8 constraint:** `NAPI_ADDON_INIT()` binds to a specific V8 Context. When injected into a different context (our sandbox), the prototype chain breaks. This is documented by Node.js core maintainers and has no workaround short of removing the sandbox entirely.

**Decision:** JavaScript shims with migration warnings + throw with clear messages for unsupported Java internals.

## Gap Summary (Prioritized by Real-World Impact)

### Category A: E4X Transpiler Gaps (3 bugs — would silently produce wrong output)

| # | Gap | Example | Impact | Sources |
|---|-----|---------|--------|---------|
| A1 | **Computed XML attributes** `<tag attr={variable}/>` | `<columns name={columnName} type={type} />` | Variable values replaced by literal `{columnName}` text | SwissTPH, connect-examples |
| A2 | **Computed tag names** `<{expr}>content</{expr}>` | `<{child.name()}>text</{child.name()}>` | SyntaxError at runtime | connect-examples (unescape HL7) |
| A3 | **Empty XMLList literal** `<></>` | `var children = <></>;` | Untranspiled, SyntaxError | SwissTPH |

**Root cause (A1):** `transpileXMLLiterals()` line 313 captures self-closing tags with regex `(<(\w+)(?:\s+[^>]*)?\/\s*>)` and wraps the entire match in `XMLProxy.create('...')` as an escaped string. The `{expr}` in attributes is never processed by `convertEmbeddedToConcat()`.

**Root cause (A2):** Tag name regex requires `\w+` — `{expr}` doesn't match word characters.

**Root cause (A3):** Empty tag name doesn't match `\w+` pattern.

### Category B: Java Interop Shim Gaps (7 gaps — would throw TypeError/ReferenceError)

| # | Gap | Example | Impact | Sources |
|---|-----|---------|--------|---------|
| B1 | **`java.net.URL` + `java.io.*` HTTP pattern** | `new java.net.URL(endpoint).openConnection()` | TypeError: undefined is not a constructor | 3 gists (most common HTTP pattern) |
| B2 | **`java.text.SimpleDateFormat`** | `new java.text.SimpleDateFormat("yyyyMMdd")` | TypeError | RSNA HL7 receiver |
| B3 | **`java.util.ArrayList/HashMap/LinkedHashMap`** | `new java.util.ArrayList(); params.add(...)` | TypeError | RSNA, SwissTPH, connect-examples |
| B4 | **`String.equals()` / `equalsIgnoreCase()`** | `str.equals("")`, `str.equalsIgnoreCase("Y")` | TypeError: not a function | RSNA, SwissTPH |
| B5 | **`globalMap.lock()`/`unlock()`/`containsKeySync()`/`putSync()`** | Thread-safe init pattern | TypeError: not a function | connect-examples (official!) |
| B6 | **`org.apache.commons.lang3.StringUtils`** | `StringUtils.countMatches(qname, '.')` | ReferenceError | connect-examples (xmlToHL7) |
| B7 | **`java.lang.StringBuffer`** | `new java.lang.StringBuffer()` | TypeError | 3 gists (HTTP response reading) |

### Category C: XMLProxy Method Gaps (1 gap)

| # | Gap | Example | Impact | Sources |
|---|-----|---------|--------|---------|
| C1 | **Missing `.child(index)` method** | `newNode.child(i).name()` | Returns empty XMLProxy (silent failure) | connect-examples (fixHL7NodeOrder) |

## Implementation Plan

### Phase 1: Build Real-World Test Channel Suite (Research + Test Writing)

Create 8 test channels derived from actual GitHub examples that exercise the discovered gaps. Each channel is a targeted test case with assertions.

**File:** `tests/integration/real-world-channels/` (new directory)

#### Test Channel 1: E4X Computed Attributes (SwissTPH pattern)
```javascript
// FROM: SwissTPH/Mirth-Channels — database schema builder
function addRow(columnName, type, defaultValue, size) {
    var dataEntry = <columns column={columnName} name={columnName} type={type}
        default_value={defaultValue} size={size} />;
    return dataEntry;
}
var row = addRow("_URI", "VARCHAR", null, "80");
// ASSERT: row.@column === "_URI", row.@type === "VARCHAR"
```

#### Test Channel 2: E4X-to-JSON Recursive Converter (shadowdoc pattern)
```javascript
// FROM: gist.github.com/shadowdoc/5884834
// Exercises: xml.*, xml.@*, .localName(), .text(), for each...in, .length()
function E4XtoJSON(xml, ignored) {
    var r, children = xml.*, attributes = xml.@*, length = children.length();
    // ... full recursive converter
}
```

#### Test Channel 3: XMLList Filter with Callback (connect-examples xFilter)
```javascript
// FROM: nextgenhealthcare/connect-examples — Filter XMLLists
// Exercises: new XMLList(), ret += node, .length(), callback filtering
function xFilter(xmlList, callback, minLimit, maxReturned) { ... }
```

#### Test Channel 4: Strip Empty Nodes with E4X Delete (connect-examples)
```javascript
// FROM: nextgenhealthcare/connect-examples — Strip Empty Nodes
// Exercises: delete node.children()[i], new XML('<...'), .name(), .children().length()
function stripEmptyNodes(node, stripWhitespaceNodes) { ... }
```

#### Test Channel 5: HL7 Date Parsing with Java SimpleDateFormat (RSNA pattern)
```javascript
// FROM: RSNA/isn-edge-server-hl7-receiver
// Exercises: java.text.SimpleDateFormat, java.sql.Date, try/catch date parsing
var parser = new java.text.SimpleDateFormat("yyyyMMdd");
var date = parser.parse(msg['PID']['PID.7']['PID.7.1'].toString());
```

#### Test Channel 6: HTTP POST via java.net.URL (jakeceballos pattern)
```javascript
// FROM: gist.github.com/jakeceballos — THE most common HTTP pattern
// Exercises: java.net.URL, java.io.*, java.lang.StringBuffer
var url = new java.net.URL(endpoint);
var conn = url.openConnection();
```

#### Test Channel 7: Database Query with ArrayList Params (RSNA pattern)
```javascript
// FROM: RSNA/isn-edge-server-hl7-receiver
// Exercises: java.util.ArrayList, .add(), executeCachedQuery with params
var params = new java.util.ArrayList();
params.add($('mrn'));
var rs = con.executeCachedQuery(sql, params);
```

#### Test Channel 8: Thread-Safe GlobalMap (connect-examples pattern)
```javascript
// FROM: nextgenhealthcare/connect-examples — Thread-safe globalMap
// Exercises: globalMap.lock(), .unlock(), .containsKeySync(), .putSync()
function getInstance(key, initializer) {
    globalMap.lock(key);
    try { ... } finally { globalMap.unlock(key); }
}
```

### Phase 2: Fix E4X Transpiler Gaps (Category A)

**File: `src/javascript/e4x/E4XTranspiler.ts`**

#### Fix A1: Computed XML Attributes
Modify `transpileXMLLiterals()` to detect `{expr}` inside attributes of both self-closing and open/close tags:

1. In the self-closing tag handler (line 313), check if the attribute string contains `{`
2. If so, build the XML string via concatenation instead of string escaping:
   - `<columns name={columnName} type={type}/>` → `XMLProxy.create('<columns name="' + String(columnName) + '" type="' + String(type) + '"/>')`
3. Reuse `convertEmbeddedToConcat()` logic for attribute values

#### Fix A2: Computed Tag Names
Add a new regex pattern before the existing `\w+` patterns to handle `<{expr}>`:

1. Match `<\{([^}]+)\}>([^]*?)<\/\{([^}]+)\}>` pattern
2. Convert to `XMLProxy.create('<' + String(expr) + '>' + content + '</' + String(expr) + '>')`

#### Fix A3: Empty XMLList
Add a simple pattern match:

1. `<></>` → `XMLProxy.createList()`

**Tests:** `tests/unit/javascript/e4x/E4XTranspiler.computed.test.ts` (~25 tests)

### Phase 3: Add Java Interop Shims (Category B)

**New file: `src/javascript/shims/JavaInterop.ts`** (~300 lines)

**Strategy:** Functional shims that **actually work** + log deprecation warnings to guide migration. For dangerous/impossible Java patterns (server internals, threading), **throw with a clear error message** so takeover-mode failures are immediately visible.

#### B1: `java.net.URL` + `java.io.*` HTTP Shim
```typescript
// java.net.URL → uses native fetch() under the hood
// Logs: WARN "java.net.URL used — consider migrating to HTTPUtil"
class JavaURL {
    constructor(private urlStr: string) {
        getLogger('javascript').warn('java.net.URL used — consider migrating to HTTPUtil');
    }
    openConnection(): JavaHttpURLConnection { return new JavaHttpURLConnection(this.urlStr); }
    toString() { return this.urlStr; }
}

class JavaHttpURLConnection {
    private method = 'GET';
    private headers: Record<string, string> = {};
    private body: string | null = null;

    setDoOutput(_v: boolean) {}
    setDoInput(_v: boolean) {}
    setRequestMethod(m: string) { this.method = m; }
    setRequestProperty(k: string, v: string) { this.headers[k] = v; }
    getOutputStream(): JavaOutputStream { return new JavaOutputStream(this); }
    getInputStream(): JavaInputStream {
        // Synchronous HTTP via execFileSync('node', [fetch-script]) or XMLHttpRequest polyfill
        // Returns stream-like object wrapping response body
    }
}
```
**Note:** The `getInputStream()` call must be synchronous (Rhino scripts are synchronous). Options:
- Use `child_process.execFileSync()` to run a fetch helper script (adds ~50ms latency but preserves sync semantics)
- Or use `Atomics.wait()` + worker thread pattern for true sync-over-async

Injected into scope as `java = { net: { URL: JavaURL }, io: { ... }, lang: { ... }, text: { ... }, util: { ... } }` + `Packages` alias pointing to same tree.

#### B2: `java.text.SimpleDateFormat` Shim
```typescript
class JavaSimpleDateFormat {
    private lenient = true;
    constructor(private pattern: string) {
        getLogger('javascript').warn('java.text.SimpleDateFormat used — consider migrating to DateUtil');
    }
    parse(dateStr: string): Date { return DateUtil.getDate(this.pattern, dateStr); }
    format(date: Date): string { return DateUtil.formatDate(this.pattern, date); }
    setLenient(lenient: boolean) { this.lenient = lenient; }
}
```

#### B3: `java.util.ArrayList/HashMap/LinkedHashMap` Shims
```typescript
// Logs migration warning on first construction per class
class JavaArrayList extends Array {
    add(item: unknown) { this.push(item); return true; }
    addAll(items: unknown[]) { this.push(...items); return true; }
    get(index: number) { return this[index]; }
    set(index: number, item: unknown) { this[index] = item; }
    size() { return this.length; }
    isEmpty() { return this.length === 0; }
    contains(item: unknown) { return this.includes(item); }
    remove(indexOrItem: number | unknown) { /* index-based or value-based removal */ }
    toArray() { return [...this]; }
    iterator() { return this[Symbol.iterator](); }
}

class JavaHashMap {
    private map = new Map<unknown, unknown>();
    put(key: unknown, value: unknown) { const prev = this.map.get(key); this.map.set(key, value); return prev; }
    get(key: unknown) { return this.map.get(key) ?? null; }
    containsKey(key: unknown) { return this.map.has(key); }
    containsValue(value: unknown) { for (const v of this.map.values()) if (v === value) return true; return false; }
    remove(key: unknown) { const v = this.map.get(key); this.map.delete(key); return v; }
    size() { return this.map.size; }
    isEmpty() { return this.map.size === 0; }
    keySet() { return new Set(this.map.keys()); }
    values() { return [...this.map.values()]; }
    entrySet() { return [...this.map.entries()].map(([k,v]) => ({ getKey: () => k, getValue: () => v })); }
    putAll(other: JavaHashMap | Map<unknown, unknown> | Record<string, unknown>) { /* merge */ }
    clear() { this.map.clear(); }
}
// JavaLinkedHashMap = same as JavaHashMap (Map preserves insertion order in JS)
// JavaHashSet = Set wrapper with add/contains/remove/size/isEmpty
```

#### B4: `String.prototype.equals/equalsIgnoreCase`
```typescript
// Inject into VM scope — NOT on global String.prototype (sandbox only)
// These are set in ScopeBuilder via scope.String.prototype patching
scope.String.prototype.equals = function(other: string) { return this.valueOf() === String(other); };
scope.String.prototype.equalsIgnoreCase = function(other: string) {
    return this.valueOf().toLowerCase() === String(other).toLowerCase();
};
// Also: .compareTo(), .compareToIgnoreCase(), .matches() (Java regex)
scope.String.prototype.matches = function(regex: string) { return new RegExp(regex).test(this.valueOf()); };
```

#### B5: MirthMap Concurrency Stubs
**File: `src/javascript/userutil/MirthMap.ts`**

No-op stubs with migration warning (Node.js is single-threaded — locking is unnecessary):
```typescript
lock(key: string): void {
    getLogger('javascript').warn(`globalMap.lock('${key}') called — no-op in Node.js (single-threaded)`);
}
unlock(key: string): void { /* no-op */ }
containsKeySync(key: string): boolean { return this.containsKey(key); }
putSync(key: string, value: unknown): unknown { return this.put(key, value); }
```

#### B6: `StringUtils` Polyfill (Apache Commons Lang3)
```typescript
const StringUtils = {
    isBlank: (s: string | null | undefined) => !s || s.trim().length === 0,
    isNotBlank: (s: string | null | undefined) => !!s && s.trim().length > 0,
    isEmpty: (s: string | null | undefined) => !s || s.length === 0,
    isNotEmpty: (s: string | null | undefined) => !!s && s.length > 0,
    trim: (s: string | null) => s?.trim() ?? null,
    trimToEmpty: (s: string | null) => s?.trim() ?? '',
    trimToNull: (s: string | null) => { const t = s?.trim(); return t && t.length > 0 ? t : null; },
    defaultString: (s: string | null, def = '') => s ?? def,
    defaultIfBlank: (s: string | null, def: string) => (!s || s.trim().length === 0) ? def : s,
    countMatches(str: string, sub: string): number {
        if (!str || !sub) return 0;
        let count = 0, pos = 0;
        while ((pos = str.indexOf(sub, pos)) !== -1) { count++; pos += sub.length; }
        return count;
    },
    chomp(str: string, suffix?: string): string {
        if (suffix) return str.endsWith(suffix) ? str.slice(0, -suffix.length) : str;
        return str.replace(/\r?\n$/, '');
    },
    join: (arr: unknown[], sep: string) => arr.map(String).join(sep),
    split: (str: string, sep: string) => str.split(sep),
    contains: (str: string, search: string) => str.includes(search),
    startsWith: (str: string, prefix: string) => str.startsWith(prefix),
    endsWith: (str: string, suffix: string) => str.endsWith(suffix),
    replace: (str: string, search: string, replacement: string) => str.split(search).join(replacement),
    upperCase: (s: string) => s.toUpperCase(),
    lowerCase: (s: string) => s.toLowerCase(),
    capitalize: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
    substringBefore: (str: string, sep: string) => { const i = str.indexOf(sep); return i < 0 ? str : str.slice(0, i); },
    substringAfter: (str: string, sep: string) => { const i = str.indexOf(sep); return i < 0 ? '' : str.slice(i + sep.length); },
};
```

#### B7: `java.lang.StringBuffer/StringBuilder` Shim
```typescript
class JavaStringBuffer {
    private parts: string[] = [];
    append(str: unknown) { this.parts.push(String(str)); return this; }
    insert(index: number, str: unknown) { /* insert at position */ return this; }
    delete(start: number, end: number) { /* remove range */ return this; }
    toString() { return this.parts.join(''); }
    length() { return this.toString().length; }
    charAt(index: number) { return this.toString().charAt(index); }
    substring(start: number, end?: number) { return this.toString().substring(start, end); }
}
```

#### B8: `java.lang.System` Shim
```typescript
const JavaSystem = {
    getenv: (key: string) => process.env[key] ?? null,
    currentTimeMillis: () => Date.now(),
    lineSeparator: () => '\n',
    getProperty: (key: string) => {
        // Map common Java system properties to Node.js equivalents
        const props: Record<string, string> = {
            'os.name': process.platform, 'user.dir': process.cwd(),
            'file.separator': '/', 'line.separator': '\n',
        };
        return props[key] ?? null;
    },
};
```

#### Dangerous Java Internals — Throw with Clear Error
```typescript
// These throw immediately with actionable error messages for takeover visibility
const unsupported = {
    'java.lang.Runtime': () => { throw new Error(
        'java.lang.Runtime.exec() is not available in Node.js Mirth. ' +
        'Use a destination connector or FileUtil for external processes.'); },
    'java.lang.Thread': () => { throw new Error(
        'java.lang.Thread is not available in Node.js Mirth. ' +
        'Node.js is single-threaded — use async patterns or Promise.all() instead.'); },
    'com.mirth.connect.server.controllers': () => { throw new Error(
        'Direct server controller access is not available in Node.js Mirth. ' +
        'Use the REST API or injected userutil classes instead.'); },
    'org.apache.log4j': () => { throw new Error(
        'Log4j is not available in Node.js Mirth. Use the injected logger object instead: ' +
        'logger.info(), logger.warn(), logger.error(), logger.debug()'); },
};
```

**Wiring in ScopeBuilder.ts:** Inject `java` namespace + `Packages` alias + `StringUtils` global + String prototype extensions into every VM scope.

**Tests:** `tests/unit/javascript/shims/JavaInterop.test.ts` (~60 tests covering all shim classes + error messages)

### Phase 4: Fix XMLProxy `.child()` Method (Category C)

**File: `src/javascript/e4x/XMLProxy.ts`**

Add `.child()` method that works both by name (string) and by index (number):
```typescript
child(nameOrIndex: string | number): XMLProxy {
    if (typeof nameOrIndex === 'number') {
        return this.getIndex(nameOrIndex);
    }
    return this.get(nameOrIndex);
}
```

Must be registered in the Proxy `get` trap so that `xmlNode.child(0)` calls the method rather than looking up a child element named "child".

**Tests:** `tests/unit/javascript/e4x/XMLProxy.child.test.ts` (~8 tests)

### Phase 5: Integration Test Suite — Full Real-World Channels

**File: `tests/integration/real-world-channels/RealWorldPatterns.test.ts`**

Build a comprehensive integration test that:
1. Creates channels with the exact JavaScript from GitHub sources
2. Sends real HL7/JSON/XML messages through the pipeline
3. Verifies output matches expected results

**Test matrix:**

| Test | GitHub Source | Key Patterns | Expected Outcome |
|------|-------------|--------------|-----------------|
| E4X-to-JSON recursive converter | shadowdoc gist | `.*`, `.@*`, `for each`, `.text()`, `.localName()` | Valid JSON output |
| xFilter XMLList callback | connect-examples | `new XMLList()`, callback, `+=`, `.length()` | Filtered OBR segments |
| stripEmptyNodes | connect-examples | `delete children[i]`, `new XML()`, `.name()` | Clean XML without empty elements |
| replaceAllInXML | connect-examples | `.hasComplexContent()`, `.childIndex()`, indexed assignment | All nodes replaced |
| fixHL7NodeOrder | connect-examples | `.child(i)`, `.insertChildBefore()`, `.appendChild()`, `+=` | Segments in sorted order |
| HTTP via java.net.URL | jakeceballos gist | Java URL/IO shims | HTTP response received |
| DB query with ArrayList params | RSNA | `java.util.ArrayList`, `.add()`, `executeCachedQuery` | Query executes with params |
| HL7 date parsing | RSNA | `java.text.SimpleDateFormat`, `java.sql.Date` | Parsed date object |
| OBX report concatenation | RSNA | `msg..OBX`, `for each`, E4X descendant | All OBX.5.1 values joined |
| Thread-safe globalMap | connect-examples | `.lock()`, `.unlock()`, `.containsKeySync()` | No TypeError |
| JSON-to-HL7 mapping | marlycormar | `tmp['MSH']['MSH.3']['MSH.3.1'] = value` | Valid HL7 output |
| Computed XML attributes | SwissTPH | `<tag attr={variable} />` | Attributes populated with values |

### Phase 6: Verification

1. **Run all new tests:** `npx jest tests/unit/javascript/e4x/E4XTranspiler.computed.test.ts tests/unit/javascript/shims tests/unit/javascript/e4x/XMLProxy.child.test.ts tests/integration/real-world-channels`
2. **Run full test suite:** `npx jest` — verify 0 regressions in 7,890 existing tests
3. **Manual smoke test:** Build a channel XML with computed E4X attributes, deploy it, send a message, verify correct output
4. **TypeScript compilation:** `npx tsc --noEmit` — zero errors

## Files to Create/Modify

| File | Action | Est. Lines |
|------|--------|-----------|
| `src/javascript/e4x/E4XTranspiler.ts` | MODIFY — computed attrs, tag names, empty XMLList | +80 |
| `src/javascript/e4x/XMLProxy.ts` | MODIFY — add `.child()` method + Proxy trap | +20 |
| `src/javascript/shims/JavaInterop.ts` | CREATE — java.* namespace shims (URL, SimpleDateFormat, ArrayList, HashMap, StringBuffer, System) | ~350 |
| `src/javascript/shims/StringUtils.ts` | CREATE — Apache Commons Lang3 StringUtils polyfill | ~80 |
| `src/javascript/runtime/ScopeBuilder.ts` | MODIFY — inject java namespace + Packages + StringUtils + String.prototype extensions | +40 |
| `src/javascript/userutil/MirthMap.ts` | MODIFY — add lock/unlock/containsKeySync/putSync stubs | +25 |
| `tests/unit/javascript/e4x/E4XTranspiler.computed.test.ts` | CREATE — computed attr/tag/XMLList tests | ~150 |
| `tests/unit/javascript/shims/JavaInterop.test.ts` | CREATE — all shim classes + error messages | ~300 |
| `tests/unit/javascript/e4x/XMLProxy.child.test.ts` | CREATE — .child() method tests | ~60 |
| `tests/integration/real-world-channels/RealWorldPatterns.test.ts` | CREATE — 12 real-world pattern tests | ~500 |
| **Total** | | **~1,605** |

## Execution Strategy

Use **3 parallel agents** in git worktrees, then a sequential integration phase:

**Wave 1 (parallel):**
1. **e4x-fixer**: E4X transpiler gaps (A1-A3) + XMLProxy .child() (C1) + unit tests
2. **shim-builder**: Java interop shims (B1-B8) + StringUtils + MirthMap stubs + ScopeBuilder wiring + unit tests

**Wave 2 (sequential, after Wave 1 merge):**
3. **integration-tester**: Real-world channel integration test suite using the actual GitHub code snippets

## Out of Scope (Throw with Clear Error Message)

These patterns **throw immediately** with actionable error messages to ensure takeover-mode incompatibilities are visible:

| Pattern | Error Message |
|---------|--------------|
| `java.lang.Runtime.getRuntime().exec()` | "Not available in Node.js Mirth. Use a destination connector or FileUtil for external processes." |
| `new java.lang.Thread({run:...})` | "Not available in Node.js Mirth. Node.js is single-threaded — use async patterns instead." |
| `com.mirth.connect.server.controllers.*` | "Direct server controller access not available. Use the REST API or injected userutil classes." |
| `org.apache.log4j.Logger.getLogger()` | "Log4j not available. Use the injected logger object: logger.info(), logger.warn(), logger.error()" |
| `new Packages.org.custom.Class()` | "Custom Java plugins cannot run in Node.js Mirth. Port to TypeScript or use Node.js equivalent." |

**Architectural limitation (documented, no fix possible):**
| Pattern | Limitation |
|---------|-----------|
| `typeof obj === 'xml'` | JavaScript Proxy always returns 'object' for typeof. All our code uses `.toXMLString()` method detection instead. User scripts checking `typeof === 'xml'` will get false — document in migration guide. |
