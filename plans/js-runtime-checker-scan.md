<!-- Completed: 2026-02-11 | Status: Implemented -->

# JS Runtime Parity Checker Scan & Remediation

## Context

Post-Wave 10 comprehensive mop-up scan using `js-runtime-checker` agent across all 10 bug categories. The JavaScript runtime had 34 source files, 11,411 LOC, and 4,633 tests at baseline.

## Scan Results

**17 total findings:**
- 2 Critical (fixed)
- 6 Major (5 fixed, 1 deferred as convenience-only)
- 9 Minor (deferred — cosmetic or edge-case)

## Fixes Implemented (8 findings)

### Critical

| ID | File | Fix | Tests |
|----|------|-----|-------|
| JRC-SVM-001 | ScopeBuilder.ts | Pass `destinationIdMap` from ConnectorMessage to ResponseMap — enables `$r('Destination Name')` lookup | 3 |
| JRC-SVM-002 | ScopeBuilder.ts | Add `template` parameter to `buildResponseTransformerScope` — prevents ReferenceError in response transformers with outbound templates | 3 |

### Major

| ID | File | Fix | Tests |
|----|------|-----|-------|
| JRC-SBD-001 | ScriptBuilder.ts | `createSegmentAfter` now walks to root and returns tree node (matching Java exactly) | 3 |
| JRC-SBD-002 | ScriptBuilder.ts | `getAttachments()` default changed from `base64Decode !== false` to `!!base64Decode \|\| false` — no-args defaults to false (no decode) matching Java | 2 |
| JRC-SBD-003 | ScriptBuilder.ts | `validate()` now type-checks before applying replacements — only applies to string and XML types (not numbers) | 2 |
| JRC-SBD-004 | ScriptBuilder.ts | Attachment functions (`getAttachments`, `addAttachment`, etc.) always included in all script types — not conditional on `includeAttachmentFunctions` option | 5 |
| JRC-ETG-001 | E4XTranspiler.ts + XMLProxy.ts | `new XMLList()` and `XMLList()` transpiled to `XMLProxy.createList()` | 6 |
| JRC-SVM-003 | ScopeBuilder.ts | Added `buildMessageReceiverScope`, `buildMessageDispatcherScope`, `buildBatchProcessorScope` | 4 |

## Deferred Findings (9 minor)

| ID | Description | Reason |
|----|-------------|--------|
| JRC-SBD-005 | Missing `regex`, `xml`, `xmllist`, `namespace`, `qname` convenience vars | Rarely used, no functional impact |
| JRC-SBD-006 | `importClass` shim doesn't log deprecation | Cosmetic |
| JRC-SBD-007 | `addAttachment` missing `useAttachmentList` variant | Rare use case (attachment handler scripts only) |
| JRC-TCD-001 | SourceMap doesn't wrap destinationSet in unmodifiable copy | Low risk — modifying through sourceMap is uncommon |
| JRC-TCD-002 | ResponseMap doesn't wrap donkey Response in userutil Response | Low impact — same API shape |
| JRC-TCD-003 | Response not wrapped in ImmutableResponse for response transformer | Low risk — read-back uses separate scope vars |
| JRC-ECL-001 | Logger not reassigned to phase name | Cosmetic logging difference |
| JRC-XNH-001 | `Namespace()` and `QName()` constructors not available | Rare — only in HL7v3/CDA namespaced XML |
| JRC-STB-001 | Script timeout mechanism differs (Rhino instruction count vs V8 timeout) | Documented behavioral difference |

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| Test suites | 224 | 224 |
| Total tests | 4,633 | 4,661 |
| New parity tests | - | 28 |
| Source files modified | - | 4 |
| Findings fixed | - | 8 |
| Findings deferred | - | 9 |
