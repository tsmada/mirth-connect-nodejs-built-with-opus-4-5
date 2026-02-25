<!-- Completed: 2026-02-24 | Status: Implemented -->
# Plan: Database Connection Pool Exhaustion with Large Channel Counts

## Context

Running the Node.js Mirth engine with 227 channels causes database pool exhaustion during startup. The pool defaults to **10 connections** (`DB_POOL_SIZE=10`), which is dramatically undersized. Each channel deployment performs ~20 DB operations, and deployed channels immediately start processing messages — creating compounding resource contention where deployment operations and message processing compete for the same tiny pool.

This is not a function of database size, but of **concurrent connection demand** during the deploy+start lifecycle.

## Root Cause Analysis

### The Triple Squeeze

| Pressure | Source | Impact |
|----------|--------|--------|
| **DDL transactions** | `createChannelTables()` holds 1 connection for 13 DDL queries per channel | 227 sequential transactions, each monopolizing a connection |
| **Deploy-start coupling** | `EngineController.deployChannel()` calls `runtimeChannel.start()` immediately | Channels 1-49 process messages while channel 50 is still deploying |
| **N+1 statistics** | `initializeStatistics()` fires 1+N separate INSERT queries per channel | 227 × (1+avg_destinations) individual pool checkouts |

### Connection Math

- Pool: 10 connections, queue: 200
- Per-channel deploy: ~16 DB operations (SELECT D_CHANNELS, MAX(), INSERT, transaction(13 DDL), global scripts, code templates, cluster registration, global channel map)
- Per-channel start: ~4-6 operations (statistics init N+1, stats load, recovery task)
- Total: 227 × ~22 = **~5,000 sequential DB operations** through 10 connections
- Plus: already-started channels' message processing (`dispatchRawMessage` → `persistInTransaction` → holds connection for 4-6 queries per message)

Once the queue fills to 200 pending operations, new `pool.query()` calls reject → channels fail to start.

## Implementation Plan

### Fix 1: Mode-Aware Startup Auto-Scale (pool.ts + Mirth.ts)

**Why startup auto-scale, not dynamic:** mysql2 does not support live pool resizing. Dynamic scaling would require draining active connections, destroying the pool, and atomically swapping — complex and error-prone. But at startup (between pool init at line 152 and channel deploy at line 302), there are zero active transactions, so closing and recreating is perfectly safe.

**File**: `src/db/pool.ts`

Add new exports:
- `recreatePool(config: DatabaseConfig): Pool` — closes existing pool and creates a new one with updated config. Safe only when no active transactions (enforced by caller).
- `getPoolConfig(): { connectionLimit: number; queueLimit: number }` — returns current pool settings for logging.
- Add `acquireTimeout` option, defaulting to 30000ms via `DB_ACQUIRE_TIMEOUT` env var. Currently queries wait indefinitely for a connection — this converts infinite waits into clear timeout errors.

**File**: `src/server/Mirth.ts`

After `initPool()` (line 152) and schema detection (line 186), but **before** `loadAndDeployChannels()` (line 302), add an auto-scale check:

```typescript
// Auto-scale pool based on channel count (safe — no active transactions yet)
await this.autoScalePool();
```

The `autoScalePool()` method:
1. Query `SELECT COUNT(*) FROM CHANNEL WHERE ENABLED = 1`
2. Compute recommended size: `Math.max(10, Math.ceil(channelCount / 5))`
3. Apply mode-aware caps:
   - **Takeover mode**: cap at `DB_POOL_MAX` (default **50**) — leaves room for Java Mirth's connections against shared MySQL
   - **Standalone mode**: cap at `DB_POOL_MAX` (default **100**) — no competition
   - **Shadow mode**: Use standalone/takeover cap, but note channels don't start so pressure is lower
4. If user explicitly set `DB_POOL_SIZE` env var → **always honor it**, skip auto-scale (log the explicit value)
5. If computed size > current pool size → `recreatePool()` with new size, log: `Auto-scaled pool: 10 → 46 connections for 227 enabled channels (${mode} mode, cap: ${cap})`
6. If computed size ≤ current size → no-op

**New env vars:**
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_POOL_SIZE` | (auto) | Explicit pool size override. If set, disables auto-scaling. |
| `DB_POOL_MAX` | `100` (standalone) / `50` (takeover) | Upper bound for auto-scaled pool size |
| `DB_ACQUIRE_TIMEOUT` | `30000` | Max ms to wait for a free connection before error |

### Fix 2: Separate Deploy Phase from Start Phase (Mirth.ts + EngineController.ts)

**File**: `src/server/Mirth.ts` — `loadAndDeployChannels()`

Currently deploys and starts each channel atomically in a loop. Change to two-phase:

```typescript
// Phase 1: Deploy all channels (DDL, build runtime objects, wire connectors — no starts)
const channelsToStart: string[] = [];
for (const channelConfig of channelConfigs) {
  if (!channelConfig.enabled) continue;
  try {
    await EngineController.deployChannel(channelConfig.id, { startAfterDeploy: false });
    if ((channelConfig.properties?.initialState || 'STARTED') === 'STARTED') {
      channelsToStart.push(channelConfig.id);
    }
  } catch (err) { logger.error(...); }
}
logger.info(`Phase 1 complete: ${deployedCount} channels deployed`);

// Phase 2: Start channels with controlled concurrency
if (channelsToStart.length > 0) {
  await EngineController.startDeployedChannels(channelsToStart, {
    concurrency: startupConcurrency
  });
}
```

**File**: `src/controllers/EngineController.ts`

1. Add `options?: { startAfterDeploy?: boolean }` parameter to `deployChannel()`:
   - Default `true` to preserve backward compatibility for API-triggered deployments (e.g., `POST /api/channels/_deploy`)
   - When `false`, skip the `runtimeChannel.start()` call at line 395
   - The channel is left in `STOPPED` state after deployment

2. Add new `startDeployedChannels(channelIds: string[], opts?: { concurrency?: number })`:
   - Uses a simple semaphore pattern (active counter + Promise queue) to limit concurrent starts
   - Default concurrency from `MIRTH_STARTUP_CONCURRENCY` env var, fallback: `Math.min(10, Math.floor(poolSize / 3))`
   - Logs progress: `Starting channels: ${started}/${total} (concurrency: ${n})`
   - Each channel start is independent — one failure doesn't stop others (existing behavior preserved)
   - Respects shadow mode (only start promoted channels)

**New env var:**
| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_STARTUP_CONCURRENCY` | `min(10, poolSize/3)` | Max channels starting simultaneously during server boot |

### Fix 3: Batch Statistics Initialization (Channel.ts + DonkeyDao.ts)

**File**: `src/donkey/channel/Channel.ts` — `initializeStatistics()`

Currently fires N+1 individual `INSERT ON DUPLICATE KEY UPDATE` queries (1 for source + 1 per destination). For a channel with 5 destinations, that's 6 separate pool checkouts.

Change to a single batched INSERT:
```typescript
const metadataIds = [0, ...this.destinationConnectors.map((_, i) => i + 1)];
await batchInitializeStatistics(this.id, metadataIds, this.serverId);
```

**File**: `src/db/DonkeyDao.ts`

Add `batchInitializeStatistics(channelId, metadataIds, serverId)`:
- Builds a single multi-value INSERT: `INSERT INTO D_MS{id} (METADATA_ID, SERVER_ID, RECEIVED, ...) VALUES (?,?,0,...), (?,?,0,...), ... ON DUPLICATE KEY UPDATE RECEIVED=RECEIVED`
- Reduces 227 × (1+avg_dest) ≈ 700+ pool checkouts to 227 × 1 = 227

### Fix 4: Pool Health Observability (pool.ts)

**File**: `src/db/pool.ts`

- Add `getPoolStats()` function returning `{ active, idle, queued, total, limit }` — extracts from mysql2's internal pool state (`pool.pool._allConnections.length`, `_freeConnections.length`). Already partially implemented in Mirth.ts OTEL gauges — refactor to shared utility.
- Enhance the existing `enqueue` event handler to include counts: `Connection pool saturated — query queued (active: ${n}/${limit}, queued: ${q}/${queueLimit})`
- On pool init, log at INFO: `Database pool initialized: connectionLimit=${n}, queueLimit=${n}, acquireTimeout=${n}ms`

**File**: `src/server/Mirth.ts`

- Before deployment, if `channelCount > poolSize * 5` and auto-scale didn't trigger (because user set explicit `DB_POOL_SIZE`), log WARN: `227 channels with pool size 10 — pool exhaustion likely. Consider increasing DB_POOL_SIZE or removing the explicit override to enable auto-scaling.`

### Fix 5: Documentation (CLAUDE.md)

Add a `### Database Pool Sizing` section documenting:
- Default behavior (auto-scaled at startup based on channel count)
- Mode-aware caps (50 takeover, 100 standalone)
- How to override: `DB_POOL_SIZE`, `DB_POOL_MAX`, `DB_ACQUIRE_TIMEOUT`
- The two-phase startup (deploy-all-then-start) and `MIRTH_STARTUP_CONCURRENCY`
- Sizing guidance: `max(10, channels/5)` as rule of thumb, MySQL `max_connections` as ceiling
- Takeover mode warning about shared MySQL connection budget with Java Mirth

## Files to Modify

| File | Changes |
|------|---------|
| `src/db/pool.ts` | `recreatePool()`, `getPoolStats()`, `getPoolConfig()`, `acquireTimeout`, enhanced logging |
| `src/server/Mirth.ts` | `autoScalePool()` method, two-phase `loadAndDeployChannels()`, pool warnings |
| `src/controllers/EngineController.ts` | `startAfterDeploy` option on `deployChannel()`, new `startDeployedChannels()` with semaphore |
| `src/donkey/channel/Channel.ts` | Batched `initializeStatistics()` |
| `src/db/DonkeyDao.ts` | `batchInitializeStatistics()` function |
| `CLAUDE.md` | Pool sizing documentation section |

## Verification

1. **Unit tests**:
   - `getPoolStats()` returns correct shape
   - `batchInitializeStatistics()` generates correct multi-value INSERT SQL
   - `startDeployedChannels()` respects concurrency limit (mock channels, verify max concurrent starts)
   - `autoScalePool()` computes correct sizes for various channel counts and modes
   - `deployChannel({ startAfterDeploy: false })` leaves channel in STOPPED state

2. **Integration test**: Deploy 50+ channels with `DB_POOL_SIZE=10` (explicit, no auto-scale) and verify controlled concurrency prevents pool exhaustion

3. **Manual verification with 227 channels**:
   - Start server, observe logs:
     - `Auto-scaled pool: 10 → 46 connections for 227 enabled channels`
     - `Phase 1 complete: 227 channels deployed`
     - `Starting channels: 10/227 (concurrency: 10)` → `50/227` → `227/227`
   - All 227 channels reach STARTED state
   - No "Connection pool exhausted" warnings during steady state
   - `curl localhost:8081/api/health` returns 200

4. **Regression**: Existing 8,690 tests pass — `startAfterDeploy` defaults to `true` preserving API-triggered behavior

5. **Takeover mode check**: With `MIRTH_MODE=takeover`, verify pool caps at 50 and logs mention takeover-aware cap
