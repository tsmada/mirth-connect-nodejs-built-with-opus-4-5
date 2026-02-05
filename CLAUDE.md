# Mirth Connect Node.js Runtime

## Project Goal
Node.js/TypeScript replacement for Mirth Connect Java engine.
Must maintain 100% API compatibility with Mirth Connect Administrator.

## Architecture
- **Donkey Engine**: Message processing in `src/donkey/`
- **Connectors**: Protocol implementations in `src/connectors/`
- **JavaScript Runtime**: E4X transpilation in `src/javascript/`
- **REST API**: Express-based in `src/api/`
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
│   ├── send.ts                 # mllp, http, hl7 message sending
│   ├── server.ts               # info, status, stats
│   ├── events.ts               # list, search, errors
│   ├── config.ts               # get, set, list, reset
│   └── dashboard.ts            # Interactive Ink-based dashboard
├── ui/
│   └── (Ink React components for dashboard)
├── lib/
│   ├── ApiClient.ts            # REST API client
│   ├── ConfigManager.ts        # ~/.mirth-cli.json management
│   ├── OutputFormatter.ts      # Table/JSON output formatting
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
mirth-cli dashboard               # Interactive real-time view
```

**Alternative invocations (if not linked):**
```bash
node dist/cli/index.js <command>  # Direct invocation
npm run cli -- <command>          # Via npm script (note the --)
```

**Dependencies:** commander, chalk (v5+), ora (v8+), conf, ink, react

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

**Per-Channel Tables** (auto-created on deploy):
- `D_M{id}` - Messages
- `D_MM{id}` - Message metadata
- `D_MC{id}` - Message content
- `D_MA{id}` - Message attachments
- `D_MS{id}` - Message statistics
- `D_MSQ{id}` - Message sequence
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

Specialized subagents for complex workflows. See `agents/README.md` for full documentation.

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

See `agents/mirth-porter.md` for full specification.

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

See `agents/version-upgrader.md` for full specification.

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

See `agents/subtle-bug-finder.md` for full specification.

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
         ├──► [Worktree 2: feature/userutil-db]       → Agent 2 ⚠️ (permission issues)
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

**VM Connector (4 components):**
- VmConnectorProperties - Receiver/dispatcher configuration
- VmReceiver - Receive messages routed from other channels
- VmDispatcher - Route messages to other channels

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
- DataPruner enhancements - Complete archival/pruning configuration

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
One agent (userutil-db) had "Permission to use Read has been auto-denied" errors. This can happen when agents run in background mode with limited prompts. Solution: retry with explicit permissions or port manually.

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
- Remote I/O Utils (S3Util, FtpUtil, SftpUtil) - File connector already supports these
- Additional servlet test coverage
- Performance optimization for high-volume channels
- Kubernetes deployment manifests

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
