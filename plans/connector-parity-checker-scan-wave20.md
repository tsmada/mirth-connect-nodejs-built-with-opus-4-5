<!-- Completed: 2026-02-13 | Status: Implemented -->

# Connector Parity Wave 20 — Scan & Remediation Report

## Summary

Wave 20 focused on **lifecycle and response-handling gaps** not covered by prior property-level or event-dispatch analysis (Waves 16-19).

| Metric | Value |
|--------|-------|
| Findings scanned | 6 |
| Fixed | 5 |
| No fix needed | 1 (CPC-W20-006) |
| New tests | 20 |
| Total tests | 5,129 (was 5,109) |
| Regressions | 0 |

## Findings

### CPC-W20-001 — HTTP Receiver Empty Response Body (CRITICAL) ✅ FIXED

**Problem:** `HttpReceiver.handleRequest()` called `dispatchRawMessage()` and discarded the return value. `sendResponse()` always sent an empty string body. Any HTTP source channel that returns channel-processed data to callers got empty responses.

**Fix:** Added `dispatchRawMessageWithResult()` private method (same pattern as TcpReceiver) that captures the `Message` result from `channel.dispatchRawMessage()`. Updated `sendResponse()` to accept the dispatch result and extract the response body from:
1. Response transformer output (highest priority)
2. Source connector's selected response content
3. First destination's response content (fallback)

Also added `deriveStatusCode()` to return HTTP 500 when the message has ERROR status (when no explicit `responseStatusCode` is configured).

**Files:** `src/connectors/http/HttpReceiver.ts`
**Tests:** 5 new tests (response body extraction, priority order, error status)

### CPC-W20-002 — HTTP Receiver Variable Response Headers (MAJOR) ✅ FIXED

**Problem:** `applyVariableResponseHeaders()` was an empty stub. When `useResponseHeadersVariable=true`, dynamic response headers were silently ignored.

**Fix:** Implemented the method to look up the named variable from the source connector message's maps (channelMap → responseMap → connectorMap → sourceMap, matching Java's priority). Supports Map objects, plain objects, and JSON strings as header value formats.

**Files:** `src/connectors/http/HttpReceiver.ts`
**Tests:** 3 new tests (object headers, Map headers, disabled flag)

### CPC-W20-003 — SourceConnector Missing halt() (MAJOR) ✅ FIXED

**Problem:** Java's `SourceConnector.halt()` is an emergency shutdown method that dispatches IDLE and sets STOPPED. Node.js had no equivalent.

**Fix:** Added `halt()` and `onHalt()` methods to `SourceConnector` base class. `halt()` sets STOPPING, calls `onHalt()`, dispatches IDLE, and sets STOPPED in a finally block. `onHalt()` defaults to delegating to `onStop()`.

**Files:** `src/donkey/channel/SourceConnector.ts`
**Tests:** 4 new tests (state transitions, IDLE event, error safety)

### CPC-W20-004 — JMS Receiver JmsClient Timing (MAJOR) ✅ FIXED

**Problem:** Java creates `JmsClient` in `onDeploy()`. Node.js created it in `start()`, meaning deployment-time configuration errors (bad broker URL) weren't caught until start.

**Fix:** Moved `JmsClient.getClient()` call to `onDeploy()`, which is now async. `start()` reuses the client from `onDeploy()`, with a fallback to create it if `onDeploy()` wasn't called.

**Files:** `src/connectors/jms/JmsReceiver.ts`
**Tests:** 3 new tests (deploy creates client, start reuses, deploy event)

### CPC-W20-005 — JDBC Receiver Lifecycle Separation (MAJOR) ✅ FIXED

**Problem:** Java's `DatabaseReceiver` separates `onDeploy()` (create pool + IDLE) from `onStart()` (begin polling). Node.js merged everything into `start()`.

**Fix:** Added `onDeploy()` (creates connection pool, dispatches IDLE) and `onUndeploy()` (closes pool) methods. `start()` now focuses on starting the poll timer. `stop()` no longer closes the pool — that's `onUndeploy()`'s job.

**Files:** `src/connectors/jdbc/DatabaseReceiver.ts`
**Tests:** 5 new tests (deploy creates pool, start reuses, undeploy closes, stop preserves pool)

### CPC-W20-006 — TCP Dispatcher socketTimeout (MINOR) — NO FIX NEEDED

**Problem:** `TcpDispatcher` has a `socketTimeout` field with no Java equivalent.

**Analysis:** This is an intentional Node.js-only addition for connection establishment timeout. Java has hardcoded defaults. The 30-second default is appropriate. No compatibility issues.

## Wave 20 vs Prior Waves

| Metric | Wave 16 | Wave 17 | Wave 18 | Wave 19 | Wave 20 |
|--------|---------|---------|---------|---------|---------|
| Findings | 73 | 56 | 48 | 8 | 6 |
| Critical | 18 | 5 | 4 | 2 | 1 |
| Major | 35 | 22 | 15 | 4 | 4 |
| Minor | 20 | 29 | 29 | 2 | 1 |
| Focus | Properties, events | replaceConnectorProperties | replaceConnectorProperties (remaining) | DICOM, WS, SMTP | Response pipeline, lifecycle |
| New tests | 40 | 112 | 88 | 43 | 20 |

## Cumulative Connector Parity Status

After 5 waves of systematic scanning:

| Category | Coverage |
|----------|----------|
| Config properties | 96%+ |
| Default values | 100% (all Java-matched) |
| replaceConnectorProperties | 9/9 (100%) |
| Event dispatch | 100% (all connectors) |
| Response pipeline | HTTP + TCP (100%) |
| Lifecycle hooks | halt + onDeploy/onUndeploy added |
| Critical findings remaining | **0** |

**Total findings across Waves 16-20: 191 found, 92 fixed, 39 deferred (9 major + 30 minor)**
