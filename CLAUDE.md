# Mirth Connect Node.js Runtime

## Project Goal
Node.js/TypeScript replacement for Mirth Connect Java engine.
Must maintain 100% API compatibility with Mirth Connect Administrator.

## Architecture
- **Donkey Engine**: Message processing in `src/donkey/`
- **Connectors**: Protocol implementations in `src/connectors/`
- **JavaScript Runtime**: E4X transpilation in `src/javascript/`
- **REST API**: Express-based in `src/api/`
- **Cluster**: Horizontal scaling in `src/cluster/`
- **CLI Tool**: Terminal monitor utility in `src/cli/`

### REST API Servlets (Implemented)
| Servlet | File | Endpoints |
|---------|------|-----------|
| Channel | ChannelServlet.ts | CRUD, import/export |
| Configuration | ConfigurationServlet.ts | Server settings |
| Engine | EngineServlet.ts | Deploy, undeploy, start/stop |
| User | UserServlet.ts | Authentication, CRUD |
| Code Template | CodeTemplateServlet.ts | Library management |
| Channel Statistics | ChannelStatisticsServlet.ts | Stats get/clear |
| Event | EventServlet.ts | Audit log search/export |
| Alert | AlertServlet.ts | Alert CRUD, enable/disable |
| Message | MessageServlet.ts | Search, reprocess, import/export |
| Channel Group | ChannelGroupServlet.ts | Group CRUD |
| Extension | ExtensionServlet.ts | Plugin management |
| Database Task | DatabaseTaskServlet.ts | Maintenance tasks |
| System | SystemServlet.ts | System info/stats |
| Usage | UsageServlet.ts | Usage data reporting |
| Trace | TraceServlet.ts | Cross-channel message tracing (Node.js-only) |
| Cluster | ClusterServlet.ts | Cluster status, node list (Node.js-only) |
| Internal | RemoteDispatcher.ts | Inter-instance message forwarding (cluster-only) |
| Shadow | ShadowServlet.ts | Shadow mode promote/demote/status (Node.js-only) |

### CLI Monitor Utility (`src/cli/`)

A terminal-based CLI tool for monitoring and managing Mirth Connect, providing alternatives to the Mirth Administrator GUI.

**Structure:**
```
src/cli/
├── index.ts                    # Entry point with Commander setup
├── commands/
│   ├── auth.ts                 # login, logout, whoami
│   ├── channels.ts             # list, get, deploy, start, stop, pause, resume, stats
│   ├── messages.ts             # list, search, get, export
│   ├── trace.ts                # cross-channel message tracing
│   ├── send.ts                 # mllp, http, hl7 message sending
│   ├── server.ts               # info, status, stats
│   ├── events.ts               # list, search, errors
│   ├── config.ts               # get, set, list, reset
│   ├── dashboard.ts            # Interactive Ink-based dashboard (thin wrapper)
│   └── shadow.ts               # Shadow mode promote/demote/cutover
├── ui/                         # Dashboard component architecture
│   ├── components/             # React/Ink UI components
│   │   ├── Dashboard.tsx       # Main orchestrator (~280 lines)
│   │   ├── Header.tsx          # Title, WS status, refresh indicator
│   │   ├── ChannelList.tsx     # Grouped channel table with search
│   │   ├── ChannelGroup.tsx    # Collapsible group header (▼/▶)
│   │   ├── ChannelRow.tsx      # Individual channel row with stats
│   │   ├── ChannelDetails.tsx  # Detail overlay with tabs
│   │   ├── StatusIndicator.tsx # Color-coded state display (●/○/◐)
│   │   ├── HelpBar.tsx         # Contextual keyboard shortcuts
│   │   ├── StatusBar.tsx       # Server info, messages
│   │   ├── SearchInput.tsx     # Filter input box (/)
│   │   └── HelpOverlay.tsx     # Full keyboard reference (?)
│   ├── hooks/                  # Business logic hooks
│   │   ├── useWebSocket.ts     # WebSocket connection management
│   │   ├── useChannels.ts      # Channel data & CRUD operations
│   │   ├── useChannelGroups.ts # Group expand/collapse state
│   │   └── useKeyboardShortcuts.ts
│   └── context/
│       └── DashboardContext.tsx # Shared state provider
├── lib/
│   ├── ApiClient.ts            # REST API client
│   ├── WebSocketClient.ts      # Real-time WebSocket client
│   ├── ConfigManager.ts        # ~/.mirth-cli.json management
│   ├── OutputFormatter.ts      # Table/JSON output formatting
│   ├── TraceFormatter.ts       # Cross-channel trace tree rendering
│   ├── ChannelResolver.ts      # Channel name → ID resolution
│   └── MessageSender.ts        # MLLP/HTTP sending utilities
└── types/
    └── index.ts                # CLI-specific types
```

**Setup (required once):**
```bash
npm run cli:link      # Build and create global symlink
which mirth-cli       # Verify: should show path in node bin directory
mirth-cli --version   # Should output: 0.1.0
```

**Key Commands:**
```bash
mirth-cli login --user admin      # Authenticate
mirth-cli channels                 # List channels with status
mirth-cli channels start <name>   # Start by name (not just ID!)
mirth-cli messages <channelId> --status E  # Find errors
mirth-cli send hl7 localhost:6662 @test.hl7  # Send test message
mirth-cli trace "Channel A" 123    # Trace message across VM-connected channels
mirth-cli dashboard               # Interactive real-time view
```

**Alternative invocations (if not linked):**
```bash
node dist/cli/index.js <command>  # Direct invocation
npm run cli -- <command>          # Via npm script (note the --)
```

**Dependencies:** commander, chalk (v5+), ora (v8+), conf, ink, react, ws

### Interactive Dashboard (`mirth-cli dashboard`)

Real-time channel monitoring with WebSocket updates and keyboard navigation.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                        Enhanced Dashboard                            │
├─────────────────────────────────────────────────────────────────────┤
│  Header (ws status) │ ChannelList (groups) │ Details │ HelpBar     │
├─────────────────────────────────────────────────────────────────────┤
│  useWebSocket ←→ WebSocketClient ←→ /ws/dashboardstatus             │
│  useChannels  ←→ ApiClient       ←→ /api/channels/*                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Real-Time Updates:**
- Primary: WebSocket connection to `/ws/dashboardstatus`
- Fallback: HTTP polling when WebSocket unavailable
- Status shown in header: `[WS: Connected]` or `[Polling]`

**Keyboard Shortcuts:**

| Key | Action | Context |
|-----|--------|---------|
| `↑`/`k` | Move up | List |
| `↓`/`j` | Move down | List |
| `Enter` | Expand group / Show details | List |
| `Space` | Multi-select toggle | List |
| `s` | Start channel(s) | List |
| `t` | Stop channel(s) | List |
| `p` | Pause/resume | List |
| `d` | Deploy | List |
| `u` | Undeploy | List |
| `r` | Manual refresh | Global |
| `/` | Search mode | List |
| `?` | Help overlay | Global |
| `a` | Select all | List |
| `c` | Clear selection | List |
| `e` | Expand all groups | List |
| `w` | Collapse all groups | List |
| `Escape` | Exit mode/close | Search/Details |
| `q` | Quit | Global |

**Usage:**
```bash
# Default: WebSocket with polling fallback
mirth-cli dashboard

# Polling only (no WebSocket)
mirth-cli dashboard --no-websocket

# Custom refresh interval (for polling fallback)
mirth-cli dashboard --refresh 10
```

**WebSocket Protocol (for custom integrations):**
```typescript
// Connect
ws://localhost:8081/ws/dashboardstatus

// Subscribe to all channel updates
{ type: 'subscribe' }

// Subscribe to specific channel
{ type: 'subscribe', channelId: 'abc-123' }

// Request current states
{ type: 'getStates' }

// Server broadcasts:
{ type: 'stateChange', connectorId: '...', data: { channelId, connected, ... } }
{ type: 'connectionLog', data: { channelId, event, timestamp, ... } }
```

### CLI API Behavior Deviation from Java Mirth

**Important**: The `mirth-cli` tool deviates from Java Mirth API default behavior for better UX:

| Aspect | Java Mirth API Default | mirth-cli Behavior |
|--------|------------------------|-------------------|
| Error Reporting | Returns HTTP 204 (success) even on failure | Passes `?returnErrors=true` to surface errors |
| Silent Failures | Errors swallowed unless explicitly requested | Errors always surfaced to user |

**Why this matters:**
- Java Mirth Administrator (GUI) also uses `returnErrors=true` internally
- The API default is for backward compatibility with legacy integrations
- Our CLI needs errors to provide useful feedback to users

**Affected operations:** deploy, undeploy, start, stop, pause, resume

**If you see "success" but channel state doesn't change:**
1. Check server logs for the actual error
2. Common causes: unsupported connector type, missing dependencies, invalid configuration

### Engine Behavior Deviations from Java Mirth

#### SourceMap Persistence (Additive)

**Change**: Node.js Mirth now persists `sourceMap` data to `D_MC` tables (`CONTENT_TYPE=14`, `METADATA_ID=0`) after each message completes processing in `Channel.dispatchRawMessage()`.

**Java behavior**: Java Mirth's Donkey engine also writes sourceMap to `D_MC` tables as part of its pipeline storage manager. Our behavior matches — the data format (JSON-serialized map) and content type (14) are identical.

**Impact**: This is an **additive write** — new rows appear in `D_MC` that wouldn't have existed before. It does not modify existing rows. If running in takeover mode against a Java Mirth database:
- The extra `D_MC` rows are harmless — Java Mirth also writes these
- If the Node.js engine is later replaced with Java Mirth, the rows are compatible

**Why**: Required for the cross-channel trace feature. Without persisted sourceMap data, the trace service cannot reconstruct message chains across VM-connected channels.

#### Cross-Channel Trace API (Node.js-Only)

**Endpoint**: `GET /api/messages/trace/:channelId/:messageId`

**This endpoint does NOT exist in Java Mirth.** It is a Node.js-only extension.

The trace feature uses VM Connector chain-tracking data (`sourceChannelIds[]`, `sourceMessageIds[]`) already present in the sourceMap to reconstruct message journeys across channels. It also builds a dependency graph from Channel Writer destination configurations to scope forward-trace queries.

| Aspect | Java Mirth | Node.js Mirth |
|--------|------------|---------------|
| SourceMap persistence | Written by Donkey StorageManager | Written by `Channel.dispatchRawMessage()` |
| Trace API endpoint | Does not exist | `GET /api/messages/trace/:channelId/:messageId` |
| Trace CLI command | Does not exist | `mirth-cli trace <channel> <messageId>` |
| D_MC content type 14 | RESPONSE_ERROR | RESPONSE_ERROR (identical) |
| D_MC content type 15 | SOURCE_MAP | SOURCE_MAP (identical) |
| D_MC data format | JSON map | JSON map (identical) |

#### ContentType Enum Parity Fix

**Fixed**: The Node.js port originally omitted `RESPONSE_ERROR` entirely and assigned `SOURCE_MAP = 14`. Java Mirth defines `RESPONSE_ERROR = 14` and `SOURCE_MAP = 15`. This caused data corruption in takeover mode: Java's RESPONSE_ERROR rows (content type 14 in `D_MC`) were misread as SOURCE_MAP data. All content type definitions — `src/model/ContentType.ts`, `src/api/models/MessageFilter.ts`, and the inline maps in `MessageServlet.ts` — now include `RESPONSE_ERROR = 14` and `SOURCE_MAP = 15`, matching Java Mirth exactly.

### Data Pruner (Operational)

The DataPruner is fully wired into the server lifecycle and matches Java Mirth's pruning behavior.

**Startup wiring:** `dataPrunerController.initialize()` is called from `Mirth.ts` after VMRouter init. `dataPrunerController.shutdown()` is called during server shutdown. The controller runs the pruner on a configurable schedule (default: every 12 hours).

**Per-channel pruning settings:** `buildTaskQueue()` reads per-channel retention settings from `ConfigurationController.getChannelMetadata()`. Channels without explicit `pruningSettings` are skipped (Java Mirth behavior). Channel names are resolved via `ChannelController.getChannelIdsAndNames()`.

**Safety features:**
- `PROCESSED=0` messages are never pruned (prevents deleting in-flight messages)
- `messageStorageMode=DISABLED` channels are skipped (no messages stored)
- `messageStorageMode=METADATA` channels have content pruning disabled (no content tables)
- Failed archives skip deletion for that batch (data safety, when archive integration is connected)

**D_MCM cleanup:** `DonkeyDao.pruneMessages()` now includes `D_MCM{id}` (custom metadata) in its batch delete transaction, matching the behavior of `deleteMessage()`.

**Config persistence:** Pruner configuration is stored in the `CONFIGURATION` table with `category='Data Pruner'`, `name='pruner.config'` as JSON via `MirthDao.getConfiguration/setConfiguration`.

**Event pruning:** `EventDao.deleteEventsBeforeDate()` is called when `pruneEvents=true` and `maxEventAge` is set, removing old audit log entries.

**Remaining gap:** `MessageArchiver` (archive-before-delete phase) is implemented but not yet connected to the pruning pipeline. Plan: `plans/datapruner-archive-integration.md`.

**Key files:**
| File | Purpose |
|------|---------|
| `src/plugins/datapruner/DataPruner.ts` | Core pruning engine with per-channel task queue |
| `src/plugins/datapruner/DataPrunerController.ts` | Scheduler, config CRUD, lifecycle management |
| `src/plugins/datapruner/DataPrunerServlet.ts` | REST API: status, start, stop, config |
| `src/plugins/datapruner/MessageArchiver.ts` | Archive-before-delete (not yet connected) |
| `src/plugins/datapruner/DataPrunerStatus.ts` | Status tracking model |
| `tests/unit/plugins/datapruner/` | 55 tests (unit + integration) |

### Horizontal Scaling (Container-Native Clustering)

**This is a Node.js-only feature with no Java Mirth equivalent.** It provides container-native horizontal scaling.

#### How It Differs from Java Mirth Clustering

Java Mirth has a separate **Clustering Plugin** (commercial add-on) that:
- Stores `server.id` in the `CONFIGURATION` table (key: `server.id`, category: `core`)
- Uses JGroups for inter-node communication and cluster discovery
- Requires a license key for the clustering extension
- Manages node membership via the `D_CONFIGURATION` or plugin-specific tables
- Coordinates via TCP/UDP multicast (JGroups protocol stack)

Node.js Mirth uses a **container-native** approach:
- Stores server identity in `MIRTH_SERVER_ID` environment variable (or auto-generated UUID)
- Uses database polling (D_CLUSTER_EVENTS) or Redis pub/sub for inter-node communication
- Requires no license — clustering is built into the core engine
- Manages node membership via the `D_SERVERS` table with heartbeat
- Coordinates via HTTP (internal API) or database polling — no multicast required

#### Takeover Mode Clustering Considerations (CRITICAL)

When running Node.js Mirth in **takeover mode** against a database that also serves Java Mirth instances:

1. **SERVER_ID Collision**: Java Mirth's clustering plugin stores `server.id` in the `CONFIGURATION` table. Node.js Mirth uses `MIRTH_SERVER_ID` env var (stored in `D_SERVERS`). These are **separate namespaces** — no collision risk. However, both systems write `SERVER_ID` into `D_M` and `D_MM` message tables, so ensure they use **different** UUIDs.

2. **D_SERVERS Table**: This table is **Node.js-only**. Java Mirth does not read or write it. It is safe to have `D_SERVERS` in a shared database — Java Mirth ignores unknown tables.

3. **D_CLUSTER_EVENTS Table**: Also Node.js-only. Java Mirth's clustering plugin uses JGroups, not database events. Safe in shared database.

4. **D_CHANNEL_DEPLOYMENTS Table**: Node.js-only. Java Mirth tracks deployments differently (in-memory via the clustering plugin's JGroups state transfer).

5. **D_GLOBAL_MAP Table**: Node.js-only. Java Mirth stores global map data in-memory (or via its own clustering plugin mechanism with JGroups replication). The D_GLOBAL_MAP table is used by Node.js for database-backed GlobalMap persistence.

6. **Message Recovery**: The critical fix — `RecoveryTask` now filters by `SERVER_ID`. Without this, a Node.js instance would recover Java Mirth's in-flight messages (and vice versa), causing duplicate processing and data corruption.

7. **Statistics Aggregation**: `D_MS` tables now have per-node rows keyed by `(METADATA_ID, SERVER_ID)`. The `/api/system/cluster/statistics` endpoint sums across all nodes for accurate cross-instance totals.

8. **Sequence IDs**: Both Java and Node.js use `D_MSQ` with `FOR UPDATE` row locks. The `SequenceAllocator` pre-allocates blocks to reduce contention, but this is compatible with Java Mirth's single-lock approach — block gaps are harmless.

#### Future Java Clustering Plugin Integration

If you need to integrate with Java Mirth's clustering plugin in takeover mode:

1. **Read Java's `server.id`**: Query `SELECT VALUE FROM CONFIGURATION WHERE CATEGORY = 'core' AND NAME = 'server.id'` to discover the Java instance's SERVER_ID.
2. **Avoid duplicate channel deployment**: If Java Mirth is processing channels, the Node.js instance should skip those channels (or accept that both will process messages on the same channel with different SERVER_IDs — the LB routes messages, so no duplicates if properly configured).
3. **JGroups compatibility**: Not planned. Node.js cannot join a JGroups cluster. The hybrid model requires the external LB to route traffic appropriately to Java vs Node.js instances.
4. **Shared GlobalMap**: Java Mirth's clustering plugin replicates GlobalMap via JGroups. Node.js uses D_GLOBAL_MAP or Redis. In hybrid mode, global map state will **not** be shared between Java and Node.js instances unless both read from the same database table.

#### Cluster Module Architecture

```
src/cluster/
├── ClusterIdentity.ts      # SERVER_ID: MIRTH_SERVER_ID env or crypto.randomUUID()
├── ClusterConfig.ts         # Central config from env vars (8 variables with defaults)
├── ServerRegistry.ts        # D_SERVERS heartbeat + node tracking
├── SequenceAllocator.ts     # Block-allocated message IDs (100 per block default)
├── HealthCheck.ts           # K8s/ECS/CloudRun probe endpoints (readiness, liveness, startup)
├── MapBackend.ts            # Pluggable storage: InMemory, Database (D_GLOBAL_MAP), Redis
├── ChannelRegistry.ts       # D_CHANNEL_DEPLOYMENTS tracking
├── RemoteDispatcher.ts      # POST /api/internal/dispatch (inter-instance forwarding)
├── EventBus.ts              # Pub/sub: Local, DatabasePolling, Redis implementations
└── index.ts                 # Barrel re-exports
```

#### Cluster Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_SERVER_ID` | auto UUID | Unique container instance identifier |
| `MIRTH_CLUSTER_ENABLED` | `false` | Enable cluster-aware behavior |
| `MIRTH_CLUSTER_REDIS_URL` | (none) | Redis URL for maps + events (optional) |
| `MIRTH_CLUSTER_SECRET` | (none) | Inter-instance API auth secret |
| `MIRTH_CLUSTER_HEARTBEAT_INTERVAL` | `10000` | Heartbeat interval (ms) |
| `MIRTH_CLUSTER_HEARTBEAT_TIMEOUT` | `30000` | Instance suspect threshold (ms) |
| `MIRTH_CLUSTER_SEQUENCE_BLOCK` | `100` | Sequence block pre-allocation size |
| `MIRTH_MODE` | `auto` | Operational mode: `takeover`/`standalone`/`auto` |
| `MIRTH_SHADOW_MODE` | `false` | Read-only observer mode for safe takeover |

#### Health Check Endpoints (No Auth Required)

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `GET /api/health` | Readiness probe (LB routing) | 200 when ready, 503 during shutdown |
| `GET /api/health/live` | Liveness probe (restart policy) | Always 200 |
| `GET /api/health/startup` | Startup probe (slow-start) | 200 after channels deployed |
| `GET /api/health/channels/:channelId` | Channel-specific health | 200 if channel STARTED |

These map to standard orchestrator probe patterns: K8s `readinessProbe`/`livenessProbe`/`startupProbe`, ECS health checks, Cloud Run startup checks, etc.

#### Cluster API Endpoints (Auth Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/cluster/status` | GET | All instances with deployed channels |
| `/api/system/cluster/nodes` | GET | Node list without channel details |
| `/api/system/cluster/statistics` | GET | Cross-instance aggregated statistics |
| `/api/internal/dispatch` | POST | Inter-instance message forwarding (cluster secret auth) |

#### Graceful Shutdown Sequence

When the container receives SIGTERM:
1. Health check returns 503 (LB stops routing new connections)
2. In-flight messages drain (current pipeline completes)
3. Server heartbeat stops
4. Server deregisters from D_SERVERS (status → OFFLINE)
5. Database pool closes
6. Process exits 0

### Shadow Mode (Safe Takeover)

**This is a Node.js-only feature with no Java Mirth equivalent.** It enables safe, progressive cutover from Java Mirth.

When `MIRTH_SHADOW_MODE=true`, the Node.js engine deploys channels in a read-only observer state — config loaded, dashboard visible, historical stats available — but no connectors start, no ports bind, and no messages are processed.

**Typical usage:** `MIRTH_MODE=takeover MIRTH_SHADOW_MODE=true PORT=8081 node dist/index.js`

#### Shadow Mode Behavior

| Aspect | Shadow Active | Channel Promoted | Full Cutover |
|--------|--------------|-----------------|--------------|
| Channel deployed | Yes | Yes | Yes |
| Dashboard visible | Yes (STOPPED) | Yes (STARTED) | Yes (STARTED) |
| Connectors started | No | Yes | Yes |
| Message processing | No | Yes | Yes |
| API writes | Blocked (409) | Allowed (per-channel) | Allowed |
| VMRouter | Not initialized | Not initialized | Initialized |
| DataPruner | Not initialized | Not initialized | Initialized |
| D_SERVERS status | SHADOW | SHADOW | ONLINE |

#### Shadow API Endpoints (Auth Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/shadow` | GET | Shadow status, promoted channels list |
| `/api/system/shadow/promote` | POST | Promote channel (`{channelId}`) or full cutover (`{all: true}`) |
| `/api/system/shadow/demote` | POST | Stop + demote a promoted channel back to shadow |

#### Shadow CLI Commands

```bash
mirth-cli shadow status              # Show shadow mode state + promoted channels
mirth-cli shadow promote <channel>   # Promote single channel (with warning)
mirth-cli shadow promote --all       # Full cutover
mirth-cli shadow demote <channel>    # Stop + return channel to shadow
mirth-cli shadow cutover             # Interactive guided cutover
```

#### Cutover Workflow (Operator Perspective)

```
1. Start Node.js:   MIRTH_MODE=takeover MIRTH_SHADOW_MODE=true PORT=8081 node dist/index.js
2. Observe:         mirth-cli shadow status          → "12 channels deployed, 0 promoted"
                    mirth-cli dashboard               → all channels show STOPPED (shadow)
3. Stop on Java:    (operator stops "ADT Receiver" in Java Mirth GUI)
4. Promote:         mirth-cli shadow promote "ADT Receiver"
                    → Node.js binds port 6661, starts processing
5. Test:            Send test HL7 message → verify processing
6. Rollback:        mirth-cli shadow demote "ADT Receiver"
                    → Node.js stops, frees port. Restart on Java Mirth
7. Repeat:          Steps 3-6 for each channel
8. Full cutover:    mirth-cli shadow cutover          → promotes all, disables shadow mode
9. Shutdown Java:   (operator shuts down Java Mirth)
```

#### Safety Guardrails

| Risk | Mitigation |
|------|------------|
| Port conflict on promote | EADDRINUSE surfaces naturally; CLI warns to stop Java first |
| Duplicate processing | CLI warns operator; no automated cross-process check |
| Recovery interference | Recovery task only runs inside `Channel.start()`, skipped in shadow mode |
| DataPruner deletes Java's data | Not initialized until full cutover |
| VMRouter routes messages | Not wired until full cutover |

#### Key Files

| File | Purpose |
|------|---------|
| `src/cluster/ShadowMode.ts` | Core state module (shadow mode flag + promoted channels set) |
| `src/api/middleware/shadowGuard.ts` | Express middleware blocking writes in shadow mode |
| `src/api/servlets/ShadowServlet.ts` | REST API for promote/demote/status |
| `src/cli/commands/shadow.ts` | CLI commands for shadow mode management |
| `tests/unit/cluster/ShadowMode.test.ts` | 15 tests — state management |
| `tests/unit/api/shadowGuard.test.ts` | 9 tests — middleware behavior |
| `tests/unit/controllers/EngineController.shadow.test.ts` | 11 tests — deploy/dispatch guards |

### Cross-Channel Message Trace (`mirth-cli trace`)

Traces a message across VM-connected channels (Channel Writer/Reader), showing the complete journey from source to final destination(s).

**Architecture:**
```
TraceService.ts
├── buildChannelDependencyGraph()  — Reads all channel configs, extracts Channel Writer targets
├── traceBackward()                — Follows sourceMap chain to find root message
├── traceForward()                 — Uses dependency graph + D_MC queries to find downstream
└── traceMessage()                 — Entry point: backward to root, then forward to build tree
```

**How it works:**
1. The VM Connector already tracks `sourceChannelId`, `sourceMessageId`, `sourceChannelIds[]`, `sourceMessageIds[]` in the sourceMap as messages flow between channels
2. `Channel.dispatchRawMessage()` persists the sourceMap to `D_MC` (`CONTENT_TYPE=14`)
3. The trace service queries `D_MC` tables to follow chains backward (sourceMap → parent) and forward (dependency graph → `LIKE` query on downstream channel tables)
4. Results are assembled into a tree structure with content snapshots at each hop

**Usage:**
```bash
mirth-cli trace "ADT Receiver" 123              # Full trace (backward + forward)
mirth-cli trace "ADT Receiver" 123 --verbose     # Full content (2000 char previews)
mirth-cli trace "ADT Receiver" 123 --direction backward  # Only upstream chain
mirth-cli trace "ADT Receiver" 123 --no-content  # Tree structure only
mirth-cli trace "ADT Receiver" 123 --json         # Raw JSON output
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-v, --verbose` | false | Full content (2000 char limit vs 200) |
| `-c, --content <types>` | `raw,transformed,response,error` | Content types to show |
| `--max-depth <n>` | 10 | Max trace depth |
| `--direction <dir>` | `both` | `both`, `backward`, `forward` |
| `--no-content` | - | Hide content, show tree structure only |
| `--json` | - | Output raw JSON |

**Performance:**
- Dependency graph computed once per trace, scopes forward queries
- Forward trace queries run in parallel via `Promise.all()`
- Content truncated at server side (default 500 chars, 2000 with `--verbose`)
- Circular reference guard prevents infinite loops

## Critical Patterns

### E4X Transpilation
ALL user scripts may contain E4X. Always transpile before execution:
```typescript
const transpiled = e4xTranspiler.transpile(userScript);
```

### Message Status Codes
R=RECEIVED, F=FILTERED, T=TRANSFORMED, S=SENT, Q=QUEUED, E=ERROR, P=PENDING

### Map Variables
$c=channelMap, $s=sourceMap, $g=globalMap, $gc=globalChannelMap,
$cfg=configurationMap, $r=responseMap, $co=connectorMap

## Database

### Operational Modes (CRITICAL CONCEPT)

**The ONLY difference between Java Mirth and Node.js Mirth is the operational mode.**

| Mode | Environment Variable | Behavior |
|------|---------------------|----------|
| **Takeover** | `MIRTH_MODE=takeover` | Connect to existing Java Mirth database |
| **Standalone** | `MIRTH_MODE=standalone` | Create fresh schema from scratch |
| **Auto** | `MIRTH_MODE=auto` (default) | Detect based on CHANNEL table presence |

This enables **zero-migration replacement** of Java Mirth with Node.js Mirth.

### SchemaManager (`src/db/SchemaManager.ts`)

Central module for dual operational mode support:

```typescript
import { detectMode, verifySchema, ensureCoreTables, seedDefaults, ensureChannelTables } from './SchemaManager.js';

// At startup (in Mirth.ts):
const mode = await detectMode();  // Returns 'takeover' | 'standalone'
if (mode === 'standalone') {
  await ensureCoreTables();  // CREATE TABLE IF NOT EXISTS for all core tables
  await seedDefaults();      // admin/admin user, default configuration
} else {
  const result = await verifySchema();  // Check SCHEMA_INFO and required tables
  if (!result.compatible) throw new Error('Schema incompatible');
}

// During channel deployment (in EngineController.ts):
await ensureChannelTables(channelId);  // Creates D_M, D_MM, D_MC, D_MA, D_MS, D_MSQ, D_MCM
```

### Database Tables

**Core Tables** (existing Mirth schema):
- `CHANNEL`, `CONFIGURATION`, `PERSON`, `PERSON_PASSWORD`, `EVENT`, `ALERT`
- `CODE_TEMPLATE`, `CODE_TEMPLATE_LIBRARY`, `CHANNEL_GROUP`, `SCRIPT`
- `SCHEMA_INFO` (version tracking), `D_CHANNELS` (channel ID mapping)

**Cluster Tables** (Node.js-only, created in standalone mode or auto-created when cluster enabled):
- `D_SERVERS` - Cluster node registry with heartbeat tracking
- `D_CHANNEL_DEPLOYMENTS` - Which channels are deployed on which instances
- `D_CLUSTER_EVENTS` - Polling-based event bus for inter-node communication
- `D_GLOBAL_MAP` - Shared global/channel map storage for clustered mode

**Note**: These tables are safe to have in a shared Java+Node.js database — Java Mirth ignores unknown tables. They are NOT related to Java Mirth's clustering plugin tables (which stores cluster state in `CONFIGURATION` and uses JGroups for communication).

**Per-Channel Tables** (auto-created on deploy):
- `D_M{id}` - Messages (includes `SERVER_ID` column for node ownership)
- `D_MM{id}` - Message metadata (includes `SERVER_ID` column)
- `D_MC{id}` - Message content
- `D_MA{id}` - Message attachments
- `D_MS{id}` - Message statistics (keyed by `METADATA_ID, SERVER_ID` for per-node tracking)
- `D_MSQ{id}` - Message sequence (row-locked for ID generation)
- `D_MCM{id}` - Custom metadata (user-defined fields)

## Validation Requirements
Before marking component complete:
1. Unit tests pass
2. Integration test with Java engine produces identical output
3. API contract tests pass (if API component)

## Reference Files (from ~/Projects/connect)
- JavaScriptBuilder.java - Script generation patterns
- JavaScriptScopeUtil.java - Scope variables
- Channel.java (donkey) - Message pipeline
- mysql-database.sql - Schema
- mysql.xml - Dynamic table queries

---

## Porting Untracked Mirth Features

When you discover a Mirth feature that isn't yet tracked in manifest.json, follow this process:

### Step 1: Identify the Feature
1. Note where you encountered the feature (channel XML, API call, error message)
2. Search the Java codebase for the implementation:
   ```bash
   # Search in ~/Projects/connect
   grep -r "FeatureName" ~/Projects/connect/server/src/
   grep -r "FeatureName" ~/Projects/connect/donkey/src/
   ```

### Step 2: Register in Manifest
Add to `manifest.json` under the appropriate category:
```json
{
  "components": {
    "category": {
      "new_feature": {
        "status": "pending",
        "javaSource": "/path/to/JavaFile.java",
        "description": "Brief description of what it does",
        "discoveredIn": "channel-name or api-endpoint",
        "tests": []
      }
    }
  }
}
```

### Step 3: Analyze Java Implementation
1. Read the Java source file completely
2. Document the key methods and their behavior
3. Identify dependencies on other Java classes
4. Note any Rhino/E4X specific code that needs transpilation

### Step 4: Create TypeScript Skeleton
```typescript
// src/path/to/NewFeature.ts

/**
 * Ported from: ~/Projects/connect/server/src/.../JavaFile.java
 *
 * Purpose: [description]
 *
 * Key behaviors to replicate:
 * - [behavior 1]
 * - [behavior 2]
 */
export class NewFeature {
  // TODO: Implement
}
```

### Step 5: Write Tests First (TDD)
1. Create test file: `tests/unit/path/to/NewFeature.test.ts`
2. Write tests based on expected Java behavior
3. Create integration test comparing with Java engine

### Step 6: Implement and Validate
1. Implement until unit tests pass
2. Run integration comparison test
3. Update manifest.json status to "validated"

### Common Porting Patterns

**Java → TypeScript Type Mapping:**
| Java | TypeScript |
|------|------------|
| `String` | `string` |
| `Integer/Long` | `number` |
| `List<T>` | `T[]` |
| `Map<K,V>` | `Map<K,V>` or `Record<K,V>` |
| `Calendar/Date` | `Date` |
| `Object` | `unknown` or generic `T` |

**Rhino JavaScript → Node.js:**
| Rhino Pattern | Node.js Equivalent |
|---------------|-------------------|
| `importPackage(...)` | `import { ... } from '...'` |
| `new XML(str)` | `XMLProxy.create(str)` |
| `msg.element.@attr` | `msg.get('element').attr('attr')` |
| `JavaAdapter` | Native class or wrapper |

**XStream Serialization:**
- Java uses XStream for XML serialization
- Use `fast-xml-parser` with custom mappers to match XStream output exactly

---

## Validation Suite

The `validation/` directory contains a side-by-side comparison suite for validating Node.js behavior against the Java engine.

### Quick Start

```bash
# 1. Setup environment (installs deps, starts Docker)
cd validation
./scripts/setup.sh

# 2. Start Node.js Mirth (separate terminal)
PORT=8081 npm run dev

# 3. Run validation
cd validation
npm run validate
```

### Commands

```bash
npm run validate                    # Run all scenarios
npm run validate -- --priority 0    # Export compatibility only
npm run validate -- --priority 1    # Core message flows only
npm run validate -- --scenario 1.1  # Specific scenario
npm run validate -- --verbose       # Verbose output
npm run validate -- --stop-on-failure
```

### Priority Levels

| Priority | Category | Description |
|----------|----------|-------------|
| 0 | Export Compatibility | Channel export/import round-trip |
| 1 | Core Message Flow | MLLP, HTTP basic flows |
| 2 | JavaScript Runtime | Filters, transformers, E4X |
| 3 | Connectors | HTTP, TCP, File, Database |
| 4 | Data Types | HL7v2, XML, JSON parsing |
| 5 | Advanced | Response transformers, routing |

### Key Components

- **MirthApiClient** (`validation/clients/`) - REST API client for both engines
- **MLLPClient** - MLLP message sender with framing
- **MessageComparator** (`validation/comparators/`) - HL7, XML, JSON comparison
- **ChannelExportComparator** - Channel XML export comparison
- **ValidationRunner** (`validation/runners/`) - Orchestrates test execution

### Adding Scenarios

1. Create directory: `validation/scenarios/NN-name/`
2. Add `config.json`:
```json
{
  "id": "1.2",
  "name": "MLLP to MLLP",
  "type": "mllp",
  "channelFile": "MLLP to MLLP.xml",
  "inputMessage": "hl7v2/simple-adt.hl7"
}
```

### Gap Tracking

Discovered gaps are tracked in `manifest.json` under `validationGaps`:
```json
{
  "validationGaps": {
    "gap-001": {
      "scenarioId": "1.1",
      "severity": "critical",
      "description": "ACK code differs",
      "status": "open"
    }
  }
}
```

Reports are saved to `validation/reports/validation-TIMESTAMP.json`

### Validation Status (as of 2026-02-04)

| Priority | Category | Status | Notes |
|----------|----------|--------|-------|
| 0 | Export Compatibility | ✅ Passing | Channel round-trip works |
| 1 | MLLP Message Flow | ✅ Passing | 3/3 tests, minor ACK format gaps |
| 2 | JavaScript Runtime | ✅ Passing | E4X, userutil, XSLT verified (Wave 2) |
| 3 | Connectors | ✅ Passing | HTTP, TCP, File, JDBC, SMTP, JMS, WebService, DICOM (Wave 3-5) |
| 4 | Data Types | ✅ Passing | HL7v2, XML, JSON, Delimited, EDI, HL7v3, NCPDP, DICOM (Wave 3-5) |
| 5 | Advanced | ✅ Passing | Response transformers, routing, multi-destination (Wave 5) |
| 6 | Operational Modes | ✅ Passing | Takeover, standalone, auto-detect (Wave 6) |

**Total Tests: 2,559 passing**

### Quick Validation Scripts

```bash
# Quick MLLP test (uses already-deployed channels)
cd validation
npx ts-node quick-validate.ts

# Test JavaScript runtime components
npx ts-node test-js-runtime.ts

# Full validation (slow - Java Mirth under QEMU)
npm run validate -- --priority 1
```

### Known Minor Gaps (Priority 1)

| Gap | Java Mirth | Node.js Mirth | Severity |
|-----|------------|---------------|----------|
| ACK sender/receiver | Swapped from message | Always `MIRTH\|MIRTH` | Minor |
| ACK message type | `ACK^A01^ACK` | `ACK` | Minor |
| Timestamp precision | With milliseconds | Without milliseconds | Minor |

### Node.js-Only Extensions (Not in Java Mirth)

| Feature | Endpoint / Command | Description |
|---------|-------------------|-------------|
| Message Trace API | `GET /api/messages/trace/:channelId/:messageId` | Cross-channel message tracing |
| Message Trace CLI | `mirth-cli trace <channel> <messageId>` | Terminal tree view of message journey |
| Shadow Mode API | `GET/POST /api/system/shadow/*` | Safe takeover with progressive cutover |
| Shadow Mode CLI | `mirth-cli shadow status/promote/demote/cutover` | Shadow mode management commands |

---

## Development Environment

### Test Ports Configuration

| Service | Java Mirth | Node.js Mirth |
|---------|------------|---------------|
| REST API | https://localhost:8443 | http://localhost:8081 |
| MLLP Test | localhost:6661 | localhost:6662 |
| HTTP Test | localhost:8082 | localhost:8083 |
| MySQL | localhost:3306 (shared) | localhost:3306 (shared) |

### Starting the Engines

```bash
# Terminal 1: Java Mirth (Docker)
cd validation
docker-compose up -d

# Terminal 2: Node.js Mirth
cd /path/to/project
PORT=8081 node dist/index.js

# Verify both are running
lsof -i :8081 -i :8443 -i :6661 -i :6662 | grep LISTEN
```

### Performance Notes

- **Java Mirth under QEMU** (M1 Mac): Channel deploy operations are very slow (2+ minutes)
- **Workaround**: Use `quick-validate.ts` which tests already-deployed channels
- **Channel deployment timeout**: Set to 120 seconds in `MirthApiClient.ts`

---

## Known Issues and Fixes

### TypeScript Patterns for Database Operations

When working with mysql2/promise in TypeScript strict mode:

**1. Database Row Interfaces Must Extend RowDataPacket**
```typescript
// ❌ Wrong - will cause type errors with query<T>()
interface MyRow {
  ID: number;
  NAME: string;
}

// ✅ Correct
interface MyRow extends RowDataPacket {
  ID: number;
  NAME: string;
}
```

**2. execute() Does Not Accept Type Parameters**
```typescript
// ❌ Wrong - execute() has no type parameter
const result = await execute<ResultSetHeader>('INSERT...');

// ✅ Correct - returns ResultSetHeader automatically
const result = await execute('INSERT...');
```

**3. Array Access After Length Check Needs Non-Null Assertion**
```typescript
// TypeScript doesn't narrow after length check
const rows = await query<MyRow>('SELECT...');
if (rows.length === 0) return null;

// ❌ Wrong - rows[0] is still possibly undefined
return rows[0].NAME;

// ✅ Correct - use non-null assertion
return rows[0]!.NAME;
```

**4. Express Route Params Are string | undefined**
```typescript
// For nested routers with mergeParams: true, params come from parent
// But TypeScript still considers them possibly undefined

// ❌ Wrong - channelId might be undefined
const { channelId } = req.params;
await someFunction(channelId); // Error!

// ✅ Correct - use type assertion (safe with mergeParams)
const channelId = req.params.channelId as string;

// Or use a helper function
function getChannelId(req: Request): string {
  return req.params.channelId as string;
}
```

### XML Body Parsing in Deploy Endpoint

**Issue**: `/api/channels/_deploy` expects array but receives XML `<set><string>id</string></set>`

**Fix**: Added `extractChannelIds()` helper in `src/api/servlets/EngineServlet.ts`:
```typescript
function extractChannelIds(body: unknown): string[] {
  // Handles both array and XML { set: { string: 'id' } } formats
}
```

### Path Resolution in Validation Suite

**Issue**: `__dirname` points to `dist/` after TypeScript compilation, breaking path lookups

**Fix**: Use `process.cwd()` instead of `__dirname` in:
- `validation/config/environments.ts`
- `validation/runners/ValidationRunner.ts`
- `validation/runners/ScenarioRunner.ts`

### Channel ID Length in MySQL

**Issue**: Channel IDs with `-java`/`-node` suffixes exceed MySQL column limit

**Fix**: Modify last 6 characters of UUID instead:
```typescript
// Instead of: originalId + '-java'
// Use: parts[4].substring(0, 6) + '000001'
```

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Plan Archival
After completing an implementation that used a plan file:
1. **Copy the plan** to `plans/` directory in the project root
2. **Rename with descriptive name** that reflects what was accomplished (not the auto-generated name)
   - Bad: `plan-2026-02-01-abc123.md`
   - Good: `password-hashing-fix.md`, `mllp-connector-implementation.md`, `e4x-transpiler-upgrade.md`
3. **Add completion metadata** at the top of the archived plan:
   ```markdown
   <!-- Completed: 2026-02-01 | Status: Implemented -->
   ```
4. Plans serve as documentation of design decisions and implementation history

### 3. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 4. Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons-md*
with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 6. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 7. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
1. **Plan First**: Write plan to 'tasks/todo.md with checkable items
2. **Verify Plan**: Check in before starting implementation
3. *Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to 'tasks/todo.md*
6. **Capture Lessons**: Update 'tasks/lessons.md after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

---

## Available Agents

Specialized subagents for complex workflows. See `.claude/agents/README.md` for full documentation.

### mirth-porter
Port Java Mirth Connect code to TypeScript following TDD methodology.

**Use for**: New connectors, API endpoints, plugins, validation gaps.

**Quick start**:
```
Use the mirth-porter agent to port {ComponentName}.
Parameters:
- componentName: {name}
- targetCategory: connectors|javascript|api|plugins|donkey
```

See `.claude/agents/mirth-porter.md` for full specification.

### version-upgrader
Orchestrate version upgrades with parallel agents and git worktrees.

**Use for**: Upgrading to new Mirth versions (e.g., 3.9.1 → 3.10.0).

**Quick start**:
```
Use the version-upgrader agent to upgrade from 3.9.1 to 3.10.0.
Parameters:
- fromVersion: 3.9.1
- toVersion: 3.10.0
- parallelWaves: true
```

See `.claude/agents/version-upgrader.md` for full specification.

### subtle-bug-finder
Detect Java→Node.js porting discrepancies focusing on state tracking, initialization bypass, and architectural drift.

**Use for**: Post-porting validation, debugging unexpected API behavior, pre-release checks.

**Quick start**:
```
Use the subtle-bug-finder agent to scan for porting issues.
Parameters:
- scope: full|changed|component
- severity: critical|major|minor
- bugCategories: ["dual-state", "initialization-bypass", "missing-registration", "singleton-issues", "circular-deps", "async-order"]
```

See `.claude/agents/subtle-bug-finder.md` for full specification.

### parity-checker
Detect Java↔Node.js Donkey engine pipeline coverage gaps — missing DAO methods, unpersisted content types, and absent pipeline stages.

**Use for**: DAO method gap analysis, content persistence audits, pipeline completeness checks, pre-takeover validation.

**Quick start**:
```
Use the parity-checker agent to scan for all Java↔Node.js pipeline gaps.
Parameters:
- scope: full|dao|content|pipeline
- severity: critical|major|minor
- bugCategories: ["in-memory-only", "missing-dao-call", "stub-implementation", "missing-java-method", "hardcoded-value", "missing-content-persistence", "missing-pipeline-stage", "incomplete-error-handling", "missing-queue-recovery", "missing-transaction-boundary"]
```

See `.claude/agents/parity-checker.md` for full specification.

### api-parity-checker
Detect Java↔Node.js REST API servlet parity gaps — missing endpoints, parameter mismatches, permission drift, and response format differences.

**Use for**: API surface gap analysis, content negotiation audits, permission audits, pre-takeover GUI validation.

**Quick start**:
```
Use the api-parity-checker agent to scan all servlets for API gaps.
Parameters:
- scope: full|servlet|permissions|response-format
- servletName: ChannelServlet (required when scope: servlet)
- severity: critical|major|minor
- bugCategories: ["missing-endpoint", "extra-endpoint", "parameter-mismatch", "response-format-gap", "status-code-mismatch", "permission-mismatch", "content-negotiation-gap", "error-handling-gap", "missing-query-option", "stub-endpoint"]
```

See `.claude/agents/api-parity-checker.md` for full specification.

### channel-deployer
Design and build git-backed configuration management, environment promotion, and deployment tooling for Mirth channel artifacts.

**Use for**: Git sync features, promotion pipelines, channel diff tools, decomposed export/import, environment-specific configuration management, sensitive data handling.

**Quick start**:
```
Use the channel-deployer agent to design a git synchronization feature.
Parameters:
- mode: design
- feature: git-sync
- scope: full-config
- sensitiveDataStrategy: env-vars
```

See `.claude/agents/channel-deployer.md` for full specification.

---

## Parallel Agent Porting (Waves 1-5 Complete - 2026-02-03)

### Architecture Used

Successfully used **parallel Claude agents** with git worktrees to port 95+ components across five waves:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PARENT SHELL (Coordinator)                       │
│  - Creates worktrees and branches                                   │
│  - Spawns child Claude agents                                       │
│  - Tracks progress across all agents                                │
│  - Merges completed branches                                        │
└─────────────────────────────────────────────────────────────────────┘
         │
         ├──► [Worktree 1: feature/userutil-core]     → Agent 1 ✅
         ├──► [Worktree 2: feature/userutil-db]       → Agent 2 ⚠️ (permission issues, retried in Wave 2 ✅)
         ├──► [Worktree 3: feature/userutil-io]       → Agent 3 ✅
         ├──► [Worktree 4: feature/donkey-engine]     → Agent 4 ✅
         ├──► [Worktree 5: feature/connectors-vm]     → Agent 5 ✅
         ├──► [Worktree 6: feature/datatypes]         → Agent 6 ✅
         ├──► [Worktree 7: feature/plugins-core]      → Agent 7 ✅
         └──► [Worktree 8: feature/utils]             → Agent 8 ✅
```

### Results (Combined Waves 1-6)

| Metric | Value |
|--------|-------|
| Agents spawned | 30 (8 Wave 1 + 6 Wave 2 + 4 Wave 3 + 4 Wave 4 + 4 Wave 5 + 4 Wave 6) |
| Agents completed | 30 (100%) |
| Total commits | 125+ |
| Lines added | 55,200+ |
| Tests added | 1,391+ |
| Total tests passing | 2,559 |

### Wave Summary

| Wave | Branches | Lines | Tests | Duration | Components |
|------|----------|-------|-------|----------|------------|
| 1 | 8 | ~12,000 | 430 | 3 hrs | Userutil core, Donkey engine, VM connector |
| 2 | 6 | ~13,000 | 359 | 3 hrs | Database, Attachments, Channels, XSLT |
| 3 | 4 | ~5,000 | 140 | 1.5 hrs | Simple utils, validation P3/P4, MessageServlet |
| 4 | 4 | ~12,700 | 305 | 4 hrs | SMTP, JMS, WebService, advanced plugins |
| 5 | 4 | ~11,500 | 141 | 5 hrs | HL7v3, NCPDP, DICOM, validation P5 |
| 6 | 4 | ~1,000 | 16 | 12 min | **Dual Operational Modes** (SchemaManager, mode integration) |
| **Total** | **30** | **~55,200** | **1,391** | **~17 hrs** | |

### Components Ported

**Userutil Core (5 classes):**
- VMRouter - Inter-channel message routing (CRITICAL)
- DestinationSet - Filter which destinations receive messages
- RawMessage - Create raw messages in scripts
- ResponseFactory - Create Response objects
- ImmutableResponse - Immutable response wrapper

**Userutil I/O (5 classes):**
- FileUtil - File read/write from scripts
- HTTPUtil - HTTP request helpers
- SMTPConnection - Send emails from scripts
- SMTPConnectionFactory - SMTP pooling
- DateUtil - Date formatting utilities

**Userutil Database (3 classes) - Wave 2:**
- DatabaseConnection - Execute SQL from user scripts
- DatabaseConnectionFactory - Create DB connections with pooling
- MirthCachedRowSet - Cache and iterate JDBC results

**Userutil Attachment (2 classes) - Wave 2:**
- Attachment - Attachment model with base64 encoding
- AttachmentUtil - Extract/store message attachments

**Userutil Channel (4 classes) - Wave 2:**
- ChannelUtil - Programmatic channel operations from scripts
- AlertSender - Send alerts programmatically
- Future - Async operation wrapper with cancellation
- DeployedState - Channel deployment state enum

**Donkey Engine (6 components):**
- Statistics - Track message counts, errors, queue sizes
- SourceQueue - Queue incoming messages at source
- DestinationQueue - Queue messages for destination
- DestinationChain - Chain of destination connectors
- ResponseSelector - Select response from multiple destinations
- ResponseTransformerExecutor - Execute response transformers

**VM Connector (4 components — fully wired for cross-channel routing):**
- VmConnectorProperties - Receiver/dispatcher configuration
- VmReceiver - Receive messages routed from other channels (Channel Reader source in ChannelBuilder)
- VmDispatcher - Route messages to other channels (Channel Writer destination in ChannelBuilder)
- EngineController adapter wired during deployment for runtime dispatch

**Data Types (3 types):**
- Raw - Pass-through data type
- Delimited - CSV, pipe-delimited, tab-delimited parsing
- EDI/X12 - Healthcare EDI transactions

**Plugins (5 plugins):**
- JavaScriptRule - Filter rule execution (CRITICAL for UI)
- JavaScriptStep - Transformer step execution (CRITICAL for UI)
- Mapper - Variable mapping transformer
- MessageBuilder - Build message segments
- XsltStep - XSLT transformer step (Wave 2)

**Utilities (5 classes):**
- ValueReplacer - Replace ${variable} placeholders (CRITICAL)
- ErrorMessageBuilder - Build formatted error messages
- JsonXmlUtil - Convert between JSON and XML
- ACKGenerator - Generate HL7 ACK messages
- SerializerFactory - Create data type serializers

**Userutil Simple (3 classes) - Wave 3:**
- UUIDGenerator - Crypto-based UUID generation wrapper
- NCPDPUtil - Signed overpunch formatting for pharmacy claims
- ContextFactory - JavaScript context info retrieval

**MessageServlet Enhancements - Wave 3:**
- Message import with multipart upload (Multer)
- Message export with AES-256-GCM encryption
- Attachment CRUD operations (create, read, update, delete)
- Bulk message reprocessing

**Enterprise Connectors - Wave 4:**

*SMTP Connector (3 components):*
- SmtpDispatcher - Email sending via nodemailer (HTML/text, attachments)
- SmtpDispatcherProperties - Configuration model
- SmtpConfiguration - Server settings, TLS, authentication

*JMS Connector (4 components):*
- JmsReceiver - Queue/topic listener via STOMP protocol
- JmsDispatcher - Queue/topic sender
- JmsClient - Connection pool management
- JmsConnectorProperties - Broker configuration

*WebService Connector (4 components):*
- WebServiceReceiver - SOAP 1.1/1.2 endpoint with WSDL generation
- WebServiceDispatcher - SOAP client with MTOM attachments
- WebServiceReceiverProperties - Server configuration
- WebServiceDispatcherProperties - Client configuration

**Advanced Plugins - Wave 4:**
- ServerLog - Real-time log streaming via WebSocket
- DashboardStatus - Real-time channel status via WebSocket
- DataPruner — Fully operational: server lifecycle wiring, per-channel pruning settings, PROCESSED flag safety, D_MCM cleanup, config persistence via CONFIGURATION table, event pruning via EventDao

**Specialized Data Types - Wave 5:**

*HL7v3 DataType (3 components):*
- HL7V3Serializer - HL7v3 CDA XML serialization
- HL7V3DataTypeProperties - Configuration
- HL7V3BatchAdaptor - Batch message processing

*NCPDP DataType (4 components):*
- NCPDPSerializer - Pharmacy claims serialization (D.0 and 5.1)
- NCPDPReader - Segment/field parsing
- NCPDPReference - Standard code lookups
- NCPDPDataTypeProperties - Configuration

*DICOM DataType (3 components):*
- DICOMSerializer - DICOM object serialization
- DICOMDataTypeProperties - Configuration
- DICOMReference - DICOM tag/VR lookups

**DICOM Connector - Wave 5 (6 components):**
- DICOMReceiver - DIMSE C-STORE/C-ECHO receiver
- DICOMDispatcher - DIMSE C-STORE sender
- DICOMConfiguration - Association settings
- DICOMConnectorProperties - Transfer syntax configuration
- DICOMUtil - Userutil wrapper for script access
- DICOM integration with dcmjs/dicom-parser libraries

### Lessons Learned

**1. Git Worktrees Enable True Parallelism**
```bash
# Create isolated worktree for each agent
git worktree add ../mirth-worktrees/feature-name -b feature/feature-name
```
Each agent works in complete isolation - no merge conflicts until final integration.

**2. Permission Issues in Background Agents**
One agent (userutil-db) had "Permission to use Read has been auto-denied" errors in Wave 1. This can happen when agents run in background mode with limited prompts. **Resolved in Wave 2** — all 3 DatabaseConnection classes were successfully ported (122 tests passing). Solution: retry with explicit permissions or port manually.

**3. Merge Conflicts in Index Files**
When multiple agents modify the same `index.ts` export file, expect merge conflicts. These are easy to resolve by combining export statements.

**4. ESM vs CJS Jest Config**
Multiple agents renamed `jest.config.js` to `jest.config.cjs`. The file must use `module.exports = {}` (CJS syntax), not `export default {}` (ESM syntax) when using `.cjs` extension.

**5. Missing Dependencies After Merge**
Some branches add npm dependencies that don't merge cleanly. After merging all branches, run `npm install` to ensure all dependencies are present.

**6. NPM Package Publishing Bugs (Wave 2)**
Some npm packages have publishing bugs where declared exports don't match actual file locations. Fix with postinstall scripts:
```javascript
// scripts/fix-xslt-processor.js - xslt-processor declares exports in dist/ but files are at root
const files = ['index.js', 'index.mjs', 'index.d.ts'];
for (const file of files) {
  symlinkSync(join('..', file), join(distDir, file));
}
```

**7. TypeScript Overload Signature Compatibility (Wave 2)**
When porting Java methods with many overloads, the implementation signature must be a superset of all parameter types:
```typescript
// ❌ Wrong - overload signature not compatible
static async updateAttachment(
  msg: ImmutableConnectorMessage | string,
  id: string | number | Attachment,
  content: string | Buffer | Attachment | boolean  // Missing types!
): Promise<Attachment>

// ✅ Correct - implementation signature includes ALL possible types from ALL overloads
static async updateAttachment(
  msg: ImmutableConnectorMessage | string,
  id: string | number | Attachment,
  content: string | Buffer | Attachment | boolean | undefined,
  type?: string | Buffer | boolean,  // Added Buffer from one overload
  base64?: boolean | string | Buffer  // Added all possibilities
): Promise<Attachment>
```

**8. Regex Patterns: hex vs alphanumeric (Wave 2)**
When porting regex patterns, verify character classes match real-world data:
```typescript
// ❌ Wrong - hex-only pattern won't match "att-embed"
const ATTACHMENT_TOKEN_PATTERN = /\$\{ATTACH:([a-f0-9-]+)\}/gi;

// ✅ Correct - alphanumeric pattern matches all attachment IDs
const ATTACHMENT_TOKEN_PATTERN = /\$\{ATTACH:([\w-]+)\}/gi;
```

**9. Promise Microtask Timing for resolved() (Wave 2)**
Static factory methods for "already resolved" futures must set state synchronously:
```typescript
// ❌ Wrong - isDone() returns false immediately after resolved()
static resolved<T>(value: T): Future<T> {
  return new Future<T>(Promise.resolve(value));  // .then() hasn't run yet!
}

// ✅ Correct - set state immediately, not via .then()
static resolved<T>(value: T): Future<T> {
  const future = new Future<T>(Promise.resolve(value));
  future._isDone = true;
  future._result = value;
  return future;
}
```

**10. Agent Rate Limit Recovery (Wave 2)**
When background agents hit rate limits (429 errors), they make partial progress before failing. Strategy:
1. Check worktree for any completed files
2. Manually commit partial progress: `git add . && git commit -m "Partial progress"`
3. Continue work manually or retry agent with remaining tasks
4. Don't discard partial work - agents often complete 60-80% before hitting limits

**11. Multer Multipart Body Handling (Wave 3)**
Express body parsers (json, xml) run before Multer for multipart requests, causing empty `req.body`:
```typescript
// ❌ Wrong - body parsers consume stream before Multer
app.use(express.json());
app.use(upload.single('file'));  // req.body is empty!

// ✅ Correct - let Multer handle multipart first
const upload = multer({ storage: multer.memoryStorage() });
router.post('/import', upload.single('file'), (req, res) => {
  // req.file contains the file, req.body contains form fields
});
```

**12. STOMP Protocol for JMS (Wave 4)**
Node.js lacks native JMS. Use STOMP protocol which most JMS brokers (ActiveMQ, RabbitMQ) support:
```typescript
// stompit library provides JMS-like semantics over STOMP
import * as stompit from 'stompit';
const client = stompit.connect({ host: 'localhost', port: 61613 });
client.send({ destination: '/queue/test' }).end('message');
```

**13. SOAP MTOM Binary Attachments (Wave 4)**
MTOM (Message Transmission Optimization Mechanism) requires special handling for binary attachments:
```typescript
// The 'soap' library supports MTOM via security option
const client = await soap.createClientAsync(wsdl, {
  forceMTOM: true,  // Enable MTOM for binary
  disableSizeLimit: true  // Required for large attachments
});
```

**14. WebSocket Upgrade Handler Placement (Wave 4)**
WebSocket upgrade handlers must be registered BEFORE Express middleware:
```typescript
// ❌ Wrong - Express middleware intercepts upgrade
app.use(express.json());
server.on('upgrade', handleWebSocket);  // Never called!

// ✅ Correct - register upgrade handler first
server.on('upgrade', handleWebSocket);
app.use(express.json());
```

**15. DICOM Transfer Syntax Negotiation (Wave 5)**
DICOM association requires negotiating transfer syntax for each abstract syntax:
```typescript
// Common transfer syntaxes to support
const TRANSFER_SYNTAXES = [
  '1.2.840.10008.1.2',      // Implicit VR Little Endian (required)
  '1.2.840.10008.1.2.1',    // Explicit VR Little Endian
  '1.2.840.10008.1.2.4.50', // JPEG Baseline
];
// Always include Implicit VR Little Endian as fallback
```

**16. Large Reference Table Loading (Wave 5)**
NCPDP and DICOM have large lookup tables (40K+ LOC in Java). Strategy:
```typescript
// ❌ Wrong - load all at startup
const ALL_CODES = require('./all-codes.json');  // 10MB+ in memory

// ✅ Correct - lazy load with caching
const codeCache = new Map<string, CodeEntry>();
function getCode(type: string, code: string): CodeEntry | undefined {
  const key = `${type}:${code}`;
  if (!codeCache.has(key)) {
    codeCache.set(key, loadFromFile(type, code));
  }
  return codeCache.get(key);
}
```

**17. Merge Conflicts in Index Files Across Waves (Wave 5)**
When merging multiple branches that modify the same `index.ts` exports, resolve by combining all exports:
```typescript
// After conflict from hl7v3 + ncpdp + dicom branches:
export * from './hl7v3/index.js';
export * from './ncpdp/index.js';
export * from './dicom/index.js';
// Simply combine all export statements
```

**18. Dynamic Imports for Optional Dependencies (Wave 6)**
When modules may not exist at compile time (parallel development), use dynamic imports:
```typescript
// In Mirth.ts - SchemaManager may be created by parallel agent
const { detectMode, verifySchema, ensureCoreTables, seedDefaults } =
  await import('../db/SchemaManager.js');
```
This pattern also helps avoid circular dependencies.

**19. Idempotent Schema Operations (Wave 6)**
All schema creation operations use `IF NOT EXISTS` for safe re-running:
```typescript
// Safe to call multiple times
await execute(`CREATE TABLE IF NOT EXISTS CHANNEL (...)`);
await execute(`CREATE INDEX IF NOT EXISTS idx_name ON table (...)`);
```

**20. Java Mirth Password Hash Compatibility (Wave 6)**
To allow login in standalone mode with default credentials:
```typescript
// Java Mirth's default admin password hash - MUST match exactly
const DEFAULT_PASSWORD_HASH = 'YzKZIAnbQ5m+3llggrZvNtf5fg69yX7pAplfYg0Dngn/fESH93OktQ==';
```

**21. Stub vs Full Implementation Merge Conflicts (Wave 6)**
When one agent creates a stub and another creates the full implementation:
```bash
# Keep the full implementation (ours = current branch, theirs = incoming)
git checkout --ours src/db/SchemaManager.ts
git add src/db/SchemaManager.ts
```

**22. Duplicate Enum Definitions Across Layers (Trace Feature)**
When the same concept (ContentType) exists in both the donkey engine model and the API layer, they can drift out of sync. The donkey engine model had `SOURCE_MAP = 14` (missing `RESPONSE_ERROR`) while Java Mirth defines `RESPONSE_ERROR = 14, SOURCE_MAP = 15`. Always treat the donkey engine model (`src/model/`) as the single source of truth — and ensure it matches Java Mirth exactly. The API layer should import or mirror it. Inline maps in servlets that duplicate enum values are especially prone to drift:
```typescript
// ❌ Wrong - omitting RESPONSE_ERROR shifts SOURCE_MAP
const contentTypeMap: Record<string, number> = {
  POSTPROCESSOR_ERROR: 13,
  SOURCE_MAP: 14,      // Wrong! Should be 15
};

// ✅ Correct - include all types matching Java Mirth
import { ContentType } from '../../model/ContentType.js';
// ContentType.RESPONSE_ERROR === 14, ContentType.SOURCE_MAP === 15
```

**23. Connector Wiring Must Be End-to-End (VM Routing Bug)**
When porting connectors that depend on runtime references (engine controller, template replacer, etc.),
the port is not complete until the wiring code is also implemented. Check:
- Constructor creates the connector
- Builder function instantiates it
- **Deployment code wires runtime dependencies** -- Often missed
- **Source connector builder handles the transport type** -- Often missed
- Startup code initializes singletons -- Often missed
Always trace the full lifecycle: construction -> wiring -> start -> runtime use.

### Wave 6: Dual Operational Modes (2026-02-04)

**The culmination of the port — enabling seamless Java → Node.js migration.**

| Agent | Branch | Files | Tests | Duration |
|-------|--------|-------|-------|----------|
| SchemaManager | `feature/schema-manager` | SchemaManager.ts | 13 | 3.6 min |
| DonkeyDao | `feature/donkey-dao` | DonkeyDao.ts | - | 2.5 min |
| Mode Integration | `feature/mode-integration` | Mirth.ts, EngineController.ts | - | 4.3 min |
| Validation | `feature/validation-modes` | scenarios/06-modes/* | 3 | 1.7 min |

**Key deliverables:**
- `MIRTH_MODE` environment variable (takeover/standalone/auto)
- SchemaManager with detectMode(), verifySchema(), ensureCoreTables(), seedDefaults()
- Auto-creation of channel tables on deployment
- D_CHANNELS table for channel ID → local ID mapping
- D_MCM table for custom metadata

### Completion Status

All Waves 1-6 are complete. The porting project has reached production-ready status:

**Completed (Waves 1-6):**
- ✅ 28/28 Userutil classes (100%)
- ✅ 11/11 Connectors (HTTP, TCP, MLLP, File, SFTP, S3, JDBC, VM, SMTP, JMS, WebService, DICOM)
- ✅ 9/9 Data Types (HL7v2, XML, JSON, Raw, Delimited, EDI, HL7v3, NCPDP, DICOM)
- ✅ 15/15 Plugins (JavaScriptRule, JavaScriptStep, Mapper, MessageBuilder, XSLT, ServerLog, DashboardStatus, DataPruner, etc.)
- ✅ All Priority 0-6 validation scenarios
- ✅ **Dual Operational Modes** — The only difference between Java and Node.js Mirth

**Future Enhancements (Optional):**
- DataPruner archive integration — `MessageArchiver` exists but not connected to pruning pipeline (see `plans/datapruner-archive-integration.md`)
- Remote I/O Utils (S3Util, FtpUtil, SftpUtil) - File connector already supports these
- Additional servlet test coverage
- Performance optimization for high-volume channels
- Kubernetes deployment manifests
- Redis-backed EventBus and MapBackend (requires ioredis dependency)
- Java Mirth clustering plugin interop (JGroups state reading, not joining)

---

## Version Management

### Tracking Versions

The Node.js port tracks which Java Mirth version each component was ported from:

| Field | Location | Purpose |
|-------|----------|---------|
| `mirthCompatibility.current` | manifest.json | Current target version |
| `component.javaVersion` | manifest.json | Source version for component |
| `versionMetadata` | manifest.json | Branch/tag mapping per version |

### Version Manager CLI

```bash
# Check current status
npm run version-manager -- status

# Compare versions
npm run version-manager -- diff 3.9.1 3.10.0

# Generate upgrade tasks
npm run version-manager -- upgrade tasks 3.10.0

# Validate against specific version
npm run version-manager -- validate 3.10.0
```

### Upgrade Workflow

1. **Analyze**: `npm run version-manager -- diff 3.9.1 3.10.0 --impact`
2. **Plan**: `npm run version-manager -- upgrade tasks 3.10.0 --parallel-agents`
3. **Branch**: `npm run version-manager -- branch create 3.10.0`
4. **Execute**: Work through generated tasks (optionally with parallel agents)
5. **Validate**: `npm run version-manager -- validate 3.10.0 --deploy-java`
6. **Merge**: `git checkout master && git merge feature/3.10.x`

### Java Version Tags

| Version | Tag | Migration Class | Notes |
|---------|-----|-----------------|-------|
| 3.9.0 | 3.9.0 | Migrate3_9_0.java | |
| 3.9.1 | 3.9.1 | (none) | **Current** |
| 3.10.0 | 3.10.0 | Migrate3_10_0.java | |
| 3.11.0 | 3.11.0 | Migrate3_11_0.java | |
| 4.0.0 | 4.0.0 | Migrate4_0_0.java | Major version |
| 4.5.2 | 4.5.2 | Migrate4_5_0.java | Latest |

### Available Skills

- `/version-status` - Show current version and component breakdown
- `/version-diff <from> <to>` - Compare Java versions
- `/version-upgrade <target>` - Plan version upgrade
- `/version-validate <version>` - Run version-specific validation
