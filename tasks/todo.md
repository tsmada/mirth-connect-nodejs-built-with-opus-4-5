# Mirth Connect Node.js Engine - TODO Tracker

## Current Status (2026-02-18)

- **Tests**: 6,092 passing (307 test suites)
- **Waves 1-22**: Complete (see CLAUDE.md for full wave summaries)
- **Production readiness**: All critical/major gaps resolved
- **Connector parity**: 9/9 connectors verified, 0 critical findings
- **JS runtime parity**: Full parity across 8 waves of fixes, verified by 3 automated scans
- **Operational modes**: Takeover, standalone, auto-detect all working
- **K8s deployment**: Validated on Rancher Desktop k3s in all 4 modes

---

## Remaining Work

### Connector Deferrals (6 total, 2 major + 4 minor)

| ID | Severity | Connector | Description |
|----|----------|-----------|-------------|
| CPC-D1 | Major | HTTP | AuthenticatorProvider plugin-based receiver authentication |
| CPC-D2 | Major | WebService | Receiver auth (same pattern as HTTP) |
| CPC-D3 | Minor | File | FTP/S3/SMB backends (SFTP already works) |
| CPC-D4 | Minor | DICOM | Storage commitment (N-ACTION/N-EVENT-REPORT protocol) |
| CPC-D5 | Minor | HTTP | Digest auth edge cases (downgraded from major) |
| CPC-D6 | Minor | JDBC | Receiver parameterized queries (downgraded from major) |

### JS Runtime Deferrals (14 total, 3 major + 11 minor)

| ID | Severity | Description |
|----|----------|-------------|
| JRC-ETG-003 | Major | E4X `delete` on named properties — Proxy handler works for common patterns |
| JRC-SVM-006 | Major | `resultMap` not injected for Database Reader — requires pipeline changes |
| JRC-MUM-001 | Major | Remaining wrapper classes (AuthenticationResult, AuthStatus) |
| JRC-SBD-016 | Minor | `getArrayOrXmlLength` type check |
| JRC-SBD-017 | Minor | `XML.ignoreWhitespace` setting |
| JRC-ETG-004 | Minor | `Namespace()`/`QName()` constructors |
| JRC-SBD-019 | Minor | `importClass` deprecation log |
| JRC-SBD-020 | Minor | `useAttachmentList` variant |
| JRC-SBD-021 | Minor | Unmodifiable sourceMap copy |
| JRC-SBD-022 | Minor | Logger phase name |
| JRC-SBD-023 | Minor | Script timeout mechanism |
| JRC-SBD-025 | Minor | Convenience vars (regex, xml, xmllist) in scope |
| JRC-MUM-002 | Minor | ImmutableResponse wrapping in filter scope |
| JRC-MUM-003 | Minor | Response wrapping edge cases |

### Logger Migration (Phases 2-6)

Centralized logging system is built and operational (Phase 1 complete). Remaining phases migrate `console.*` calls to structured logging.

| Phase | Scope | ~Files | ~Console Calls | Status |
|-------|-------|--------|---------------|--------|
| 2 | Donkey engine | ~4 | ~16 | Pending |
| 3 | Connectors | ~15 | ~60 | Pending |
| 4 | API servlets | ~15 | ~150 | Pending |
| 5 | Plugins/cluster | ~20 | ~80 | Pending |
| 6 | CLI (internal only) | ~5 | ~15 | Pending |

### Other Enhancements

- [ ] **DataPruner archive integration** — `MessageArchiver` exists but not connected to pruning pipeline (see `plans/datapruner-archive-integration.md`)
- [ ] **Redis EventBus/MapBackend** — Requires ioredis dependency; database-polling EventBus works for now
- [ ] **Java Mirth clustering plugin interop** — JGroups state reading (not joining) for hybrid mode
- [ ] **Remote I/O Utils** — S3Util, FtpUtil, SftpUtil (File connector already supports these via config)
- [ ] **Performance optimization** — High-volume channel tuning, connection pooling improvements

---

## Recently Completed (This Session)

1. **Deadlock retry** — Wrapped all `FOR UPDATE` transactions with `withRetry()` (3 retries, exponential backoff)
2. **Auth ESLint fix** — Added `RedisClient` interface, eliminated 38 unsafe-* errors (0 errors remaining)
3. **Servlet tests** — 180 new tests across ChannelServlet (51), EngineServlet (22), UserServlet (49), ConfigurationServlet (58)
4. **Route ordering bug** — Fixed `DELETE /_removeAllMessages` being caught by `DELETE /:channelId`

---

## Source of Truth

For detailed wave summaries, component inventories, and architectural documentation, see **CLAUDE.md** (project root). This file tracks only remaining work items.
