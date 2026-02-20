# Risk Assessment: Generated JavaScript Runtime Bugs (Same Class as $c() Bug)

## Context

The `$c()` bug (lesson #54) was an insidious class of defect: **generated JavaScript code** that compiled fine as TypeScript, passed all unit tests (which mock the VM scope), passed all parity agent scans (which compare method inventories), but **crashed at runtime** when real data flowed through the VM sandbox. The root cause was a `for...in` loop iterating Map prototype properties without a `typeof === 'function'` guard — producing `TypeError: scope[key] is not a function`.

This assessment identifies **other risk items in the same class** — bugs that exist in generated JavaScript strings, E4X transpiler output, VM scope construction, or scope readback logic that would only manifest at runtime with real channel data.

---

## Findings

### RISK 1 — CRITICAL: Non-JavaScript Step Types Silently Skipped

**Files:** `ChannelBuilder.ts:1374` and `ChannelBuilder.ts:1323`
**Status:** Known (lesson #55) — **NOT YET FIXED**

Both `extractTransformerSteps()` and `extractFilterRules()` have `if (!step.script) continue;` — silently skipping steps without a `script` field. In Java Mirth, three non-JavaScript step/rule types store structured XML config instead of inline `<script>`:

| Step Type | XML Config | Java Compilation |
|-----------|-----------|-----------------|
| **Mapper** (`MapperStep`) | `<mapping>`, `<variable>`, `<defaultValue>` | `getScript()` generates `validate(...)` call |
| **MessageBuilder** (`MessageBuilderStep`) | `<messageSegment>`, `<mapping>` | `getScript()` generates segment assignment |
| **XsltStep** | `<stylesheet>` | `getScript()` generates XSLT transform call |
| **RuleBuilderRule** | `<field>`, `<condition>`, `<values>` | `getScript()` generates condition expression |

**Impact:** Channels built using the Mirth Administrator GUI's drag-and-drop transformer/filter builder would have **empty transformers** (data passes through unchanged) or **bypass filters** (all messages accepted). No error is thrown — the extraction function silently returns `[]`.

**Why this is the same class as $c():** Silent runtime failure invisible to static analysis, unit tests, and parity agents. The extraction function *exists* and *works* — it just doesn't handle all input shapes.

**Validation approach:** Deploy a channel with Mapper steps via the Java Mirth GUI, then process a message through Node.js and verify the mapping was applied.

---

### RISK 2 — HIGH: E4X Self-Closing Tag Transpilation Uses `indexOf` Instead of Regex Offset

**File:** `E4XTranspiler.ts:313-319`

```typescript
result = result.replace(/(<(\w+)(?:\s+[^>]*)?\/\s*>)/g, (match, fullTag, _tagName) => {
    if (this.isInsideString(result, result.indexOf(match))) {  // BUG: indexOf
        return match;
    }
    return `XMLProxy.create('${this.escapeForString(fullTag)}')`;
});
```

`result.indexOf(match)` finds the **first** occurrence of the matched string, not the current occurrence. When the same self-closing XML tag appears both inside a string and outside:

```javascript
var template = '<PID/>';     // inside string — should be preserved
var newPid = <PID/>;         // outside string — should be transpiled
```

The second `<PID/>` gets `indexOf` → position of the first `<PID/>` (inside string) → `isInsideString` returns true → **not transpiled** → `SyntaxError: Unexpected token '<'` at runtime.

**Fix:** The `replace()` callback provides the offset as a positional argument after the capture groups. Use it:
```typescript
result = result.replace(pattern, (match, fullTag, _tagName, offset) => {
    if (this.isInsideString(result, offset)) { return match; }
    ...
});
```

**Validation approach:** Write a test with duplicate XML literals where one is in a string and one is outside.

---

### RISK 3 — HIGH: `processXMLTag` Only Finds First Match, Skips Remainder If First Is In String

**File:** `E4XTranspiler.ts:337-367`

```typescript
private processXMLTag(code: string): string {
    const tagPattern = /<(\w+)(\s+[^>]*)?>([^]*?)<\/\1>/;
    const match = tagPattern.exec(code);        // Non-global — always starts at 0
    if (match && !this.isInsideString(code, match.index)) {
        // ... replace this one tag
    }
    return code;  // No change → while(changed) loop exits
}
```

The non-global regex always finds the **first** match by position. If the first XML tag is inside a string, the function returns the code unchanged, `changed` becomes `false`, and the loop exits — **all subsequent XML tags (even those outside strings) are never transpiled**.

```javascript
var s = "<PID>test</PID>";       // inside string — found first by exec()
var x = <OBX>test</OBX>;         // outside string — never reached!
```

**Impact:** `SyntaxError` at runtime if the first XML literal in the source is inside a string.

**Validation approach:** Script with string-enclosed XML appearing before E4X XML literals.

---

### RISK 4 — HIGH: `convertEmbeddedToConcat` Brace Tracker Doesn't Account for String Literals

**File:** `E4XTranspiler.ts:373-412`

The brace depth counter increments/decrements for every `{`/`}`, even inside string literals within the expression:

```xml
<tag>{getConfig("{nested}")}</tag>
```

The `{` inside `"{nested}"` increments `braceDepth` to 2. The first `}` (inside the string) decrements to 1. The real closing `}` decrements to 0. In this case it **accidentally works** because there's one extra `{` and one extra `}` inside the string, so they cancel out.

But for asymmetric cases:
```xml
<tag>{format("value}")}</tag>
```
The `}` inside `"value}"` would prematurely close the expression at depth 0, producing:
```javascript
'<tag>' + String(format("value) + '}</tag>')
```
→ `SyntaxError: Unexpected string`

**Impact:** Runtime syntax error for E4X embedded expressions containing string literals with unbalanced braces.

**Validation approach:** Test E4X expressions with strings containing `{` or `}` characters.

---

### RISK 5 — MEDIUM: Auto-Serialization `hasSimpleContent()` Not Guarded

**File:** `ScriptBuilder.ts:780-781` (generated code)

```javascript
if (typeof msg === 'object' && typeof msg.toXMLString === 'function') {
    if (msg.hasSimpleContent()) { msg = msg.toXMLString(); }
}
```

The generated code checks for `toXMLString` but then calls `hasSimpleContent()` without verifying it exists. If a user-created object has `toXMLString` but not `hasSimpleContent`, this throws `TypeError: msg.hasSimpleContent is not a function`.

While rare (XMLProxy always has both), this could occur if a user script sets `msg` to a custom object with a `toXMLString` method for custom serialization.

**Validation approach:** Set `msg` to a plain object with `toXMLString` but without `hasSimpleContent` in a transformer script.

---

### RISK 6 — MEDIUM: `$()` Function Silently Swallows Backend Errors

**File:** `ScriptBuilder.ts:527-569` (generated code)

```javascript
function $(string) {
    try {
        if (typeof responseMap !== 'undefined' && responseMap.containsKey(string)) {
            return responseMap.get(string);
        }
    } catch (e) {}   // <— Silent swallow
    // ... same pattern 7 more times
    return '';
}
```

Every map lookup is wrapped in `try/catch(e){}` with an empty catch block. If the underlying map's `containsKey()` or `get()` throws for a real reason (e.g., GlobalMap database backend connection failure, Redis timeout), the error is silently swallowed and `$()` returns `''` (empty string).

**Impact:** In clustered mode with a database/Redis backend for GlobalMap, a transient connection failure would cause `$g('key')` to silently return `''` instead of throwing, potentially corrupting message data with empty values.

**Validation approach:** Mock a GlobalMap backend that throws on `get()`, verify `$()` behavior.

---

### RISK 7 — MEDIUM: E4X Attribute Write Regex Can Overcapture in Chained Expressions

**File:** `E4XTranspiler.ts:434`

```typescript
code = code.replace(/\.@(\w+)\s*=\s*(?!=)([^;,\n\)]+)/g, ".setAttr('$1', $2)");
```

The value capture `[^;,\n\)]+` is greedy and stops at `;`, `,`, newline, or `)`. But in multi-line statements without semicolons, it can capture too much:

```javascript
msg.@version = "2.5"
msg.@encoding = "UTF-8"
```

Without semicolons, the first rule captures `"2.5"\nmsg` as the value (newlines ARE excluded, so this specific case actually works). But in minified code:
```javascript
msg.@version = "2.5" msg.@encoding = "UTF-8"
```

The capture stops at... well, spaces aren't excluded, so it captures `"2.5" msg` as the value. This produces:
```javascript
msg.setAttr('version', "2.5" msg).setAttr('encoding', ...
```
→ `SyntaxError`

**Impact:** Minified or single-line E4X code with multiple attribute writes can produce invalid JavaScript.

**Validation approach:** Test multi-attribute writes on a single line without separators.

---

### RISK 8 — LOW: `escapeForString()` Missing Backtick Escape

**File:** `E4XTranspiler.ts:597-604`

The escape function handles `\`, `'`, `\n`, `\r`, `\t` but not backticks (`` ` ``). Since generated code uses single quotes (`XMLProxy.create('...')`), backticks in XML content won't break the string literal. However, if the transpiler output is ever consumed by template literal contexts, or if user code uses eval-like patterns, backticks could escape.

**Impact:** Very low — backticks in HL7/healthcare XML content are extremely rare.

---

## Prioritized Action Items

| # | Risk | Severity | Effort | Recommended Action |
|---|------|----------|--------|-------------------|
| 1 | Non-JS step types silently skipped | CRITICAL | HIGH | Implement `getScript()` compilation for Mapper, MessageBuilder, XSLT, RuleBuilder |
| 2 | E4X `indexOf` vs regex offset | HIGH | LOW | Replace `result.indexOf(match)` with offset parameter in replace callback |
| 3 | `processXMLTag` first-match-in-string skip | HIGH | MEDIUM | Refactor to use global regex or skip-and-continue pattern |
| 4 | Brace tracker ignores string literals | HIGH | MEDIUM | Add string-literal-aware brace counting in `convertEmbeddedToConcat` |
| 5 | `hasSimpleContent()` not guarded | MEDIUM | LOW | Add `typeof msg.hasSimpleContent === 'function'` guard |
| 6 | `$()` silently swallows errors | MEDIUM | LOW | Log errors before swallowing, or rethrow non-expected errors |
| 7 | Attribute write regex overcapture | MEDIUM | LOW | Tighten the value capture regex |
| 8 | Missing backtick escape | LOW | LOW | Add `` ` `` to `escapeForString()` |

## Implementation Plan

### Phase 1: E4X Transpiler Fixes (Risks 2, 3, 4, 7, 8) — LOW-MEDIUM effort

All in `src/javascript/e4x/E4XTranspiler.ts`. Tests in `tests/unit/javascript/e4x/E4XTranspiler.test.ts`.

#### RISK 2 Fix — `indexOf` → regex offset (line 315)

Replace:
```typescript
result = result.replace(/(<(\w+)(?:\s+[^>]*)?\/\s*>)/g, (match, fullTag, _tagName) => {
    if (this.isInsideString(result, result.indexOf(match))) {
```
With:
```typescript
result = result.replace(/(<(\w+)(?:\s+[^>]*)?\/\s*>)/g, (match, fullTag, _tagName, offset) => {
    if (this.isInsideString(result, offset)) {
```

**Tests:** Self-closing tag `<PID/>` both inside a string and outside a string in the same script. Verify only the outside one is transpiled.

#### RISK 3 Fix — `processXMLTag` skip-and-continue (lines 337-367)

The current non-global regex + early-return pattern skips ALL remaining tags when the first match is inside a string. Refactor to search forward past in-string matches:

```typescript
private processXMLTag(code: string): string {
    const tagPattern = /<(\w+)(\s+[^>]*)?>([^]*?)<\/\1>/g;  // Now global
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(code)) !== null) {
        if (this.isInsideString(code, match.index)) {
            continue;  // Skip this match, try next
        }
        const [fullMatch, tagName, attrs, content] = match;
        // ... existing replacement logic ...
        // After replacing, return the modified code (caller's while loop re-enters)
        return code.slice(0, match.index) + replacement + code.slice(match.index + fullMatch.length);
    }
    return code;  // No matches outside strings
}
```

**Tests:** String-enclosed `<PID>test</PID>` appearing BEFORE bare E4X `<OBX>test</OBX>`. Verify the OBX is transpiled even though PID is found first.

#### RISK 4 Fix — String-aware brace counting in `convertEmbeddedToConcat` (lines 373-412)

Add string literal tracking to the character-by-character brace counter. When inside a string (`"`, `'`, or `` ` ``), do not increment/decrement braceDepth:

```typescript
private convertEmbeddedToConcat(content: string): string {
    const parts: string[] = [];
    let inExpr = false;
    let current = '';
    let braceDepth = 0;
    let inString: string | null = null;  // NEW: track string literals
    let escaped = false;                  // NEW: track escape sequences

    for (let i = 0; i < content.length; i++) {
        const char = content[i]!;

        // Handle escape sequences inside strings
        if (escaped) { escaped = false; current += char; continue; }
        if (inString !== null && char === '\\') { escaped = true; current += char; continue; }

        // Handle string delimiters (only inside expressions)
        if (inExpr && inString === null && (char === '"' || char === "'" || char === '`')) {
            inString = char; current += char; continue;
        }
        if (inExpr && inString !== null && char === inString) {
            inString = null; current += char; continue;
        }

        // Brace counting only when NOT inside a string
        if (char === '{' && !inExpr && inString === null) {
            // ... existing open-expression logic
        } else if (char === '{' && inExpr && inString === null) {
            braceDepth++; current += char;
        } else if (char === '}' && inExpr && inString === null) {
            braceDepth--;
            // ... existing close-expression logic
        } else {
            current += char;
        }
    }
    // ... existing tail logic
}
```

**Tests:** E4X `<tag>{format("value}")}</tag>` — asymmetric brace inside string. Verify correct transpilation to `'<tag>' + String(format("value}")) + '</tag>'`.

#### RISK 7 Fix — Tighten attribute write regex (line 434)

Replace greedy `[^;,\n\)]+` with a smarter capture that stops at whitespace-followed-by-identifier (a heuristic for the next statement):

```typescript
// Old: captures too aggressively on single-line multi-attribute writes
code = code.replace(/\.@(\w+)\s*=\s*(?!=)([^;,\n\)]+)/g, ".setAttr('$1', $2)");

// New: stop at semicolon, comma, newline, close-paren, OR whitespace-before-identifier
// The negative lookahead (?!\s) ensures we don't over-capture trailing content
code = code.replace(/\.@(\w+)\s*=\s*(?!=)([^;,\n\)]+?)\s*(?=[;,\n\)]|$)/g, ".setAttr('$1', $2)");
```

Actually, this is tricky to get right without a full expression parser. A safer approach: use a non-greedy capture with a required terminator:

```typescript
code = code.replace(/\.@(\w+)\s*=\s*(?!=)(.+?)(?=[;\n,)]|$)/gm, ".setAttr('$1', $2)");
```

The key change is `(.+?)` (non-greedy) + `(?=[;\n,)]|$)` (lookahead for natural statement terminators including end-of-line due to `m` flag).

**Tests:** `msg.@version = "2.5"\nmsg.@encoding = "UTF-8"` on two lines. Also single-line with semicolons.

#### RISK 8 Fix — Add backtick escape in `escapeForString` (lines 597-604)

Add `.replace(/`/g, '\\`')` to the chain:

```typescript
private escapeForString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/`/g, '\\`')    // NEW
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}
```

**Tests:** XML content containing backticks. Verify escaped output.

---

### Phase 2: ScriptBuilder Generated Code Fixes (Risks 5, 6)

File: `src/javascript/runtime/ScriptBuilder.ts`. Tests: `tests/unit/javascript/runtime/ScriptBuilder.parity.test.ts`.

#### RISK 5 Fix — Guard `hasSimpleContent()` (lines 780-781, 789-790)

Replace:
```javascript
if (msg.hasSimpleContent()) { msg = msg.toXMLString(); }
```
With:
```javascript
if (typeof msg.hasSimpleContent === 'function' && msg.hasSimpleContent()) { msg = msg.toXMLString(); }
```

Same for `tmp` block on line 790.

**Tests:** Set `msg` in a VM scope to `{ toXMLString: () => '<test/>' }` (no hasSimpleContent). Verify no TypeError.

#### RISK 6 Fix — Log errors in `$()` catch blocks (lines 527-569)

Replace each empty `catch (e) {}` with `catch (e) { if (typeof logger !== 'undefined') { logger.error('$() lookup error: ' + e); } }`.

This matches Java's pattern — Java's `$()` also uses try/catch, but Java logs at WARN level. The intent is to prevent script execution from crashing on map errors while still providing diagnostic visibility.

**Note:** This is strictly a logging improvement, not a behavior change. The function still returns `''` on error, matching Java. The key insight: Java Mirth's `$()` in `JavaScriptBuilder.java` has the same empty catch pattern — but Java's Map implementations rarely throw (they're all in-memory ConcurrentHashMap). Our Node.js maps can throw because the backends (MySQL, Redis) have real failure modes. Adding logging is the conservative fix.

**Tests:** Mock GlobalMap backend that throws on `get()`, verify `$()` returns '' and logs error.

---

### Phase 3: Non-JavaScript Step Type Compilation (Risk 1 — CRITICAL)

**Files to modify:**
- `src/donkey/channel/ChannelBuilder.ts` — `extractTransformerSteps()` and `extractFilterRules()`
- New file: `src/javascript/runtime/StepCompiler.ts` — compiles non-JS step types to JavaScript

**Files to create:**
- `tests/unit/javascript/runtime/StepCompiler.test.ts`

This is the most complex fix. The approach: create a `StepCompiler` module that accepts the structured XML config from each step type and returns compiled JavaScript — mimicking Java's `getScript()` method on each step class.

#### 3A. StepCompiler — MapperStep compilation

Java's `MapperStep.getScript(context)` generates:
```javascript
if ('channel' == mapName) {
  channelMap.put('variable', validate('msg.mapping.toString()', defaultValue, [regexEntry1, ...]))
}
```

Our `compileMapperStep(step)` will generate equivalent JS:
```typescript
function compileMapperStep(step: Record<string, unknown>): string {
    const variable = String(step.variable || '');
    const mapping = String(step.mapping || '');
    const defaultValue = step.defaultValue !== undefined ? String(step.defaultValue) : "''";
    const scope = String(step.scope || 'channel');  // channel, global, globalChannel, response, connector
    const mapName = scopeToMapName(scope);  // 'channel' → 'channelMap', etc.

    // Build replacement array from step.replacements
    const replacements = buildReplacementArray(step.replacements);

    return `${mapName}.put('${escapeJsString(variable)}', validate(${mapping}, ${defaultValue}, new Array(${replacements})))`;
}
```

#### 3B. StepCompiler — MessageBuilderStep compilation

Java's `MessageBuilderStep.getScript(context)` generates:
```javascript
msg['PID']['PID.3']['PID.3.1'] = validate('mapping.toString()', defaultValue, [regexEntries...])
```

Our `compileMessageBuilderStep(step)` generates:
```typescript
function compileMessageBuilderStep(step: Record<string, unknown>): string {
    const messageSegment = String(step.messageSegment || '');
    const mapping = String(step.mapping || '');
    const defaultValue = step.defaultValue !== undefined ? String(step.defaultValue) : "''";
    const replacements = buildReplacementArray(step.replacements);

    return `${messageSegment} = validate(${mapping}, ${defaultValue}, new Array(${replacements}))`;
}
```

#### 3C. StepCompiler — XsltStep compilation

Java's `XsltStep.getScript(context)` uses `Packages.javax.xml.transform.*` which is **NOT portable** to Node.js VM. Two options:

**Option A (Recommended):** Generate code that calls a pre-injected `xsltTransform(source, stylesheet)` function in the VM scope. The function delegates to the `xslt-processor` npm library already used in the project. The scope injection happens in `ScopeBuilder.buildBasicScope()`.

```typescript
function compileXsltStep(step: Record<string, unknown>): string {
    const template = String(step.sourceXml || 'msg');
    const stylesheet = escapeJsString(String(step.stylesheet || ''));
    return `msg = xsltTransform(${template}, '${stylesheet}')`;
}
```

**Option B (Fallback):** Throw a clear error at deploy time:
```
Error: XsltStep is not supported in Node.js Mirth. Convert to JavaScriptStep with explicit XSLT call.
```

Going with Option A — it provides seamless parity.

#### 3D. StepCompiler — RuleBuilderRule compilation

Java's `RuleBuilderRule.getScript(context)` generates boolean expressions. 6 condition types:

| Condition | Java Output | Node.js Output |
|-----------|-------------|----------------|
| EXISTS | `msg['PID']['PID.3'].toString().length > 0` | Same |
| NOT_EXIST | `!msg['PID']['PID.3'].toString().length > 0` | Same (note: Java's logic, we match exactly) |
| EQUALS | `msg['PID']['PID.3'].toString() == 'value'` | Same |
| NOT_EQUAL | `msg['PID']['PID.3'].toString() != 'value'` | Same |
| CONTAINS | `msg['PID']['PID.3'].toString().indexOf('value') >= 0` | Same (multiple values: `|| indexOf('v2') >= 0`) |
| NOT_CONTAIN | `msg['PID']['PID.3'].toString().indexOf('value') < 0` | Same (multiple values: `&& indexOf('v2') < 0`) |

```typescript
function compileRuleBuilderRule(rule: Record<string, unknown>): string {
    const field = String(rule.field || '');
    const condition = String(rule.condition || 'EXISTS');
    const values = extractValues(rule.values);

    const fieldAccess = `${field}.toString()`;

    switch (condition) {
        case 'EXISTS': return `${fieldAccess}.length > 0`;
        case 'NOT_EXIST': return `!(${fieldAccess}.length > 0)`;
        case 'EQUALS': return values.map(v => `${fieldAccess} == '${escapeJsString(v)}'`).join(' || ');
        case 'NOT_EQUAL': return values.map(v => `${fieldAccess} != '${escapeJsString(v)}'`).join(' && ');
        case 'CONTAINS': return values.map(v => `${fieldAccess}.indexOf('${escapeJsString(v)}') >= 0`).join(' || ');
        case 'NOT_CONTAIN': return values.map(v => `${fieldAccess}.indexOf('${escapeJsString(v)}') < 0`).join(' && ');
        default: return 'true';
    }
}
```

#### 3E. Integration — Wire into ChannelBuilder extractors

In `extractTransformerSteps()` (line 1374) and `extractFilterRules()` (line 1323), replace `if (!step.script) continue;` with step-type-aware compilation:

```typescript
// In extractTransformerSteps(), after line 1372:
const step = item as Record<string, unknown>;
if (step.enabled === false || String(step.enabled) === 'false') continue;

let script: string;
if (step.script) {
    script = String(step.script);
} else if (className.includes('MapperStep')) {
    script = compileMapperStep(step);
} else if (className.includes('MessageBuilderStep')) {
    script = compileMessageBuilderStep(step);
} else if (className.includes('XsltStep')) {
    script = compileXsltStep(step);
} else {
    continue;  // Unknown step type without script — skip
}

steps.push({ name: String(step.name || ''), script, enabled: true });
```

Same pattern for `extractFilterRules()`:
```typescript
let script: string;
if (rule.script) {
    script = String(rule.script);
} else if (className.includes('RuleBuilderRule')) {
    script = compileRuleBuilderRule(rule);
} else {
    continue;  // Unknown rule type without script — skip
}
```

#### 3F. XsltTransform scope injection (for XsltStep)

In `ScopeBuilder.buildBasicScope()`, inject an `xsltTransform` function into the VM scope:

```typescript
// Import at top of ScopeBuilder.ts
import { xsltProcess, xmlParse } from 'xslt-processor';

// In buildBasicScope():
scope['xsltTransform'] = (sourceXml: string, stylesheetXml: string) => {
    const xml = xmlParse(sourceXml);
    const xslt = xmlParse(stylesheetXml);
    return xsltProcess(xml, xslt);
};
```

---

### Phase 4: Test Suite

Each phase produces targeted tests:

| Phase | Test File | Test Count (est.) |
|-------|-----------|-------------------|
| 1 | `tests/unit/javascript/e4x/E4XTranspiler.edge-cases.test.ts` | ~15 |
| 2 | `tests/unit/javascript/runtime/ScriptBuilder.generated-code.test.ts` | ~8 |
| 3 | `tests/unit/javascript/runtime/StepCompiler.test.ts` | ~20 |
| 3 | `tests/unit/donkey/channel/ChannelBuilder.stepcompile.test.ts` | ~10 |

**Key testing approach:** E4X and ScriptBuilder tests should use **real VM execution** — not just string comparison. Compile the generated JS with `vm.Script`, run in `vm.createContext()`, and assert on runtime behavior. This is what would have caught the $c() bug.

---

## Execution Order

1. **Phase 1** (E4X fixes): Risks 2, 3, 4, 7, 8 — all in E4XTranspiler.ts, independent of each other
2. **Phase 2** (ScriptBuilder fixes): Risks 5, 6 — small changes in ScriptBuilder.ts
3. **Phase 3** (StepCompiler): Risk 1 — new module + ChannelBuilder integration
4. **Phase 4** (Tests): Can partially parallel with Phase 3

Phases 1 and 2 can be done in parallel (different files). Phase 3 depends on nothing else.

---

## Verification Strategy

These bugs share a common trait: **they only manifest when real data flows through the full pipeline**. The recommended validation approach mirrors how we found the $c() bug:

1. **Unit tests with real VM execution** — NOT mocked scopes. Create ScriptBuilder output, compile with `vm.Script`, run in `vm.createContext()`, verify results.
2. **E4X transpiler edge case suite** — Specifically test duplicate literals, string-enclosed XML, embedded expressions with braces in strings, multi-attribute writes.
3. **Channel XML with non-JS steps** — Import a channel XML from Java Mirth that uses Mapper/MessageBuilder/XSLT steps, deploy in Node.js, send a message, verify transformation output.
4. **Clustered mode error injection** — Simulate backend failures in GlobalMap/ConfigurationMap to verify error propagation vs silent swallowing.
5. **Run existing test suite** — `npm test` must pass with 0 regressions (currently 7,689 tests).
