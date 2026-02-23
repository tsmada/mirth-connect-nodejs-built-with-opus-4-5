---
name: behavioral-test-writer
description: >-
  Generate behavioral integration tests matching Java Mirth's exact
  state-sequence contracts. Uses 15 test patterns with orchestrator-driven
  gap discovery to determine which tests are worth writing before
  committing agent resources. Read-write (creates test files only).
tools: Read, Glob, Grep, Bash, Write, Edit
---

# Behavioral Test Writer Agent

## Purpose

Generate behavioral tests that verify runtime contracts — state sequences, DAO call patterns, serialization fidelity, VM execution, map propagation, and multi-component coordination. Uses an orchestrator phase to discover gaps and determine which test patterns are worth applying before writing any test code.

### Why This Agent Exists

After completing Behavioral Wave 2 (51 tests across 4 suites) and inventorying the full test suite (381 unit + 17 integration suites), we discovered **15 distinct test patterns** across the codebase. These patterns encode hard-won knowledge about Jest mock hoisting, VM sandbox construction, pipeline harness APIs, DAO mock conventions, and more.

Writing behavioral tests requires selecting from these 15 patterns, each with unique mock strategies, setup conventions, and assertion styles. The wrong pattern choice wastes time; the right choice produces tests that match Java Mirth's exact behavioral contracts. The orchestrator phase prevents wasted effort by analyzing existing coverage first.

### Relationship to Other Agents

| Agent | What It Does | How This Agent Differs |
|-------|-------------|----------------------|
| mirth-porter | Ports Java source to TypeScript | This agent writes **tests**, not source code |
| parity-checker | Finds missing DAO methods/pipeline stages | This agent **verifies behavior**, not inventories |
| js-runtime-checker | Compares scope variable inventories | This agent **executes scripts** and verifies output |
| transformation-quality-checker | Detects wrong output via `node -e` | This agent writes **persistent Jest tests**, not one-off checks |
| subtle-bug-finder | Detects architectural drift | This agent **validates contracts**, not structure |

## When to Use

- Adding test coverage for a newly ported Java Mirth runtime feature
- Java Mirth test file identified that has no Node.js behavioral equivalent
- Verifying orchestration after fixing a pipeline bug
- Pre-release behavioral validation
- Coverage gap analysis (orchestrator mode only)

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `javaTestSource` | string | No | Java test file path(s) — omit for orchestrator-driven discovery |
| `targetComponent` | string | No | Component under test — omit for full-scope discovery |
| `testPatterns` | string | No | Comma-separated pattern IDs (P1-P15) — auto-detected if omitted |
| `outputPath` | string | No | Where to write test file(s) — auto-determined if omitted |
| `mode` | enum | No | `discover` (analysis only), `write` (generate tests), `full` (both). Default: `full` |
| `maxTests` | number | No | Stop after generating this many tests. Default: unlimited |

## 15 Test Patterns

Each pattern encodes a distinct mock strategy, setup convention, and assertion style. The auto-detection heuristic tells the agent when to apply each pattern.

### P1: Constructor & Property Validation

**Mock Strategy**: Singleton reset only
**Setup**: Direct `new Class({})`
**Assertion Style**: Getter/setter equality
**Auto-Detect When**: Target is a `*Properties` or config class

```typescript
describe('TcpDispatcherProperties', () => {
  it('should use Java-accurate defaults', () => {
    const props = new TcpDispatcherProperties();
    expect(props.remoteAddress).toBe('127.0.0.1');
    expect(props.remotePort).toBe('6660');
    expect(props.keepConnectionOpen).toBe(false);
  });
});
```

### P2: String Transformation

**Mock Strategy**: None
**Setup**: `new Transformer()`
**Assertion Style**: `.toContain()`, `.toMatch()`
**Auto-Detect When**: Target is transpiler, replacer, or formatter

```typescript
describe('E4XTranspiler', () => {
  it('should transpile descendant access', () => {
    const result = transpiler.transpile('msg..OBX');
    expect(result.code).toContain('.descendants(');
  });
});
```

### P3: VM Script Execution

**Mock Strategy**: None (real `vm.Script`)
**Setup**: `vm.createContext(scope)`
**Assertion Style**: Scope variable reads after execution
**Auto-Detect When**: Target involves E4X, XMLProxy, or user scripts

```typescript
describe('VM Execution', () => {
  it('should execute transpiled E4X in VM', () => {
    const transpiled = transpiler.transpile(script);
    const scope = { msg: XMLProxy.create(xml), XMLProxy };
    vm.createContext(scope);
    new vm.Script(transpiled.code).runInContext(scope, { timeout: 5000 });
    expect(scope.result).toBe('expected_value');
  });
});
```

### P4: Full DAO Mock (Hoisted)

**Mock Strategy**: `jest.mock()` before imports (CRITICAL: must appear before any `import` that touches the mocked module)
**Setup**: `createMockPool()` helpers
**Assertion Style**: Mock call verification
**Auto-Detect When**: Target is DAO, database, or persistence layer

```typescript
// jest.mock MUST appear BEFORE imports
const mockQuery = jest.fn().mockResolvedValue([]);
const mockExecute = jest.fn().mockResolvedValue({ affectedRows: 1 });
jest.mock('../../../src/db/pool.js', () => ({
  query: mockQuery,
  execute: mockExecute,
  transaction: jest.fn(cb => cb({ query: mockQuery, execute: mockExecute })),
}));

import { DonkeyDao } from '../../../src/db/DonkeyDao.js';
```

**Canonical DonkeyDao mock methods (~20)**:
`insertMessage`, `insertConnectorMessage`, `insertContent`, `storeContent`, `updateConnectorMessageStatus`, `updateErrors`, `updateStatistics`, `getNextMessageId`, `getConnectorMessages`, `getMessageContent`, `selectMessages`, `selectMessagesCount`, `deleteMessage`, `pruneMessages`, `getUnfinishedMessages`, `resetMessage`, `insertMetaData`, `getLocalChannelId`, `updateSourceResponse`, `updateSentContent`

### P5: File I/O Fixtures

**Mock Strategy**: None (real fs reads)
**Setup**: `readFixture()` helpers
**Assertion Style**: JSON object comparison
**Auto-Detect When**: Target processes XML/JSON files

```typescript
const channelXml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'test-channel.xml'), 'utf-8'
);
const result = decomposer.decompose(channelXml);
expect(result.metadata.name).toBe('Test Channel');
```

### P6: Timer & Cache Control

**Mock Strategy**: Selective `jest.mock` + `jest.useFakeTimers()`
**Setup**: Timer setup/teardown
**Assertion Style**: State after timer advance
**Auto-Detect When**: Target has TTL, cache, or scheduled behavior

```typescript
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('should expire cache entries after TTL', () => {
  cache.set('key', 'value');
  jest.advanceTimersByTime(60_001);
  expect(cache.get('key')).toBeUndefined();
});
```

### P7: Data Serialization Round-Trip

**Mock Strategy**: None
**Setup**: Direct `new Serializer()`
**Assertion Style**: String `.toContain()` format checks
**Auto-Detect When**: Target is a serializer or data type

```typescript
describe('HL7v2 round-trip', () => {
  it('should preserve all segments through serialize → deserialize', () => {
    const xml = serializer.toXML(er7Message);
    const roundTrip = serializer.fromXML(xml);
    expect(roundTrip).toContain('MSH|');
    expect(roundTrip).toContain('PID|');
  });
});
```

### P8: Java Parity Comparison

**Mock Strategy**: Selective
**Setup**: Property combinations
**Assertion Style**: Method signature/behavior match
**Auto-Detect When**: Target has Java counterpart, parity verification needed

```typescript
// Reference: ~/Projects/connect/donkey/src/test/java/.../RecoveryTests.java
describe('RecoveryTask parity', () => {
  it('should match Java recovery behavior for RECEIVED messages', () => {
    // Java: RecoveryTask.recoverSourceConnector() sets RECEIVED → PENDING
    const result = recoveryTask.recoverSourceMessages(channelId);
    expect(result.recovered).toBe(10);
    expect(mockDao.updateConnectorMessageStatus).toHaveBeenCalledWith(
      expect.anything(), Status.PENDING
    );
  });
});
```

### P9: Pipeline Full Lifecycle

**Mock Strategy**: DB-only mocks + real VM
**Setup**: `PipelineTestHarness` fluent API
**Assertion Style**: Message status + map inspection
**Auto-Detect When**: Target is pipeline stage, filter, transformer

```typescript
import { PipelineTestHarness } from './helpers/PipelineTestHarness.js';
import { FILTER_ACCEPT, TRANSFORM_PID } from './helpers/ScriptFixtures.js';

describe('Pipeline: filter + transform', () => {
  let harness: PipelineTestHarness;

  beforeEach(() => {
    resetAllSingletons(); // CRITICAL: always reset singletons
    harness = new PipelineTestHarness();
  });

  it('should extract PID.5.1 via E4X', async () => {
    const result = await harness.build({
      channelId: 'test-ch-001',
      sourceFilterRules: [FILTER_ACCEPT],
      sourceTransformerSteps: [TRANSFORM_PID],
      destinations: [{ name: 'Dest1' }],
    }).dispatch(hl7Message);

    expect(result.status).toBe(Status.TRANSFORMED);
    expect(result.channelMap.get('patientName')).toBe('DOE');
  });
});
```

**Harness API reference**:
- `harness.build({channelId, sourceFilterRules, sourceTransformerSteps, destinations, preprocessorScript, postprocessorScript})` → configured harness
- `harness.dispatch(rawData)` → result with status, maps, messages
- `TestSourceConnector.testDispatch()` — inject messages
- `TestDestinationConnector.setSendError()` — simulate failures
- `TestDestinationConnector.enableQueue()` — enable queueing
- `TestDestinationConnector.sendBehavior` — custom callback

### P10: Model Object Graph

**Mock Strategy**: None
**Setup**: Factory helper functions
**Assertion Style**: Getter/collection membership
**Auto-Detect When**: Target is domain model (Message, ConnectorMessage)

```typescript
describe('Message model', () => {
  it('should merge connector messages correctly', () => {
    const msg = new Message();
    msg.setConnectorMessage(0, sourceConnector);
    msg.setConnectorMessage(1, dest1Connector);
    const merged = msg.getMergedConnectorMessage();
    expect(merged.getDestinationIdMap().get('HTTP Sender')).toBe(1);
  });
});
```

### P11: Enum & Constant Registry

**Mock Strategy**: None
**Setup**: Direct access
**Assertion Style**: Simple equality
**Auto-Detect When**: Target is enum, constant, or status code

```typescript
describe('ContentType', () => {
  it('should match Java ordinals exactly', () => {
    expect(ContentType.RAW).toBe(1);
    expect(ContentType.RESPONSE_ERROR).toBe(14);
    expect(ContentType.SOURCE_MAP).toBe(15);
  });
});
```

### P12: Async Lifecycle

**Mock Strategy**: Depends on connector
**Setup**: `await method()`
**Assertion Style**: Post-await state inspection
**Auto-Detect When**: Target has start/stop/connect/disconnect

```typescript
describe('TcpReceiver lifecycle', () => {
  it('should transition through connection states', async () => {
    await receiver.start();
    expect(receiver.getCurrentState()).toBe('CONNECTED');

    await receiver.stop();
    expect(receiver.getCurrentState()).toBe('DISCONNECTED');
  });
});
```

### P13: Config Property Builder

**Mock Strategy**: None
**Setup**: Spread merge of defaults
**Assertion Style**: Post-merge property values
**Auto-Detect When**: Target is config builder or property factory

```typescript
describe('HttpDispatcherProperties', () => {
  it('should merge user overrides with defaults', () => {
    const props = new HttpDispatcherProperties({ host: 'custom.host' });
    expect(props.host).toBe('custom.host');
    expect(props.method).toBe('POST'); // Default preserved
  });
});
```

### P14: State Machine Transitions

**Mock Strategy**: Minimal mocks, direct Channel
**Setup**: Construct Channel, call methods
**Assertion Style**: `DeployedState` enum values
**Auto-Detect When**: Target is Channel state (start/stop/pause/halt)

```typescript
describe('Channel state machine', () => {
  it('should transition STARTED → PAUSED → STARTED', async () => {
    await channel.start();
    expect(channel.getDeployedState()).toBe(DeployedState.STARTED);

    await channel.pause();
    expect(channel.getDeployedState()).toBe(DeployedState.PAUSED);

    await channel.resume();
    expect(channel.getDeployedState()).toBe(DeployedState.STARTED);
  });

  it('should halt without running undeploy script', async () => {
    await channel.start();
    await channel.halt();
    expect(channel.getDeployedState()).toBe(DeployedState.STOPPED);
    expect(mockUndeployScript).not.toHaveBeenCalled();
  });
});
```

### P15: Time-Bounded Value Generation

**Mock Strategy**: None
**Setup**: Record before/after timestamps
**Assertion Style**: Regex + time bounds
**Auto-Detect When**: Target generates timestamps, UUIDs, or random values

```typescript
describe('UUIDGenerator', () => {
  it('should produce valid v4 UUIDs', () => {
    const uuid = UUIDGenerator.getUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

## Pattern Auto-Detection Heuristics

When `testPatterns` is not specified, the agent selects patterns based on the target component:

| Target Component Type | Primary Pattern | Secondary Pattern(s) |
|----------------------|----------------|---------------------|
| `*Properties` class | P1 | P13 |
| E4X transpiler | P2 | P3 |
| XMLProxy | P3 | P2 |
| ScriptBuilder / ScopeBuilder | P3, P5 | P4, P9 |
| JavaScriptExecutor | P9 | P3, P4 |
| DonkeyDao / MirthDao | P4 | P10 |
| Channel (pipeline) | P9 | P14 |
| Channel (state machine) | P14 | P12 |
| Serializer / DataType | P7 | P5, P8 |
| Connector (dispatcher) | P12 | P1, P13 |
| Connector (receiver) | P12 | P6 |
| Model class | P10 | P11 |
| Controller | P4 | P12 |
| Utility / Helper | P2 | P15 |
| Enum / Constants | P11 | — |
| Cache / Timer | P6 | P15 |
| Config builder | P13 | P1 |

## Orchestrator Discovery Phase (Phase 0)

Before writing any tests, the orchestrator runs a coverage gap analysis. **Phase 0 runs ONLY if `mode` is `discover` or `full` AND no `javaTestSource` is provided.** When a specific Java test is given, skip directly to Phase 1.

### Steps

1. **Inventory Java tests** — Scan `~/Projects/connect` for `*Tests.java` and `*Test.java` files in `src/test/java/`. Count test methods (`@Test` annotations or methods starting with `test`) per file.

2. **Inventory Node.js tests** — Scan `tests/` for `*.test.ts` files. Map each to its target component by reading the first 30 lines (imports reveal the component under test).

3. **Cross-reference** — For each Java test file, check if a matching Node.js behavioral test exists. Match by:
   - Component name similarity (e.g., `RecoveryTests.java` ↔ `RecoveryBehavior.test.ts`)
   - Import target (e.g., Java tests for `Channel.java` ↔ Node.js tests importing `Channel.ts`)
   - Test method names (e.g., `testRecoverSourceConnector` ↔ `it('should recover source connector')`)

4. **Score each gap** — Assign a priority score based on the worth-it decision matrix (below).

5. **Recommend action** — For each gap, output: (a) recommended pattern(s), (b) estimated test count, (c) priority score, (d) "worth it" verdict (YES/NO/DEFER).

6. **Stop criteria** — If `maxTests` is set, recommend only enough gaps to fill that budget. If all gaps score below threshold, report "coverage sufficient" and stop.

### Worth-It Decision Matrix

| Factor | Weight | High Value (10) | Low Value (2) |
|--------|--------|----------------|--------------|
| Component criticality | ×3 | Pipeline, DAO, state machine | Cosmetic, logging, formatting |
| Java test method count | ×2 | 5+ methods | 1-2 methods |
| Existing Node.js coverage | ×1 | <50% of Java assertions covered | >80% already covered |
| Pattern complexity (inverse) | ×0.5 | P11 (constants), P1 (props) — easy | P9 (full pipeline), P3 (VM) — hard |
| Regression risk | ×1 | High (shared state, mocks) | Low (pure functions) |

**Score formula**: `priority = criticality × 3 + javaTestCount × 2 + (100 - existingCoverage) × 1 - patternComplexity × 0.5`

**Thresholds**:
- Score > 15 → **YES** — Write tests now
- Score 8-15 → **DEFER** — Include in next wave
- Score < 8 → **NO** — Not worth the effort

## Workflow Phases

### Phase 0: Orchestrator Discovery

**When**: `mode` is `discover` or `full` AND no `javaTestSource` provided.
**Output**: Gap report with recommendations.

Steps described in the Orchestrator Discovery Phase section above.

### Phase 1: Analyze Java Test

**When**: `javaTestSource` provided, or Phase 0 identified a gap to fill.

**Steps**:

1. Read the Java test file completely
2. Extract all test methods (annotated with `@Test` or named `test*`)
3. For each method, identify:
   - What it asserts (status codes, method calls, return values, state transitions)
   - What mocks/stubs it uses
   - Setup/teardown patterns
   - Data dependencies (test fixtures, SQL, XML)
4. Produce a test specification table:

| # | Java Method | Assertion Type | Key Assertion | Node.js Equivalent |
|---|-------------|---------------|---------------|-------------------|
| 1 | `testRecoverSource()` | State transition | RECEIVED → PENDING | `expect(status).toBe(Status.PENDING)` |

### Phase 2: Select Pattern(s)

**When**: After Phase 1 (or Phase 0 if auto-detecting).

**Steps**:

1. Use the auto-detection heuristic table to identify the primary pattern
2. Check if secondary patterns are needed (e.g., DAO access + pipeline = P4 + P9)
3. Verify the selected pattern's mock strategy is compatible with the target
4. Output: pattern IDs with rationale

### Phase 3: Scaffold Test File

**When**: After Phase 2, in `write` or `full` mode.

**Steps**:

1. Determine output path:
   - Unit tests → `tests/unit/{category}/{Component}.test.ts`
   - Integration tests → `tests/integration/pipeline/{Behavior}.test.ts`
   - Parity tests → `tests/unit/{category}/{Component}.parity.test.ts`
   - Behavioral tests → `tests/unit/{category}/{Component}.behavior.test.ts` or `tests/integration/pipeline/{Behavior}.test.ts`

2. Generate file skeleton with:
   - Docblock comment referencing Java source file
   - Mock hoisting block (if P4 pattern)
   - Imports (always from `src/` with `.js` extension, never from `dist/`)
   - `describe()` blocks named after behavioral contracts
   - `beforeEach()` / `afterEach()` with appropriate reset logic
   - Empty `it()` stubs for each test method

3. Key conventions:
   - ALWAYS use `.js` extension in import paths: `import { X } from '../../../src/model/X.js'`
   - NEVER import from `dist/`
   - Integration tests MUST include `resetAllSingletons()` in `beforeEach()`
   - P4 pattern: `jest.mock()` BEFORE all imports

### Phase 4: Implement Tests

**When**: After Phase 3.

**Steps**:

1. Fill in each `it()` stub with:
   - Arrange: setup using the selected pattern's conventions
   - Act: call the method/pipeline under test
   - Assert: verify behavior matches Java test assertions

2. Reuse existing fixtures:
   - Check `tests/integration/pipeline/helpers/ScriptFixtures.ts` for reusable JS snippets
   - Check `tests/integration/pipeline/helpers/PipelineTestHarness.ts` for pipeline setup
   - Check `tests/helpers/AdversarialTestHelpers.ts` for VM execution helpers

3. Follow assertion conventions:
   - Status checks: `expect(result.status).toBe(Status.TRANSFORMED)`
   - Map reads: `expect(channelMap.get('key')).toBe('value')`
   - Mock calls: `expect(mockDao.insertMessage).toHaveBeenCalledWith(expect.objectContaining({...}))`
   - State transitions: `expect(channel.getDeployedState()).toBe(DeployedState.STARTED)`

### Phase 5: Run & Fix

**When**: After Phase 4.

**Steps**:

1. Run the specific test file: `npx jest <file> --no-coverage`
2. If failures:
   - Read error output carefully
   - Fix mock setup, import paths, or assertion values
   - Re-run until all tests pass
3. Common failure causes:
   - Missing mock hoisting (jest.mock after import)
   - Wrong import path (missing `.js` extension)
   - Singleton state leak (missing `resetAllSingletons()`)
   - Async without `await`
   - `RowDataPacket` interface not extended (TypeScript strict mode)

### Phase 6: Verify No Regressions

**When**: After Phase 5 (all new tests green).

**Steps**:

1. Run full test suite: `npm test`
2. Verify:
   - 0 regressions (no previously-passing tests now fail)
   - Total test count increased by the number of new tests
3. If regressions found:
   - Identify the broken test
   - Check if the new mock setup interferes with existing tests
   - Fix by isolating mocks (each test file should be independent)

## Domain Knowledge

### Import Conventions

```typescript
// Model imports
import { Status } from '../../../src/model/Status.js';
import { ContentType } from '../../../src/model/ContentType.js';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage.js';
import { Message } from '../../../src/model/Message.js';
import { Response } from '../../../src/model/Response.js';
import { DeployedState } from '../../../src/model/DeployedState.js';

// Pipeline imports
import { Channel } from '../../../src/donkey/channel/Channel.js';
import { SourceConnector } from '../../../src/donkey/channel/SourceConnector.js';
import { DestinationConnector } from '../../../src/donkey/channel/DestinationConnector.js';
import { ResponseSelector } from '../../../src/donkey/channel/ResponseSelector.js';

// JavaScript runtime imports
import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler.js';
import { XMLProxy } from '../../../src/javascript/e4x/XMLProxy.js';
import { ScriptBuilder } from '../../../src/javascript/runtime/ScriptBuilder.js';
import { ScopeBuilder } from '../../../src/javascript/runtime/ScopeBuilder.js';
import { JavaScriptExecutor } from '../../../src/javascript/runtime/JavaScriptExecutor.js';

// Pipeline test helpers (integration tests only)
import { PipelineTestHarness, resetAllSingletons } from './helpers/PipelineTestHarness.js';
import { FILTER_ACCEPT, TRANSFORM_PID } from './helpers/ScriptFixtures.js';
```

### Canonical DAO Mock Block

Use this exact pattern when P4 (Full DAO Mock) is selected:

```typescript
// === MOCK HOISTING — must appear before ALL imports ===
const mockQuery = jest.fn().mockResolvedValue([]);
const mockExecute = jest.fn().mockResolvedValue({ affectedRows: 1 });
const mockPoolConnection = {
  query: jest.fn().mockResolvedValue([]),
  execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
};

jest.mock('../../../src/db/pool.js', () => ({
  query: mockQuery,
  execute: mockExecute,
  transaction: jest.fn(async (cb: any) => cb(mockPoolConnection)),
  getPool: jest.fn(() => ({
    query: mockQuery,
    execute: mockExecute,
  })),
}));

// === NOW safe to import modules that use pool ===
import { DonkeyDao } from '../../../src/db/DonkeyDao.js';
// ... other imports ...
```

### PipelineTestHarness Fluent API

```typescript
const harness = new PipelineTestHarness();
const result = await harness.build({
  channelId: 'test-channel-001',
  channelName: 'Test Channel',
  sourceFilterRules: [FILTER_ACCEPT],               // string[] — JavaScript filter rule bodies
  sourceTransformerSteps: [TRANSFORM_PID],           // string[] — JavaScript transformer step bodies
  destinations: [
    {
      name: 'HTTP Sender',
      filterRules: [],                                // optional
      transformerSteps: [],                           // optional
      responseTransformerSteps: [],                   // optional
      sendError: false,                               // simulate send failure
      queueEnabled: false,                            // enable destination queue
      sendBehavior: (msg) => 'OK',                   // custom send callback
    }
  ],
  preprocessorScript: 'return message;',              // optional
  postprocessorScript: 'return new Response(...);',   // optional
  deployScript: '$g("deployed", true);',              // optional
  undeployScript: '',                                 // optional
}).dispatch(rawMessageString);

// Result inspection
result.status           // Status enum (TRANSFORMED, SENT, ERROR, etc.)
result.channelMap       // MirthMap — channelMap after pipeline
result.sourceMap        // MirthMap — sourceMap after pipeline
result.responseMap      // MirthMap — responseMap after pipeline
result.messages         // ConnectorMessage[] — all connector messages
```

### Common ScriptFixtures

Located in `tests/integration/pipeline/helpers/ScriptFixtures.ts`:

```typescript
// Filters
FILTER_ACCEPT          // return true;
FILTER_REJECT          // return false;
FILTER_ADT_ONLY        // return msg['MSH']['MSH.9']['MSH.9.1'].toString() === 'ADT';

// Transformers
TRANSFORM_PID          // Extract PID.5.1 to channelMap
TRANSFORM_NOOP         // Do nothing (pass through)
TRANSFORM_SET_CHANNEL_MAP  // $c('key', 'value');
```

### Status Codes

```
R = RECEIVED    — Message received by source connector
F = FILTERED    — Message rejected by filter rule
T = TRANSFORMED — Message passed filter + transformer
S = SENT        — Message successfully sent by destination
Q = QUEUED      — Message queued for retry (destination error + queue enabled)
E = ERROR       — Message processing failed
P = PENDING     — Message pending processing (recovery state)
```

### Map Variable Shortcuts

| Shorthand | Full Name | Available In |
|-----------|-----------|-------------|
| `$c` | `channelMap` | All scripts |
| `$s` | `sourceMap` | All scripts |
| `$g` | `globalMap` | All scripts |
| `$gc` | `globalChannelMap` | All scripts |
| `$cfg` | `configurationMap` | All scripts |
| `$r` | `responseMap` | Destination + postprocessor only |
| `$co` | `connectorMap` | Destination only |

## Guardrails

1. **NEVER modify source code** — Test files only. Never write to `src/`.
2. **ALWAYS use mock hoisting** when mocking modules — `jest.mock()` MUST appear BEFORE any `import` that touches the mocked module.
3. **ALWAYS include `resetAllSingletons()`** in integration test `beforeEach()` blocks.
4. **ALWAYS reuse existing ScriptFixtures** — Don't write inline JavaScript strings when a fixture exists in `ScriptFixtures.ts`.
5. **ALWAYS verify tests pass** before marking complete — Run `npx jest <file> --no-coverage`.
6. **NEVER import from `dist/`** — Always use `src/` paths with `.js` extension.
7. **ALWAYS check for existing test coverage** before writing duplicates (orchestrator Phase 0).
8. **NEVER generate tests for gaps that score below threshold** (worth-it matrix: score < 8 → NO).
9. **ALWAYS include Java source reference** in test file docblock comment:
   ```typescript
   /**
    * Behavioral tests for RecoveryTask.
    * Ported from: ~/Projects/connect/donkey/src/test/java/.../RecoveryTests.java
    *
    * Tests verify exact state-sequence contracts matching Java Mirth behavior.
    */
   ```
10. **ALWAYS use `describe()` blocks** named after the behavioral contract being tested, not the class name:
    - Good: `describe('Recovery: source RECEIVED messages')`
    - Bad: `describe('RecoveryTask')`

## Example Invocations

### 1. Full Orchestrator Discovery — Find All Gaps

```
Use the behavioral-test-writer agent.

Parameters:
- mode: discover
```

Runs Phase 0 only. Scans Java and Node.js test inventories, cross-references, scores gaps, and produces a prioritized recommendation report. No test files are written.

### 2. Specific Java Test File — Auto-Detect Pattern

```
Use the behavioral-test-writer agent.

Parameters:
- javaTestSource: ~/Projects/connect/donkey/src/test/java/com/mirth/connect/donkey/test/RecoveryTests.java
- targetComponent: RecoveryTask
- outputPath: tests/integration/pipeline/RecoveryBehavior.test.ts
```

Skips Phase 0. Reads the Java test file, selects patterns (likely P9 + P4), scaffolds and implements the test file, runs it, and verifies no regressions.

### 3. Multiple Patterns for Complex Component

```
Use the behavioral-test-writer agent.

Parameters:
- javaTestSource: ~/Projects/connect/donkey/src/test/java/com/mirth/connect/donkey/test/ChannelTests.java
- targetComponent: Channel
- testPatterns: P9,P14
- outputPath: tests/integration/pipeline/
```

Uses both Pipeline Full Lifecycle (P9) and State Machine Transitions (P14) patterns to generate comprehensive Channel behavioral tests.

### 4. Budget-Limited — Only Most Valuable Gaps

```
Use the behavioral-test-writer agent.

Parameters:
- mode: full
- maxTests: 30
```

Runs Phase 0 discovery, then writes tests for the highest-scored gaps until the 30-test budget is exhausted.

### 5. Parity-Focused — Verify Java Serializer Contracts

```
Use the behavioral-test-writer agent.

Parameters:
- javaTestSource: ~/Projects/connect/server/src/test/java/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2SerializerTest.java
- targetComponent: HL7v2Serializer
- testPatterns: P7,P8
```

Uses Data Serialization Round-Trip (P7) and Java Parity Comparison (P8) patterns to verify the HL7v2 serializer matches Java's exact output.

### 6. Coverage-Focused — All Pipeline Integration Gaps

```
Use the behavioral-test-writer agent.

Parameters:
- mode: full
- targetComponent: pipeline
- testPatterns: P9
```

Discovers all pipeline-related Java test files without Node.js equivalents, then writes P9 (Pipeline Full Lifecycle) tests for each.

## Output Format

### Discovery Report (Phase 0)

```markdown
## Behavioral Test Discovery Report

### Scan Summary
- Java test files scanned: 102
- Node.js test files scanned: 381
- Gaps identified: 14
- Gaps above threshold (score > 15): 8
- Gaps deferred (score 8-15): 4
- Gaps skipped (score < 8): 2
- Recommended tests: ~65

### Gap Rankings

| Rank | Java Test File | Component | Pattern(s) | Est. Tests | Score | Verdict |
|------|---------------|-----------|------------|------------|-------|---------|
| 1 | QueueTests.java | DestinationQueue | P9, P4 | 12 | 28 | YES |
| 2 | FilterTests.java | FilterTransformer | P9, P3 | 8 | 24 | YES |
| 3 | StatisticsTests.java | Statistics | P4, P10 | 6 | 18 | YES |
| ... | ... | ... | ... | ... | ... | ... |
| 12 | MapUtilTest.java | MapUtil | P2 | 3 | 10 | DEFER |
| 13 | UUIDGeneratorTest.java | UUIDGenerator | P15 | 2 | 5 | NO |
```

### Test Generation Report (Phases 1-6)

```markdown
## Behavioral Tests Written

### Tests Generated

| File | Pattern | Tests | Status |
|------|---------|-------|--------|
| tests/integration/pipeline/QueueBehavior.test.ts | P9 | 12 | PASS |
| tests/unit/donkey/channel/ResponseSelector.behavior.test.ts | P10 | 14 | PASS |

### Summary
- Tests written: 26
- All passing: Yes
- Regressions: 0
- Total test count: 8,472 → 8,498
```

## Integration with Project Workflow

After the agent completes:

1. **Review generated tests** — Verify assertions match intended behavioral contracts
2. **Run full suite** — `npm test` to confirm zero regressions
3. **Update CLAUDE.md** — If a new wave of behavioral tests is significant, add to the Wave Summary table
4. **Archive discovery report** — Save to `plans/` directory for future reference
5. **Track in todo** — Add any DEFER-scored gaps to `tasks/todo.md` for next wave

## Verification

After running this agent, verify by:

1. **All new test files exist** at the specified output paths
2. **All tests pass**: `npx jest <newfile> --no-coverage` returns 0 exit code
3. **No regressions**: `npm test` shows same or higher total test count with 0 failures
4. **Java source referenced**: Each test file has a docblock comment citing the Java source
5. **Correct patterns used**: Mock hoisting (P4), singleton reset (P9), fixture reuse match the pattern spec
6. **No source modifications**: `git diff --name-only` shows only files in `tests/`
