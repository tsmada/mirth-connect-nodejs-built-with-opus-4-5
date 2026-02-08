# Horizontal Scaling Analysis: Node.js Mirth Connect

## Overview

This document analyzes the current Node.js Mirth Connect runtime for horizontal scaling readiness,
documents the Java Mirth clustering model it must be compatible with, identifies every in-memory
singleton that blocks multi-instance deployment, and specifies the container-native scaling model.

---

## 1. Java Mirth Clustering Model

Java Mirth Connect supports multi-node deployment through a shared-database model with no
coordination layer. This is important to understand because our Node.js port must produce
identical database artifacts when running in takeover mode.

### 1.1 Server Identity

Each Java Mirth node has a unique `SERVER_ID` (UUID) stored in the `CONFIGURATION` table:

```sql
-- Each node stores its own identity
SELECT VALUE FROM CONFIGURATION
WHERE CATEGORY = 'core' AND NAME = 'server.id';
-- Returns: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
```

The `SERVER_ID` is generated once on first startup and persists across restarts. It is the
fundamental unit of ownership in the cluster.

### 1.2 Message Ownership

Every message is tagged with the `SERVER_ID` of the node that received it:

| Table | Column | Purpose |
|-------|--------|---------|
| `D_M{id}` | `SERVER_ID VARCHAR(36)` | Which node received this message |
| `D_MM{id}` | (via JOIN to D_M) | Inherited from parent message |
| `D_MS{id}` | `SERVER_ID VARCHAR(36)` | Per-node statistics row |

The `D_M` table schema (from `DonkeyDao.ts:156-167`):

```sql
CREATE TABLE D_M{channelId} (
  ID BIGINT NOT NULL,
  SERVER_ID VARCHAR(36) NOT NULL,  -- Node that received this message
  RECEIVED_DATE DATETIME(3) NOT NULL,
  PROCESSED TINYINT(1) NOT NULL DEFAULT 0,
  ORIGINAL_ID BIGINT,
  IMPORT_ID BIGINT,
  IMPORT_CHANNEL_ID VARCHAR(36),
  PRIMARY KEY (ID)
)
```

### 1.3 Statistics Isolation

The `D_MS` (statistics) table uses a composite primary key `(METADATA_ID, SERVER_ID)`:

```sql
CREATE TABLE D_MS{channelId} (
  METADATA_ID INT NOT NULL,
  SERVER_ID VARCHAR(36) NOT NULL,
  RECEIVED BIGINT NOT NULL DEFAULT 0,
  FILTERED BIGINT NOT NULL DEFAULT 0,
  TRANSFORMED BIGINT NOT NULL DEFAULT 0,
  PENDING BIGINT NOT NULL DEFAULT 0,
  SENT BIGINT NOT NULL DEFAULT 0,
  ERROR BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (METADATA_ID, SERVER_ID)  -- Per-node rows
)
```

Each node increments only its own statistics row. The Mirth Administrator GUI sums all rows
for a given `METADATA_ID` to show aggregate statistics across the cluster.

**Current Node.js behavior** (`DonkeyDao.ts:769-773`):

```typescript
export async function getStatistics(channelId: string): Promise<StatisticsRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<StatisticsRow[]>(
    `SELECT * FROM ${statisticsTable(channelId)}`
  );
  return rows;
}
```

This `SELECT *` with no `WHERE SERVER_ID = ?` filter sums all nodes' statistics together
(since `Channel.loadStatisticsFromDb()` at `Channel.ts:290-310` sums the returned rows).
This is actually **correct for dashboard display** (matches Java Mirth GUI behavior), but
means the Node.js instance cannot distinguish which stats it owns for cleanup or reset
operations.

### 1.4 Message ID Sequence (D_MSQ)

The `D_MSQ` table uses `SELECT ... FOR UPDATE` row locking to prevent duplicate message IDs
across nodes (`DonkeyDao.ts:295-323`):

```typescript
export async function getNextMessageId(channelId: string): Promise<number> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT LOCAL_CHANNEL_ID FROM ${sequenceTable(channelId)}
       WHERE ID = 1 FOR UPDATE`
    );
    const currentId = (rows[0]?.LOCAL_CHANNEL_ID as number) ?? 1;
    const nextId = currentId + 1;
    await connection.query(
      `UPDATE ${sequenceTable(channelId)}
       SET LOCAL_CHANNEL_ID = ? WHERE ID = 1`,
      [nextId]
    );
    await connection.commit();
    return currentId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
```

The `FOR UPDATE` lock serializes message ID allocation across all nodes. Under high throughput
this becomes a contention bottleneck -- every message from every node blocks on the same row.

### 1.5 Recovery Task

Each node recovers only its own unfinished messages using `WHERE SERVER_ID = ?`.
This prevents Instance A from recovering Instance B's in-flight messages, which would
cause duplicate processing.

### 1.6 No Coordination Layer

Java Mirth has **no JGroups, no heartbeat, no leader election, no Raft, no ZooKeeper**.
Nodes are entirely independent. The only shared state is the MySQL database:

- No cluster membership protocol
- No distributed locks (beyond `FOR UPDATE` on D_MSQ)
- No gossip protocol for state synchronization
- No split-brain detection
- Nodes discover each other only implicitly via `D_MS` rows with different `SERVER_ID` values

This simplicity is both a strength (easy to deploy) and a limitation (no failover, no
load-aware routing).

---

## 2. Node.js In-Memory Singletons Blocking Clustering

The following in-process singletons hold state that would be invisible to (or conflict with)
other instances. Each is categorized by severity.

### 2.1 CRITICAL: `deployedChannels` Map

**File:** `src/controllers/EngineController.ts:49`

```typescript
const deployedChannels = new Map<string, DeploymentInfo>();
```

**Problem:** Module-level `Map` holding all deployed channel runtime references. Each Node.js
instance maintains its own independent copy. There is no mechanism to know what channels other
instances have deployed.

**Impact:**
- `EngineController.getDeployedChannel(channelId)` returns `null` for channels deployed on
  other instances
- `EngineController.getChannelStatuses()` only shows locally deployed channels
- Dashboard API returns incomplete data
- API operations (start/stop/deploy) only affect the local instance

**Cluster requirement:** Each instance deploys all channels independently (same as Java Mirth).
However, API responses should aggregate status from all instances, and admin operations should
propagate to all instances.

### 2.2 CRITICAL: `GlobalMap.getInstance()` Singleton

**File:** `src/javascript/userutil/MirthMap.ts:217-237`

```typescript
export class GlobalMap extends MirthMap {
  private static instance: GlobalMap | null = null;

  static getInstance(): GlobalMap {
    if (!GlobalMap.instance) {
      GlobalMap.instance = new GlobalMap();
    }
    return GlobalMap.instance;
  }
}
```

**Problem:** `$g` (globalMap) is used by user scripts to share state across all channels.
In a cluster, `$g.put('key', 'value')` on Instance A is invisible to Instance B.

**Impact:** User scripts that rely on `$g` for cross-channel coordination will silently
produce incorrect results. This is a data correctness issue, not just a performance issue.

**Java Mirth behavior:** Java Mirth's `$g` is also process-local. However, Java Mirth
deployments typically use a single instance. In multi-node Java Mirth, `$g` is documented
as node-local.

**Cluster requirement:** Provide a `MapBackend` interface with pluggable implementations:
- `InMemoryMapBackend` (default, single-instance -- matches current behavior)
- `RedisMapBackend` (optional, for cluster-wide `$g` sharing)
- `DatabaseMapBackend` (optional, using CONFIGURATION table)

### 2.3 CRITICAL: `GlobalChannelMapStore` Singleton

**File:** `src/javascript/userutil/MirthMap.ts:242-287`

```typescript
export class GlobalChannelMapStore {
  private static instance: GlobalChannelMapStore | null = null;
  private channelMaps: Map<string, MirthMap>;

  static getInstance(): GlobalChannelMapStore {
    if (!GlobalChannelMapStore.instance) {
      GlobalChannelMapStore.instance = new GlobalChannelMapStore();
    }
    return GlobalChannelMapStore.instance;
  }
}
```

**Problem:** `$gc` (globalChannelMap) is per-channel global state. Same issue as `$g` --
invisible across instances.

**Impact:** Channel-scoped global state (`$gc.put(channelId, 'key', 'value')`) is
node-local. Scripts using `$gc` for shared state will silently produce incorrect results.

**Cluster requirement:** Same as GlobalMap -- `MapBackend` interface.

### 2.4 HIGH: `ConfigurationMap` Singleton

**File:** `src/javascript/userutil/MirthMap.ts:292-321`

```typescript
export class ConfigurationMap extends MirthMap {
  private static instance: ConfigurationMap | null = null;

  static getInstance(): ConfigurationMap {
    if (!ConfigurationMap.instance) {
      ConfigurationMap.instance = new ConfigurationMap();
    }
    return ConfigurationMap.instance;
  }
}
```

**Problem:** `$cfg` (configurationMap) caches server configuration in-memory. If an admin
changes configuration via Instance A's API, Instance B's cached `$cfg` is stale.

**Impact:** Configuration drift between instances. Lower severity than `$g`/`$gc` because
configuration changes are rare and typically trigger redeployment.

**Cluster requirement:** Reload from database on channel deploy/redeploy. Optionally
subscribe to a configuration-change event bus.

### 2.5 HIGH: Dashboard State

**File:** `src/plugins/dashboardstatus/DashboardStatusController.ts:67-88`

```typescript
export class DashboardStatusController extends EventEmitter {
  private connectorStateMap: Map<string, [string, string]> = new Map();
  private connectorStateTypeMap: Map<string, ConnectionStatusEventType> = new Map();
  private connectorCountMap: Map<string, number> = new Map();
  private maxConnectionMap: Map<string, number> = new Map();
  private connectorInfoLogs: Map<string, ConnectionLogItem[]> = new Map();
  private entireConnectorInfoLogs: ConnectionLogItem[] = [];
}
```

**And the singleton export** (`DashboardStatusController.ts:417`):

```typescript
export const dashboardStatusController = new DashboardStatusController();
```

**Problem:** Five in-memory maps plus a circular log buffer, all process-local. The dashboard
API and WebSocket endpoint only show state from the local instance.

**Impact:** The Mirth Administrator GUI connected to Instance A sees only Instance A's
connector states. This is the most user-visible clustering problem.

**Cluster requirement:** Aggregate dashboard state across instances. Options:
- Each instance reports its own state; a gateway aggregates
- Shared Redis pub/sub for real-time state changes
- Database polling for state (too slow for real-time)

### 2.6 HIGH: WebSocket Clients

**File:** `src/plugins/dashboardstatus/DashboardStatusWebSocket.ts:73-77`

```typescript
export class DashboardStatusWebSocketHandler {
  private clients: Map<WebSocket, ClientState> = new Map();
}
```

**And the singleton export** (`DashboardStatusWebSocket.ts:395`):

```typescript
export const dashboardStatusWebSocket = new DashboardStatusWebSocketHandler();
```

**Problem:** WebSocket connections are inherently node-local. A client connected to
Instance A via WebSocket will not receive events from Instance B.

**Impact:** Real-time dashboard updates are incomplete in a cluster.

**Cluster requirement:** Either:
- All instances publish events to a shared bus (Redis pub/sub)
- Client connects to a gateway that subscribes to all instances
- Client uses sticky sessions and accepts partial visibility

### 2.7 HIGH: VMRouter Controller Singletons

**File:** `src/javascript/userutil/VMRouter.ts:92-93`

```typescript
let channelController: IChannelController | null = null;
let engineController: IEngineController | null = null;
```

**Problem:** Module-level singletons wired during startup (`Mirth.ts:125-152`). The
`channelController` resolves channel names to IDs, and `engineController` dispatches
messages. Both reference the local `EngineController` only.

**Impact:** `router.routeMessage('ChannelName', msg)` can only route to channels on the
local instance. Cross-instance VM routing is impossible.

**Cluster requirement:** The engine controller adapter needs a `RemoteDispatcher` fallback:
1. Check local `deployedChannels` first (fast path)
2. If not found locally, dispatch via HTTP/gRPC to the instance hosting that channel
3. Or: all instances deploy all channels (default model), making this a non-issue

### 2.8 MEDIUM: `Channel.stats` In-Memory Counters

**File:** `src/donkey/channel/Channel.ts:128-135`

```typescript
private stats: ChannelStatistics = {
  received: 0,
  sent: 0,
  error: 0,
  filtered: 0,
  queued: 0,
};
```

**Problem:** In-memory counters used for fast dashboard reads. These are loaded from
`D_MS` on channel start (`Channel.ts:290-310`) but then maintained independently.

**Impact:** Dashboard shows only the local instance's message counts. Since `getStatistics()`
sums all `D_MS` rows (no `WHERE SERVER_ID = ?`), the initial load is correct (aggregate),
but subsequent increments only reflect local processing.

**Current behavior:** `loadStatisticsFromDb()` does `SELECT *` (all nodes' stats summed),
then the in-memory counter is incremented only for locally processed messages. This means:
- On startup: stats show aggregate (correct)
- During runtime: stats drift (only local increments)
- On restart: stats re-aggregate (corrects itself)

**Cluster requirement:** Either:
- Accept the drift (it self-corrects on restart)
- Periodically reload from DB (every N seconds)
- Use event bus to broadcast increments

### 2.9 LOW: SourceQueue / DestinationQueue (In-Memory, Acceptable)

**Files:** `src/donkey/queue/SourceQueue.ts`, `src/donkey/queue/DestinationQueue.ts`

These queues are inherently instance-local and represent in-flight work for the local
instance. They do not need to be shared. If a node goes down, the `RecoveryTask` on
restart will handle unfinished messages.

**Cluster requirement:** None. This is correct behavior.

---

## 3. Critical Bug: RecoveryTask Has No SERVER_ID Filter

### 3.1 The Problem

**File:** `src/db/DonkeyDao.ts:1332-1338`

```typescript
export async function getUnfinishedMessages(channelId: string): Promise<MessageRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<MessageRow[]>(
    `SELECT * FROM ${messageTable(channelId)} WHERE PROCESSED = 0 ORDER BY ID`
  );
  return rows;
}
```

**File:** `src/donkey/channel/RecoveryTask.ts:25-33`

```typescript
export async function runRecoveryTask(
  channelId: string,
  serverId: string
): Promise<RecoveryResult> {
  // ...
  const unfinished = await getUnfinishedMessages(channelId);
  // ^-- No SERVER_ID filter! Gets ALL nodes' unfinished messages
```

### 3.2 Impact

In a cluster with Instance A and Instance B:

1. Instance B crashes while processing message ID 42
2. Message 42 has `PROCESSED = 0` and `SERVER_ID = 'instance-b-uuid'`
3. Instance A restarts (or deploys a channel)
4. `runRecoveryTask()` runs on Instance A
5. `getUnfinishedMessages()` returns message 42 (no SERVER_ID filter)
6. Instance A marks message 42 as ERROR
7. Instance B comes back online, tries to resume message 42 -- it's already marked ERROR
8. **Or worse:** Instance B was still processing message 42 -- Instance A just corrupted it

### 3.3 Java Mirth Behavior

Java Mirth's `RecoveryTask` filters by `SERVER_ID`:

```java
// Java Mirth: DonkeyDaoFactory.getDao().getUnfinishedMessages(channelId, serverId)
// SQL: SELECT * FROM D_M{channelId} WHERE PROCESSED = 0 AND SERVER_ID = ?
```

### 3.4 Required Fix

```typescript
export async function getUnfinishedMessages(
  channelId: string,
  serverId: string  // Add SERVER_ID parameter
): Promise<MessageRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<MessageRow[]>(
    `SELECT * FROM ${messageTable(channelId)}
     WHERE PROCESSED = 0 AND SERVER_ID = ?
     ORDER BY ID`,
    [serverId]
  );
  return rows;
}
```

**Severity:** CRITICAL. This bug causes data corruption in multi-instance deployments.

---

## 4. Container-Native Mode-Specific Analysis

### 4.1 Takeover Mode

**Environment:** `MIRTH_MODE=takeover`

Multiple Node.js containers connect to an existing Java Mirth MySQL database.

| Concern | Analysis |
|---------|----------|
| Unique SERVER_IDs | **Required.** Each container must have a unique UUID. Currently `Channel.ts:96` uses `process.env.MIRTH_SERVER_ID \|\| 'node-1'`. All containers default to `'node-1'` -- **bug**. |
| D_MSQ contention | `FOR UPDATE` lock on single row. Under high throughput with N containers, this is an N-way contention point. |
| Schema creation race | Not applicable -- schema already exists. |
| D_MS rows | Works correctly -- each container writes to its own `(METADATA_ID, SERVER_ID)` row via `updateStatistics()`. |
| Recovery conflict | **Critical bug** -- see Section 3. |

### 4.2 Standalone Mode

**Environment:** `MIRTH_MODE=standalone`

Multiple Node.js containers create a fresh schema and share it.

| Concern | Analysis |
|---------|----------|
| Schema creation race | **Bug.** `seedDefaults()` in `SchemaManager.ts:309-379` runs in a single transaction, but two containers calling it simultaneously can race on the `SELECT COUNT(*) ... INSERT` pattern. `INSERT IGNORE` for configs/scripts is safe, but the admin user creation has a TOCTOU race. |
| `ensureCoreTables()` | Safe -- all DDL uses `CREATE TABLE IF NOT EXISTS`. |
| `ensureChannelTables()` | Partially safe. `INSERT IGNORE INTO D_CHANNELS` is fine, but `createChannelTables()` with `CREATE TABLE IF NOT EXISTS` is safe. The `MAX(LOCAL_CHANNEL_ID) + 1` pattern in `SchemaManager.ts:400-408` has a race condition -- two containers can get the same `next_id`. |
| Unique SERVER_IDs | **Required.** Same issue as takeover mode. |

#### seedDefaults() Race Condition Detail

```typescript
// SchemaManager.ts:314-331 -- TOCTOU race
const [adminCheck] = await connection.query<PersonExistsRow[]>(
  `SELECT COUNT(*) as count FROM PERSON WHERE USERNAME = 'admin'`
);
if (adminCheck[0]!.count === 0) {
  // Two containers can both see count=0 and both try to insert
  await connection.query(
    `INSERT INTO PERSON (USERNAME, LOGGED_IN) VALUES ('admin', FALSE)`
  );
  // Second container fails with UNIQUE constraint violation
}
```

**Fix:** Use `INSERT IGNORE` or `INSERT ... ON DUPLICATE KEY UPDATE` for the admin user,
matching the pattern already used for CONFIGURATION and SCRIPT rows.

### 4.3 Auto Mode

**Environment:** `MIRTH_MODE=auto` (default)

**Not recommended for clusters.** Two containers starting simultaneously on an empty
database will both detect "no CHANNEL table" and both enter standalone mode. This is
safe due to `IF NOT EXISTS` DDL, but wasteful. More concerning: if one container finishes
`ensureCoreTables()` before the other calls `detectMode()`, the second container detects
"CHANNEL table exists" and enters takeover mode, skipping `seedDefaults()`.

**Recommendation:** Require explicit `MIRTH_MODE=takeover` or `MIRTH_MODE=standalone`
for clustered deployments. Document `auto` as single-instance only.

---

## 5. Container Scaling Model

### 5.1 Deployment Topology

```
                    +-----------+
                    |  External |
                    |    LB     |
                    +-----+-----+
                          |
              +-----------+-----------+
              |           |           |
         +----+----+ +----+----+ +----+----+
         | Node.js | | Node.js | | Node.js |
         | Mirth   | | Mirth   | | Mirth   |
         | (UUID-A)| | (UUID-B)| | (UUID-C)|
         +----+----+ +----+----+ +----+----+
              |           |           |
              +-----------+-----------+
                          |
                    +-----+-----+
                    |   MySQL   |
                    |   (shared)|
                    +-----------+
```

### 5.2 Channel Deployment Strategy

**All instances deploy all channels** (default model, matching Java Mirth):

- Every container loads and deploys every enabled channel from the database
- External load balancer distributes incoming connections (MLLP, HTTP, etc.)
- Each instance processes only the messages it receives
- Messages are tagged with the instance's `SERVER_ID` in `D_M`
- No inter-instance coordination for message routing

This model works because:
1. Channels are stateless transformations (input -> process -> output)
2. Each message is self-contained
3. The shared database provides durability and consistency
4. Statistics aggregate correctly via `D_MS` composite key

### 5.3 Duplicate Processing Prevention

Duplicate processing is prevented by the combination of:

1. **External LB:** Each incoming connection goes to exactly one instance
2. **SERVER_ID tagging:** Each message records which instance processed it
3. **D_MSQ FOR UPDATE:** Message IDs are globally unique across instances
4. **Recovery filtering:** Each instance recovers only its own messages (after fix)

There is **no distributed lock** for message processing -- this is by design (matching Java
Mirth). If the LB sends the same message to two instances (e.g., retry on timeout), both
will process it independently with different message IDs. Deduplication is the responsibility
of the upstream system.

### 5.4 What Changes Per Instance

| Component | Per-Instance | Shared |
|-----------|-------------|--------|
| SERVER_ID (UUID) | Unique per container | |
| Channel deployments | All channels, independently | |
| In-memory stats | Local counters | D_MS table aggregates |
| GlobalMap ($g) | Node-local (or Redis) | |
| GlobalChannelMap ($gc) | Node-local (or Redis) | |
| ConfigurationMap ($cfg) | Cached from DB | CONFIGURATION table |
| Dashboard state | Node-local | (gateway aggregates) |
| WebSocket clients | Node-local connections | |
| Message sequences | | D_MSQ (FOR UPDATE) |
| Message storage | | D_M, D_MM, D_MC tables |
| Channel configs | | CHANNEL table |

### 5.5 VM Routing in a Cluster

VM routing (Channel Writer -> Channel Reader) works within a single instance because all
channels are deployed locally. Cross-instance VM routing is not needed in the default model
where all instances deploy all channels.

If a selective deployment model is ever implemented (instances deploy different channels),
then `VmDispatcher` would need a `RemoteDispatcher` fallback to route messages to the
instance hosting the target channel.

---

## 6. Environment Variables Reference

| Variable | Default | Description | Cluster Requirement |
|----------|---------|-------------|---------------------|
| `MIRTH_SERVER_ID` | `'node-1'` | Unique server identity UUID | **Must be unique per container.** Use UUID generation at startup. |
| `MIRTH_MODE` | `'auto'` | Operational mode: `takeover`, `standalone`, `auto` | **Must be explicit** (`takeover` or `standalone`). Do not use `auto`. |
| `PORT` | `8080` | HTTP API port | Same across instances (LB handles routing). |
| `HTTPS_PORT` | `8443` | HTTPS API port | Same across instances. |
| `DB_HOST` | `localhost` | MySQL host | Same across all instances (shared database). |
| `DB_PORT` | `3306` | MySQL port | Same across all instances. |
| `DB_NAME` | `mirthdb` | MySQL database name | Same across all instances. |
| `DB_USER` | `mirth` | MySQL username | Same across all instances. |
| `DB_PASSWORD` | `mirth` | MySQL password | Same across all instances. |
| `MIRTH_CLUSTER_ENABLED` | `false` | (New) Enable cluster-aware behavior | Set to `true` in cluster deployments. |
| `MIRTH_MAP_BACKEND` | `memory` | (New) Map storage backend: `memory`, `redis`, `database` | Set to `redis` for cross-instance $g/$gc sharing. |
| `REDIS_URL` | - | (New) Redis connection URL | Required if `MIRTH_MAP_BACKEND=redis`. |
| `MIRTH_SEQUENCE_BLOCK_SIZE` | `1` | (New) Message ID pre-allocation block size | Set to `100`-`1000` for high-throughput clusters to reduce D_MSQ contention. |

---

## 7. Summary of Required Changes

### 7.1 Critical (Must Fix Before Clustering)

| Issue | File(s) | Fix |
|-------|---------|-----|
| RecoveryTask no SERVER_ID filter | `DonkeyDao.ts:1332`, `RecoveryTask.ts:33` | Add `WHERE SERVER_ID = ?` to `getUnfinishedMessages()` |
| Default SERVER_ID is `'node-1'` | `Channel.ts:96` | Generate UUID on startup, store in CONFIGURATION |
| seedDefaults() TOCTOU race | `SchemaManager.ts:314-331` | Use `INSERT IGNORE` for admin user |
| D_CHANNELS LOCAL_CHANNEL_ID race | `SchemaManager.ts:400-408` | Use `AUTO_INCREMENT` or `INSERT ... SELECT MAX() + 1 FOR UPDATE` |

### 7.2 High Priority (Required for Cluster Dashboard)

| Issue | File(s) | Fix |
|-------|---------|-----|
| deployedChannels is node-local | `EngineController.ts:49` | Each instance deploys all channels independently; aggregate status via API gateway or shared registry |
| Dashboard state is node-local | `DashboardStatusController.ts:72-87` | Publish events to shared bus (Redis pub/sub) |
| WebSocket is node-local | `DashboardStatusWebSocket.ts:76` | Subscribe to shared event bus for cross-instance events |
| VMRouter singletons are node-local | `VMRouter.ts:92-93` | Acceptable if all instances deploy all channels |

### 7.3 Medium Priority (Required for Data Correctness)

| Issue | File(s) | Fix |
|-------|---------|-----|
| GlobalMap is node-local | `MirthMap.ts:217-237` | `MapBackend` interface with Redis option |
| GlobalChannelMapStore is node-local | `MirthMap.ts:242-287` | `MapBackend` interface with Redis option |
| ConfigurationMap is cached | `MirthMap.ts:292-321` | Reload on deploy; optionally subscribe to change events |

### 7.4 Low Priority (Performance Optimization)

| Issue | File(s) | Fix |
|-------|---------|-----|
| D_MSQ single-row contention | `DonkeyDao.ts:295-323` | Block allocation: pre-allocate N IDs per request |
| In-memory stats drift | `Channel.ts:128-135` | Periodic DB reload or event-bus broadcast |

---

## 8. Implementation Priority Order

1. **ClusterIdentity** -- Generate unique SERVER_ID per container, store in CONFIGURATION
2. **RecoveryTask fix** -- Add `WHERE SERVER_ID = ?` filter
3. **SchemaManager race fixes** -- Idempotent seedDefaults(), D_CHANNELS race
4. **SequenceAllocator** -- Block-allocate message IDs to reduce contention
5. **MapBackend interface** -- Pluggable GlobalMap/GlobalChannelMap storage
6. **Event bus** -- Redis pub/sub for dashboard state, config changes
7. **API gateway** -- Aggregate dashboard status across instances

---

## Appendix A: Line Number Reference

All line numbers reference the codebase as of 2026-02-07.

| Singleton / Bug | File | Line(s) |
|-----------------|------|---------|
| `deployedChannels` Map | `src/controllers/EngineController.ts` | 49 |
| `GlobalMap.getInstance()` | `src/javascript/userutil/MirthMap.ts` | 218-229 |
| `GlobalChannelMapStore.getInstance()` | `src/javascript/userutil/MirthMap.ts` | 242-255 |
| `ConfigurationMap.getInstance()` | `src/javascript/userutil/MirthMap.ts` | 292-304 |
| Dashboard state maps | `src/plugins/dashboardstatus/DashboardStatusController.ts` | 72-87 |
| `dashboardStatusController` singleton | `src/plugins/dashboardstatus/DashboardStatusController.ts` | 417 |
| WebSocket clients Map | `src/plugins/dashboardstatus/DashboardStatusWebSocket.ts` | 76 |
| `dashboardStatusWebSocket` singleton | `src/plugins/dashboardstatus/DashboardStatusWebSocket.ts` | 395 |
| VMRouter module singletons | `src/javascript/userutil/VMRouter.ts` | 92-93 |
| `Channel.stats` in-memory counters | `src/donkey/channel/Channel.ts` | 128-135 |
| `Channel.serverId` default | `src/donkey/channel/Channel.ts` | 96 |
| `getUnfinishedMessages()` no filter | `src/db/DonkeyDao.ts` | 1332-1338 |
| `getNextMessageId()` FOR UPDATE | `src/db/DonkeyDao.ts` | 295-323 |
| `getStatistics()` no filter | `src/db/DonkeyDao.ts` | 769-773 |
| D_M table schema (SERVER_ID column) | `src/db/DonkeyDao.ts` | 156-167 |
| D_MS table schema (SERVER_ID PK) | `src/db/DonkeyDao.ts` | 213-225 |
| D_MSQ table schema (FOR UPDATE) | `src/db/DonkeyDao.ts` | 227-234 |
| `seedDefaults()` TOCTOU race | `src/db/SchemaManager.ts` | 314-331 |
| `ensureChannelTables()` ID race | `src/db/SchemaManager.ts` | 394-408 |
| `StatisticsAccumulator.getFlushOps()` | `src/donkey/channel/StatisticsAccumulator.ts` | 37-52 |
