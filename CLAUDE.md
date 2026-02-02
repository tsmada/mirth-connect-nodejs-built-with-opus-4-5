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

**Key Commands:**
```bash
mirth-cli login --user admin      # Authenticate
mirth-cli channels                 # List channels with status
mirth-cli channels start <name>   # Start by name (not just ID!)
mirth-cli messages <channelId> --status E  # Find errors
mirth-cli send hl7 localhost:6662 @test.hl7  # Send test message
mirth-cli dashboard               # Interactive real-time view
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
Using existing Mirth MySQL schema - do NOT modify tables.
Per-channel tables: D_M{id}, D_MM{id}, D_MC{id}, D_MA{id}, D_MS{id}, D_MSQ{id}

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

### Validation Status (as of 2026-02-01)

| Priority | Category | Status | Notes |
|----------|----------|--------|-------|
| 0 | Export Compatibility | ✅ Passing | Channel round-trip works |
| 1 | MLLP Message Flow | ✅ Passing | 3/3 tests, minor ACK format gaps |
| 2 | JavaScript Runtime | 🟡 In Progress | E4X transpiler verified |
| 3-5 | Connectors/Data Types/Advanced | ⏳ Pending | Scenarios defined |

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
