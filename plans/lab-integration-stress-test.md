<!-- Completed: 2026-02-08 | Status: Implemented -->

# Plan: Complex Multi-Channel Lab Integration Stress Test

## Context

Real-world Mirth deployments at large healthcare organizations use deep multi-channel architectures — ORM lab orders fan out to dozens of lab-specific API channels, ORU results flow back through processing pipelines with many filter/transformer steps. This integration test creates a **13-channel, 30+ step pipeline** to stress-test the Node.js Donkey engine under realistic conditions: deep VM routing chains, heavy filter/transformer execution, fan-out patterns, sourceMap propagation, error handling, and statistics tracking.

The goal is to **find faults** in the engine by exercising the most complex message flow patterns a big-corp environment would produce.

---

## File Location

```
tests/integration/donkey/LabIntegration.stress.test.ts
```

Single test file, ~1200-1500 lines. No external fixtures needed — all HL7 messages and channel configs are inline.

---

## Architecture

```
                         ORM SIDE (Lab Orders)
  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────────────────────────┐
  │ ORM_Inbound  │───▶│  ORM_Processor  │───▶│           ORM_Router                 │
  │ (source fltr)│ VM │  (15 xform      │ VM │  (dest filters route by CPT code)    │
  │ ORM^O01 only │    │   steps)        │    │                                      │
  └──────────────┘    └─────────────────┘    └──┬──────┬──────┬──────┬──────┬───────┘
                                                │      │      │      │      │
                                           API_CBC API_CMP API_UA API_LIP API_DEF
                                           85025  80053  81001  80061  catch-all

                         ORU SIDE (Lab Results)
  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────────────────────────┐
  │ ORU_Inbound  │───▶│  ORU_Processor  │───▶│           ORU_Router                 │
  │ (source fltr)│ VM │  (15 xform      │ VM │  (dest filters route by result type) │
  │ ORU^R01 only │    │   steps)        │    │                                      │
  └──────────────┘    └─────────────────┘    └──┬──────────┬───────────┬────────────┘
                                                │          │           │
                                           ORU_EMR    ORU_Critical  ORU_Archive
                                           (normal)   (HH/LL only)  (all results)

  Total: 13 channels, 6 VM hops max depth, 30+ filter/transformer steps
```

---

## Implementation Steps

### Step 1: Mocks and Imports (~50 lines)

Mock `DonkeyDao` and `pool.js` following the exact pattern from `tests/unit/connectors/vm/VmRouting.integration.test.ts:1-33`:

```typescript
jest.mock('../../../src/db/DonkeyDao.js', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateResponseMap: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  getNextMessageId: jest.fn().mockImplementation(() => Promise.resolve(mockNextMessageId++)),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(undefined),
  pruneMessageAttachments: jest.fn().mockResolvedValue(undefined),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));
```

**Key imports:**
- `Channel` from `src/donkey/channel/Channel`
- `DestinationConnector` from `src/donkey/channel/DestinationConnector`
- `SourceConnector` from `src/donkey/channel/SourceConnector`
- `VmDispatcher`, `EngineController`, `DispatchResult` from `src/connectors/vm/VmDispatcher`
- `VmReceiver` from `src/connectors/vm/VmReceiver`
- `RawMessage` from `src/model/RawMessage`
- `ConnectorMessage` from `src/model/ConnectorMessage`
- `Status` from `src/model/Status`
- `FilterRule`, `TransformerStep`, `SerializationType` from `src/javascript/runtime/ScriptBuilder`
- `GlobalMap`, `ConfigurationMap`, `GlobalChannelMapStore` from `src/javascript/userutil/MirthMap`
- `resetDefaultExecutor` from `src/javascript/runtime/JavaScriptExecutor`
- `SOURCE_CHANNEL_ID`, `SOURCE_MESSAGE_ID`, `SOURCE_CHANNEL_IDS`, `SOURCE_MESSAGE_IDS` from `src/connectors/vm/VmConnectorProperties`

### Step 2: HL7 Message Fixtures (~80 lines)

Eight inline HL7 message constants using `\r` as segment delimiter:

| Fixture | Type | Purpose |
|---------|------|---------|
| `ORM_CBC` | ORM^O01, CPT 85025 | Routes to API_CBC |
| `ORM_CMP` | ORM^O01, CPT 80053 | Routes to API_CMP |
| `ORM_MULTI` | ORM^O01, CPT 85025 + 81001 | Routes to API_CBC (first OBR routing key) |
| `ORM_UNKNOWN` | ORM^O01, CPT 99999 | Routes to API_DEFAULT |
| `ORM_INVALID` | ORM^O01, missing PID | Errors at ORM_Processor step 1 |
| `ADT_MESSAGE` | ADT^A01 | Filtered at ORM_Inbound source filter |
| `ORU_NORMAL` | ORU^R01, all N flags | Routes to ORU_EMR + ORU_Archive |
| `ORU_CRITICAL` | ORU^R01, HH flag | Routes to all 3 ORU destinations |

Each message has realistic segments: MSH, PID, PV1, ORC, OBR (for ORM), OBR+OBX (for ORU), IN1 (on some).

### Step 3: Helper Classes (~60 lines)

**TestSourceConnector** — minimal source connector (reuse from VmRouting test):
```typescript
class TestSourceConnector extends SourceConnector {
  constructor() { super({ name: 'Test Source', transportName: 'TEST' }); }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}
```

**TestDestinationConnector** — captures sent messages with channel/dest tracking:
```typescript
class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  constructor(metaDataId: number, name: string) {
    super({ name, metaDataId, transportName: 'TEST' });
  }
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }
  async getResponse(): Promise<string | null> { return null; }
}
```

### Step 4: Engine Controller and Channel Registry (~30 lines)

Central `Map<string, Channel>` and `EngineController` that dispatches to any registered channel:

```typescript
const channels = new Map<string, Channel>();

const engineController: EngineController = {
  async dispatchRawMessage(channelId, rawMessage): Promise<DispatchResult | null> {
    const target = channels.get(channelId);
    if (!target) throw new Error(`Channel not deployed: ${channelId}`);
    const message = await target.dispatchRawMessage(
      rawMessage.getRawData(), rawMessage.getSourceMap());
    return { messageId: message.getMessageId() };
  },
};
```

### Step 5: Channel Factory Helper (~80 lines)

`createVmChannel()` helper to reduce boilerplate:

```typescript
function createVmChannel(id: string, name: string, opts: {
  sourceType: 'test' | 'vm';
  sourceFilter?: FilterRule[];
  sourceTransformer?: TransformerStep[];
  preprocessorScript?: string;
  destinations: Array<{
    type: 'vm' | 'test';
    name: string;
    targetChannelId?: string;
    filter?: FilterRule[];
    transformer?: TransformerStep[];
    mapVariables?: string[];
  }>;
}): { channel: Channel; testDests: TestDestinationConnector[] }
```

This builds a Channel, wires source connector (VmReceiver or TestSourceConnector), configures source filter/transformer, creates destination connectors (VmDispatcher with engineController or TestDestinationConnector), configures destination filters/transformers, registers in the `channels` map, and returns test destinations for assertion.

### Step 6: ORM Pipeline Channels (~250 lines)

**6a. ORM_Inbound** — Source filter accepts only ORM^O01:
```typescript
// Source filter script (returns true=accept, false=reject):
var segments = msg.split('\\r');
var msh = segments.find(function(s) { return s.indexOf('MSH') === 0; });
if (!msh) return false;
var fields = msh.split('|');
var msgType = fields[8] || '';
return msgType.indexOf('ORM') === 0;
```

Source transformer: Extract and store MRN, normalize sending facility.

Destination: 1 VmDispatcher → `orm-processor` with mapVariables for patientMRN.

**6b. ORM_Processor** — 15 transformer steps (the heart of the stress test):

| # | Name | Script Logic |
|---|------|-------------|
| 1 | Validate Segments | Parse `\r`-delimited, check MSH/PID/ORC/OBR exist. Throw if missing. |
| 2 | Validate ORC Control | Extract ORC.1, verify = `NW`. Throw if not. |
| 3 | Extract Patient MRN | PID.3 → `$c.put('patientMRN', mrn)` |
| 4 | Extract Demographics | PID.5 (name), PID.7 (DOB), PID.8 (sex) → channelMap |
| 5 | Extract Physician | OBR.16 → `$c.put('orderingPhysician', ...)` |
| 6 | Extract CPT Codes | All OBR.4 fields → JSON array → `$c.put('cptCodes', ...)` |
| 7 | Build Routing Key | First CPT code → `$c.put('routingKey', cpt)` |
| 8 | Normalize Dates | ORC.9 → ISO 8601 → `$c.put('orderDate', ...)` |
| 9 | Add Audit Trail | `$c.put('processedAt', new Date().toISOString())` |
| 10 | Validate Insurance | Check IN1 segment, extract company name if present |
| 11 | Duplicate Check | If ORC.2 contains "DUP" → `$c.put('isDuplicate', 'true')` |
| 12 | Enrich Facility | MSH.4 → standardized code → `$c.put('facilityCode', ...)` |
| 13 | Count Segments | `$c.put('segmentCount', segments.length)` |
| 14 | Verify Integrity | Re-check MSH.9 = ORM (guard against corruption) |
| 15 | Final Validation | Verify patientMRN, cptCodes, routingKey all set. Throw if missing. |

Destination: 1 VmDispatcher → `orm-router` with mapVariables: `['patientMRN', 'routingKey', 'cptCodes', 'orderingPhysician', 'facilityCode', 'processedAt', 'segmentCount']`.

**6c. ORM_Router** — 5 VmDispatcher destinations, each with a destination filter:

Each destination filter checks `$c.get('routingKey')` (which reads from sourceMap via ChannelMap fallback):
- Dest 1 (→ api-cbc): `return ($c.get('routingKey') || '').toString() === '85025';`
- Dest 2 (→ api-cmp): `return ($c.get('routingKey') || '').toString() === '80053';`
- Dest 3 (→ api-ua): `return ($c.get('routingKey') || '').toString() === '81001';`
- Dest 4 (→ api-lipid): `return ($c.get('routingKey') || '').toString() === '80061';`
- Dest 5 (→ api-default): `return ['85025','80053','81001','80061'].indexOf(($c.get('routingKey') || '').toString()) === -1;`

**6d. API_* Channels** (5 channels) — VmReceiver source, each with 1 TestDestinationConnector:
- Destination transformer adds a header: `$c.put('apiTarget', 'CBC')` (or CMP, UA, LIPID, DEFAULT)
- No destination filter needed (routing already happened at ORM_Router level)

### Step 7: ORU Pipeline Channels (~200 lines)

**7a. ORU_Inbound** — Source filter accepts only ORU^R01 (same pattern as ORM).

Source transformer: Extract result metadata.

Destination: 1 VmDispatcher → `oru-processor`.

**7b. ORU_Processor** — 15 transformer steps:

| # | Name | Script Logic |
|---|------|-------------|
| 1 | Validate Segments | Check MSH/PID/OBR/OBX exist. Throw if missing. |
| 2 | Validate Result Status | OBR.25 = "F" (final). Set `$c.put('isPreliminary', ...)` if "P". |
| 3 | Extract Patient MRN | PID.3 → channelMap |
| 4 | Extract Provider | OBR.16 → channelMap |
| 5 | Extract OBX Results | All OBX: code, value, units, range, flag → JSON array |
| 6 | Flag Abnormal | Check OBX.8 for H/L/HH/LL → `$c.put('hasAbnormal', ...)` |
| 7 | Detect Critical | HH or LL flags → `$c.put('isCritical', 'true')` |
| 8 | Normalize LOINC | Extract OBX.3 codes → channelMap |
| 9 | Interpretation | Based on flags, build interpretation notes |
| 10 | Validate Ranges | Check OBX.7 present for NM types |
| 11 | Enrich Facility | MSH.4 → facility code |
| 12 | Format for EMR | Build JSON summary → channelMap |
| 13 | Set Result Type | `$c.put('resultType', isCritical ? 'critical' : 'normal')` |
| 14 | Delivery Tracking | `$c.put('deliveryId', ...)` and timestamp |
| 15 | Final Validation | Verify required channelMap keys set |

Destination: 1 VmDispatcher → `oru-router` with mapVariables: `['patientMRN', 'hasAbnormal', 'isCritical', 'resultType', 'results', 'deliveryId']`.

**7c. ORU_Router** — 3 destinations with filters:
- Dest 1 (→ oru-emr): Accept all (no filter — all results go to EMR)
- Dest 2 (→ oru-critical): `return ($c.get('isCritical') || '').toString() === 'true';`
- Dest 3 (→ oru-archive): Accept all (no filter — all archived)

**7d. ORU_EMR, ORU_Critical, ORU_Archive** — VmReceiver + TestDestinationConnector each.

### Step 8: Test Setup and Teardown (~40 lines)

```typescript
beforeEach(() => {
  mockNextMessageId = 1;
  jest.clearAllMocks();
  // Reset mock implementations
  (channelTablesExist as jest.Mock).mockResolvedValue(true);
  (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
  // ... reset all mocks
  GlobalMap.resetInstance();
  ConfigurationMap.resetInstance();
  GlobalChannelMapStore.resetInstance();
  resetDefaultExecutor();
  channels.clear();
});

afterEach(async () => {
  // Stop all channels in reverse dependency order
  for (const channel of channels.values()) {
    try { await channel.stop(); } catch { /* ignore */ }
  }
  channels.clear();
});
```

**Channel start order** (downstream first — critical for VM routing):
1. API_CBC, API_CMP, API_UA, API_LIPID, API_DEFAULT, ORU_EMR, ORU_Critical, ORU_Archive
2. ORM_Router, ORU_Router
3. ORM_Processor, ORU_Processor
4. ORM_Inbound, ORU_Inbound

### Step 9: Test Cases (~400 lines)

**Group 1: ORM Routing (6 tests)**

| Test | Input | Assert |
|------|-------|--------|
| `ORM CBC routes to API_CBC only` | ORM_CBC | api_cbc.sentMessages.length === 1; all others === 0 |
| `ORM CMP routes to API_CMP only` | ORM_CMP | api_cmp.sentMessages.length === 1; all others === 0 |
| `ORM multi-order routes by first OBR CPT` | ORM_MULTI | api_cbc.sentMessages.length === 1 (first OBR = 85025) |
| `ORM unknown CPT routes to API_DEFAULT` | ORM_UNKNOWN | api_default.sentMessages.length === 1; specific APIs === 0 |
| `ADT message filtered at ORM_Inbound` | ADT_MESSAGE | All API dests === 0; return message status === FILTERED |
| `Invalid ORM (no PID) errors at processor` | ORM_INVALID | No API dests receive message; processor throws |

**Group 2: ORU Routing (3 tests)**

| Test | Input | Assert |
|------|-------|--------|
| `ORU normal results → EMR + Archive, not Critical` | ORU_NORMAL | oru_emr: 1, oru_archive: 1, oru_critical: 0 |
| `ORU critical results → all 3 destinations` | ORU_CRITICAL | oru_emr: 1, oru_archive: 1, oru_critical: 1 |
| `ADT message filtered at ORU_Inbound` | ADT_MESSAGE | All ORU dests === 0 |

**Group 3: Data Integrity (3 tests)**

| Test | Input | Assert |
|------|-------|--------|
| `channelMap data preserved through full ORM pipeline` | ORM_CBC | Final API_CBC message's maps contain patientMRN, routingKey, facilityCode, processedAt |
| `channelMap data preserved through full ORU pipeline` | ORU_CRITICAL | Final ORU_Critical message's maps contain isCritical='true', patientMRN, resultType='critical' |
| `sourceMap chain tracks full ORM journey` | ORM_CBC | Verify SOURCE_CHANNEL_IDS contains the traversed channel IDs in order |

**Group 4: Statistics (2 tests)**

| Test | Input | Assert |
|------|-------|--------|
| `ORM pipeline stats after single message` | ORM_CBC | ORM_Inbound: received=1, sent>=1. ORM_Processor: received=1, sent>=1. API_CBC: received=1, sent>=1. |
| `Filtered message increments filtered counter` | ADT_MESSAGE | ORM_Inbound: received=1, filtered=1, sent=0 |

**Group 5: Throughput (2 tests)**

| Test | Input | Assert |
|------|-------|--------|
| `Full ORM pipeline completes in < 2000ms` | ORM_CBC | performance.now() delta < 2000ms |
| `Sequential 4-message ORM batch` | All 4 ORM fixtures | Each routes correctly. Stats show received=4 at inbound. |

**Total: 16 test cases**

---

## Key Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `tests/integration/donkey/LabIntegration.stress.test.ts` | **CREATE** | The entire integration test |

## Key Files to Reference (read-only patterns)

| File | Purpose |
|------|---------|
| `tests/unit/connectors/vm/VmRouting.integration.test.ts` | Mock setup pattern, TestSourceConnector, TestDestinationConnector, engine controller wiring |
| `src/donkey/channel/Channel.ts` | dispatchRawMessage pipeline: filter → transform → destination loop |
| `src/donkey/channel/FilterTransformerExecutor.ts` | FilterRule/TransformerStep interfaces, executeFilter semantics (true=accept) |
| `src/donkey/channel/DestinationConnector.ts` | setFilterTransformer API, dest filter/transformer execution |
| `src/donkey/channel/SourceConnector.ts` | setFilterTransformer API for source-level filters |
| `src/connectors/vm/VmDispatcher.ts` | mapVariables propagation, sourceMap chain building, getMapValue scope chain |
| `src/connectors/vm/VmReceiver.ts` | VM receiver connector |
| `src/javascript/runtime/ScopeBuilder.ts` | $c, $s, $g, msg scope setup — confirms ChannelMap reads sourceMap as fallback |
| `src/javascript/runtime/ScriptBuilder.ts` | FilterRule, TransformerStep, SerializationType interfaces |

---

## Critical Design Decisions

1. **SerializationType.RAW** for all channels — HL7 is pipe-delimited, so `msg` is a raw string in scripts. Scripts parse via `msg.split('\r')` and `segment.split('|')`. This avoids dependency on the HL7v2 XML parser and matches how many real deployments handle RAW data type.

2. **Destination filters for routing** (not DestinationSet) — Each ORM_Router destination has a filter that checks `$c.get('routingKey')`. Since `$c` (ChannelMap) falls back to sourceMap for reads, VM-propagated mapVariables are accessible transparently.

3. **Filter semantics**: Script returns `true` → accepted (continue), `false` → rejected (FILTERED). Confirmed at `FilterTransformerExecutor.ts:93`: `return !result.accepted`.

4. **mapVariables propagation**: VmDispatcher's `getMapValue()` searches response → connector → channel → source → globalChannel → global → config maps. Setting values via `$c.put()` stores in channelMap, which VmDispatcher finds and copies to the target channel's sourceMap.

5. **Channel start order**: Downstream channels must start before upstream (VM targets must be ready before dispatchers send). Stop in reverse order.

6. **Performance threshold**: 2000ms (generous) for the full 6-hop pipeline with 15+ script executions, since this is testing correctness more than raw speed. The `vm` module JIT overhead for first-run script compilation can be significant.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Script scope missing `$c.put`/`$c.get` | Confirmed via ScopeBuilder: `$c = new ChannelMap(...)` with put/get methods |
| mapVariables not arriving at downstream | VmDispatcher.send() explicitly copies listed variables; ChannelMap constructor takes sourceMap fallback |
| `msg` not being raw string for HL7 | Confirmed: ScopeBuilder sets `scope.msg = rawContent` for non-XML content |
| Jest timeout with deep recursive dispatch | Set `jest.setTimeout(60000)` at file level |
| Transaction mock missing for `persistInTransaction` | Already handled: mock `channelTablesExist` returns true, all DonkeyDao methods are no-ops |
| Filter error vs filter rejection confusion | Filter errors throw (causing ERROR status), filter returning false causes FILTERED status. Scripts use explicit `return true/false`. |

---

## Team-Based Parallel Execution Strategy

The implementation will use **3 parallel agents** via git worktrees, each handling an independent portion of the test file, then merged by the coordinator.

### Team Structure

| Agent | Branch | Worktree | Responsibility |
|-------|--------|----------|---------------|
| **infra-agent** | `feature/lab-test-infra` | `../mirth-worktrees/lab-test-infra` | Shared infrastructure: mocks, HL7 fixtures, helpers, engine controller, channel factory |
| **orm-agent** | `feature/lab-test-orm` | `../mirth-worktrees/lab-test-orm` | ORM pipeline: 8 channels (Inbound, Processor, Router, 5 API_*), ORM test cases |
| **oru-agent** | `feature/lab-test-oru` | `../mirth-worktrees/lab-test-oru` | ORU pipeline: 5 channels (Inbound, Processor, Router, 3 delivery), ORU test cases |

### File Split Strategy

Since all code ultimately goes into one test file, each agent writes to a **separate file** that gets composed into the final file:

| Agent | Output File | Contents |
|-------|-------------|----------|
| infra-agent | `tests/integration/donkey/_lab-infra.ts` | Mocks, imports, HL7 constants, helper classes, engine controller, channel factory, `beforeEach`/`afterEach` |
| orm-agent | `tests/integration/donkey/_lab-orm.ts` | `buildOrmPipeline()` function (creates 8 ORM channels), ORM test `describe` block (6 tests) |
| oru-agent | `tests/integration/donkey/_lab-oru.ts` | `buildOruPipeline()` function (creates 5 ORU channels), ORU test `describe` block (3 tests) |

### Merge Phase (Coordinator)

After all 3 agents complete:
1. Read all 3 output files
2. Compose into single `LabIntegration.stress.test.ts`:
   - Mocks (from infra)
   - Imports (from infra)
   - HL7 fixtures (from infra)
   - Helper classes + channel factory (from infra)
   - `buildOrmPipeline()` (from orm-agent)
   - `buildOruPipeline()` (from oru-agent)
   - `describe('Lab Integration Stress Test')` wrapping all test groups
   - Cross-cutting tests (data integrity, statistics, throughput) — coordinator writes these using both pipelines
3. Delete the 3 temporary files
4. Run full test suite to verify

### Agent Contracts

**infra-agent exports** (for orm/oru agents to reference):
- `TestSourceConnector`, `TestDestinationConnector` classes
- `channels` Map, `engineController` EngineController
- `createVmChannel()` factory function
- All HL7 message constants: `ORM_CBC`, `ORM_CMP`, `ORM_MULTI`, `ORM_UNKNOWN`, `ORM_INVALID`, `ADT_MESSAGE`, `ORU_NORMAL`, `ORU_CRITICAL`
- `beforeEach`/`afterEach` setup and teardown
- `MAP_VARIABLES_ORM` and `MAP_VARIABLES_ORU` — arrays of variable names to propagate

**orm-agent receives** (context in prompt):
- Exact interfaces: `FilterRule`, `TransformerStep`, `SerializationType`
- Factory function signature: `createVmChannel(id, name, opts)`
- Map variable names for propagation
- All 15 ORM_Processor transformer step specifications
- ORM_Router destination filter scripts
- Expected test assertions per test case

**oru-agent receives** (same pattern for ORU side)

### Timing

All 3 agents run simultaneously. Expected completion: ~8-12 minutes each. Merge phase: ~5 minutes. Total: ~15-20 minutes.

---

## Verification

1. **Run the test file**: `npx jest tests/integration/donkey/LabIntegration.stress.test.ts --verbose`
2. **All 16 tests should pass** on first run
3. **Verify no console errors** from the engine (only expected mock behavior)
4. **Check test isolation** by running tests in random order: `npx jest --randomize`
5. **Performance check**: The throughput tests verify pipeline latency stays reasonable
