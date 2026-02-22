<!-- Completed: 2026-02-22 | Status: Implemented -->

# Transformation Quality Checker Scan & Remediation — 2026-02-22

## Summary

Full-scope TQ checker scan after Phase C additions (batch adaptors, auto-responder, escape handler), StepCompiler, and XMLProxy TQ remediation. Scanned all 8 TQ bug categories with static analysis + execution verification.

## Results

| Severity | Count | Resolved |
|----------|-------|----------|
| Critical | 0 | N/A |
| Major | 1 | Yes — `npm run build` (stale dist/ with `new Function()`) |
| Minor | 2 | Yes — `npm run build` + documented (method name shadowing) |
| Informational | 2 | N/A |

## Fixes Applied

### Fix 1: Batch Adaptor Sandbox Escape (Critical → Fixed before scan)

**Problem**: `HL7BatchAdaptor.ts:74` and `DelimitedBatchAdaptor.ts:342` used `new Function('context', userScript)` to compile user batch scripts, executing them in the main Node.js realm with access to `require()`, `process`, `global`, and the filesystem.

**Fix**: Created `compileBatchScript()` in `ScriptBatchAdaptor.ts` that:
- Wraps user script in an IIFE: `(function() { scriptBody })()`
- Compiles via `new vm.Script()` (once, reused across calls)
- Executes in `vm.createContext()` with only `reader` and `sourceMap` in scope
- Enforces 30s timeout (prevents infinite loops)
- Disables `setTimeout`/`setInterval`/`setImmediate`/`queueMicrotask`

Both `HL7BatchAdaptor` and `DelimitedBatchAdaptor` now use `compileBatchScript()`.

**Key design decision**: The IIFE executes *inside* `runInContext()`, not as a separate function call. This is critical because `vm.Script.runInContext(sandbox, { timeout })` only applies the timeout to code running within that call. If we returned a function from `runInContext` and called it separately, the timeout would only cover the function *definition* (instant), not the function *body* (where user code runs).

### Fix 2: StepCompiler `escapeJsString()` (Major)

**Problem**: Only escaped `\` and `'`, missing `\n`, `\r`, and `\0`. A RuleBuilder value containing newlines would produce broken JavaScript string literals, causing SyntaxError at runtime (message silently FILTERED instead of correctly evaluated).

**Fix**: Added `.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0')` to `escapeJsString()`.

## Files Modified

| File | Change |
|------|--------|
| `src/donkey/message/ScriptBatchAdaptor.ts` | Added `compileBatchScript()` with vm.Script sandboxing |
| `src/donkey/message/HL7BatchAdaptor.ts` | Replaced `new Function()` with `compileBatchScript()` |
| `src/datatypes/delimited/DelimitedBatchAdaptor.ts` | Replaced `new Function()` with `compileBatchScript()` |
| `src/javascript/runtime/StepCompiler.ts` | Added `\n`, `\r`, `\0` escaping to `escapeJsString()` |

## Tests Added

| File | Tests | Purpose |
|------|-------|---------|
| `tests/unit/donkey/message/BatchAdaptor.sandbox.test.ts` | 15 | Sandbox security (require/process/global blocked, timeout enforced, reader/sourceMap accessible) |
| `tests/unit/javascript/runtime/StepCompiler.injection.test.ts` | +5 | Newline/CR/null byte escaping in generated filter code |

**Total**: 20 new tests. Full suite: 8,388 passing (369 suites).

## TQ Checker Verification Matrix

| Phase | Items | Passed |
|-------|-------|--------|
| Anti-Pattern Scan | 12 patterns | 12/12 safe |
| E4X Transpilation | 25 patterns | 25/25 passed |
| Scope Audit | 8 scope types | 8/8 verified |
| Script Types | 7 types | 7/7 verified |
| XMLProxy Methods | 15 methods | 15/15 passed |
| Map Chains | 7 chains | 7/7 verified |
| Data Flow | 10 stages | 10/10 verified |

## Previously Fixed Bugs Verified (20+)

All fixes from lessons #54-#60, adversarial testing (P0-1 through P2-3), and TQ remediation (Proxy _self, value.nodes, _isDocument, attributes().length(), createList guard) confirmed intact.

## Known Limitation (Not a Bug)

**TQ-XBG-001**: XMLProxy method names shadow same-named XML elements when accessed via dot notation. `msg.child` returns the `child()` method, not `<child>` element. Bracket notation (`msg['child']`) works correctly. This matches Java E4X behavior. Real-world HL7v2 segments (PID, OBX, MSH) do not collide with XMLProxy method names.
