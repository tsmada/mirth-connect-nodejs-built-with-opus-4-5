<!-- Completed: 2026-02-20 | Status: Implemented | Tests: 18/18 passing -->

# Pipeline Lifecycle Integration Test Suite

## Context

The Node.js Mirth Connect port has 8,151+ tests, but there's a critical testing gap: **no test sends a message through the full Channel pipeline with REAL JavaScript VM execution at every stage**. The existing tests fall into two non-overlapping categories:

1. **Unit tests** (`Channel.test.ts`) — test full pipeline orchestration but **mock** the `JavaScriptExecutor`, so user JavaScript never actually runs in a VM
2. **VM execution tests** (`RealWorldPatterns.test.ts`) — run real JavaScript in V8 VM but test **individual script types** in isolation, never through the full `dispatchRawMessage()` flow

If a scope variable is incorrectly wired between stages, a map readback is missing, or transformed data doesn't propagate from source to destination, both test categories pass — but production channels break silently.

This test suite fills that gap with 13 scenarios that exercise the **complete message lifecycle** with real E4X transpilation, real VM execution, and real scope construction at every pipeline stage.

## Approach

Create a self-contained integration test suite that:
- Uses **real** `JavaScriptExecutor`, `ScriptBuilder`, `ScopeBuilder`, `E4XTranspiler` (no mocks for JS execution)
- **Mocks only** `DonkeyDao` and `pool` (no MySQL dependency needed)
- Creates `Channel` objects programmatically with concrete `TestSourceConnector`/`TestDestinationConnector` subclasses
- Asserts on `ConnectorMessage` status, content, and map values after full pipeline completion
- Verifies DAO mock calls to confirm persistence ordering and status transitions

## Files to Create

### 1. `tests/integration/pipeline/PipelineLifecycle.test.ts` (~1,200 lines, 13 describe blocks, ~45 tests)

Main test file. Structure:

```
jest.mock(...DonkeyDao, pool, RecoveryTask...)  // DB-only mocks — NO JS executor mock

imports (Channel, ConnectorMessage, Status, ContentType, MirthMap singletons, etc.)

TestSourceConnector extends SourceConnector    // Reuse pattern from Channel.test.ts:62-86
TestDestinationConnector extends DestinationConnector  // Configurable send/fail/response behavior

createTestChannel(options) helper              // Fluent channel factory
beforeEach: resetDefaultExecutor(), GlobalMap.resetInstance(), etc.

describe('Scenario 1: Happy path — transform + send')
describe('Scenario 2: Source filter rejects → FILTERED')
describe('Scenario 3: Destination filter rejects one of two destinations')
describe('Scenario 4: Send failure → ERROR status')
describe('Scenario 5: Queue-enabled send failure → QUEUED status')
describe('Scenario 6: Response transformer reads and modifies response')
describe('Scenario 7: Preprocessor return semantics')
describe('Scenario 8: Postprocessor creates Response object')
describe('Scenario 9: Deploy/undeploy script lifecycle')
describe('Scenario 10: Global + channel script chaining order')
describe('Scenario 11: E4X transform pipeline end-to-end')
describe('Scenario 12: Multi-destination fan-out with destinationSet.remove()')
describe('Scenario 13: Map variable propagation across all stages')
```

### 2. `tests/integration/pipeline/helpers/ScriptFixtures.ts` (~200 lines)

Reusable JavaScript script snippets for each scenario:
- Filter rules (accept/reject, conditional on message content)
- Transformer steps (extract fields, build JSON, E4X XML literals)
- Preprocessor scripts (modify message, set channelMap)
- Postprocessor scripts (read $r, return Response)
- Deploy/undeploy scripts (set/clear globalMap)
- Global pre/postprocessor scripts
- Response transformer scripts
- Test message fixtures (XML HL7-like, JSON, empty PID)

### 3. `tests/integration/pipeline/helpers/PipelineTestHarness.ts` (~250 lines)

Channel factory + assertion utilities:
- `PipelineTestHarness` class with fluent configuration API
- `TestSourceConnector` with `testDispatch()` method
- `TestDestinationConnector` with configurable send behavior (success/error/response)
- Helper to extract DAO call sequences for status transition verification
- Map singleton reset in constructor

## Wiring Strategy (Critical)

The key architectural challenge: `Channel.ts` uses `getDefaultExecutor()` at construction (line 189), and each `FilterTransformerExecutor` also calls `getDefaultExecutor()` independently (line 55 of FilterTransformerExecutor.ts). To get real VM execution:

1. **Do NOT** `jest.mock` the `JavaScriptExecutor` module
2. **Call** `resetDefaultExecutor()` in `beforeEach` — this clears the singleton so the next `getDefaultExecutor()` creates a fresh real instance via `createJavaScriptExecutor()`
3. The `Channel` constructor calls `getDefaultExecutor()` → gets real executor
4. `SourceConnector.setChannel()` calls `createFilterTransformerExecutor()` → calls `getDefaultExecutor()` → same real executor
5. `DestinationConnector.setChannel()` does the same for dest filter/transform + response transformer

**Result**: All script execution uses real V8 VM — E4X transpilation, scope building, map injection, scope readback all run for real.

**Mock only**: `DonkeyDao` (all DB operations), `pool` (transaction wrapper), `RecoveryTask` (background recovery)

## 13 Test Scenarios

### Scenario 1: Happy Path — Source Transform + Destination Send
- **Channel config**: Source transformer extracts `msg['PID']['PID.5']['PID.5.1']` via XMLProxy, puts to `$c('patientName', ...)`
- **Input**: XML HL7-like message with PID.5.1 = "DOE"
- **Assert**: Source status = TRANSFORMED, dest status = SENT, `channelMap.get('patientName')` === 'DOE', dest connector received 1 message, message.isProcessed() === true

### Scenario 2: Source Filter Rejects → FILTERED
- **Channel config**: Source filter returns `false` unconditionally
- **Input**: Any XML message
- **Assert**: Source status = FILTERED, 0 destination messages created, no dest connector `send()` called, message.isProcessed() === true

### Scenario 3: Partial Destination Filtering
- **Channel config**: 2 destinations, dest 1 filter accepts, dest 2 filter rejects
- **Input**: Any message
- **Assert**: Source status = TRANSFORMED, dest 1 status = SENT, dest 2 status = FILTERED, dest 1 connector received message, dest 2 connector did not

### Scenario 4: Send Error → ERROR Status
- **Channel config**: Destination `send()` throws `new Error('Connection refused')`
- **Input**: Any message
- **Assert**: Dest status = ERROR, `DonkeyDao.updateErrors` called with error content, postprocessor still executed

### Scenario 5: Queue-Enabled Error → QUEUED Status
- **Channel config**: Destination with `queueEnabled=true`, `send()` throws
- **Input**: Any message
- **Assert**: Dest status = QUEUED (not ERROR)

### Scenario 6: Response Transformer Execution
- **Channel config**: Destination returns response `'{"result":"ok"}'`, response transformer script reads `responseStatus` and `response`, writes to `$r`
- **Input**: Any message
- **Assert**: Dest status = SENT, response transformer scope variables were accessible, `responseMap` contains values set by response transformer script

### Scenario 7: Preprocessor Return Semantics
- **Channel config**: Preprocessor appends `<!-- preprocessed -->` and returns modified message
- **Input**: XML message
- **Assert**: Source transformer receives the MODIFIED message (not original), `PROCESSED_RAW` content contains the modification
- **Also test**: Null/undefined return preserves original message

### Scenario 8: Postprocessor Response Object
- **Channel config**: Postprocessor accesses `$r('Dest 1')` via merged connector message, returns `new Response(SENT, "Custom ACK")`
- **Input**: Any message
- **Assert**: `channelMap.get('postprocessorRan')` === true, postprocessor had access to destination response via `$r()`

### Scenario 9: Deploy/Undeploy Script Lifecycle
- **Channel config**: Deploy script sets `globalMap.put('deployed', 'yes')`, undeploy script sets `globalMap.put('undeployed', 'yes')`
- **Action**: `channel.start()` → verify deploy ran → `channel.stop()` → verify undeploy ran
- **Assert**: GlobalMap values set/cleared at correct lifecycle points

### Scenario 10: Global + Channel Script Chaining
- **Channel config**: Global preprocessor + channel preprocessor, global postprocessor + channel postprocessor
- **Assert preprocessor order**: Global runs first (sets globalMap), channel runs second (reads globalMap value, confirms global ran first)
- **Assert postprocessor order**: Channel runs first, global runs second (reversed from preprocessor)

### Scenario 11: E4X Transform Pipeline
- **Channel config**: Source transformer uses E4X XML literal syntax (`var ack = <ACK>...</ACK>`) with computed content from `msg`
- **Input**: XML message
- **Assert**: E4X transpiled and executed correctly, `channelMap.get('ackXml')` contains valid XML output

### Scenario 12: DestinationSet Fan-Out Control
- **Channel config**: 3 destinations, source transformer calls `destinationSet.remove('Dest 2')`
- **Input**: Any message
- **Assert**: Dest 1 = SENT, Dest 2 = FILTERED (skipped by destinationSet), Dest 3 = SENT

### Scenario 13: Map Variable Propagation Across All Stages
- **Channel config**: Preprocessor sets `$c('fromPre')`, source transformer reads `$c('fromPre')` + sets `$c('fromSource')`, dest transformer reads both + sets `$co('destKey')`, postprocessor reads all via merged maps + `$r`
- **Pre-seed**: `$g('globalKey')`, `$gc('gcKey')`, `$cfg('cfgKey')`
- **Assert per stage**:
  - Preprocessor: wrote to channelMap ✓
  - Source transformer: read preprocessor's channelMap value ✓, read $g/$gc/$cfg ✓
  - Dest transformer: read source transformer's channelMap value ✓
  - Postprocessor: read all channelMap values via merged message ✓, $r contains dest response ✓

## Status Enum Coverage Matrix

| Status | Scenario | How Triggered |
|--------|----------|---------------|
| RECEIVED (R) | All | Initial state on message creation |
| FILTERED (F) | 2, 3, 12 | Source filter reject, dest filter reject, destinationSet.remove() |
| TRANSFORMED (T) | 1, 3, 4, 5, 6-13 | Source transformer completes |
| SENT (S) | 1, 3, 6-13 | Destination send succeeds |
| QUEUED (Q) | 5 | Queue-enabled destination send fails |
| ERROR (E) | 4 | Non-queue destination send fails |
| PENDING (P) | 6 | Set between send and response transformer (verified via DAO mock) |

## Critical Source Files (Read-only Reference)

| File | Purpose in Tests |
|------|-----------------|
| `src/donkey/channel/Channel.ts` | `dispatchRawMessage()` — the method under test |
| `src/donkey/channel/SourceConnector.ts` | Base class for TestSourceConnector |
| `src/donkey/channel/DestinationConnector.ts` | Base class for TestDestinationConnector |
| `src/donkey/channel/FilterTransformerExecutor.ts` | Orchestrates filter+transform via real executor |
| `src/javascript/runtime/JavaScriptExecutor.ts` | Real VM execution (NOT mocked) |
| `src/javascript/runtime/ScriptBuilder.ts` | Script generation + E4X transpilation |
| `src/javascript/runtime/ScopeBuilder.ts` | Scope construction with all map variables |
| `src/javascript/e4x/E4XTranspiler.ts` | E4X-to-JS conversion |
| `src/javascript/userutil/MirthMap.ts` | GlobalMap, ConfigurationMap, GlobalChannelMapStore singletons |
| `src/model/Status.ts` | Status enum (R, F, T, S, Q, E, P) |
| `src/model/ConnectorMessage.ts` | Message model with content, maps, status |
| `src/model/Message.ts` | Message with getMergedConnectorMessage() |
| `src/model/Response.ts` | Response object with multi-overload constructor |

## Reusable Patterns from Existing Tests

| Pattern | Source | Reuse |
|---------|--------|-------|
| DonkeyDao mock block | `Channel.test.ts:1-37` | Copy verbatim (all DAO functions mocked) |
| TestSourceConnector | `Channel.test.ts:62-86` | Extend with configurable behavior |
| TestDestinationConnector | `Channel.test.ts:89-109` | Extend with error throwing + response return |
| Singleton resets | `LabIntegration.stress.test.ts:801-804` | `resetDefaultExecutor()`, `GlobalMap.resetInstance()`, etc. |
| Real executor pattern | `LabIntegration.stress.test.ts` (no JS mock) | Confirms real VM execution works with mocked DB |

## Verification

After implementation, run:

```bash
# Run just the new integration tests
npm test -- tests/integration/pipeline/PipelineLifecycle.test.ts --verbose

# Expected: 13 describe blocks, ~45 individual tests, all passing
# Each test exercises real VM execution (E4X transpilation + scope building)

# Run the full test suite to verify no regressions
npm test

# Expected: 8,151+ existing tests still passing + ~45 new tests
```

## Estimated Output

| File | Lines | Tests |
|------|-------|-------|
| `PipelineLifecycle.test.ts` | ~1,200 | ~45 |
| `helpers/PipelineTestHarness.ts` | ~250 | — |
| `helpers/ScriptFixtures.ts` | ~200 | — |
| **Total** | **~1,650** | **~45** |
