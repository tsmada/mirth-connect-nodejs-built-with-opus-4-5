[← Back to README](../README.md)

# Database Schema & Engine Behavior

This project uses the **existing Mirth MySQL schema** — no modifications required in takeover mode.

## Operational Mode Database Behavior

| Mode | Core Tables | Channel Tables | User Data |
|------|-------------|----------------|-----------|
| **Takeover** | Verifies existing schema | Uses existing tables | Preserves all users |
| **Standalone** | Creates with `IF NOT EXISTS` | Auto-creates on deploy | Seeds admin/admin |

## Core Tables (Created in Standalone Mode)

| Table | Purpose |
|-------|---------|
| `SCHEMA_INFO` | Version tracking (3.9.1) |
| `CHANNEL` | Channel definitions |
| `CONFIGURATION` | Server settings |
| `PERSON` / `PERSON_PASSWORD` | User accounts |
| `EVENT` | Audit log |
| `ALERT` | Alert definitions |
| `CODE_TEMPLATE` / `CODE_TEMPLATE_LIBRARY` | Templates |
| `CHANNEL_GROUP` | Channel groupings |
| `SCRIPT` | Global scripts |
| `D_CHANNELS` | Channel ID → local ID mapping |
| `D_SERVERS` | Cluster node registry (Node.js-only) |
| `D_CHANNEL_DEPLOYMENTS` | Channel → instance deployment tracking (Node.js-only) |
| `D_CLUSTER_EVENTS` | Inter-node event bus via DB polling (Node.js-only) |
| `D_GLOBAL_MAP` | Shared global map for clustered mode (Node.js-only) |
| `D_ARTIFACT_SYNC` | Git artifact sync tracking — commit ↔ revision mapping (Node.js-only) |

## Per-Channel Tables (Auto-Created on Deploy)

Each channel creates dynamic tables when deployed:

| Table | Purpose |
|-------|---------|
| `D_M{id}` | Messages |
| `D_MM{id}` | Message metadata |
| `D_MC{id}` | Message content |
| `D_MA{id}` | Message attachments |
| `D_MS{id}` | Message statistics |
| `D_MSQ{id}` | Message sequence |
| `D_MCM{id}` | Custom metadata (user-defined fields) |

**Note**: In takeover mode, existing channel tables are reused. In standalone mode, tables are created automatically when a channel is deployed.

---

## Engine Behavior Differences from Java Mirth

The Node.js engine maintains 100% API compatibility with the Java Mirth Administrator, but includes a few behavioral differences and extensions. These are documented here for compatibility awareness.

### Additive Changes (Backward Compatible)

| Change | Behavior | Compatibility |
|--------|----------|---------------|
| **SourceMap Persistence** | Node.js persists `sourceMap` data to the `D_MC` table (as `CONTENT_TYPE=14`) after message processing. Java Mirth keeps sourceMap in memory only. | Additive — Java Mirth ignores the extra `D_MC` rows. Does not affect message processing. |
| **Trace API** | New endpoint `GET /api/messages/trace/:channelId/:messageId` for cross-channel message tracing. | Extension — does not exist in Java Mirth. Does not affect existing API endpoints. |
| **Error Surfacing** | CLI passes `?returnErrors=true` on deploy/undeploy/start/stop operations. | Same as Java Mirth Administrator GUI behavior. Java API default (no param) silently swallows errors. |
| **Cluster Tables** | 4 new tables (D_SERVERS, D_CHANNEL_DEPLOYMENTS, D_CLUSTER_EVENTS, D_GLOBAL_MAP) created in standalone mode or when cluster is enabled. | Additive — Java Mirth ignores unknown tables. Safe in shared databases. |
| **Health Endpoints** | `GET /api/health/*` endpoints for orchestrator probes. No auth required. | Extension — Java Mirth does not have these endpoints. |
| **Cluster API** | `GET /api/system/cluster/*` endpoints for node status and aggregated statistics. | Extension — not related to Java Mirth's clustering plugin endpoints. |
| **Shadow Mode** | When `MIRTH_SHADOW_MODE=true`, channels deploy in read-only state. Operator promotes channels one-by-one for safe cutover from Java Mirth. | Extension — Java Mirth has no equivalent. Does not affect normal operation when disabled (default). |
| **Graceful Shutdown** | SIGTERM triggers drain + deregister sequence instead of immediate exit. | Behavioral improvement — Java Mirth has similar graceful shutdown in its shutdown hook. |
| **Block Sequence IDs** | SequenceAllocator pre-allocates 100 IDs per lock instead of 1. | Compatible — produces valid non-contiguous IDs. Gaps are harmless (IDs need only be unique). |
| **Artifact Sync Table** | `D_ARTIFACT_SYNC` table tracks git sync operations (commit hash ↔ channel revision). | Additive — Java Mirth ignores unknown tables. Safe in shared databases. |
| **Artifact API** | 14 REST endpoints under `/api/artifacts/*` for git-backed config management. | Extension — Java Mirth has no equivalent. Does not affect existing API endpoints. |
| **Data Pruner Operational** | DataPruner is wired into server lifecycle, runs on schedule, reads per-channel pruning settings, skips in-flight messages (`PROCESSED=0`), cleans D_MCM tables, persists config to CONFIGURATION table, and prunes old audit events. | Matches Java Mirth behavior. Archive-before-delete phase not yet connected (planned). |

### Bug Fixes Applied

| Fix | Java Mirth Behavior | Node.js Behavior | Impact |
|-----|---------------------|-------------------|--------|
| **ContentType Enum** | `SOURCE_MAP = 14` in the engine (correct) | Fixed API layer to also use `SOURCE_MAP = 14` (was incorrectly `15` in the API models layer) | Ensures sourceMap content queries work correctly. The Java engine was not affected because its API layer uses a different code path. |

### Node.js-Only Extensions

These features exist only in the Node.js engine and have no Java Mirth equivalent:

| Feature | Description | API Endpoint |
|---------|-------------|-------------|
| Cross-Channel Trace | Reconstructs complete message journey across VM-connected channels | `GET /api/messages/trace/:channelId/:messageId` |
| Interactive Dashboard | Terminal-based real-time channel monitoring via Ink/React | CLI: `mirth-cli dashboard` |
| Message Trace CLI | CLI command to trace messages with tree visualization | CLI: `mirth-cli trace <channel> <messageId>` |
| Shadow Mode | Safe read-only takeover with progressive per-channel cutover | `GET/POST /api/system/shadow/*` |
| Shadow Mode CLI | CLI commands for shadow status, promote, demote, cutover | CLI: `mirth-cli shadow <command>` |
| Container-Native Clustering | Horizontal scaling without clustering plugin | `GET /api/system/cluster/*` |
| Health Probes | Readiness/liveness/startup for orchestrators | `GET /api/health/*` |
| Block Sequence Allocation | Pre-allocated message IDs for reduced DB contention | Internal (SequenceAllocator) |
| Database-Backed GlobalMap | Shared global map across instances via D_GLOBAL_MAP | Internal (MapBackend) |
| Git Artifact Sync | Git-backed config management, decompose/assemble, export/import | `GET/POST /api/artifacts/*` |
| Artifact CLI | Export, import, diff, promote, deploy, rollback commands | CLI: `mirth-cli artifact <command>` |
| Environment Promotion | Dev → staging → prod workflow with version compatibility guards | `POST /api/artifacts/promote` |
| Delta Deploy | Deploy only changed artifacts with dependency cascades | `POST /api/artifacts/deploy` |
| Logging API | Runtime log level control with per-component debug | `GET/PUT/DELETE /api/system/logging/*` |

### How SourceMap Tracing Works

When messages flow through VM-connected channels (Channel Writer/Reader), the VM connector stores chain-tracking data in the sourceMap:
- `sourceChannelIds[]` — ordered list of channel IDs the message has traversed
- `sourceMessageIds[]` — corresponding message IDs at each hop

The Node.js engine persists this sourceMap to the `D_MC` table after message processing, enabling the trace API to reconstruct the full message journey by following these references backward (to find the root) and forward (to find all downstream destinations).

**Dependency graph**: The trace service builds a channel dependency graph by scanning all channel configurations for `transportName === 'Channel Writer'` destinations, scoping forward-trace queries to only relevant downstream channels.

**VM cross-channel routing** is fully operational: `ChannelBuilder` wires both `VmReceiver` (Channel Reader source) and `VmDispatcher` (Channel Writer destination), and the `EngineController` adapter is connected during deployment to enable runtime message dispatch between channels.

### Data Pruner

The Data Pruner runs as a scheduled background task that removes old messages from per-channel tables based on retention policies configured per channel. It is automatically started on server startup via `dataPrunerController.initialize()`.

**How it works:**

1. On each scheduled run (default: every 12 hours), the pruner builds a task queue by scanning all channels
2. Per-channel pruning settings are read from `ConfigurationController.getChannelMetadata()` — channels without explicit settings are skipped
3. Channels with `messageStorageMode=DISABLED` are skipped (no messages stored)
4. For each channel, messages older than the configured retention period are deleted in batches
5. In-flight messages (`PROCESSED=0`) are never pruned, preventing data loss during pipeline processing
6. All per-channel tables are cleaned: `D_M`, `D_MM`, `D_MC`, `D_MA`, `D_MCM` (custom metadata)
7. Old audit events can be pruned when `pruneEvents` is enabled with a `maxEventAge` setting
8. Configuration is persisted to the `CONFIGURATION` table and survives server restarts

**REST API:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/extensions/datapruner/status` | GET | Current pruner status (running, progress, last run) |
| `/api/extensions/datapruner/_start` | POST | Trigger a manual pruning run |
| `/api/extensions/datapruner/_stop` | POST | Stop a running pruning job |
| `/api/extensions/datapruner/config` | GET, PUT | Read/update pruner configuration |

**Remaining gap:** The `MessageArchiver` (archive-before-delete) is implemented but not yet connected to the pruning pipeline. See `plans/datapruner-archive-integration.md` for the integration plan.
