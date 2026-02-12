<!-- Completed: 2026-02-12 | Status: Scan + Remediation Complete -->

# Connector Parity Checker Scan — Wave 19

## Context

Fourth systematic connector parity scan across all 9 connectors (HTTP, TCP, File, JDBC, VM, SMTP, JMS, WebService, DICOM). This is a fresh ground-truth scan following 3 prior waves (16-18) that achieved 97.5% property coverage, 100% replaceConnectorProperties, and 100% event dispatch. Orchestrated via agent team with parallel fixer agents.

## Scan Parameters

- **Scope**: full (all 9 connectors)
- **Severity**: minor (report all)
- **Bug categories**: all 10
- **Output format**: markdown
- **Include fix plans**: true
- **Agent**: connector-parity-checker (team: connector-parity-w19)

## Summary

| Metric | Wave 18 | Wave 19 | Delta |
|--------|---------|---------|-------|
| Total new findings | 7 | 8 | +1 |
| Critical | 4 | 2 | -2 |
| Major | 3 | 4 | +1 |
| Minor | 0 | 2 | +2 |
| Previously deferred | 37 | 37 | 0 |
| Fixed this wave | — | 7 | — |
| Deferred (new) | — | 1 | — |
| Total tests | 5,066 | 5,109 | +43 |

### Findings by Connector

| Connector | Role | Critical | Major | Minor | Total New |
|-----------|------|----------|-------|-------|-----------|
| DICOM | Disp | **2** | 1 | 1 | 4 |
| DICOM | Recv | 0 | 1 | 0 | 1 |
| WS | Disp | 0 | 1 | 0 | 1 |
| SMTP | Disp | 0 | 1 | 1 | 2 |
| HTTP | Both | 0 | 0 | 0 | 0 |
| TCP | Both | 0 | 0 | 0 | 0 |
| File | Both | 0 | 0 | 0 | 0 |
| JDBC | Both | 0 | 0 | 0 | 0 |
| VM | Both | 0 | 0 | 0 | 0 |
| JMS | Both | 0 | 0 | 0 | 0 |
| **Total** | | **2** | **4** | **2** | **8** |

### Connector Audit Matrix

| Connector | Role | Java Props | Node Props | Coverage | replaceConnProps | Events |
|-----------|------|-----------|------------|----------|-----------------|--------|
| HTTP | Receiver | 16 | 16 | 100% | N/A (receiver) | 3/3 |
| HTTP | Dispatcher | 22 | 22 | 100% | 10/10 | 2/2 |
| TCP | Receiver | 12 | 12 | 100% | N/A (receiver) | 4/4 |
| TCP | Dispatcher | 10 | 10 | 100% | 5/5 | 3/3 |
| File | Receiver | 24 | 24 | 100% | N/A (receiver) | 2/2 |
| File | Dispatcher | 17 | 17 | 100% | 5/5 | 2/2 |
| JDBC | Receiver | 8 | 7 | 87% | N/A (receiver) | 2/2 |
| JDBC | Dispatcher | 6 | 6 | 100% | 3/3 | 2/2 |
| VM | Receiver | 2 | 2 | 100% | N/A (receiver) | 1/1 |
| VM | Dispatcher | 3 | 3 | 100% | 2/2 | 3/3 |
| SMTP | Dispatcher | 20 | 20 | 100% | 18/18 | 2/2 |
| JMS | Receiver | 10 | 8 | 80% | N/A (receiver) | 2/2 |
| JMS | Dispatcher | 8 | 8 | 100% | 1/1 | 2/2 |
| WS | Receiver | 6 | 6 | 100% | N/A (receiver) | 3/3 |
| WS | Dispatcher | 22 | 22 | 100% | 17/17 | 2/2 |
| DICOM | Receiver | 30 | 30 | 100% | N/A (receiver) | 3/3 |
| DICOM | Dispatcher | 35 | 35 | 100% | 14/14 | 2/2 |
| **Overall** | | **251** | **248** | **96%** | **9/9 (100%)** | **40/40 (100%)** |

---

## New Findings (8)

### CPC-W19-001 (CRITICAL): DICOM Dispatcher — Non-success status throws instead of QUEUED — FIXED

**Category**: response-handling-gap
**Connector**: DICOM Dispatcher
**Java**: DICOMDispatcher.java:268-271
**Node.js**: DICOMDispatcher.ts:467

**Gap**: Non-success DICOM status codes threw an Error, causing permanent message failure instead of queueing for retry.
**Fix**: Changed to set Status.QUEUED and return a Response with the error message, matching Java behavior.
**Tests**: 6 new parity tests

### CPC-W19-002 (CRITICAL): DICOM Dispatcher — 16 dcmSnd config properties not wired — FIXED

**Category**: protocol-behavior-gap
**Connector**: DICOM Dispatcher
**Java**: DICOMDispatcher.java:154-231
**Node.js**: DICOMDispatcher.ts:376-417

**Gap**: createConnection() only passed a subset of properties. Missing: async, bufSize, priority, username/passcode, pdv1, reaper, releaseTo, rspTo, shutdownDelay, soCloseDelay, sorcvbuf, sosndbuf, tcpDelay.
**Fix**: Extended AssociationParams interface and createConnection() to pass all properties through. Socket-level options (sorcvbuf, sosndbuf, tcpDelay) wired to net.Socket methods.
**Tests**: 8 new parity tests

### CPC-W19-003 (MAJOR): DICOM Dispatcher — Storage commitment not implemented — DEFERRED

**Category**: protocol-behavior-gap
**Connector**: DICOM Dispatcher
**Java**: DICOMDispatcher.java:238-255

**Gap**: Storage commitment (N-ACTION → N-EVENT-REPORT) is stubbed with a console.log.
**Why deferred**: Requires implementing DICOM N-ACTION/N-EVENT-REPORT protocol in DicomConnection — complex protocol work (~4+ hours).

### CPC-W19-004 (MAJOR): WS Dispatcher — useHeadersVariable runtime lookup missing — FIXED

**Category**: missing-config-property
**Connector**: WebService Dispatcher
**Java**: WebServiceDispatcher.java:754-758
**Node.js**: WebServiceDispatcher.ts

**Gap**: When useHeadersVariable is true, Java's getHeaders() looks up the variable name from message maps and uses the resulting Map as SOAP headers. Node.js only resolved ${variable} in static header values.
**Fix**: Added getHeaders() and getTableMapFromVariable() methods matching Java's HttpUtil.getTableMap() pattern.
**Tests**: 11 new parity tests

### CPC-W19-005 (MAJOR): SMTP Dispatcher — Missing ErrorEvent on send failure — FIXED

**Category**: missing-connector-event
**Connector**: SMTP Dispatcher
**Java**: SmtpDispatcher.java:257
**Node.js**: SmtpDispatcher.ts

**Gap**: No ErrorEvent dispatched when email sending fails. Java dispatches both ConnectionStatusEvent (IDLE) AND ErrorEvent.
**Fix**: Added ErrorEvent dispatch via getAlertEventController() in the catch block, matching Java's pattern.
**Tests**: 4 new parity tests

### CPC-W19-006 (MAJOR): DICOM Receiver — Config properties not fully wired — FIXED

**Category**: protocol-behavior-gap
**Connector**: DICOM Receiver
**Java**: DICOMReceiver.java:64-166
**Node.js**: DICOMReceiver.ts

**Gap**: Properties rspDelay, reaper, soCloseDelay, sosndbuf, sorcvbuf, bufSize, async, pdv1 defined but not wired to TCP server socket.
**Fix**: Wired remaining properties to server socket options and association negotiation parameters.
**Tests**: 6 new parity tests

### CPC-W19-007 (MINOR): DICOM Dispatcher — Missing ErrorEvent on send failure — FIXED

**Category**: missing-connector-event
**Connector**: DICOM Dispatcher
**Java**: DICOMDispatcher.java:283
**Node.js**: DICOMDispatcher.ts:208-210

**Gap**: No ErrorEvent dispatched on DICOM send failure.
**Fix**: Added ErrorEvent dispatch in catch block, matching SMTP pattern.
**Tests**: 4 new parity tests

### CPC-W19-008 (MINOR): SMTP Dispatcher — Missing localPort in overrideLocalBinding — FIXED

**Category**: missing-config-property
**Connector**: SMTP Dispatcher
**Java**: SmtpDispatcher.java:174-177
**Node.js**: SmtpDispatcher.ts:196-198

**Gap**: Only localAddress was set when overrideLocalBinding is true. Java sets both localaddress and localport.
**Fix**: Added localPort to nodemailer transport options alongside localAddress.
**Tests**: 4 new parity tests

---

## Previously Deferred Findings (37 from Waves 16-18) — Status Check

### Major Deferrals (8) — All Unchanged

| # | Finding | Connector | Status |
|---|---------|-----------|--------|
| 1 | HTTP static resources serving | HTTP Recv | Still deferred |
| 2 | HTTP Digest authentication | HTTP Disp | Still deferred |
| 3 | HTTP/WS receiver auth middleware | HTTP Recv | Still deferred |
| 4 | WS receiver authentication | WS Recv | Still deferred |
| 5 | JDBC script mode delegate | JDBC Recv | Still deferred |
| 6 | JDBC parameter extraction | JDBC Disp | Still deferred |
| 7 | File FTP/S3/SMB backends | File Recv+Disp | Still deferred |
| 8 | JDBC receiver retry implementation | JDBC Recv | Still deferred |

### Minor Deferrals (29) — All Unchanged

All 29 minor findings from Wave 17 remain unchanged (cosmetic, optimization, or rarely-used features).

### New Deferral from Wave 19

| # | Finding | Connector | Status | Why |
|---|---------|-----------|--------|-----|
| 9 | DICOM storage commitment | DICOM Disp | New deferral | Complex N-ACTION/N-EVENT-REPORT protocol |

**Total deferred: 9 major + 29 minor = 38**

---

## Fixer Agent Results

| Agent | Branch | Findings Fixed | New Tests | Commit |
|-------|--------|---------------|-----------|--------|
| dicom-fixer | fix/connector-parity-dicom-w19 | CPC-W19-001, 002, 006, 007 | 24 | 87aaa75 |
| ws-fixer | fix/connector-parity-ws-w19 | CPC-W19-004 | 11 | a527176 |
| smtp-fixer | fix/connector-parity-smtp-w19 | CPC-W19-005, 008 | 8 | 4fe4047 |
| **Total** | | **7 fixed** | **43** | 3 commits |

All branches merged cleanly into master — no conflicts (each modified different connector directories).

---

## Final Parity Status

| Metric | Value |
|--------|-------|
| Property coverage | 96% (248/251) |
| replaceConnectorProperties | 9/9 (100%) |
| Event dispatch | 40/40 (100%) |
| Critical findings remaining | **0** |
| Major deferrals | 9 (all architectural — require new deps or protocol implementations) |
| Minor deferrals | 29 |
| Total tests | 5,109 (43 new, 0 regressions) |

---

## Verification

1. `npm test` — 5,109 passing, 0 failures, 252 test suites
2. All 3 fixer branches merged cleanly
3. No critical findings remaining
4. All 8 prior deferred major findings re-verified (no escalation)
5. 29 minor deferrals re-verified (no escalation)
