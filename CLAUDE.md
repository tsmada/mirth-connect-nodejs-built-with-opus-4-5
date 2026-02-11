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
- **Artifact**: Git-backed config management in `src/artifact/`
- **Logging**: Centralized logging with per-component debug in `src/logging/`
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
| Artifact | ArtifactServlet.ts | Git-backed config management: export/import/diff/promote/deploy (Node.js-only) |
| Logging | LoggingServlet.ts | Runtime log level control: global + per-component (Node.js-only) |

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
│   ├── shadow.ts               # Shadow mode promote/demote/cutover
│   └── artifact.ts             # Git-backed artifact export/import/diff/promote/deploy
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
mirth-cli artifact export --all   # Export all channels to git
mirth-cli artifact git push       # Export + commit + push to git
mirth-cli artifact promote staging # Promote artifacts to staging
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

**Supported E4X features:**
- XML literals: `<tag/>` → `XMLProxy.create('<tag/>')`
- Descendant access: `msg..PID` → `msg.descendants('PID')`
- Attribute read: `msg.@version` → `msg.attr('version')`
- Attribute write: `msg.@version = "2.5"` → `msg.setAttr('version', "2.5")`
- XML append: `xml += <tag/>` → `xml = xml.append(XMLProxy.create('<tag/>'))`
- `for each...in` loops
- `delete msg.PID['PID.6']` (named property deletion via `removeChild()`)
- `xml.text()`, `xml.elements()` (E4X built-in methods)

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
- `D_ARTIFACT_SYNC` - Git artifact sync tracking (commit hash ↔ channel revision mapping)

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
| 2 | JavaScript Runtime | ✅ Passing | E4X, userutil, XSLT verified (Wave 2); parity fixes (Waves 8-10) |
| 3 | Connectors | ✅ Passing | HTTP, TCP, File, JDBC, SMTP, JMS, WebService, DICOM (Wave 3-5) |
| 4 | Data Types | ✅ Passing | HL7v2, XML, JSON, Delimited, EDI, HL7v3, NCPDP, DICOM (Wave 3-5) |
| 5 | Advanced | ✅ Passing | Response transformers, routing, multi-destination (Wave 5) |
| 6 | Operational Modes | ✅ Passing | Takeover, standalone, auto-detect (Wave 6) |

**Total Tests: 4,699 passing** (2,559 core + 417 artifact management + 1,723 parity/unit)

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
| Git Artifact Sync | `GET/POST /api/artifacts/*` | Git-backed config management, promotion, delta deploys |
| Artifact CLI | `mirth-cli artifact export/import/diff/promote/deploy` | Artifact management commands |
| Logging API | `GET/PUT/DELETE /api/system/logging/*` | Runtime log level control + per-component debug |

### Centralized Logging System (`src/logging/`)

**This is a Node.js-only feature with no Java Mirth equivalent.** Java Mirth uses Log4j 1.x with named loggers configured via XML files at startup — no runtime API. Node.js Mirth provides a centralized, transport-pluggable logging system with runtime log level control via REST API.

#### Architecture

```
src/logging/
├── config.ts              # Env var parsing (LOG_LEVEL, LOG_FORMAT, etc.)
├── DebugModeRegistry.ts   # Per-component debug toggle (runtime + env)
├── transports.ts          # LogTransport interface + ConsoleTransport + FileTransport
├── Logger.ts              # Core Logger class (dual output: Winston + ServerLogController)
├── LoggerFactory.ts       # Named logger creation + Winston root setup
└── index.ts               # Barrel exports

src/api/servlets/LoggingServlet.ts   # Runtime log level control API
```

#### How It Works

Each log call writes to two outputs simultaneously:
1. **Winston** — console, file, or cloud transport (extensible via `LogTransport` interface)
2. **ServerLogController** — in-memory circular buffer for WebSocket dashboard streaming

Winston's Console transport uses `process.stdout.write()`, NOT `console.log()`, so the existing `hookConsole()` backward-compatibility bridge does not intercept logger output. Any remaining unmigrated `console.*` calls still flow into ServerLogController with category `'console'`.

**Level hierarchy:** Per-component override > Global `LOG_LEVEL` env var

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Global minimum: TRACE, DEBUG, INFO, WARN, ERROR |
| `MIRTH_DEBUG_COMPONENTS` | (none) | Comma-separated component names to set to DEBUG |
| `LOG_FORMAT` | `text` | Output format: `text` (Log4j-style) or `json` (structured) |
| `LOG_FILE` | (none) | Optional file path for file transport |
| `LOG_TIMESTAMP_FORMAT` | `mirth` | `mirth` = `yyyy-MM-dd HH:mm:ss,SSS`, `iso` = ISO 8601 |

#### Output Formats

**Text format** (default) — matches Java Mirth's Log4j pattern:
```
 INFO 2026-02-10 14:30:15,042 [server] Starting Mirth Connect Node.js Runtime...
 INFO 2026-02-10 14:30:15,150 [server] Connected to database at localhost:3306
 INFO 2026-02-10 14:30:16,320 [engine] Channel ADT Receiver deployed with state STARTED
DEBUG 2026-02-10 14:30:17,001 [http-connector] Request received POST /api/channels
ERROR 2026-02-10 14:30:18,500 [engine] Failed to deploy channel Lab Orders
  at Error: EADDRINUSE: port 6661
    at TcpReceiver.start (src/connectors/tcp/TcpReceiver.ts:45)
```

**JSON format** (`LOG_FORMAT=json`):
```json
{"level":"info","message":"Starting Mirth Connect Node.js Runtime...","component":"server","timestamp":"2026-02-10T14:30:15.042Z"}
```

#### Registered Components

Components register themselves at module initialization. Currently registered:

| Component Name | Description | Source Files |
|---|---|---|
| `server` | Server lifecycle | `Mirth.ts` |
| `engine` | Channel deploy/start/stop | `EngineController.ts` |

**Future components** (registered as migration progresses):

| Component Name | Description | Debug Use Case |
|---|---|---|
| `http-connector` | HTTP source/destination | Debug request/response bodies, headers, routing |
| `tcp-connector` | TCP/MLLP connections | Debug connection lifecycle, frame parsing, timeouts |
| `file-connector` | File polling/writing | Debug poll cycles, file locks, directory scanning |
| `jdbc-connector` | Database connector | Debug SQL queries, connection pool, result mapping |
| `sftp-connector` | SFTP file transfer | Debug SSH handshake, key auth, directory listing |
| `jms-connector` | JMS messaging (STOMP) | Debug queue/topic subscription, message ack |
| `smtp-connector` | Email sending | Debug SMTP handshake, TLS, attachment encoding |
| `webservice-connector` | SOAP endpoint | Debug WSDL generation, MTOM attachments, envelope |
| `dicom-connector` | DICOM C-STORE/C-ECHO | Debug association negotiation, transfer syntax |
| `vm-connector` | Channel Writer/Reader | Debug inter-channel routing, sourceMap chain |
| `database` | DB pool/queries | Debug connection pool, query timing, deadlocks |
| `javascript` | Script execution | Debug E4X transpilation, scope variable injection |
| `api` | REST API server | Debug request handling, auth, content negotiation |
| `cluster` | Cluster operations | Debug heartbeat, server registry, event bus |
| `data-pruner` | Pruning engine | Debug task queue, batch deletes, archive phase |
| `artifact` | Git artifact sync | Debug decompose/assemble, git operations, promotion |
| `secrets` | Secret management | Debug provider init, cache refresh, resolution |

#### Enabling Debug for Specific Connectors

**At startup via environment:**
```bash
# Debug a single connector
MIRTH_DEBUG_COMPONENTS=http-connector LOG_LEVEL=WARN node dist/index.js

# Debug multiple connectors
MIRTH_DEBUG_COMPONENTS=http-connector,tcp-connector,jdbc-connector node dist/index.js

# Debug with TRACE level (most verbose)
MIRTH_DEBUG_COMPONENTS=tcp-connector:TRACE node dist/index.js

# Common troubleshooting combinations:
# MLLP connectivity issues
MIRTH_DEBUG_COMPONENTS=tcp-connector:TRACE LOG_LEVEL=WARN node dist/index.js

# HTTP integration debugging
MIRTH_DEBUG_COMPONENTS=http-connector,api LOG_LEVEL=WARN node dist/index.js

# SFTP transfer problems
MIRTH_DEBUG_COMPONENTS=sftp-connector:TRACE,file-connector LOG_LEVEL=WARN node dist/index.js

# Database connector + pool issues
MIRTH_DEBUG_COMPONENTS=jdbc-connector,database LOG_LEVEL=WARN node dist/index.js

# Channel routing (VM connector) debugging
MIRTH_DEBUG_COMPONENTS=vm-connector,engine LOG_LEVEL=WARN node dist/index.js

# Script execution issues
MIRTH_DEBUG_COMPONENTS=javascript LOG_LEVEL=WARN node dist/index.js

# Full verbose mode (everything at DEBUG)
LOG_LEVEL=DEBUG node dist/index.js

# JSON output for log aggregation (CloudWatch, Datadog, etc.)
LOG_FORMAT=json LOG_LEVEL=INFO node dist/index.js

# Write to file
LOG_FILE=/var/log/mirth/mirth.log LOG_LEVEL=INFO node dist/index.js
```

**At runtime via REST API** (no restart required):
```bash
# Check current logging state
curl http://localhost:8081/api/system/logging \
  -H "X-Session-ID: <session>"

# Enable DEBUG for HTTP connector at runtime
curl -X PUT http://localhost:8081/api/system/logging/components/http-connector \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: <session>" \
  -d '{"level":"DEBUG"}'

# Enable TRACE for MLLP debugging
curl -X PUT http://localhost:8081/api/system/logging/components/tcp-connector \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: <session>" \
  -d '{"level":"TRACE"}'

# Raise global level to suppress noise while debugging one component
curl -X PUT http://localhost:8081/api/system/logging/level \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: <session>" \
  -d '{"level":"WARN"}'

# Stop debugging (clear override, revert to global level)
curl -X DELETE http://localhost:8081/api/system/logging/components/http-connector \
  -H "X-Session-ID: <session>"
```

#### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/logging` | GET | Current global level + all component overrides |
| `/api/system/logging/level` | PUT | Set global level `{ level: "DEBUG" }` |
| `/api/system/logging/components/:name` | PUT | Set component level `{ level: "DEBUG" }` |
| `/api/system/logging/components/:name` | DELETE | Clear component override (revert to global) |

All endpoints require authentication. Not shadow-guarded (logging changes are safe in shadow mode).

#### Usage in Code

```typescript
import { getLogger, registerComponent } from '../logging/index.js';

// Register at module level (once per component)
registerComponent('http-connector', 'HTTP source/destination connector');
const logger = getLogger('http-connector');

// Standard logging — component name is automatically included in output
logger.info(`Listening on ${host}:${port}`);
logger.warn('Connection timeout', { host, timeout: 30000 });
logger.error('Failed to process request', error, { method: 'POST', url });

// Guard expensive debug serialization
if (logger.isDebugEnabled()) {
  logger.debug(`Request payload: ${JSON.stringify(body)}`, { headers });
}

// Child logger for sub-components ("http-connector.poll")
const pollLogger = logger.child('poll');
pollLogger.debug('Polling cycle started');
```

#### Custom Transport Extensibility

```typescript
import { initializeLogging, LogTransport } from '../logging/index.js';

// Example: CloudWatch transport
class CloudWatchTransport implements LogTransport {
  name = 'cloudwatch';
  createWinstonTransport(): winston.transport {
    return new WinstonCloudWatch({ logGroupName: '/mirth/production', ... });
  }
}

// Pass custom transports at startup
initializeLogging(serverLogController, [new CloudWatchTransport()]);
```

#### Server Lifecycle Integration

In `src/server/Mirth.ts`:
- `initializeLogging(serverLogController)` is called as the FIRST action in `start()`
- `shutdownLogging()` is called at the end of `stop()` (flushes pending writes)
- All `console.warn/log/error` calls replaced with `logger.info/error`

#### Migration Status

| Phase | Scope | Files | Console Calls | Status |
|-------|-------|-------|---------------|--------|
| 1 (done) | Core server + engine | 3 modified | 37 migrated | Complete |
| 2 | Donkey engine | ~4 files | ~16 | Pending |
| 3 | Connectors | ~15 files | ~60 | Pending |
| 4 | API servlets | ~15 files | ~150 | Pending |
| 5 | Plugins/cluster | ~20 files | ~80 | Pending |
| 6 | CLI (internal only) | ~5 files | ~15 | Pending |

CLI user-facing output (tables, spinners, chalk) stays as console — only internal error/debug logging migrates.

#### Key Files

| File | ~Lines | Tests | Purpose |
|------|--------|-------|---------|
| `config.ts` | 65 | 24 | Env var parsing, caching |
| `DebugModeRegistry.ts` | 143 | 31 | Per-component debug toggle |
| `transports.ts` | 110 | (in Logger tests) | Console + File transport |
| `Logger.ts` | 136 | 26 | Dual-output logger |
| `LoggerFactory.ts` | 181 | 18 | Factory + Winston setup |
| `LoggingServlet.ts` | 100 | 13 | REST API (4 endpoints) |
| **Total** | **~735** | **112** | |

### Git-Backed Artifact Management (`src/artifact/`)

**This is a Node.js-only feature with no Java Mirth equivalent.** It enables managing Mirth configurations as code — with git-backed version control, environment promotion, delta deploys, and structural diffs.

Java Mirth stores all channel configurations as monolithic XML blobs in the database with integer revision counters. This module decomposes those blobs into reviewable file trees, syncs bidirectionally with git repositories, promotes configurations across environments, and performs delta deploys.

#### Module Architecture

```
src/artifact/
├── types.ts                     # Core types: DecomposedChannel, ChannelMetadata, etc.
├── ChannelDecomposer.ts         # Channel XML → decomposed file tree (fast-xml-parser)
├── ChannelAssembler.ts          # Decomposed file tree → Channel XML (lossless round-trip)
├── SensitiveDataDetector.ts     # Transport-type-aware credential detection + parameterization
├── VariableResolver.ts          # Deploy-time ${VAR} resolution with priority chain
├── ChannelDiff.ts               # Structural diff (YAML paths) + script diff (unified format)
├── DependencySort.ts            # Topological sort (Kahn's algorithm) with cycle detection
├── ArtifactController.ts        # Central orchestrator with lifecycle management
├── ArtifactDao.ts               # CRUD for D_ARTIFACT_SYNC table
├── index.ts                     # Barrel exports
├── git/
│   ├── GitClient.ts             # Shell wrapper: init, add, commit, push, pull, diff, log
│   ├── GitSyncService.ts        # Orchestrates export-to-git and import-from-git workflows
│   ├── GitWatcher.ts            # fs.watch() auto-sync on filesystem changes (debounced)
│   ├── CommitMapper.ts          # Maps channel revisions ↔ git commits via D_ARTIFACT_SYNC
│   ├── DeltaDetector.ts         # Maps git file changes to artifact IDs + dependency cascades
│   └── index.ts
└── promotion/
    ├── PromotionPipeline.ts     # Dev → staging → prod workflow with env ordering validation
    ├── PromotionGate.ts         # Approval records for promotion gating
    ├── VersionCompatibility.ts  # Version detection, E4X/ES6 guards, compatibility matrix
    └── index.ts
```

#### Decomposed Directory Structure

When a channel is exported, it is decomposed into this file tree:

```
mirth-config/                    # Git root
  .mirth-sync.yaml               # Repo metadata (engine version, git flow config)
  channels/
    {channel-name}/
      channel.yaml               # Metadata: id, name, version, revision, enabled, properties
      _skeleton.xml              # XML backbone with placeholders (for lossless reassembly)
      source/
        connector.yaml           # Transport properties (type, host, port, etc.)
        filter.js                # Filter rules (with @mirth-artifact metadata headers)
        transformer.js           # Transformer steps
      destinations/
        {dest-name}/             # Sanitized: "Dest 1 - Send" → "dest-1-send"
          connector.yaml
          filter.js
          transformer.js
          response-transformer.js
      scripts/
        deploy.js                # Channel deploy script
        undeploy.js
        preprocess.js
        postprocess.js
  code-templates/
    {library-name}/
      library.yaml
      {template-name}.js
  groups/
    {group-name}.yaml
  config/
    dependencies.yaml
    tags.yaml
    metadata.yaml
    global-scripts.yaml
  environments/
    base.yaml                    # Shared defaults
    dev.yaml                     # Dev-specific overrides
    staging.yaml
    prod.yaml
```

#### Environment Variable Resolution

The `VariableResolver` resolves `${VAR}` and `${VAR:default_value}` placeholders with this priority chain:

1. `process.env` — runtime overrides (highest priority)
2. `environments/{env}.yaml` — environment-specific values
3. `environments/base.yaml` — shared defaults
4. Inline defaults `${VAR:default_value}` — fallback

This is distinct from `ValueReplacer` (runtime message context like `$c`, `$g`). `VariableResolver` is for deploy-time configuration only.

#### Sensitive Data Detection

The `SensitiveDataDetector` uses transport-type heuristics to identify credentials:
- **Generic** (all transports): `password`, `secret`, `token`, `credential`, `passphrase`, `apiKey`
- **Database**: `username`, `password`, `url`
- **SFTP**: `username`, `password`, `keyFile`, `passPhrase`
- **SMTP/JMS/WebService/HTTP**: `username`, `password`

Detected fields are parameterized as `${CHANNEL_NAME_FIELD}` (UPPER_SNAKE convention) in the decomposed output.

#### Version Compatibility Guards

The `VersionCompatibility` module prevents deploying artifacts incompatible with the target engine:
- E4X scripts promoted to Java Mirth 4.0+ (no E4X support) → **BLOCK**
- ES6 scripts promoted to Java Mirth 3.8.x (limited Rhino) → **WARN**
- Node.js to Node.js promotion → **ALLOW** (transpiler handles E4X)
- `--force` flag overrides all guards

#### Delta Deploys

The `DeltaDetector` maps git file changes to artifact IDs via `git diff --name-only`:
- File path → channel/template/config artifact ID mapping
- Dependency cascades: code template changes → all referencing channels
- Selective deployment: only changed artifacts are redeployed

#### Database Table

```sql
CREATE TABLE IF NOT EXISTS D_ARTIFACT_SYNC (
  ID VARCHAR(36) NOT NULL PRIMARY KEY,
  ARTIFACT_TYPE VARCHAR(20) NOT NULL,     -- 'channel', 'code_template', 'group', 'config'
  ARTIFACT_ID VARCHAR(36) NOT NULL,
  ARTIFACT_NAME VARCHAR(255),
  REVISION INT,
  COMMIT_HASH VARCHAR(40),
  SYNC_DIRECTION VARCHAR(10) NOT NULL,    -- 'push', 'pull'
  SYNCED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  SYNCED_BY VARCHAR(255),
  ENVIRONMENT VARCHAR(50),
  INDEX idx_artifact (ARTIFACT_TYPE, ARTIFACT_ID),
  INDEX idx_commit (COMMIT_HASH)
) ENGINE=InnoDB;
```

This table is **Node.js-only**, safe in a shared Java+Node.js database (Java Mirth ignores unknown tables). Created in `SchemaManager.ensureCoreTables()`.

#### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/artifacts/export` | POST | Export channels to decomposed file tree |
| `/api/artifacts/export/:channelId` | GET | Export single channel (decomposed JSON) |
| `/api/artifacts/import` | POST | Import from decomposed file tree |
| `/api/artifacts/diff/:channelId` | GET | Diff current vs git version |
| `/api/artifacts/sensitive/:channelId` | GET | Detect sensitive fields in channel |
| `/api/artifacts/deps` | GET | Dependency graph (no init required) |
| `/api/artifacts/git/status` | GET | Git repository status |
| `/api/artifacts/git/push` | POST | Export + commit + push |
| `/api/artifacts/git/pull` | POST | Pull + import + deploy |
| `/api/artifacts/git/log` | GET | Recent commit history |
| `/api/artifacts/promote` | POST | Promote to target environment |
| `/api/artifacts/promote/status` | GET | Promotion pipeline status (no init required) |
| `/api/artifacts/delta` | GET | Changed artifacts between git refs |
| `/api/artifacts/deploy` | POST | Deploy changed artifacts (delta or full) |

All endpoints except `/deps` and `/promote/status` require the artifact controller to be initialized (return 503 otherwise).

#### CLI Commands

```bash
# Export / Import
mirth-cli artifact export [channel]         # Export to git directory
mirth-cli artifact export --all             # Export all channels + templates + config
mirth-cli artifact export --all --mask-secrets  # Parameterize detected credentials
mirth-cli artifact import [channel]         # Import from git directory
mirth-cli artifact import --all --env prod  # Import all with prod env vars

# Git operations
mirth-cli artifact git init [path]          # Initialize artifact repo
mirth-cli artifact git status               # Show sync status
mirth-cli artifact git push -m "message"    # Export + commit + push
mirth-cli artifact git pull [--env <env>]   # Pull + import + optionally deploy
mirth-cli artifact git log [-n <limit>]     # Show recent sync history

# Analysis
mirth-cli artifact diff <channel>           # Structural diff vs git version
mirth-cli artifact secrets <channel>        # Detect sensitive fields
mirth-cli artifact deps                     # Show dependency graph

# Promotion
mirth-cli artifact promote <target-env>     # Promote to environment
  --source <env>                            # Source environment (default: auto-detect)
  --force                                   # Skip version compatibility checks
  --dry-run                                 # Show what would change

# Delta deploy
mirth-cli artifact deploy --delta           # Deploy only changed artifacts
mirth-cli artifact deploy --from <ref>      # Deploy from specific commit
mirth-cli artifact deploy --channels "A,B"  # Deploy specific channels
mirth-cli artifact rollback <ref>           # Rollback to previous state
```

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_ARTIFACT_REPO` | (none) | Path to git repository for artifact sync |
| `MIRTH_ARTIFACT_ENV` | (none) | Active environment (dev, staging, prod) |
| `MIRTH_ARTIFACT_AUTO_SYNC` | `false` | Enable filesystem watcher for auto-sync |
| `MIRTH_ARTIFACT_REMOTE` | `origin` | Git remote name |

#### Server Lifecycle Integration

In `src/server/Mirth.ts`, after channel deployment:
```typescript
const artifactRepoPath = process.env['MIRTH_ARTIFACT_REPO'];
if (artifactRepoPath) {
  const { ArtifactController } = await import('../artifact/ArtifactController.js');
  await ArtifactController.initialize(artifactRepoPath);
  if (process.env['MIRTH_ARTIFACT_AUTO_SYNC'] === 'true') {
    await ArtifactController.startWatcher();
  }
}
```

#### Key Files

| File | ~Lines | Tests | Purpose |
|------|--------|-------|---------|
| `ChannelDecomposer.ts` | 486 | 66 | XML → decomposed file tree |
| `ChannelAssembler.ts` | 312 | (in decomposer tests) | File tree → XML |
| `SensitiveDataDetector.ts` | 256 | (in decomposer tests) | Credential detection |
| `VariableResolver.ts` | 399 | 50 | Deploy-time ${VAR} resolution |
| `ChannelDiff.ts` | 645 | 63 | Structural + script diffs |
| `GitClient.ts` | 278 | 42 | Shell-based git operations |
| `GitSyncService.ts` | 535 | (in git client tests) | Push/pull workflows |
| `DeltaDetector.ts` | 458 | 45 | Change detection + cascades |
| `DependencySort.ts` | 223 | 77 | Topological sort + cycle detection |
| `PromotionPipeline.ts` | 250 | (in promotion tests) | Environment promotion |
| `VersionCompatibility.ts` | 285 | (in promotion tests) | E4X/ES6 compatibility guards |
| `ArtifactController.ts` | 671 | 74 | Central orchestrator |
| **Total** | **~5,400** | **417** | |

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

### js-runtime-checker
Detect Java↔Node.js JavaScript runtime parity gaps — E4X transpilation errors, scope variable mismatches, userutil API drift, and script builder divergences.

**Use for**: E4X transpiler audits, scope variable mismatch detection, userutil API comparison, script builder divergence analysis, sandbox security review.

**Quick start**:
```
Use the js-runtime-checker agent to scan for all JavaScript runtime parity gaps.
Parameters:
- scope: full|e4x|scope|userutil|scripts
- severity: critical|major|minor
- bugCategories: ["e4x-transpilation-gap", "scope-variable-mismatch", "userutil-api-mismatch", "script-builder-divergence", "type-coercion-difference", "missing-userutil-method", "sandbox-escape-risk", "error-context-loss", "xml-namespace-handling", "script-timeout-behavior"]
```

See `.claude/agents/js-runtime-checker.md` for full specification.

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

### Results (Combined Waves 1-12)

| Metric | Value |
|--------|-------|
| Agents spawned | 50 (8 Wave 1 + 6 Wave 2 + 4 Wave 3 + 4 Wave 4 + 4 Wave 5 + 4 Wave 6 + 7 Wave 7 + 4 Wave 8 + 4 Wave 9 + 4 Wave 10 + 1 Wave 11 + 0 Wave 12) |
| Agents completed | 50 (100%) |
| Total commits | 160+ |
| Lines added | 69,000+ |
| Tests added | 2,063+ |
| Total tests passing | 4,699 |

### Wave Summary

| Wave | Branches | Lines | Tests | Duration | Components |
|------|----------|-------|-------|----------|------------|
| 1 | 8 | ~12,000 | 430 | 3 hrs | Userutil core, Donkey engine, VM connector |
| 2 | 6 | ~13,000 | 359 | 3 hrs | Database, Attachments, Channels, XSLT |
| 3 | 4 | ~5,000 | 140 | 1.5 hrs | Simple utils, validation P3/P4, MessageServlet |
| 4 | 4 | ~12,700 | 305 | 4 hrs | SMTP, JMS, WebService, advanced plugins |
| 5 | 4 | ~11,500 | 141 | 5 hrs | HL7v3, NCPDP, DICOM, validation P5 |
| 6 | 4 | ~1,000 | 16 | 12 min | **Dual Operational Modes** (SchemaManager, mode integration) |
| 7 | 7 | ~10,600 | 417 | ~30 min | **Git-Backed Artifact Management** (decomposer, git, promotion, API, CLI) |
| 8 | 4 | ~1,700 | 61 | ~20 min | **JavaScript Runtime Parity** (ScriptBuilder, ScopeBuilder, E4X, XMLProxy, XmlUtil, JsonUtil, Lists, Maps) |
| 9 | 4 | ~300 | 19 | ~15 min | **JavaScript Runtime Parity** (E4X filter predicates, wildcards, CDATA, for-each bare vars) |
| 10 | 4 | ~250 | 42 | ~3 min | **JavaScript Runtime Parity** (ResponseMap d#, ChannelMap, validate regex, createSegment, namespace) |
| 11 | 1 | ~200 | 28 | ~10 min | **JS Runtime Checker Mop-Up** (destinationIdMap wiring, response transformer template, createSegmentAfter, getAttachments default, validate type-check, XMLList transpilation) |
| 12 | 0 | ~200 | 38 | ~5 min | **JS Runtime Parity** (getMergedConnectorMessage, filter == true, attachments in filter/transformer, code templates in all generators, AlertSender context, SourceMap.put) |
| **Total** | **50** | **~69,000** | **2,063** | **~19 hrs** | |

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

**24. Java `String.replaceAll()` is Regex-Based (Wave 10)**
Java's `String.replaceAll(pattern, replacement)` treats the first argument as a **regex pattern**. JavaScript's `String.replaceAll()` treats it as a literal string. Any generated code that uses `replaceAll` for Java parity must use `String.replace(new RegExp(pattern, 'g'), replacement)` instead:
```typescript
// ❌ Wrong - JavaScript replaceAll treats first arg as literal
result = result.replaceAll(entry[0], entry[1]);

// ✅ Correct - matches Java's regex-based replaceAll
result = result.replace(new RegExp(entry[0], 'g'), entry[1]);
```
This affects `validate()` replacement patterns and any other Java-ported code that uses `replaceAll`.

**25. Map containsKey() vs get() Semantics Differ by Design (Wave 10)**
Java's `ChannelMap.containsKey()` deliberately does NOT check sourceMap, while `get()` DOES fall back to sourceMap with a deprecation warning. This is intentional — `containsKey()` answers "is this key in the channel map?" while `get()` provides backward-compatible access. When porting Java maps with fallback behavior, always verify that `containsKey()` and `get()` have the correct (and potentially different) lookup semantics:
```typescript
// ❌ Wrong - containsKey checks sourceMap (makes $() function find keys in wrong map)
override containsKey(key: string): boolean {
  return this.data.has(key) || this.sourceMap.containsKey(key);
}

// ✅ Correct - matches Java: only check delegate
override containsKey(key: string): boolean {
  return this.data.has(key);
}
```

**26. Sandbox Timer Functions Must Be Explicitly Disabled (Wave 10)**
Node.js `vm.createContext()` does not automatically exclude `setTimeout`/`setInterval`/`setImmediate`/`queueMicrotask`. User scripts can use these to schedule code that persists after the `vm.Script` timeout, causing memory leaks or DoS. Always set them to `undefined` in the scope:
```typescript
setTimeout: undefined,
setInterval: undefined,
setImmediate: undefined,
queueMicrotask: undefined,
```

**27. ResponseMap Destination Name Lookup Pattern (Wave 10)**
Java's `ResponseMap` uses a `destinationIdMap` to translate destination names (e.g., "HTTP Sender") to metadata ID keys (e.g., "d1"). Both `get()` and `containsKey()` must implement this fallback. This is one of the most common patterns in postprocessor scripts — `$r('HTTP Sender')` must resolve to the response stored under `d1`:
```typescript
override get(key: string): unknown {
  let value = this.data.get(key);
  if (value === undefined && this.destinationIdMap.has(key)) {
    value = this.data.get(`d${this.destinationIdMap.get(key)}`);
  }
  return value;
}
```

**28. Automated Cross-Codebase Scanning Catches "Implemented but Not Wired" Bugs (Wave 11)**
The `js-runtime-checker` agent found 17 gaps that manual review missed over 3 prior waves. The most critical pattern: code that **exists** but **isn't connected**. For example, `destinationIdMap` was available on `ConnectorMessage` but never passed to `ResponseMap` during scope construction — so `$r('HTTP Sender')` silently returned `undefined`. Similarly, `buildResponseTransformerScope` accepted a `template` parameter in Java but the Node.js port omitted it, causing `ReferenceError` in response transformers that reference `template`. These "wiring gaps" are invisible to unit tests (which mock the scope) but break real channels:
```typescript
// ❌ Before — destinationIdMap exists on ConnectorMessage but never reaches ResponseMap
const responseMap = new ResponseMap(connectorMessage.getResponseMap());

// ✅ After — wired through to enable $r('Destination Name') → d# lookup
const destinationIdMap = connectorMessage.getDestinationIdMap?.();
const responseMap = new ResponseMap(connectorMessage.getResponseMap(), destinationIdMap);
```
Lesson: after manual porting waves, run automated inventory-based scanning to catch integration gaps.

**29. Java's getAttachments() No-Args Defaults to false (Wave 11)**
Java's `Attachment.getAttachments(base64Decode)` defaults to `false` when called with no args — attachments are returned as-is without base64 decoding. The Node.js port had `base64Decode !== false` which inverted this (no-args → `true` → decode). The fix: `!!base64Decode || false`. This is subtle because most test channels don't use attachments, so the bug only surfaces in production attachment-heavy channels.

**30. validate() Type Guards Must Match Java (Wave 11)**
Java's `validate()` only applies regex replacement patterns to `String` and `XML` types. The Node.js port applied replacements to all types including numbers, which could corrupt numeric fields. The fix adds an explicit type check before the replacement loop:
```javascript
if ('string' === typeof result ||
    (typeof result === 'object' && result != null && typeof result.toXMLString === 'function')) {
  // Only apply replacements to strings and XML objects
}
```

**31. Postprocessor Requires Merged Connector Message, Not Source (Wave 12)**
Java's `getMergedConnectorMessage()` creates a synthetic ConnectorMessage merging maps from ALL connectors (source + destinations). Without it, `$r('HTTP Sender')` in postprocessor scripts returns `undefined` because the source connector's responseMap doesn't contain destination responses. The merged message also needs a `destinationIdMap` (connectorName → metaDataId) to bridge human-readable names ("HTTP Sender") to internal keys ("d1"):
```typescript
// ❌ Before — only source connector's maps visible
const mergedConnectorMessage = message.getSourceConnectorMessage();

// ✅ After — merged maps from source + all destinations
const mergedConnectorMessage = message.getMergedConnectorMessage();
// Now $r('HTTP Sender') → destinationIdMap → d1 → response data
```
This is one of the most common patterns in production Mirth channels.

**32. Java's Filter Rule `== true` Is a Deliberate Type Guard (Wave 12)**
Java wraps each filter rule call with `== true`: `(filterRule1() == true)`. JavaScript's loose equality `"accept" == true` evaluates to `false`, which matches Java's `Boolean.TRUE.equals("accept")`. Without this wrapping, Node.js filter rules accept any truthy value, diverging from Java behavior:
```typescript
// ❌ Before — truthy strings like "accept" pass the filter
const expr = `filterRule${i + 1}()`;

// ✅ After — matches Java: only boolean true passes
const expr = `(filterRule${i + 1}() == true)`;
```

**33. Code Templates Must Be Available in ALL Script Contexts (Wave 12)**
Java's `generateScript()` pipeline unconditionally calls `appendCodeTemplates()` for every script type. The Node.js port only included code templates in `generateScript()`, `generateDeployScript()`, and `generateUndeployScript()` — missing filter/transformer, response transformer, preprocessor, and postprocessor. This means shared utility functions (date formatters, HL7 helpers, validation functions) from code template libraries throw `ReferenceError` in the most commonly used script types.

**34. AlertSender Connector Context Requires Override in Connector Scope (Wave 12)**
Java's `addConnectorMessage()` creates AlertSender with the full `ImmutableConnectorMessage`, providing `channelId`, `metaDataId`, and `connectorName`. The Node.js port created AlertSender with only `channelId` in `buildChannelScope()` and never overrode it in `buildConnectorMessageScope()`. Alert events from connector scripts lacked `metaDataId` and `connectorName`, making it impossible to identify which connector triggered the alert.

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

### Wave 7: Git-Backed Artifact Management (2026-02-08)

**Config-as-code for Mirth Connect — git sync, env promotion, delta deploys.**

7 agents across 4 sub-waves, all using git worktrees for parallel development. Zero merge conflicts.

| Agent | Branch | Phase | Tests | Duration |
|-------|--------|-------|-------|----------|
| decomposer | `feature/artifact-decomposer` | 1 (Core) | 66 | ~10 min |
| env-resolver | `feature/artifact-env-resolver` | 3 (Env Vars) | 50 | ~8 min |
| diff-engine | `feature/artifact-diff-engine` | 8 (Diff) | 63 | ~8 min |
| git-layer | `feature/artifact-git-layer` | 2 (Git) | 42 | ~12 min |
| delta-deploy | `feature/artifact-delta-deploy` | 6 (Delta) | 45 | ~10 min |
| promotion | `feature/artifact-promotion` | 4+5 (Promotion) | 77 | ~15 min |
| api-cli | `feature/artifact-api-cli` | 7 (API+CLI) | 74 | ~12 min |

**Key deliverables:**
- `src/artifact/` module: 20 source files, ~5,400 lines
- Lossless channel XML decompose/assemble round-trip
- Shell-based GitClient, GitSyncService, GitWatcher
- VariableResolver with priority chain (process.env → YAML → defaults)
- PromotionPipeline with VersionCompatibility guards (E4X/ES6 detection)
- DeltaDetector with dependency cascades
- ChannelDiff with structural + unified script diff
- ArtifactServlet with 14 REST endpoints
- CLI with 9 subcommands (export, import, diff, secrets, deps, promote, deploy, rollback, git)
- D_ARTIFACT_SYNC table in SchemaManager
- 14 test suites, 417 tests passing

### Wave 8: JavaScript Runtime Parity Fixes (2026-02-10)

**Closes 17 CRITICAL/MAJOR gaps between Java Mirth Rhino/E4X runtime and Node.js port.**

4 parallel agents coordinated via team "js-runtime-parity". All modifications to shared files (ScriptBuilder, ScopeBuilder, E4XTranspiler, XMLProxy) done by dedicated agents.

| Agent | Scope | Changes | Tests | Duration |
|-------|-------|---------|-------|----------|
| scriptbuilder-agent | ScriptBuilder.ts | 7 fixes (helpers, $(), $cfg, phase, serialization, attachments, validate) | 27 | ~5 min |
| scopebuilder-agent | ScopeBuilder.ts | 4 fixes (19 userutil imports, destinationSet, phase array, real VMRouter) | 19 | ~5 min |
| e4x-agent | E4XTranspiler.ts + XMLProxy.ts | 5 fixes (attr write, += append, deleteProperty, text, elements) | 11 | ~5 min |
| userutil-agent | 4 new files + index.ts | XmlUtil, JsonUtil, Lists/ListBuilder, Maps/MapBuilder | 4 suites | ~5 min |

**Key fixes:**
- ScriptBuilder: `$()` lookup order matches Java (responseMap first, configurationMap last), `$cfg()` supports put, `phase[0]` array syntax, auto-serialization after doTransform(), attachment functions delegate to AttachmentUtil, type coercion helpers
- ScopeBuilder: 19 userutil classes injected into scope (was missing `importPackage()` equivalent), `destinationSet` injected for source connectors, placeholder VMRouter/AlertSender replaced with real implementations
- E4XTranspiler: Attribute write `.@attr = value` → `.setAttr()`, XML append `+=` operator
- XMLProxy: Named property `delete` via `removeChild()`, `text()` and `elements()` E4X methods
- New userutil: XmlUtil (prettyPrint, encode/decode, toJson), JsonUtil (prettyPrint, escape, toXml), Lists/Maps (fluent builders matching Java Collections-style API)
- 8 new test files, 61 parity tests, 4,505 total tests passing

### Wave 9: JavaScript Runtime Parity Fixes (2026-02-10)

**Closes 19 CRITICAL/MAJOR gaps in E4X transpilation and XMLProxy.**

4 parallel agents. Focused on E4X transpiler patterns not covered in Wave 8.

| Agent | Scope | Changes | Tests | Duration |
|-------|-------|---------|-------|----------|
| e4x-filter-agent | E4XTranspiler.ts | Filter predicates `msg.OBX.(condition)`, wildcards `.@*`/`.*` | 7 | ~5 min |
| e4x-misc-agent | E4XTranspiler.ts | Bare variable for-each, variable namespace decl, comment safety | 5 | ~5 min |
| xmlproxy-agent | XMLProxy.ts | `filter()` method, CDATA preservation, `comments()`/`processingInstructions()` stubs | 4 | ~3 min |
| userutil-agent | XmlUtil, JsonUtil | `toJson()` 7-param overload, `toXml()` options | 3 | ~2 min |

**Key fixes:**
- E4XTranspiler: Filter predicates `msg.OBX.(OBX.3 == 'WBC')` → `.filter()`, wildcard operators `.@*`→`.attributes()` and `.*`→`.children()`, bare variable for-each, string/comment safety
- XMLProxy: `filter(predicate)` for transpiled predicates, CDATA preservation via `__cdata`, `comments()` and `processingInstructions()` stubs
- 19 parity tests, 4,505 → 4,591 total tests passing

### Wave 10: JavaScript Runtime Parity Fixes (2026-02-11)

**Closes 14 confirmed gaps (5 critical, 6 major, 3 minor) in core script execution paths.**

4 parallel agents, one per source file. No cross-file dependencies. ~3 minutes wall time.

| Agent | Source File | Test File | Fixes | Tests |
|-------|------------|-----------|-------|-------|
| mirthmap-agent | MirthMap.ts | MirthMap.test.ts | 3 (ResponseMap d#, ChannelMap containsKey, get warning) | 8 |
| scriptbuilder-agent | ScriptBuilder.ts | ScriptBuilder.parity.test.ts | 6 (createSegment, validate regex, deploy helpers, importPackage, attachmentIds, undeploy) | 14 |
| scopebuilder-agent | ScopeBuilder.ts | ScopeBuilder.parity.test.ts | 4 (SerializerFactory, postprocessor response, sandbox timers, attachment scope) | 12 |
| xmlproxy-agent | XMLProxy.ts | XMLProxy.parity.test.ts | 1 (namespace xmlns extraction) | 6 |

**Key fixes:**
- MirthMap: ResponseMap `d#` destination name lookup via `destinationIdMap` (enables `$r('HTTP Sender')` pattern), ChannelMap `containsKey()` no longer checks sourceMap (matches Java), `get()` logs deprecation error on sourceMap fallback
- ScriptBuilder: `createSegment(name, msgObj, index)` now assigns to parent via `msgObj[name][index]` (was creating detached nodes), `validate()` uses `new RegExp(entry[0], 'g')` for replacement (Java's `replaceAll` is regex-based), deploy/undeploy scripts include all map functions + misc helpers (was missing `$co`, `$c`, `$s`, `$r`, `validate()`, `createSegment()`), `importPackage()` Rhino shim, `getAttachmentIds()` 2-arg overload routes to `(channelId, messageId)`, undeploy uses proper `doUndeploy` wrapper
- ScopeBuilder: `SerializerFactory` injected into scope, `buildPostprocessorScope()` accepts optional `response` parameter (Java overload), sandbox timer functions (`setTimeout`/`setInterval`/`setImmediate`/`queueMicrotask`) set to `undefined`, new `buildAttachmentScope()` for attachment processing scripts
- XMLProxy: `namespace('')` extracts default namespace URI from `xmlns` attribute, `namespace('prefix')` extracts from `xmlns:prefix`
- 42 new parity tests, 935 JS runtime tests, 4,633 total tests passing

### Wave 11: JS Runtime Checker Mop-Up Scan (2026-02-11)

**Automated cross-codebase scan using `js-runtime-checker` agent. Found 17 gaps, fixed 8, deferred 9 minor.**

Single `js-runtime-checker` agent ran a full inventory of 34 Node.js source files against Java Mirth's Rhino/E4X codebase (JavaScriptBuilder.java, JavaScriptScopeUtil.java, 46 userutil files). Unlike Waves 8-10 which used manual comparison, this wave used automated cross-reference scanning across all 10 bug categories.

| Finding | File | Fix | Tests |
|---------|------|-----|-------|
| JRC-SVM-001 (critical) | ScopeBuilder.ts | Wire `destinationIdMap` from ConnectorMessage to ResponseMap — enables `$r('Destination Name')` | 3 |
| JRC-SVM-002 (critical) | ScopeBuilder.ts | Add `template` parameter to `buildResponseTransformerScope` — prevents ReferenceError | 3 |
| JRC-SVM-003 (major) | ScopeBuilder.ts | Add `buildMessageReceiverScope`, `buildMessageDispatcherScope`, `buildBatchProcessorScope` | 4 |
| JRC-SBD-001 (major) | ScriptBuilder.ts | `createSegmentAfter` walks to root and returns tree node (matching Java exactly) | 3 |
| JRC-SBD-002 (major) | ScriptBuilder.ts | `getAttachments()` no-args defaults to false (no decode) matching Java | 2 |
| JRC-SBD-003 (major) | ScriptBuilder.ts | `validate()` type-checks before applying replacements (strings/XML only) | 2 |
| JRC-SBD-004 (major) | ScriptBuilder.ts | Attachment functions always included in all script types (unconditional) | 5 |
| JRC-ETG-001 (major) | E4XTranspiler.ts + XMLProxy.ts | `new XMLList()` and `XMLList()` transpiled to `XMLProxy.createList()` | 6 |

**Deferred (9 minor):** convenience vars (`regex`, `xml`, `xmllist`), `importClass` deprecation log, `useAttachmentList` variant, unmodifiable sourceMap copy, Response wrapping, ImmutableResponse wrapping, logger phase name, `Namespace()`/`QName()` constructors, script timeout mechanism.

**Key insight:** The most dangerous bugs were "wiring gaps" — code that existed in isolation but wasn't connected at the integration point (e.g., `destinationIdMap` on ConnectorMessage never passed to ResponseMap constructor in scope builder). These are invisible to unit tests that mock scope construction.

- 28 new parity tests, 963 JS runtime tests, 4,661 total tests passing
- Full scan report archived at `plans/js-runtime-checker-scan.md`

### Wave 12: JS Runtime Parity Fixes (2026-02-11)

**Follow-up scan found 6 remaining gaps (1 critical, 4 major, 1 minor) in core script execution paths.**

Direct implementation without parallel agents — all changes made to 4 source files + 4 test files.

| Finding | Severity | File | Fix | Tests |
|---------|----------|------|-----|-------|
| JRC-SBD-008 | **Critical** | Message.ts, ScopeBuilder.ts | `getMergedConnectorMessage()` — merges maps from ALL connectors for postprocessor; enables `$r('HTTP Sender')` | 10 |
| JRC-SBD-009 | Major | ScriptBuilder.ts | Filter rule `== true` wrapping — prevents truthy non-booleans from passing filter | 3 |
| JRC-SBD-010 | Major | ScriptBuilder.ts | Attachment functions (`getAttachments`, `addAttachment`, etc.) added to filter/transformer and response transformer scripts | 6 |
| JRC-SBD-011 | Major | ScriptBuilder.ts | Code templates included in filter/transformer, response transformer, preprocessor, and postprocessor generators | 9 |
| JRC-SVM-004 | Major | ScopeBuilder.ts | AlertSender in connector scope overridden with connector-message-aware version (metaDataId + connectorName) | 2 |
| JRC-TCD-004 | Minor | MirthMap.ts | SourceMap.put() warning removed — Java SourceMap.put() is a plain delegate | 3 |

**Key fix:** The most impactful change is `getMergedConnectorMessage()`. Java's postprocessor creates a synthetic ConnectorMessage that unions channelMap and responseMap from ALL connectors (source + destinations). It also builds a `destinationIdMap` (connectorName → metaDataId) enabling the ubiquitous `$r('HTTP Sender')` pattern. Without this, postprocessor scripts silently received `undefined` for all destination responses.

**Files modified:**
| File | Changes |
|------|---------|
| `src/model/ConnectorMessage.ts` | Added `destinationIdMap` field with getter/setter |
| `src/model/Message.ts` | Added `getMergedConnectorMessage()` method |
| `src/javascript/runtime/ScriptBuilder.ts` | Filter `== true`, attachment functions in 2 generators, code templates in 4 generators |
| `src/javascript/runtime/ScopeBuilder.ts` | Postprocessor uses merged message, AlertSender override in connector scope |
| `src/javascript/userutil/MirthMap.ts` | Removed SourceMap.put() warning |

- 38 new parity tests, 1,001 JS runtime tests, 4,699 total tests passing

### Completion Status

All Waves 1-12 are complete. The porting project has reached production-ready status:

**Completed (Waves 1-12):**
- ✅ 32/32 Userutil classes (100%) — including XmlUtil, JsonUtil, Lists/ListBuilder, Maps/MapBuilder
- ✅ 11/11 Connectors (HTTP, TCP, MLLP, File, SFTP, S3, JDBC, VM, SMTP, JMS, WebService, DICOM)
- ✅ 9/9 Data Types (HL7v2, XML, JSON, Raw, Delimited, EDI, HL7v3, NCPDP, DICOM)
- ✅ 15/15 Plugins (JavaScriptRule, JavaScriptStep, Mapper, MessageBuilder, XSLT, ServerLog, DashboardStatus, DataPruner, etc.)
- ✅ All Priority 0-6 validation scenarios
- ✅ **Dual Operational Modes** — The only difference between Java and Node.js Mirth
- ✅ **Git-Backed Artifact Management** — Decompose/assemble, git sync, env promotion, delta deploy, structural diff (417 tests)
- ✅ **JavaScript Runtime Parity** — Full parity with Java Mirth Rhino/E4X runtime across 5 waves of fixes (Waves 8-12, 188 parity tests, verified by automated js-runtime-checker scan)

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
