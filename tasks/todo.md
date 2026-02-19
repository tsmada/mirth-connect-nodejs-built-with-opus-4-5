# Mirth Connect Node.js Engine - TODO Tracker

## Current Status (2026-02-19)

- **Tests**: 6,092 passing (307 test suites)
- **Waves 1-22**: Complete (see CLAUDE.md for full wave summaries)
- **Production readiness**: PASS — comprehensive audit completed 2026-02-19 (see CLAUDE.md § Production Readiness Assessment)
- **Connector parity**: 9/9 connectors verified, 0 critical findings, 5 minor deferrals
- **JS runtime parity**: Full parity across 8 waves of fixes, verified by 3 automated scans, 10 minor deferrals (0 major)
- **Operational modes**: Takeover, standalone, auto-detect all working
- **K8s deployment**: Validated on Rancher Desktop k3s in all 4 modes
- **Security**: Auth on all routes, parameterized SQL, VM sandbox, rate limiting, zero production vulnerabilities
- **Type safety**: `tsc --noEmit` zero errors under strict mode
- **Logger migration**: Core engine fully migrated (0 console calls in donkey, connectors, API, plugins, cluster)

---

## Remaining Work

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

## Recently Completed (This Session)

1. **Deadlock retry** — Wrapped all `FOR UPDATE` transactions with `withRetry()` (3 retries, exponential backoff)
2. **Auth ESLint fix** — Added `RedisClient` interface, eliminated 38 unsafe-* errors (0 errors remaining)
3. **Servlet tests** — 180 new tests across ChannelServlet (51), EngineServlet (22), UserServlet (49), ConfigurationServlet (58)
4. **Route ordering bug** — Fixed `DELETE /_removeAllMessages` being caught by `DELETE /:channelId`
5. **Doc rot cleanup** — Updated CLAUDE.md + todo.md: archiver integration status, resolved deferrals, logger migration status

---

## Source of Truth

For detailed wave summaries, component inventories, and architectural documentation, see **CLAUDE.md** (project root). This file tracks only remaining work items.
