# Reverse Behavioral Analysis: Node.js Concurrency & Platform Divergences

<!-- Completed: 2026-02-23 | Status: Implemented -->

## Context

The Mirth Connect Node.js port has passed 22 waves of automated inventory-based scanning (8,690 tests, 0 regressions). However, all prior scanning compared **method inventories and property defaults** — not runtime behavior under concurrent load. This plan addresses a class of bugs that are invisible to inventory scanning: **shared mutable state corrupted by async/await interleaving** and **platform-level semantic differences** between Java's thread-per-message model and Node.js's single-threaded event loop.

These bugs only manifest when multiple messages are processed concurrently on the same channel — which is the normal operating mode for HTTP/TCP receivers in production.

---

## Findings Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| F1 | Shared `StatisticsAccumulator` race condition — double-count or lost stats | **CRITICAL** | Concurrency |
| F2 | In-memory `this.stats` counters increment even when DB persist fails silently | **CRITICAL** | Error handling |
| F3 | MySQL timezone not configured — timestamp drift in takeover mode | **HIGH** | Platform semantics |
| F4 | No concurrency limiting on HTTP Receiver — can exhaust DB pool | **HIGH** | Backpressure |
| F5 | `safeSerializeMap()` fallback uses `String(date)` instead of ISO-8601 | **MEDIUM** | Serialization |

---

## F1: Per-Message StatisticsAccumulator (CRITICAL)

### Problem

`Channel.ts` has a single `statsAccumulator` instance shared by all concurrent `dispatchRawMessage()` calls. The pattern at 8+ locations:

```
this.statsAccumulator.increment(metaDataId, status);
await this.persistInTransaction([...this.statsAccumulator.getFlushOps(...)]);
this.statsAccumulator.reset();
```

When two messages interleave at the `await`:
- **Double-count**: Message B's `getFlushOps()` captures both A's and B's increments; A's flush also captured A's increment → DB gets +3 for 2 messages
- **Lost-count**: Message A's `reset()` clears B's pending increment before B calls `getFlushOps()` → B writes +0

Java Mirth avoids this because each thread has its own `BufferedDao` with local statistics buffering.

### Fix

Replace the shared class-level `statsAccumulator` with a **local per-message instance** created at the top of `dispatchRawMessage()`:

```typescript
async dispatchRawMessage(...): Promise<Message> {
  const msgStats = new StatisticsAccumulator();  // per-message, not shared
  // ... replace all this.statsAccumulator → msgStats (8 locations)
}
```

Remove the class-level field: `private statsAccumulator = new StatisticsAccumulator();`

### Files
- `src/donkey/channel/Channel.ts` — Replace `this.statsAccumulator` → local `msgStats` at ~16 call sites
- `src/donkey/channel/StatisticsAccumulator.ts` — No changes needed

### Tests
- Concurrent message stress test: dispatch 10 messages simultaneously, verify `D_MS` counts match exactly
- Verify no `statsAccumulator` property on Channel instance

---

## F2: Conditional In-Memory Stats Increment (CRITICAL)

### Problem

`this.stats.received++` (and filtered/sent/error/queued) increments even when `persistInTransaction()` fails silently (it catches errors at line 861-864 and returns void). Dashboard stats diverge from DB reality after any DB error.

Additionally, some counters increment BEFORE the persist call (e.g., `this.stats.filtered++` at line 1183), guaranteeing divergence on failure.

### Fix

**Change 1**: Make `persistInTransaction()` return `boolean` (success/failure) instead of `void`:

```typescript
private async persistInTransaction(
  operations: Array<(conn: PoolConnection) => Promise<void>>
): Promise<boolean> {
  try {
    // ... existing logic ...
    return true;
  } catch (err) {
    this.persistenceFailureCount++;
    logger.error(`[${this.name}] DB transaction error: ${err}`);
    return false;
  }
}
```

**Change 2**: Guard all in-memory stats increments on persist success:

```typescript
const ok = await this.persistInTransaction([...ops]);
if (ok) this.stats.received++;
```

Move any counter increments that currently appear BEFORE the persist to AFTER it.

### Files
- `src/donkey/channel/Channel.ts` — `persistInTransaction` return type + ~8 guarded increments

### Tests
- Mock `transaction()` to throw → verify `getStatistics().received === 0`
- Normal flow → verify `getStatistics().received === 1`
- Partial failure (RECEIVED succeeds, SENT fails) → verify `received=1, sent=0`

---

## F3: MySQL Timezone Configuration (HIGH)

### Problem

`pool.ts` creates the connection pool without a `timezone` option. mysql2 defaults to the local Node.js process timezone. In Kubernetes, this is typically UTC. In takeover mode against a Java Mirth database that was populated in a different timezone, `DATETIME` columns (RECEIVED_DATE, LAST_HEARTBEAT, etc.) will have incorrect offsets.

### Fix

Add UTC timezone default to pool configuration:

```typescript
const DEFAULT_CONFIG: Partial<DatabaseConfig> = {
  // ... existing ...
  timezone: process.env.DB_TIMEZONE || '+00:00',  // UTC default
};
```

### Files
- `src/db/pool.ts` — Add `timezone` to interface + defaults (3 lines)

### Tests
- Verify `timezone` option passed to `mysql.createPool()`
- Timestamp round-trip test: insert `NOW()`, read back, verify < 2s delta from `new Date()`

---

## F4: HTTP Receiver Concurrency Limiting (HIGH)

### Problem

Express accepts unlimited concurrent requests. Each triggers `dispatchRawMessage()` which acquires a DB connection from a pool of 10. With 20+ concurrent requests, the pool exhausts and health checks / heartbeats queue indefinitely, potentially causing self-fencing.

Java Mirth limits concurrency via Jetty's thread pool (default 254 threads).

### Fix

Add concurrency-limiting middleware to `HttpReceiver.configureMiddleware()`:

```typescript
private activeRequests = 0;

// In configureMiddleware(), first middleware:
if (this.properties.maxConnections > 0) {
  this.app!.use((req, res, next) => {
    if (this.activeRequests >= this.properties.maxConnections) {
      res.status(503).set('Retry-After', '1').send('Service Unavailable');
      return;
    }
    this.activeRequests++;
    res.on('close', () => { this.activeRequests--; });
    next();
  });
}
```

Default `maxConnections: 0` (no limit) preserves backward compatibility. Operators set it explicitly.

### Files
- `src/connectors/http/HttpReceiver.ts` — Add middleware + `activeRequests` tracking
- `src/connectors/http/HttpConnectorProperties.ts` — Add `maxConnections` to interface + defaults

### Tests
- Set `maxConnections: 2`, send 3 concurrent requests → 2 get 200, 1 gets 503
- After slot freed, next request gets 200

---

## F5: safeSerializeMap Date Fallback (MEDIUM)

### Problem

`DonkeyDao.ts:695` — the fallback path for circular-reference maps uses `String(date)` which produces locale-specific format (`"Sun Feb 23 2026..."`) instead of ISO-8601. The primary `JSON.stringify` path correctly produces `"2026-02-23T14:30:00.000Z"`. Inconsistent format between the two code paths.

### Fix

Replace line 695 with type-aware fallback:

```typescript
} catch {
  if (value instanceof Date) {
    safeObj[key] = value.toISOString();
  } else if (typeof value === 'bigint') {
    safeObj[key] = value.toString();
  } else {
    safeObj[key] = value != null ? String(value) : null;
  }
}
```

### Files
- `src/db/DonkeyDao.ts` — 5-line change at line 693-695

### Tests
- Map with circular ref + Date → verify ISO-8601 in serialized output
- Verify primary path and fallback path produce identical Date format

---

## Implementation Order

| Step | Finding | Files | Est. Tests | Risk |
|------|---------|-------|------------|------|
| 1 | F5 (Date fallback) | DonkeyDao.ts | 3 | Minimal — isolated change |
| 2 | F3 (MySQL timezone) | pool.ts | 2 | Low — additive config |
| 3 | F1+F2 (stats accumulator + conditional increment) | Channel.ts | 10 | Medium — 8+ call sites, return type change |
| 4 | F4 (HTTP concurrency) | HttpReceiver.ts, HttpConnectorProperties.ts | 4 | Low — self-contained |

F1 and F2 are implemented together as one commit since both modify `Channel.ts` in overlapping areas and the `boolean` return from `persistInTransaction` (F2) is used by the guarded increment pattern that F1's per-message accumulator also benefits from.

---

## Verification

1. **Existing test suite**: All 8,690 tests must pass (0 regressions)
2. **New concurrent stress test**: 50 simultaneous HTTP messages to single channel → verify exact D_MS counts
3. **Timezone test**: Takeover mode timestamp comparison with Java Mirth data
4. **Pool exhaustion test**: Verify health checks remain responsive under sustained HTTP load
5. **Type check**: `npx tsc --noEmit` — zero errors
