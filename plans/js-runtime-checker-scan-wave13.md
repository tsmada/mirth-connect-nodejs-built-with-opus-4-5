<!-- Completed: 2026-02-11 | Status: Scan Complete, Remediation In Progress -->

# JavaScript Runtime Checker Report — Wave 13

**Scan Date**: 2026-02-11
**Scope**: full (all 10 categories)
**Minimum Severity**: minor
**Previous Scans**: Waves 8-12 fixed ~60 gaps

## Finding Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Major | 5 |
| Minor | 5 |
| **Total** | **12** |

## Triage

| ID | Severity | Finding | Action |
|---|---|---|---|
| JRC-SBD-012 | Critical | Transformed data (msg/tmp) never read back from VM | Fix now |
| JRC-SBD-013 | Critical | Postprocessor return value ignored | Fix now |
| JRC-SBD-014 | Major | Response not wrapped in ImmutableResponse | Fix now |
| JRC-SVM-005 | Major | Batch scope missing alerts/globalChannelMap | Fix now |
| JRC-ECL-002 | Minor | Response status not read back from scope | Fix now |
| JRC-ETG-002 | Major | E4X += with variable RHS | Document limitation |
| JRC-MUM-001 | Major | Missing wrapper classes | Defer Wave 14 |
| JRC-SBD-015 | Major | Global pre/postprocessor | Defer Wave 14 |
| JRC-SBD-016 | Minor | getArrayOrXmlLength type check | Defer |
| JRC-SBD-017 | Minor | XML.ignoreWhitespace setting | Defer |
| JRC-SBD-018 | Minor | validate() boxed String | Defer |
| JRC-MUM-002 | Minor | AuthenticationResult/AuthStatus | Defer |

## Critical Findings

### JRC-SBD-012: Transformed data never read back from VM context

After filter/transformer script executes, auto-serialized msg/tmp values sit in scope but
are never propagated to ConnectorMessage.transformedData. Java's getTransformedDataFromScope()
explicitly reads scope["tmp"] (if template) or scope["msg"] and returns to pipeline.

**Impact**: Every transformer that modifies msg produces ORIGINAL untransformed content downstream.

### JRC-SBD-013: Postprocessor return value ignored

Java's executePostprocessorScripts() converts the script's return value into a Response object.
Node.js returns ExecutionResult<void> and discards the value.

**Impact**: Channels relying on postprocessor Response object are broken.

## Major Findings

### JRC-SBD-014: Response transformer scope missing ImmutableResponse wrapping
### JRC-SVM-005: Batch processor scope missing alerts and globalChannelMap
### JRC-ETG-002: E4X += only transpiles XMLProxy.create() RHS (documented limitation)
### JRC-MUM-001: Missing wrapper classes (MessageHeaders, MessageParameters, etc.)
### JRC-SBD-015: Global preprocessor/postprocessor scripts not supported
