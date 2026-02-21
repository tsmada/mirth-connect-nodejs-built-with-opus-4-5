<!-- Completed: 2026-02-21 | Status: Implemented — 57 tests across 8 phases, all passing -->

# Plan: Adversarial Transformer Runtime Testing

## Context

The Mirth Connect Node.js port has undergone 15+ waves of automated parity scanning (js-runtime-checker, connector-parity-checker, etc.) and has 8,169 passing tests. These scanners compare **method inventories** — "does method X exist?", "is variable Y in scope?" — but do NOT execute generated JavaScript with adversarial data patterns. The remaining bugs are the ones that only manifest at runtime with specific inputs (lessons #54-59).

This plan creates a systematic adversarial test suite that executes real scripts through the full transpiler→builder→scope→VM pipeline with edge-case data, targeting 7 bug categories discovered during exploration.

## Confirmed Bugs (Validated Against Source Code)

### P0 — Silent Data Corruption

**P0-1: `globalDefaultNamespace` is module-level shared state** (`XMLProxy.ts:937`)
- `let globalDefaultNamespace = ''` is a module-level variable
- `setDefaultXmlNamespace()` (injected into every VM scope) modifies it globally
- When Channel A sets `default xml namespace = "urn:hl7-org:v3"`, Channel B's transformer inherits it
- Persists across pipeline stages (source transformer → destination transformer) and across messages
- **Impact**: Namespace corruption in HL7v3/CDA channels under any load

**P0-2: Empty XMLProxy is truthy — breaks `if (msg.PV1)` existence checks** (`XMLProxy.ts:71`)
- `msg.NONEXISTENT` returns a Proxy object (nodes=[]) which is always truthy in JavaScript
- Java E4X empty XMLList is falsy — `if (msg.PV1)` returns false for missing segments
- `if (msg.PV1)` is the most common existence check pattern in HL7 transformers
- **Impact**: Silent logic errors in any channel that checks segment existence

**P0-3: `XMLProxy.set()` only modifies the first node** (`XMLProxy.ts:192-197`)
- `const node = this.nodes[0]!` — operates on the first node only
- `msg.OBX['OBX.3'] = 'NEW'` when there are 3 OBX segments only updates OBX #1
- Java E4X applies set to all nodes in the XMLList
- **Impact**: Incorrect multi-segment updates — extremely common HL7 pattern

**P0-4: `toXMLString()` silently returns empty string on builder errors** (`XMLProxy.ts:627-635`)
- Catches ALL errors from `builder.build()` and returns `''`
- After aggressive delete/append operations, corrupted node structure → empty string
- Auto-serialization writes empty string as transformedData — message continues with no content
- **Impact**: Silent data loss — the worst possible failure mode

### P1 — Script Execution Errors

**P1-1: `escapeForString` does not escape `"` for XML attribute reconstruction** (`E4XTranspiler.ts:854-862`)
- Escapes `\`, `'`, `` ` ``, `\n`, `\r`, `\t` — but NOT `"`
- `buildComputedAttrTag` at line 589 wraps attribute values in double quotes
- Source E4X `<tag title='He said "hello"'/>` → computed attr path → produces malformed XML `<tag title="He said "hello""/>`
- XMLProxy.create() receives broken XML → parse error or silent data corruption
- **Impact**: Any XML literal with double quotes in attribute values

**P1-2: `isInsideStringOrComment` doesn't track template literal `${...}` zones** (`E4XTranspiler.ts:778-841`)
- Backtick strings tracked as monolithic strings (line 835)
- E4X inside `` `${msg.PID}` `` is treated as "inside string" and skipped
- **Impact**: Node.js-native scripts using template literals with E4X (LOW for ported Rhino scripts)

**P1-3: `isInsideStringOrComment` doesn't track regex literals** (`E4XTranspiler.ts:778-841`)
- `/pattern/` not tracked — E4X patterns inside regex are incorrectly transpiled
- `var re = /msg\.@attr/;` → `.@attr` is transpiled inside the regex, breaking it
- **Impact**: Scripts that validate HL7 patterns via regex (uncommon but real)

### P2 — Security & Quality

**P2-1: StepCompiler field name injection** (`StepCompiler.ts:85`)
- `const fieldAccess = `${field}.toString()`` — `field` interpolated without validation
- Channel XML with `<field>` = `x); $g.put('leak', channelMap); (0` → arbitrary code in VM sandbox
- Sandbox prevents system access, but cross-channel data leakage via globalMap is possible
- **Impact**: Malicious channel XML imported from untrusted sources

**P2-2: `Buffer` prototype pollution** (`ScopeBuilder.ts:264`)
- `Buffer` from outer Node.js realm passed into VM scope
- User script `Buffer.prototype.foo = fn` persists on outer realm's Buffer
- Affects ALL future VM contexts — cross-channel data leakage
- **Impact**: Deliberate exploitation only; unlikely in practice

**P2-3: Auto-serialization circular reference error quality** (`ScriptBuilder.ts:773`)
- `JSON.stringify(msg)` throws `TypeError: Converting circular structure to JSON`
- No Mirth context (channel name, step number, guidance)
- **Impact**: Poor developer experience for common beginner mistake

**P2-4: Error type and stack trace loss across VM boundary** (`JavaScriptExecutor.ts:148-155`)
- Catch block creates `new Error(message)` — loses error type, stack, custom properties
- User script `throw new TypeError("bad input")` becomes generic `Error("bad input")`
- **Impact**: Harder debugging for operators

## Implementation Plan

### Phase 1: Adversarial Test Harness (~100 lines, 1 new file)

Create `tests/helpers/AdversarialTestHelpers.ts`:
- `transpileAndExecute(script, rawContent, options?)` — runs full transpiler→builder→scope→VM pipeline, returns transpiled code + execution result + scope state
- `createMinimalConnectorMessage(rawContent, type)` — creates ConnectorMessage with raw data
- `createMinimalScriptContext(channelId?, channelName?)` — creates ScriptContext
- `assertErrorContains(result, ...keywords)` — verifies error messages include Mirth context

### Phase 2: XMLProxy Behavioral Bugs (P0-2, P0-3, P0-4) — 16 tests

**File**: `tests/unit/javascript/e4x/XMLProxy.adversarial.test.ts`

Tests — Existence checking (P0-2):
1. `msg.NONEXISTENT` truthiness — verify Proxy is truthy (current JS behavior, cannot change)
2. `msg.PV1.exists()` returns `true` for present segments — new method
3. `msg.NONEXISTENT.exists()` returns `false` for missing segments — new method
4. `msg.PV1.length()` returns node count — new method
5. `msg.NONEXISTENT.length()` returns `0` — new method
6. `msg.NONEXISTENT.toString()` returns `''` — verify string coercion works as safe alternative
7. Warning logged when empty XMLProxy hits Symbol.toPrimitive — verify warning text

Tests — Multi-node set (P0-3):
8. `msg.OBX['OBX.3'] = 'NEW'` with 3 OBX segments — verify ALL three are modified (currently only first)
9. `msg.OBX['OBX.3'] = 'NEW'` with 1 OBX segment — verify single node still works
10. `msg.OBX.forEach(...)` — verify iteration still works after multi-node set

Tests — Serialization safety (P0-4):
11. Aggressive delete then serialize — verify toXMLString throws/warns instead of silent empty
12. Delete all children then append new content — verify roundtrip serialization
13. `+msg.OBX['OBX.5']` with empty OBX.5 — verify numeric coercion behavior

Tests — Edge cases:
14. `msg.constructor` access — verify doesn't return child element named "constructor"
15. Very deep non-existent path `msg.A.B.C.D.E.F.G.H` — verify no infinite recursion
16. `msg.PID[0] === msg.PID[0]` — verify object identity (same Proxy or new each time?)

**Fixes** (in `XMLProxy.ts`):
- P0-2: **Both + warning log approach** — JavaScript Proxy objects are always truthy; `if (msg.PV1)` cannot be made to work identically to Java. Fix:
  1. Add `exists()` method — returns `true` if `this.nodes.length > 0`, `false` otherwise
  2. Add `length()` method (E4X built-in) — returns `this.nodes.length`
  3. Override `Symbol.toPrimitive` to log a warning via `console.warn()` when an empty XMLProxy is coerced: `"Warning: Empty XML element used in boolean context — use .exists() or .length() instead of if(msg.SEGMENT)"`
  4. Recommended migration pattern: `if (msg.PV1)` → `if (msg.PV1.exists())` or `if (msg.PV1.length() > 0)`
- P0-3: Change `set()` to iterate all nodes, not just `this.nodes[0]`
- P0-4: Change `toXMLString()` catch block to log warning and rethrow — silent empty string is worse than a visible error

### Phase 3: Global Default Namespace Fix (P0-1) — 6 tests

**File**: `tests/unit/javascript/e4x/XMLProxy.namespace.test.ts`

Tests:
1. Set namespace in Channel A, verify Channel B doesn't inherit it
2. Set namespace in source transformer, verify destination transformer starts clean
3. Set namespace, process message, verify next message starts clean
4. Set namespace with `default xml namespace = "uri"` E4X syntax (end-to-end transpile+execute)
5. Two concurrent messages with different namespaces — verify isolation
6. `getDefaultXmlNamespace()` returns correct value within same script

**Fix** (in `XMLProxy.ts` + `ScopeBuilder.ts`):
- Replace module-level `globalDefaultNamespace` with a per-scope variable
- `setDefaultXmlNamespace` and `getDefaultXmlNamespace` become closures over a scope-local variable
- Inject fresh namespace functions into each scope via `buildBasicScope()`
- This is a ~15-line change but architecturally important

### Phase 4: E4X Transpiler String Detection (P1-1, P1-2, P1-3) — 10 tests

**File**: `tests/unit/javascript/e4x/E4XTranspiler.adversarial.test.ts`

Tests:
1. XML literal with double-quoted attribute value containing `"` inside single-quoted source
2. XML literal with `&quot;` entities in attribute values
3. Template literal `` `${msg.PID}` `` — verify E4X inside `${...}` IS transpiled
4. Template literal `` `${msg.@version}` `` — verify attribute access inside `${...}`
5. Nested template literal `` `${`${msg.PID}`}` `` — verify nested `${...}`
6. Regex literal `/msg\.PID/` — verify E4X inside regex is NOT transpiled
7. Regex literal with flags `/msg\.@attr/gi` — verify not transpiled
8. Division operator `count = x / msg.PID.length()` — verify NOT treated as regex
9. E4X pattern appears both inside string AND outside: `"<OBX/>" + msg.OBX`
10. E4X pattern inside multiline block comment `/* <OBX/> */`

**Fixes** (in `E4XTranspiler.ts`):
- P1-1: Add `"` → `&quot;` escaping when output is used inside XML attribute values (new method `escapeForXmlAttr`)
- P1-2: Track `${...}` nesting depth inside backtick strings in `isInsideStringOrComment()`: when `${` is encountered inside a backtick string, increment depth and treat content as code until matching `}` decrements back to 0
- P1-3: Add regex literal detection heuristic: after `=`, `(`, `,`, `|`, `&`, `!`, `{`, `;`, `return`, `typeof`, or start-of-line, treat `/` as regex start (not division). Track until closing `/` with optional flags.

### Phase 5: StepCompiler Injection (P2-1) — 5 tests

**File**: `tests/unit/javascript/runtime/StepCompiler.injection.test.ts`

Tests:
1. Normal field `msg['PID']['PID.5']` — verify works
2. Injected field `x); malicious(); (0` — verify rejected or escaped
3. Field with special chars `msg['PID.5.1']` — verify works
4. Field with semicolons — verify rejected
5. RuleBuilder value with `';\nmalicious//` — verify `escapeJsString` prevents injection

**Fix** (in `StepCompiler.ts`):
- Validate `field` against an allowlist pattern: must match `/^[\w$.[\]'"()]+$/` (property access chains only)
- Reject fields containing `;`, `{`, `}`, `\n`, `//`, `/*` with a descriptive error

### Phase 6: Global State Isolation (P2-2) — 4 tests

**File**: `tests/unit/javascript/runtime/ScopeIsolation.test.ts`

Tests:
1. Script modifies `Buffer.prototype` — verify next execution doesn't see it
2. Script modifies `console.log` — verify next execution has original
3. Script stores reference to `scope` object — verify it doesn't persist
4. Two scripts in sequence — verify no shared mutable state beyond globalMap

**Fix** (in `ScopeBuilder.ts`):
- Wrap `Buffer` in a Proxy that intercepts `prototype` modifications, or create a read-only wrapper
- Consider replacing `console` with a sandboxed logger proxy

### Phase 7: Auto-Serialization Edge Cases (P2-3) — 6 tests

**File**: `tests/unit/javascript/runtime/AutoSerialization.adversarial.test.ts`

Tests:
1. Circular reference `msg.self = msg` — verify error message includes context
2. Very large message (1MB string) — verify no OOM or timeout
3. `msg = undefined` — verify handled gracefully
4. `msg = null` — verify handled gracefully
5. `msg = 42` (numeric) — verify `String(42)` serialization
6. Malformed JSON input with JSON inbound type — verify error includes parse context

**Fix** (in `ScriptBuilder.ts`):
- Wrap auto-serialization `JSON.stringify` in try-catch in generated code:
  ```javascript
  try { msg = JSON.stringify(msg); } catch(e) { throw new Error('Transformer error: msg contains circular reference or non-serializable value: ' + e.message); }
  ```

### Phase 8: Pipeline Integration Edge Cases — 8 tests

**File**: `tests/integration/pipeline/PipelineAdversarial.test.ts`

Uses existing `PipelineTestHarness` from `tests/integration/pipeline/helpers/`.

Tests:
1. Source transformer sets `default xml namespace` → destination transformer starts clean
2. Two messages through same channel → second doesn't inherit first's namespace
3. Filter rule modifies `$c` then returns false → verify `$c` changes NOT persisted
4. Filter rule modifies `$g` then returns false → verify `$g` changes ARE persisted (globalMap)
5. Preprocessor returns null → verify original message preserved
6. Postprocessor with undefined response → verify no TypeError
7. Response transformer sets `responseStatus = ERROR` then script times out → verify response not partially mutated
8. Transformer with E4X, Java interop shims, and map operations together (kitchen sink)

## Verification

After implementation, run:
```bash
# Run new adversarial tests
npx jest --testPathPattern='adversarial|injection|namespace|ScopeIsolation' --verbose

# Run full test suite to verify no regressions
npx jest --no-cache

# Verify test count increased (expect ~55 new tests)
npx jest --silent 2>&1 | tail -3
```

## Files to Create
| File | Tests | Purpose |
|------|-------|---------|
| `tests/helpers/AdversarialTestHelpers.ts` | — | Shared harness |
| `tests/unit/javascript/e4x/XMLProxy.adversarial.test.ts` | 16 | P0-2, P0-3, P0-4 |
| `tests/unit/javascript/e4x/XMLProxy.namespace.test.ts` | 6 | P0-1 |
| `tests/unit/javascript/e4x/E4XTranspiler.adversarial.test.ts` | 10 | P1-1, P1-2, P1-3 |
| `tests/unit/javascript/runtime/StepCompiler.injection.test.ts` | 5 | P2-1 |
| `tests/unit/javascript/runtime/ScopeIsolation.test.ts` | 4 | P2-2 |
| `tests/unit/javascript/runtime/AutoSerialization.adversarial.test.ts` | 6 | P2-3 |
| `tests/integration/pipeline/PipelineAdversarial.test.ts` | 8 | Integration |
| **Total** | **55** | |

## Files to Modify
| File | Changes |
|------|---------|
| `src/javascript/e4x/XMLProxy.ts` | `set()` iterate all nodes; namespace per-scope; toXMLString error handling |
| `src/javascript/e4x/E4XTranspiler.ts` | `isInsideStringOrComment` template literal + regex; `escapeForXmlAttr` method |
| `src/javascript/runtime/ScopeBuilder.ts` | Inject per-scope namespace functions; Buffer wrapper |
| `src/javascript/runtime/StepCompiler.ts` | Field validation |
| `src/javascript/runtime/ScriptBuilder.ts` | Auto-serialization try-catch wrapping |

## Execution Strategy

Given the cross-cutting nature of these changes, the recommended approach is:
1. **Phase 1-2 first** (XMLProxy) — highest impact, most test coverage needed
2. **Phase 3** (namespace) — couples with Phase 2's XMLProxy changes
3. **Phase 4** (E4X transpiler) — independent from XMLProxy
4. **Phase 5-7** (StepCompiler, isolation, serialization) — small targeted fixes
5. **Phase 8 last** (pipeline integration) — validates all fixes work end-to-end

Phases 4, 5, 6, 7 can run in parallel (independent files). Phases 2+3 should be sequential (both modify XMLProxy.ts). Phase 8 depends on all prior phases.
