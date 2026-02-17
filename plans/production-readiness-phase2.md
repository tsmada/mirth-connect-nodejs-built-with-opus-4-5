# Production Readiness Assessment Plan — Node.js Mirth Connect (Phase 2)

## Context

A first-round production readiness assessment was completed on 2026-02-17 (report: `tasks/production-readiness-report.md`). That round fixed all BLOCKER and CRITICAL issues — encryptor initialization, CORS hardening, helmet, cookie flags, rate limiting, DB pool configurability, and structured logging for critical paths. It scored **93% CONDITIONAL GO** with 5,626 tests passing.

**This plan addresses what remains**: the 7% gap comes from deferred K8s validation (Phases 5-6), incomplete logging migration (70+ files still using `console.*`), the in-memory session store limitation, and the absence of an operational runbook. The goal is to close as many of these gaps as possible to reach ≥95% confidence.

---

## Step 1: Verify Previous Fixes Are Intact (Gate Check)

Quick re-verification that the Phase 2-4 fixes from the first round haven't regressed.

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| 1.1 | Full Jest suite | `npm test` | 5,626+ tests, 0 failures |
| 1.2 | TypeScript build | `npm run build` | 0 errors |
| 1.3 | Encryptor init present | Grep `initEncryptorFromEnv` in `Mirth.ts` | Called after DB init |
| 1.4 | Helmet active | Grep `helmet` in `server.ts` | Middleware applied |
| 1.5 | Rate limiter active | Grep `loginLimiter` in `UserServlet.ts` | Applied to `_login` route |
| 1.6 | Cookie flags | Grep `SameSite=Strict` in `auth.ts` | Present in `setSessionCookie` |

**Effort**: ~5 min, fully automated. If any fail → stop and fix before proceeding.

---

## Step 2: Complete Logging Migration (Connectors + Controllers)

The first round migrated `Channel.ts` (9 calls) and `server.ts` (3 calls). ~70+ files still use `console.*` in `src/`. Prioritize by production impact.

### High Priority (Connector Error Paths)

| File | Console Calls | Why Critical |
|------|--------------|--------------|
| `src/db/DonkeyDao.ts` | 1 (`console.error` in decrypt) | PHI-adjacent error logging |
| `src/connectors/file/FileReceiver.ts` | ~4 error calls | File polling failures need structured logs |
| `src/connectors/file/FileDispatcher.ts` | ~2 error calls | File write failures |
| `src/connectors/jdbc/DatabaseReceiver.ts` | ~3 error calls | DB connector operations |
| `src/connectors/jdbc/JdbcDispatcher.ts` | ~2 error calls | DB connector operations |
| `src/connectors/tcp/TcpReceiver.ts` | ~3 error calls | MLLP connection errors |
| `src/connectors/tcp/TcpDispatcher.ts` | ~2 error calls | MLLP send errors |
| `src/connectors/http/HttpDispatcher.ts` | ~2 error calls | HTTP request failures |

### Medium Priority (Controllers + Plugins)

| File | Console Calls | Why |
|------|--------------|-----|
| `src/controllers/EngineController.ts` | ~3 | Channel deploy/start errors |
| `src/controllers/ChannelController.ts` | ~2 | Channel CRUD errors |
| `src/plugins/datapruner/DataPruner.ts` | ~2 | Pruner status logging |
| `src/plugins/dashboardstatus/DashboardStatusController.ts` | ~2 | Dashboard events |

### Skip (Acceptable as-is)

- `src/cli/**` — CLI user-facing output uses `console.log` by design
- `src/logging/transports.ts` — Console transport implementation (by design)
- Test files — Not production code

### Implementation Pattern

Each file follows the same pattern:
```typescript
import { getLogger, registerComponent } from '../../logging/index.js';
registerComponent('component-name', 'Description');
const logger = getLogger('component-name');
// Then replace: console.error(...) → logger.error(...)
//               console.warn(...)  → logger.warn(...)
//               console.log(...)   → logger.info(...)
```

**Effort**: ~2 hours. Can parallelize with 3-4 agents (one per connector group).

**Files to modify**: ~15-20 source files
**Tests**: Existing tests should continue to pass (logging is a side effect, not tested directly)

---

## Step 3: Fix Test Worker Leak Warning

The Jest suite produces a cosmetic warning about a worker process failing to exit gracefully. Root cause: `setInterval(cleanExpiredSessions, 5 * 60 * 1000)` in `src/api/middleware/auth.ts:105` creates a timer that keeps the process alive.

### Fix

In `src/api/middleware/auth.ts`, change line 105 from:
```typescript
setInterval(cleanExpiredSessions, 5 * 60 * 1000);
```
to:
```typescript
setInterval(cleanExpiredSessions, 5 * 60 * 1000).unref();
```

The `.unref()` call tells Node.js not to keep the event loop alive solely for this timer — the process can exit naturally when all other work is done. This matches the standard Node.js pattern for background maintenance tasks.

**Effort**: ~1 minute, 1 line change.
**File**: `src/api/middleware/auth.ts:105`

---

## Step 4: Document Known Limitations & Environment Variables

Create a production deployment guide that consolidates all operational knowledge.

### 4a. Update CLAUDE.md Environment Variables Section

Add a consolidated table of ALL production-relevant env vars (existing section covers cluster vars but not the new ones from the hardening session):

| Variable | Default | Category | Notes |
|----------|---------|----------|-------|
| `CORS_ORIGINS` | `*` (warns) | Security | Comma-separated allowed origins |
| `MIRTH_ENCRYPTION_KEY` | (none) | Security | AES key for content encryption |
| `MIRTH_SCRIPT_TIMEOUT` | `30000` | Runtime | Script execution timeout (ms) |
| `DB_POOL_SIZE` | `10` | Database | MySQL connection pool size |
| `DB_CONNECT_TIMEOUT` | `10000` | Database | MySQL connect timeout (ms) |
| `DB_QUEUE_LIMIT` | `0` | Database | Pool queue limit (0=unlimited) |
| `TLS_ENABLED` | (none) | Security | Adds `Secure` flag to cookies |
| `NODE_ENV` | (none) | Security | `production` adds `Secure` cookie flag |

### 4b. Create Known Limitations Section

Document in CLAUDE.md under a new "### Known Limitations (Production)" heading:

1. **In-memory session store** — Sessions not shared across cluster instances. Use sticky sessions at LB, or implement Redis-backed session store.
2. **AlertServlet.changedChannels** — Returns empty array (cosmetic).
3. **DICOM storage commitment** — N-ACTION/N-EVENT-REPORT not implemented.
4. **stompit library** — JMS via STOMP works but library is unmaintained. Monitor for alternatives.
5. **Console logging incomplete** — ~50 files still use `console.*` for non-critical error paths (after Step 2 migration).

**Effort**: ~30 min.
**Files**: `CLAUDE.md`

---

## Step 5: Run Specialized Parity Agents (Final Verification)

Use the existing specialized agents for one final automated sweep to catch any remaining porting gaps. These are read-only scans.

| Agent | Purpose | Expected Outcome |
|-------|---------|-----------------|
| `subtle-bug-finder` | Detect state tracking, init bypass, architectural drift | Confirm 0 new critical findings |
| `js-runtime-checker` | JavaScript runtime parity (E4X, scope, userutil) | Confirm 0 new critical findings (last scan: Wave 15) |
| `connector-parity-checker` | Connector implementation gaps | Confirm 0 new critical findings (last scan: Wave 21) |

All three can run **in parallel** since they're read-only. If any find new CRITICAL issues → fix before proceeding.

**Effort**: ~15 min (parallel execution).

---

## Step 6: Confidence Score Recalculation

After Steps 1-5, recalculate the confidence score using the same formula from the first assessment.

### Expected Score Movement

| Item | Previous Score Impact | After This Plan |
|------|----------------------|-----------------|
| Logging migration (incomplete) | -3 pts (MEDIUM) | -1 pt (LOW, ~50 files → ~15 remain) |
| Test worker warning | -1 pt (LOW) | 0 (fixed) |
| Env var documentation | -1 pt (cosmetic) | 0 (documented) |
| Known limitations doc | -3 pts (MEDIUM) | 0 (documented) |

**Expected new score**: ~96% (up from 93%)

### Go / No-Go Criteria (Unchanged)

- **BLOCK**: Any test failure, any BLOCKER, any data safety CRITICAL
- **CONDITIONAL GO**: Score ≥ 85%, 0 BLOCKERs, 0 data safety CRITICALs, conditions documented
- **AUTOMATIC GO**: Score ≥ 95%, 0 BLOCKERs, 0 data safety CRITICALs

**Target**: AUTOMATIC GO (≥ 95%)

---

## Execution Strategy

```
Step 1: Gate check                          — ~5 min (automated, BLOCKING)
Step 2: Logging migration                   — ~2 hours (3-4 parallel agents)
Step 3: Fix test worker leak                — ~1 min (1 line)
Step 4: Documentation updates               — ~30 min (CLAUDE.md)
Step 5: Parity agent final sweep            — ~15 min (3 parallel agents, read-only)
Step 6: Score recalculation + final report  — ~15 min
```

**Total**: ~3 hours (with parallelization)

Steps 1 and 3 are quick wins done first. Steps 2 and 5 run in parallel (agents don't overlap — logging agents modify source files while parity agents only read). Step 4 can happen concurrently. Step 6 waits for all others.

---

## Key Files to Modify

| File | Step | Change |
|------|------|--------|
| `src/api/middleware/auth.ts` | 3 | `.unref()` on session cleanup timer |
| `src/db/DonkeyDao.ts` | 2 | `console.error` → `logger.error` (1 call) |
| `src/connectors/file/FileReceiver.ts` | 2 | ~4 console calls → structured logger |
| `src/connectors/file/FileDispatcher.ts` | 2 | ~2 console calls → structured logger |
| `src/connectors/jdbc/DatabaseReceiver.ts` | 2 | ~3 console calls → structured logger |
| `src/connectors/jdbc/JdbcDispatcher.ts` | 2 | ~2 console calls → structured logger |
| `src/connectors/tcp/TcpReceiver.ts` | 2 | ~3 console calls → structured logger |
| `src/connectors/tcp/TcpDispatcher.ts` | 2 | ~2 console calls → structured logger |
| `src/connectors/http/HttpDispatcher.ts` | 2 | ~2 console calls → structured logger |
| `src/controllers/EngineController.ts` | 2 | ~3 console calls → structured logger |
| `src/controllers/ChannelController.ts` | 2 | ~2 console calls → structured logger |
| `src/plugins/datapruner/DataPruner.ts` | 2 | ~2 console calls → structured logger |
| `CLAUDE.md` | 4 | Env var table + known limitations section |
| `tasks/production-readiness-report.md` | 6 | Updated score + assessment |

---

## Verification

After all steps complete:
1. `npm run build` — 0 errors
2. `npm test` — 5,626+ tests, 0 failures, **no worker leak warning**
3. `grep -r "console\.\(log\|error\|warn\)" src/ --include="*.ts" | grep -v cli/ | grep -v logging/transports | grep -v test | wc -l` — should be ≤ 20 (down from ~70+)
4. Parity agents report 0 new CRITICAL findings
5. Updated confidence score ≥ 95%
6. Updated report written to `tasks/production-readiness-report.md`
