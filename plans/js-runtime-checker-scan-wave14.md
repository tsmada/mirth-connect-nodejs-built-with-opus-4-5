<!-- Completed: 2026-02-11 | Status: Scan Complete, Remediation In Progress -->

# JavaScript Runtime Checker Report — Wave 14

**Scan Date**: 2026-02-11
**Scope**: full (all 10 categories)
**Minimum Severity**: minor
**Previous Scans**: Waves 8-13 fixed ~65 gaps, 214 parity tests

## Coverage Summary

| Metric | Java | Node.js | Coverage |
|--------|------|---------|----------|
| Server Userutil Classes | 28 | 29 (28 + MirthMap) | 100% |
| Non-Server Userutil Classes | 18 | 12 → 14 | 78% |
| Scope Variables (basic) | 12 | 12 | 100% |
| Scope Variables (per-phase) | 22+ | 20+ | ~91% |
| E4X Patterns | 25 | 19 → 20 | 80% |
| Script Generator Types | 8 | 8 | 100% |

## Finding Summary

| Severity | Total Found | Fixed (Wave 14) | Known Deferrals | New Deferrals |
|----------|-------------|-----------------|-----------------|---------------|
| Critical | 2 | 2 | 0 | 0 |
| Major | 7 | 3 | 3 | 1 |
| Minor | 12 | 0 | 11 | 1 |
| **Total** | **21** | **5** | **14** | **2** |

---

## CRITICAL FINDINGS — FIXED

### JRC-ECL-002 + JRC-SBD-020: Response transformer scope readback missing (ESCALATED from minor)

**Category**: `script-builder-divergence`
**Status**: FIXED (Wave 14)

After the response transformer script executes, Java calls `getResponseDataFromScope(scope, userResponse)` which reads `responseStatus`, `responseStatusMessage`, and `responseErrorMessage` from the VM scope back into the Response object. It also reads transformed data from `msg`/`tmp` via `getTransformedDataFromScope()`.

The Node.js port had no `executeResponseTransformer()` method. The `ResponseTransformerExecutor.ts` called `doTransform()` but never read scope variables back.

**Fix**: Added `executeResponseTransformer()` to `JavaScriptExecutor.ts` with full scope readback for response status + transformed data.

**Java reference**: `JavaScriptResponseTransformer.java:197-200`, `JavaScriptScopeUtil.java:417-434`

### JRC-SBD-015: Global pre/postprocessor scripts not executed (CONFIRMED Critical)

**Category**: `script-builder-divergence`
**Status**: FIXED (Wave 14)

Java executes global preprocessor THEN channel preprocessor in sequence. Similarly, channel postprocessor runs first, then global postprocessor receives its Response.

**Fix**: Added `executePreprocessorScripts()` and `executePostprocessorScripts()` methods to `JavaScriptExecutor.ts` that chain global + channel scripts in the correct order.

**Java reference**: `JavaScriptUtil.java:168-235` (preprocessor), `JavaScriptUtil.java:260-303` (postprocessor)

---

## MAJOR FINDINGS — FIXED

### JRC-ETG-002: E4X `+=` with variable RHS not transpiled (KNOWN DEFERRAL → FIXED)

**Category**: `e4x-transpilation-gap`
**Status**: FIXED (Wave 14)

The E4X transpiler only handled `xml += XMLProxy.create(...)`. When RHS was a variable (`msg += someVar`), JavaScript string concatenation occurred instead of XML append.

**Fix**: Extended `transpileXMLAppend` to handle variable/expression RHS for XML-like identifiers (`msg`, `tmp`, `xml` prefixed variables).

### JRC-MUM-001: Missing wrapper classes (partial fix — MessageHeaders + MessageParameters)

**Category**: `missing-userutil-method`
**Status**: PARTIALLY FIXED (Wave 14)

Added `MessageHeaders` (case-insensitive HTTP header multi-value map) and `MessageParameters` (query parameter multi-value map) wrapper classes. These are the most urgently needed for HTTP connector scripts.

**Remaining**: `ImmutableMessage`, `ImmutableConnectorMessage`, `ImmutableMessageContent`, `ImmutableAttachment`, `AttachmentEntry` — deferred to future wave.

---

## MAJOR FINDINGS — DEFERRED

### JRC-ETG-003: E4X `delete` operator on named properties relies solely on Proxy handler

**Category**: `e4x-transpilation-gap`
**Severity**: Major
**Status**: DEFERRED (Proxy handler covers common patterns)

The `delete` operator on nested E4X paths may silently fail when intermediate access resolves to text content instead of XMLProxy. The Proxy handler approach works for the common `delete msg.PID['PID.6']` pattern.

**Rationale**: No user reports of failures; Proxy handler covers the most common patterns.

### JRC-SVM-006: `resultMap` not injected into scope for Database Reader scripts

**Category**: `scope-variable-mismatch`
**Severity**: Major
**Status**: DEFERRED (requires pipeline architecture changes)

The `$()` function correctly tries `resultMap.containsKey(string)` with a typeof guard, but `resultMap` is never injected into scope. In Java, the Database Receiver overrides `processRow()` to set up scope with `resultMap` before filter/transformer runs. Node.js uses `dispatchRawMessage(xml)` which enters the standard pipeline without connector-specific scope injection.

**Workaround**: Scripts use XML/msg path access instead of `$('columnName')`.
**Fix path**: Add connector-specific scope injection hook to the pipeline.

### JRC-MUM-002: AuthenticationResult/AuthStatus classes missing

**Category**: `missing-userutil-method`
**Severity**: Major
**Status**: DEFERRED (only needed for custom authentication scripts)

---

## MINOR FINDINGS — ALL DEFERRED (unchanged from Waves 11/13)

| ID | Category | Description | Rationale |
|----|----------|-------------|-----------|
| JRC-ETG-004 | e4x-transpilation-gap | Convenience vars `regex`, `xml`, `xmllist`, `namespace`, `qname` | Rarely used in modern scripts |
| JRC-ETG-005 | e4x-transpilation-gap | `Namespace()`/`QName()` constructors | Rare — only in HL7v3/CDA namespaced XML |
| JRC-SBD-016 | type-coercion-difference | `getArrayOrXmlLength` type check | Edge case |
| JRC-SBD-017 | xml-namespace-handling | `XML.ignoreWhitespace` setting | fast-xml-parser handles differently |
| JRC-SBD-018 | type-coercion-difference | `validate()` boxed String | V8 scripts rarely use `new String()` |
| JRC-SBD-019 | type-coercion-difference | Auto-serialization typeof check | Duck-typing approach is correct for V8 |
| JRC-SBD-021 | script-builder-divergence | `useAttachmentList` variant | Rare use case |
| JRC-SBD-022 | scope-variable-mismatch | `debug/info/warn/error` convenience functions | Node.js-only addition (not a bug) |
| JRC-TCD-005 | type-coercion-difference | `importClass` no deprecation log | Cosmetic |
| JRC-ECL-003 | error-context-loss | Phase name in error context | Cosmetic logging |
| JRC-STB-001 | script-timeout-behavior | Timeout on async only | Documented behavioral difference |
| JRC-SER-001 | scope-variable-mismatch | Unmodifiable sourceMap | Low risk |

---

## SCOPE VARIABLE AUDIT

| Variable | Java | Node.js | Status |
|----------|------|---------|--------|
| `msg`, `tmp` | Yes | Yes | Matched |
| `connectorMessage` | Yes | Yes | Matched |
| `channelId`, `channelName` | Yes | Yes | Matched |
| `sourceMap`/`$s` | Yes | Yes | Matched |
| `channelMap`/`$c` | Yes | Yes | Matched |
| `connectorMap`/`$co` | Yes | Yes | Matched |
| `responseMap`/`$r` | Yes | Yes | Matched (with destinationIdMap) |
| `globalMap`/`$g` | Yes | Yes | Matched |
| `globalChannelMap`/`$gc` | Yes | Yes | Matched |
| `configurationMap`/`$cfg` | Yes | Yes | Matched |
| `destinationSet` | Yes | Yes | Matched |
| `alerts` | Yes | Yes | Matched (connector-aware) |
| `router`, `replacer` | Yes | Yes | Matched |
| `logger` | Yes | Yes | Matched |
| `template`, `phase` | Yes | Yes | Matched |
| `response`, `responseStatus` | Yes | Yes | Matched (with readback) |
| `message` | Yes | Yes | Matched |
| `resultMap` | Yes | **No** | Missing (JRC-SVM-006) |
| `regex`/`xml`/`xmllist` | Yes | **No** | Missing (minor) |

## E4X PATTERN AUDIT

| Pattern | Handled? | Notes |
|---------|----------|-------|
| `.child` access | Yes | Proxy `get` trap |
| `.@attr` read/write | Yes | Transpiler |
| `..descendant` | Yes | Transpiler |
| `xml += literal` | Yes | Transpiler |
| `xml += variable` | Yes | **Fixed Wave 14** |
| `delete xml.child` | Partial | Proxy handler |
| `.child.(predicate)` | Yes | Filter transpilation |
| `for each...in` | Yes | Transpiler |
| `new XML()` / `new XMLList()` | Yes | Transpiler |
| `xml.text()`, `.elements()` | Yes | XMLProxy methods |
| `.@*`, `.*` wildcards | Yes | Transpiler |
| `Namespace()`, `QName()` | No | Minor deferral |

## SANDBOX SECURITY AUDIT

| Check | Status |
|-------|--------|
| `require`, `process`, `global`, `Buffer` excluded | Yes |
| `setTimeout`/`setInterval`/`setImmediate` disabled | Yes |
| `queueMicrotask` disabled | Yes |
| Prototype chain escape | Needs review (low priority — trusted admin scripts) |
| `Function()` constructor | Needs review (low priority) |

---

## Wave 14 Metrics

| Metric | Before | After |
|--------|--------|-------|
| Total tests | 4,725 | 4,806 |
| New parity tests | - | 81 |
| Source files modified | - | 4 |
| New source files | - | 2 (MessageHeaders, MessageParameters) |
| New test files | - | 5 |
| Findings fixed | - | 5 |
| Findings deferred | 15 | 16 |
| Known deferrals re-confirmed | - | 14 |
