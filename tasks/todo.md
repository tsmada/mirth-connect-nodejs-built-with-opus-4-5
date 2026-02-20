# Mirth Connect Node.js Engine - TODO Tracker

## Current Status (2026-02-19)

- **Tests**: 7,598 total (7,598 passing + 22 e2e CLI rate-limit flakes), 336 test suites
- **Waves 1-22 + Phase C**: Complete (see CLAUDE.md for full wave summaries)
- **Independent Verification**: **GO** — All Phase A + Phase B remediation complete. 6 scanner agents ran full audits (see `plans/independent-verification-report.md`)
- **Connector parity**: 9/9 connectors verified, 0 new findings (6th scan confirms Wave 21 baseline)
- **JS runtime parity**: Full parity verified, 0 new findings (4th scan confirms Wave 15 baseline)
- **Serializer parity**: All critical/major findings resolved (DICOM isSerializationRequired, metadata no-op, batch adaptors ported in Phase C)
- **API parity**: All critical/major findings resolved (UsageServlet path, Extension stubs, multipart form data, DELETE /_removeAll)
- **Pipeline parity**: All critical/major findings resolved (D_MS flush, updateSourceMap, content removal, PENDING status, storeMetaData)
- **Subtle bugs**: All critical/major findings resolved (global scripts wired, connector start/stop, cache refresh)
- **Security**: All 5 dimensions PASS — auth, SQL injection, VM sandbox, secrets, password handling
- **Operational**: All 4 dimensions PASS — shutdown, health probes, error handling, logging
- **Type safety**: `tsc --noEmit` zero errors under strict mode
- **Test coverage**: 70.88% statements, 71.58% lines (thresholds met — Phase C complete)

---

## Required Remediation (Pre-Production)

**Phase A — Must-Fix (COMPLETE)**

- [x] **SBF-INIT-001 (Critical)**: Wire `executePreprocessorScripts()`/`executePostprocessorScripts()` in Channel.ts — global scripts loaded via EngineController → ChannelBuilder → Channel
- [x] **SPC-ISG-001 (Critical)**: Change DICOM `isSerializationRequired()` from `true` to `false` in `DICOMSerializerAdapter.ts`
- [x] **SPC-MEG-001 (Critical)**: Make `populateMetaData()` a no-op for XML, JSON, Delimited, HL7V3, DICOM, Raw adapters
- [x] **PC-MJM-001 (Critical)**: Add sourceMap persistence to Transaction 2 via `insertContent()` in Channel.ts (both sync and async paths)
- [x] **APC-ME-001 (Critical)**: Add `POST /usageData/_generate` endpoint to UsageServlet.ts
- [x] **APC-ME-002/003 (Critical)**: Add Extension `_install`/`_uninstall` 501 stubs to ExtensionServlet.ts

**Phase B — Fix Before Takeover Mode (COMPLETE)**

- [x] **PC-MPS-001 (Critical)**: Wired D_MS statistics flush — `statsAccumulator.flush()` called on periodic timer + channel stop + undeploy
- [x] **PC-MTB-001 (Critical)**: Added `removeOnlyFilteredOnCompletion` content removal path with async lock in Channel.ts
- [x] **PC-MPS-004 (Major)**: Added PENDING status commit before response transformer execution
- [x] **PC-MJM-002 (Major)**: Added `storeMetaData()` INSERT...ON DUPLICATE KEY UPDATE for queue retry metadata persistence
- [x] **APC-ME-004 (Major)**: Added `DELETE /_removeAll` per-channel endpoint to MessageServlet.ts
- [x] **APC-SE-001 (Major)**: Analyzed — no change needed. Export endpoints correctly use `res.json()` (format predetermined by writerType, not Accept header)
- [x] **APC-PM-002/003/004 (Major)**: Added `multipartFormMiddleware()` for 3 bulk update endpoints (ChannelStatistics, ChannelGroup, CodeTemplate)
- [x] **SBF-STUB-001 (Major)**: Implemented `startConnector()`/`stopConnector()` in EngineController — source + destination + queue processing
- [x] **SBF-STALE-001 (Major)**: Extracted ChannelCache module, wired `refreshChannelCache()` after all channel CRUD operations in ChannelServlet

**Phase C — Nice-to-Have (COMPLETE)**

- [x] Port 7 missing batch adaptors (HL7v2, XML, JSON, Raw, Delimited, NCPDP) — ScriptBatchAdaptor base + 6 type-specific adaptors
- [x] Port HL7v2 AutoResponder (wire to ACKGenerator) — MSH.15 accept ack modes, custom ACK codes, DefaultAutoResponder
- [x] Add HL7v2 escape sequence handling in non-strict parser — HL7EscapeHandler wired into HL7v2SerializerAdapter
- [x] Break circular import Mirth.ts ↔ EngineController.ts — setter injection pattern (setDonkeyInstance)
- [x] Raise test coverage from 62% to 70% — 70.88% statements, 71.58% lines (1,499 new tests)

---

## Existing Deferrals

Everything below is **non-blocking for production**. These are edge-case gaps, optional enhancements, and protocol features that most deployments don't use.

### Connector Deferrals (5 total, 2 major + 3 minor)

| ID | Severity | Connector | Description |
|----|----------|-----------|-------------|
| CPC-D1 | Major | HTTP | AuthenticatorProvider plugin-based receiver authentication (framework scaffolded, not wired to receiver) |
| CPC-D2 | Major | WebService | Receiver auth (same pattern as HTTP) |
| CPC-D4 | Minor | DICOM | Storage commitment (N-ACTION/N-EVENT-REPORT protocol) |
| CPC-D5 | Minor | HTTP | Digest auth edge cases (scaffolded, no handshake logic) |
| CPC-D6 | Minor | JDBC | Receiver parameterized queries |

**Resolved since last update:**
- ~~CPC-D3 (File FTP/S3/SMB)~~ — Fully implemented: `FtpClient.ts`, `S3Client.ts`, `SmbClient.ts` with factory pattern

### JS Runtime Deferrals (10 total, 0 major + 10 minor)

| ID | Severity | Description |
|----|----------|-------------|
| JRC-SBD-016 | Minor | `getArrayOrXmlLength` type check |
| JRC-SBD-017 | Minor | `XML.ignoreWhitespace` setting |
| JRC-ETG-004 | Minor | `Namespace()`/`QName()` constructors |
| JRC-SBD-019 | Minor | `importClass` deprecation log |
| JRC-SBD-020 | Minor | `useAttachmentList` variant |
| JRC-SBD-021 | Minor | Unmodifiable sourceMap copy |
| JRC-SBD-022 | Minor | Logger phase name |
| JRC-SBD-025 | Minor | Convenience vars (regex, xml, xmllist) in scope |
| JRC-MUM-002 | Minor | ImmutableResponse wrapping in filter scope |
| JRC-MUM-003 | Minor | Response wrapping edge cases |

**Resolved since last update:**
- ~~JRC-ETG-003 (E4X `delete` on named properties)~~ — Proxy `deleteProperty` handler implemented in XMLProxy.ts
- ~~JRC-MUM-001 (AuthenticationResult/AuthStatus)~~ — Full classes in `src/connectors/http/auth/types.ts`
- ~~JRC-SBD-023 (Script timeout)~~ — `vm.runInContext({ timeout })` wired with `WALL_TIMEOUT_MS` env var
- ~~JRC-SVM-006 (`resultMap` for Database Reader)~~ — Already implemented in `DatabaseReceiver.ts:buildUpdateScope()` (connector-local injection, not pipeline-level)

### Logger Migration

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Core server + engine | Complete |
| 2 | Donkey engine | Complete (0 console calls remain) |
| 3 | Connectors | Complete (0 console calls remain) |
| 4 | API servlets | Complete (0 console calls remain) |
| 5 | Plugins/cluster | Complete (0 console calls remain) |
| 6 | CLI | N/A — console calls are intentional user-facing output (chalk, tables, spinners) |

Remaining internal `console.*` calls (~35) are in `src/javascript/userutil/` (deprecation warnings) and `src/index.ts` (startup). Low priority.

### Optional Enhancements

- [x] ~~**DataPruner archive integration** — Fully wired into pruning pipeline~~
- [ ] **DataPruner archive encryption** — `encrypt` option exists in `MessageWriterOptions` but no crypto implementation
- [ ] **Redis EventBus/MapBackend** — Requires ioredis dependency; database-polling EventBus works for now
- [ ] **Java Mirth clustering plugin interop** — JGroups state reading (not joining) for hybrid mode
- [ ] **Performance optimization** — High-volume channel tuning, connection pooling improvements

---

## Recently Completed (Verification Sessions 1-3)

**Session 1:**
1. Deadlock retry — Wrapped all `FOR UPDATE` transactions with `withRetry()` (3 retries, exponential backoff)
2. Auth ESLint fix — Added `RedisClient` interface, eliminated 38 unsafe-* errors
3. Servlet tests — 180 new tests across ChannelServlet (51), EngineServlet (22), UserServlet (49), ConfigurationServlet (58)
4. Route ordering bug — Fixed `DELETE /_removeAllMessages` being caught by `DELETE /:channelId`
5. Doc rot cleanup — Updated CLAUDE.md + todo.md

**Session 2 (Phase A + Phase B critical):**
6. **SBF-INIT-001** — Wired global pre/postprocessor scripts into Channel.ts pipeline
7. **SPC-ISG-001** — Changed DICOM isSerializationRequired to false
8. **SPC-MEG-001** — Made populateMetaData no-op for XML, JSON, Delimited, HL7V3, DICOM, Raw
9. **PC-MJM-001** — Added sourceMap persistence to Transaction 2
10. **APC-ME-001** — Added POST /usageData/_generate endpoint
11. **APC-ME-002/003** — Added Extension _install/_uninstall 501 stubs
12. **PC-MPS-001** — Wired D_MS statistics flush (timer + stop + undeploy)
13. **PC-MTB-001** — Added removeOnlyFilteredOnCompletion content removal
14. **PC-MPS-004** — Added PENDING status commit before response transformer
15. **PC-MJM-002** — Added storeMetaData() upsert for queue retry
16. **APC-ME-004** — Added DELETE /_removeAll per-channel endpoint

**Session 3 (Phase B major):**
17. **APC-SE-001** — Analyzed: no change needed (export endpoints use predetermined format)
18. **APC-PM-002/003/004** — Added multipartFormMiddleware for 3 bulk update endpoints
19. **SBF-STUB-001** — Implemented startConnector/stopConnector with full connector lifecycle
20. **SBF-STALE-001** — Extracted ChannelCache module, wired refresh after CRUD operations
21. Fixed SerializerFactory.test.ts to match Phase A populateMetaData no-op changes
22. Fixed AuthorizationWiring.test.ts for multipartFormMiddleware route chain

---

## Source of Truth

For detailed wave summaries, component inventories, and architectural documentation, see **CLAUDE.md** (project root). This file tracks only remaining work items.
