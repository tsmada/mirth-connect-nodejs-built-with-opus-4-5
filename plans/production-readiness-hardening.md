<!-- Completed: 2026-02-17 | Status: Implemented | All 16 items across 5 phases -->
# Production Readiness: Full Hardening + Feature Completion

## Context

The Node.js Mirth Connect port has 5,700+ passing tests, 9/9 connectors, 9/9 data types, and validated operational modes (standalone, takeover, shadow, cluster). A production readiness audit identified 16 remaining items: process-level error handling gaps, security defaults, operational hardening, cluster reliability, and 3 incomplete features. This plan addresses all of them.

### Corrections from Deep Exploration

| Original Assessment | Actual State | Impact |
|---|---|---|
| HTTP response status maps to ERROR on >=400 | Already defaults to QUEUED, SENT only on <400 | Not a bug |
| File FTP/S3/SMB backends are stubs | All 3 fully implemented (358-507 LOC each) | Already done |
| Login rate limiting not wired | Already in UserServlet.ts (10 req/min/IP) | Reduced scope |
| Digest auth missing | Fully implemented; only `useCredentialsVariable` gap | Retargeted |
| Script timeout missing | CPU-based timeout works; wall-clock is defense-in-depth | Reduced severity |

---

## Phase 1: Critical Production Safety

**All 4 items can run in parallel. No cross-file dependencies.**

### 1A. Unhandled Rejection/Exception Handlers

**File:** `src/index.ts` (lines 11-35)

Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` before `main()`. Both handlers: log via logger, attempt graceful `mirth.stop()`, then `process.exit(1)` after 5s safety timeout. Hoist Mirth instance reference above handlers.

~20 lines added.

**Verify:** Unit test checking `process.listenerCount('unhandledRejection') > 0`.

### 1B. CORS Configuration & Documentation

**Files:** `.env`, `README.md`

The `CORS_ORIGINS` env var is already wired in `src/api/server.ts:56-58` (comma-separated → array). The `*` wildcard default is correct for development. No code change needed.

Changes:
1. Add commented-out `CORS_ORIGINS` example to `.env`:
   ```
   # CORS - comma-separated allowed origins (default: * for development)
   # For production, set explicitly:
   # CORS_ORIGINS=https://mirth-admin.example.com,https://monitoring.example.com
   ```
2. Add "Production Configuration" note to `README.md` explaining:
   - `CORS_ORIGINS` env var controls allowed origins
   - Default `*` is for development only
   - In production containers: set via env var in deployment manifest, `.env` file mount, or k8s ConfigMap
   - List recommended origins for your admin UI and monitoring tools

~5 lines in `.env` + README section.

**Verify:** Server starts with default `*` in development. Setting `CORS_ORIGINS=https://admin.example.com` restricts to that origin only.

### 1C. General API Rate Limiting

**File:** `src/api/server.ts`

Import and wire `express-rate-limit` (already in `package.json`). Apply general limiter (100 req/min/IP, configurable via `MIRTH_API_RATE_LIMIT`) after helmet, before routes. Exclude `/api/health/*` endpoints.

~15 lines in server.ts.

**Verify:** 101st rapid request returns 429; health endpoints exempt.

### 1D. Source Queue Content Removal Safety

**File:** `src/donkey/channel/Channel.ts` (lines 1710-1720)

The async dispatch path removes content WITHOUT verifying all destinations are in terminal state. The sync path (lines 1139-1154) does verify. Extract shared `allDestinationsTerminal(messageId)` method, use in both paths.

~30 lines (new method + refactor both call sites).

**Verify:** Mock QUEUED destination -> content NOT removed. All SENT -> content removed.

---

## Phase 2: Operational Hardening

**2A+2B in parallel (both in pool.ts). 2C+2D in parallel (separate files).**

### 2A. Connection Pool Error Handlers

**File:** `src/db/pool.ts` (lines 33-46)

After `mysql.createPool()`, attach:
- `pool.on('error', ...)` — log, prevent unhandled error crash
- `pool.on('enqueue', ...)` — warn on pool exhaustion
- `pool.on('connection', ...)` — debug-level new connection

Import and register `'database'` logger component.

~15 lines.

**Verify:** Kill MySQL mid-session -> error logged, no crash.

### 2B. Database Deadlock Retry

**File:** `src/db/pool.ts` (lines 71-90)

Add `withRetry<T>(fn, maxRetries)` wrapper. Retry on MySQL error 1213 (deadlock) and 1205 (lock wait timeout). 3 attempts, exponential backoff (100/200/400ms). Configurable via `DB_DEADLOCK_RETRIES` env var.

~30 lines.

**Verify:** Mock error 1213 on first call, success on second -> retry works. Non-deadlock errors NOT retried.

### 2C. Console-to-Logger Migration (Core Infrastructure)

**Files (34 console calls across 6 files):**

| File | Calls | Component Name |
|---|---|---|
| `src/index.ts` | 3 | `server` |
| `src/api/server.ts` | 4 | `api` |
| `src/db/SchemaManager.ts` | 9 | `database` |
| `src/donkey/channel/Channel.ts` | 9 | `engine` |
| `src/connectors/dicom/DicomDispatcher.ts` | 3 | `dicom-connector` |
| `src/cluster/ServerRegistry.ts` | 6 | `cluster` |

For each: import `getLogger`/`registerComponent`, replace `console.*` with `logger.*`.

~50 lines total. CLI user-facing output stays as console.

**Verify:** Grep migrated files for remaining `console.` — should be zero.

### 2D. Script Wall-Clock Timeout (Defense-in-Depth)

**File:** `src/javascript/runtime/JavaScriptExecutor.ts` (line 128)

The existing `vm.Script` CPU timeout handles compute-bound infinite loops. Add post-execution wall-clock check: if execution elapsed time exceeds `MIRTH_SCRIPT_WALL_TIMEOUT` (default: 60s), log a warning. This catches blocking I/O (e.g., `FileUtil.readFileSync` on a hung NFS mount) retroactively.

True mid-execution cancellation of blocking I/O requires `worker_threads` — deferred to a future phase. Document this limitation.

~15 lines.

**Verify:** Fast script -> no warning. Simulated slow execution -> warning logged.

---

## Phase 3: Cluster Readiness

**3A+3B in parallel. 3C depends on 3B.**

### 3A. Redis Session Store

**File:** `src/api/middleware/auth.ts` (lines 13-56)

**New dependency:** `ioredis`

1. Create `SessionStore` interface: `get(id)`, `set(id, session)`, `delete(id)`, `has(id)`, `clear()`
2. Create `InMemorySessionStore` wrapping existing `Map` — default
3. Create `RedisSessionStore` using `ioredis` — used when `MIRTH_CLUSTER_REDIS_URL` set
4. Factory: `createSessionStore()` checks env, returns appropriate store
5. Session TTL in Redis matches `SESSION_TIMEOUT_MS` (30 min)
6. Graceful fallback: if Redis connection fails, fall back to in-memory with warning

~150 lines (interface + Redis impl + refactor).

**Verify:** Login on instance A, access on instance B via shared Redis.

### 3B. Dead Node Detection

**File:** `src/cluster/ServerRegistry.ts`

Add periodic cleanup running at `heartbeatInterval`: query D_SERVERS for nodes where `now() - lastHeartbeat > heartbeatTimeout`, mark them OFFLINE. Start/stop with heartbeat lifecycle. Configurable via `MIRTH_CLUSTER_DEAD_NODE_CLEANUP` (default: `true`).

~40 lines.

**Verify:** Register fake node, wait past timeout, verify marked OFFLINE.

### 3C. Quorum Guard

**New file:** `src/cluster/QuorumCheck.ts`

- `hasQuorum()`: `alive >= ceil(total / 2)` from D_SERVERS
- `getQuorumStatus()`: returns `{ alive, total, hasQuorum, minRequired }`
- Integrate into `HealthCheck.ts`: readiness returns 503 on quorum loss
- Single-instance: `ceil(1/2) = 1`, always satisfied
- Opt-in via `MIRTH_CLUSTER_QUORUM_ENABLED` (default: `false`)

~90 lines.

**Verify:** 2/3 alive -> quorum. 1/3 alive -> no quorum -> health 503.

---

## Phase 4: Feature Completion

**All 3 items are independent and can run in parallel.**

### 4A. DataPruner Archive Integration

**Files:** `DataPruner.ts`, `DataPrunerController.ts`, `MessageArchiver.ts`, `DonkeyDao.ts`

**Existing plan:** `plans/datapruner-archive-integration.md`

1. Add `getContentBatch()` and `getAttachmentsBatch()` to DonkeyDao (~20 lines)
2. Add `buildArchiveMessage()` helper (~40 lines)
3. Add `archiveAndGetIdsToPrune()` method (~60 lines)
4. Wire into `pruneChannel()` — archive before delete (~10 lines)
5. Config wiring in DataPrunerController (~15 lines)
6. Enable gzip compression in MessageArchiver (~15 lines)

If archiving fails for a batch, skip deletion for that batch (data safety).

~160 lines.

**Verify:** Prune with archive enabled -> files created, then DB rows deleted. Archive failure -> rows NOT deleted.

### 4B. HTTP Auth useCredentialsVariable

**Files:** `src/connectors/http/auth/BasicAuthenticator.ts`, `DigestAuthenticator.ts`

When `useCredentialsVariable === true`, resolve `credentialsVariable` from message maps (channelMap -> sourceMap -> connectorMap) at request time. Expected format: `Map<string, string>` (username -> password). Fall back to static `credentials` if variable not found.

Pass message maps to authenticator via the dispatcher's `send()` method (which has access to ConnectorMessage).

~100 lines total.

**Verify:** `useCredentialsVariable=false` -> static credentials. `=true` -> resolved from channelMap.

### 4C. DICOM Storage Commitment

**Files:** `DicomDispatcher.ts` (line 233-238), `DicomConnection.ts`

1. Add `requestStorageCommitment(sopClassUID, sopInstanceUID)` to DicomConnection:
   - Negotiate Storage Commitment Push Model SOP class (1.2.840.10008.1.20.1)
   - Send N-ACTION request
   - Wait for N-EVENT-REPORT with 30s timeout (configurable)
2. In DicomDispatcher.send(): after successful C-STORE, call `requestStorageCommitment()` when `storageCommitment=true`
3. Timeout or rejection -> Status.QUEUED (retry)
4. Success -> proceed with Status.SENT

~180 lines. This is the most complex item — DICOM PDU construction/parsing.

**Verify:** Mock DICOM association -> N-ACTION sent when `stgcmt=true`. Timeout -> QUEUED. `stgcmt=false` -> skipped.

---

## Phase 5: Documentation

**Can run after Phase 1.**

### 5A. README Production Configuration

**File:** `README.md`

Add a "Production Configuration" section covering:

- **CORS**: `CORS_ORIGINS` env var (comma-separated list of allowed origins). Default restricts to localhost. For containers, mount via `.env` file or set in deployment manifest.
- **Rate Limiting**: `MIRTH_API_RATE_LIMIT` env var (requests per minute, default 100)
- **Redis**: `MIRTH_CLUSTER_REDIS_URL` for shared sessions and cluster communication
- **Quorum**: `MIRTH_CLUSTER_QUORUM_ENABLED` for multi-instance split-brain protection
- **Script Timeout**: `MIRTH_SCRIPT_TIMEOUT` (CPU, default 30s), `MIRTH_SCRIPT_WALL_TIMEOUT` (wall-clock, default 60s)
- **Database**: `DB_DEADLOCK_RETRIES` (default 3)
- All existing env vars from CLAUDE.md in a single reference table

~100 lines of documentation.

### 5B. E2E Smoke Test Script

**New file:** `scripts/smoke-test.sh`

Automated script that:
1. Starts the server
2. Verifies health endpoints (readiness, liveness, startup)
3. Logs in as admin
4. Creates a test channel
5. Deploys and starts it
6. Sends a test HL7 message
7. Verifies message processed
8. Cleans up (stop, undeploy, delete channel)

~100 lines.

---

## Execution Strategy

| Phase | Items | Est. LOC | Est. Time | Approach |
|---|---|---|---|---|
| 1: Critical Safety | 1A, 1B, 1C, 1D | ~75 | 2 hrs | 4 parallel agents in worktrees |
| 2: Operational | 2A, 2B, 2C, 2D | ~110 | 3 hrs | 2 parallel agents (pool.ts pair + other pair) |
| 3: Cluster | 3A, 3B, 3C | ~280 | 4 hrs | 2 agents (3A parallel with 3B, then 3C) |
| 4: Features | 4A, 4B, 4C | ~440 | 4 hrs | 3 parallel agents |
| 5: Docs | 5A, 5B | ~200 | 2 hrs | 1 agent |
| **Total** | **16 items** | **~1,105** | **~15 hrs** | |

**Dependency graph:**
```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 5
                    ──► Phase 4 ──►
```

Phase 3 and 4 can run in parallel after Phase 2.

## Verification Plan

After all phases:
1. `npm test` — all 5,700+ existing tests pass (zero regressions)
2. New tests: ~400 additional tests across all items
3. `scripts/smoke-test.sh` passes end-to-end
4. Manual verification: start server, check health endpoints, verify CORS headers, attempt brute-force login (rate limited), verify structured JSON logs
