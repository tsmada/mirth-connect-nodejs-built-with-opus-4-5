<!-- Completed: 2026-02-19 | Status: Implemented -->
# Phase C Implementation Plan

## Context

The Node.js Mirth Connect port is production-ready (GO verdict, 18 PASS / 4 WARN / 0 FAIL). Phase C addresses 5 post-launch "nice-to-have" items that improve completeness and code quality:

1. Port 7 missing batch adaptors (HL7v2, XML, JSON, Raw, Delimited, EDI, NCPDP)
2. Port HL7v2 AutoResponder (wire to ACKGenerator)
3. Add HL7v2 escape sequence handling in non-strict parser
4. Break circular import Mirth.ts ↔ EngineController.ts
5. Raise test coverage from 62% to 70%

**Execution strategy**: Agent team with 4 parallel waves. Estimated wall time: ~2-3 hours.

---

## Wave 1: Infrastructure + Quick Wins

### 1a. Break Circular Import (~10 min)

**Problem**: `Mirth.ts:18` imports `EngineController`, and `EngineController.ts:26` imports `getDonkeyInstance` from `Mirth.ts`.

**Fix**: Use setter injection (the established pattern in this codebase — VMRouter, ChannelUtil, AlertSender all use it).

**Files to modify**:
- `src/controllers/EngineController.ts` — Remove `import { getDonkeyInstance }` from Mirth.js. Add a module-level `let donkeyInstanceRef: Donkey | null = null` and `export function setDonkeyInstance(d: Donkey): void`. Replace the 2 call sites (lines 341, 436) with `donkeyInstanceRef!`.
- `src/server/Mirth.ts` — After creating the Donkey instance, call `setDonkeyInstance(donkey)` imported from EngineController. Remove the `export function getDonkeyInstance()` export.
- Update any other files that import `getDonkeyInstance` from Mirth.ts (search first).

**Verification**: `tsc --noEmit` passes, all tests pass.

### 1b. ScriptBatchAdaptor Base Class (~15 min)

**Key insight**: Java's Raw, JSON, and NCPDP batch adaptors have **identical** code — the only difference is class name and properties type. They all only support JavaScript batch script splitting. Creating a shared base eliminates 3x code duplication.

**New file**: `src/donkey/message/ScriptBatchAdaptor.ts`

```typescript
// Executes a user-defined batch script via JavaScriptExecutor
// Scope: reader (string content), sourceMap
// Returns: next message string from script, or null when exhausted
export class ScriptBatchAdaptor implements BatchAdaptor {
  constructor(rawMessage: string, batchScript: string, channelId: string, channelName: string)
}
```

**Integration point**: Uses `JavaScriptExecutor.executeBatchScript()` with `ScopeBuilder.buildBatchProcessorScope()` (both already exist). The batch script receives a `reader` object wrapping the raw message content. Each call to `getMessage()` re-executes the script; the script returns the next message or `null`/empty when done.

**Simplification from Java**: Java uses `BufferedReader` streaming + `BatchMessageReceiver` (network source). Node.js simplification: pass the full string to the script scope. This matches the existing Node.js adaptor pattern (HL7BatchAdaptor, EDIBatchAdaptor all load full string into memory). Streaming can be added later if needed.

### 1c. Raw, JSON, NCPDP Batch Adaptors (~15 min)

**New files** (3 thin wrappers over ScriptBatchAdaptor):
- `src/datatypes/raw/RawBatchAdaptor.ts` — SplitType.JavaScript only
- `src/datatypes/json/JSONBatchAdaptor.ts` — SplitType.JavaScript only
- `src/datatypes/ncpdp/NCPDPBatchAdaptor.ts` — SplitType.JavaScript only

Each is ~30 lines: constructor validates batch properties, delegates to ScriptBatchAdaptor. Factory classes implement `BatchAdaptorFactory`.

**Tests** (3 files, ~20 tests each):
- `tests/unit/datatypes/raw/RawBatchAdaptor.test.ts`
- `tests/unit/datatypes/json/JSONBatchAdaptor.test.ts`
- `tests/unit/datatypes/ncpdp/NCPDPBatchAdaptor.test.ts`

---

## Wave 2: Complex Batch Adaptors (parallel agents)

### 2a. XML Batch Adaptor (~45 min)

**Java source**: `XMLBatchAdaptor.java` — supports 4 split modes:
- `Element_Name` — XPath `//*[local-name()='elementName']`
- `Level` — XPath `/*` repeated N times
- `XPath_Query` — User-provided XPath expression
- `JavaScript` — Batch script (delegates to ScriptBatchAdaptor pattern)

**New files**:
- `src/datatypes/xml/XMLBatchAdaptor.ts` (~120 lines)
- `src/datatypes/xml/XMLBatchProperties.ts` (~30 lines) — SplitType enum + config
- `tests/unit/datatypes/xml/XMLBatchAdaptor.test.ts` (~25 tests)

**Dependencies**: `fast-xml-parser` (already in project) for XML parsing. For XPath, use `xpath` npm package or DOM-based approach. Since we already have `fast-xml-parser`, convert to DOM and use simple tree walking for Element_Name/Level, and defer full XPath to a lightweight library.

**Simplification**: Use fast-xml-parser to parse XML, then walk the parsed tree for element/level splitting. For XPath_Query mode, use the `xpath` package (already available as a transitive dependency via `xmldom`). For JavaScript mode, delegate to ScriptBatchAdaptor.

### 2b. Delimited Batch Adaptor (~1 hr)

**Java source**: `DelimitedBatchAdaptor.java` (368 lines) — the most complex. Supports:
- `Record` — Each row/record is a message
- `Delimiter` — Records grouped by a message delimiter string
- `Grouping_Column` — Records grouped by column value transitions
- `JavaScript` — Batch script

**Key dependency**: Java's `DelimitedReader` class handles character-by-character parsing with quote escaping, column widths, custom delimiters. Check if Node.js already has a `DelimitedReader` or equivalent.

**New files**:
- `src/datatypes/delimited/DelimitedBatchAdaptor.ts` (~200 lines)
- `src/datatypes/delimited/DelimitedBatchProperties.ts` (~40 lines)
- `tests/unit/datatypes/delimited/DelimitedBatchAdaptor.test.ts` (~30 tests)

**Approach**: For `Record` and `Delimiter` modes, use string splitting with the configured record delimiter. For `Grouping_Column`, parse records and track column value transitions. For `JavaScript`, delegate to ScriptBatchAdaptor. Skip the full `DelimitedReader` character-by-character reimplementation — use string-based splitting with proper quote handling via a simple state machine.

### 2c. ER7 Full Batch Adaptor — Upgrade (~30 min)

**Java source**: `ER7BatchAdaptor.java` (249 lines) — adds to existing HL7BatchAdaptor:
- `MSH_Segment` split mode with configurable `lineBreakPattern` and `segmentDelimiter`
- Handles MLLP framing bytes (0x0B start, 0x1C end)
- Lookahead via Scanner for streaming
- `JavaScript` batch script mode
- Batch envelope stripping (FHS/BHS/BTS/FTS — already in Node.js)

**Modify**: `src/donkey/message/HL7BatchAdaptor.ts`

**Changes**:
- Add `HL7v2BatchProperties` with `SplitType` enum (MSH_Segment, JavaScript)
- Add configurable `lineBreakPattern` (regex) and `segmentDelimiter`
- Strip MLLP framing bytes (0x0B, 0x1C) from lines
- Add JavaScript batch script mode (delegate to ScriptBatchAdaptor)
- Update `HL7BatchAdaptorFactory` to accept properties

**Tests**: Update `tests/unit/donkey/message/HL7BatchAdaptor.test.ts` with ~15 new tests for MLLP framing, custom delimiters, and JavaScript mode.

---

## Wave 3: AutoResponder + Escape Sequences

### 3a. HL7v2 AutoResponder (~45 min)

**Java source**: `AutoResponder.java` (interface, 51 lines) + `HL7v2AutoResponder.java` (205 lines) + `DefaultAutoResponder.java` (exists but trivial)

**New files**:
- `src/donkey/message/AutoResponder.ts` — Interface matching Java
- `src/donkey/message/DefaultAutoResponder.ts` — Returns Response with null content
- `src/datatypes/hl7v2/HL7v2AutoResponder.ts` (~150 lines) — The main implementation
- `src/datatypes/hl7v2/HL7v2ResponseGenerationProperties.ts` (~40 lines) — ACK code/message config
- `tests/unit/datatypes/hl7v2/HL7v2AutoResponder.test.ts` (~30 tests)

**Key behaviors to port**:
1. **MSH.15 field handling** — Parse MSH.15 from ER7 (field 14 after split on field delimiter) or XML (XPath). Support AL/NE/ER/SU modes.
2. **Template value replacement** — Use existing `ValueReplacer` on ACK code/message properties with ConnectorMessage context.
3. **Status-based ACK codes** — Map Status.ERROR → errorACKCode, Status.FILTERED → rejectedACKCode, else → successfulACKCode.
4. **Delegate to ACKGenerator** — Use existing `HL7v2ACKGenerator.generateAckResponse()`.

**Wiring**: The AutoResponder is called from `SourceConnector` after message processing. Check `src/donkey/channel/SourceConnector.ts` for the `handleResponse()` flow and wire in the AutoResponder. If SourceConnector doesn't have a response hook, add one.

### 3b. HL7v2 Escape Sequence Handling (~30 min)

**Java source**: `XMLEncodedHL7Handler.java` (214 lines) — SAX handler for XML-to-ER7 conversion that processes escape sequences.

**The 6 escape sequences**:
| Escape | Meaning | Character |
|--------|---------|-----------|
| `\F\` | Field separator | `\|` |
| `\S\` | Component separator | `^` |
| `\R\` | Repetition separator | `~` |
| `\T\` | Subcomponent separator | `&` |
| `\E\` | Escape character | `\` |
| `\X{hex}\` | Hex-encoded character | varies |

**New file**: `src/datatypes/hl7v2/HL7EscapeHandler.ts` (~80 lines)

```typescript
export class HL7EscapeHandler {
  constructor(escapeChar: string, fieldSep: string, compSep: string, repSep: string, subSep: string)
  escape(text: string): string    // Encode special chars as escape sequences
  unescape(text: string): string  // Decode escape sequences to characters
}
```

**Integration**: Wire into `HL7v2SerializerAdapter` (which already has an unused `escapeChar` field). In `toXML()`, unescape before parsing. In `fromXML()`, escape after serializing. Controlled by the existing `useStrictParser` property — when strict=false (default), escape sequences are processed.

**Tests**: `tests/unit/datatypes/hl7v2/HL7EscapeHandler.test.ts` (~20 tests)

---

## Wave 4: Test Coverage (parallel agents)

**Goal**: 62.23% → 70% statements (~2,400 more statements to cover)

### Target Files (by impact — lines × uncovered%)

Priority order for maximum coverage gain:

| # | Servlet/File | Lines | Expected Tests | Est. Coverage Gain |
|---|-------------|-------|---------------|-------------------|
| 1 | ChannelStatusServlet.ts | 503 | 35 | ~350 stmts |
| 2 | AlertServlet.ts | 426 | 30 | ~300 stmts |
| 3 | DatabaseTaskServlet.ts | 306 | 20 | ~215 stmts |
| 4 | ChannelGroupServlet.ts | 286 | 20 | ~200 stmts |
| 5 | EventServlet.ts | 251 | 18 | ~175 stmts |
| 6 | SystemServlet.ts | 246 | 18 | ~170 stmts |
| 7 | UsageServlet.ts | 202 | 12 | ~140 stmts |
| 8 | ClusterServlet.ts | 84 | 8 | ~60 stmts |
| **Total** | | **2,304** | **~161** | **~1,610 stmts** |

Additional coverage from batch adaptors + AutoResponder + escape handler tests: ~500 stmts.

**Combined estimate**: ~2,100 new statements covered → 62.23% + ~6.8% = ~69%. Close to 70% threshold. If short, add `operations.ts` middleware tests (~977 lines, ~680 stmts).

### Test Pattern

All servlet tests follow the established pattern in `tests/unit/api/servlets/`:
```typescript
// Mock controllers, create Express app with router, use supertest
import request from 'supertest';
import express from 'express';
```

Existing examples: `ChannelServlet.test.ts` (51 tests), `UserServlet.test.ts` (49 tests), `ConfigurationServlet.test.ts` (58 tests).

---

## Execution Plan (Agent Team)

```
Phase C Team: "phase-c"

Wave 1 (sequential, ~30 min):
  Lead does: circular import fix + ScriptBatchAdaptor + Raw/JSON/NCPDP adaptors

Wave 2 (3 parallel agents, ~1 hr):
  ├─ [xml-adaptor]       XML batch adaptor + tests
  ├─ [delimited-adaptor]  Delimited batch adaptor + tests
  └─ [er7-upgrade]        ER7 full batch adaptor upgrade + tests

Wave 3 (2 parallel agents, ~45 min):
  ├─ [autoresponder]      AutoResponder interface + HL7v2 impl + wiring
  └─ [escape-handler]     HL7EscapeHandler + serializer integration

Wave 4 (4 parallel agents, ~1.5 hrs):
  ├─ [servlet-tests-1]    ChannelStatus + Alert + DatabaseTask tests
  ├─ [servlet-tests-2]    ChannelGroup + Event + System tests
  ├─ [servlet-tests-3]    Usage + Cluster tests
  └─ [verifier]           Full test suite + coverage check
```

---

## Key Files

| Purpose | File |
|---------|------|
| Batch adaptor interface | `src/donkey/message/BatchAdaptor.ts` |
| Existing HL7 batch | `src/donkey/message/HL7BatchAdaptor.ts` |
| Existing EDI batch | `src/donkey/message/EDIBatchAdaptor.ts` |
| JS executor | `src/javascript/runtime/JavaScriptExecutor.ts` |
| Scope builder | `src/javascript/runtime/ScopeBuilder.ts` |
| ACK generator | `src/datatypes/hl7v2/HL7v2ACKGenerator.ts` |
| HL7v2 serializer | `src/util/serializers/HL7v2SerializerAdapter.ts` |
| Value replacer | `src/util/ValueReplacer.ts` |
| Mirth lifecycle | `src/server/Mirth.ts` |
| Engine controller | `src/controllers/EngineController.ts` |
| Source connector | `src/donkey/channel/SourceConnector.ts` |

## Java Reference Files

| Purpose | File |
|---------|------|
| Base batch adaptor | `~/Projects/connect/donkey/.../batch/BatchAdaptor.java` |
| ER7 batch | `~/Projects/connect/server/.../hl7v2/ER7BatchAdaptor.java` |
| XML batch | `~/Projects/connect/server/.../xml/XMLBatchAdaptor.java` |
| JSON batch | `~/Projects/connect/server/.../json/JSONBatchAdaptor.java` |
| Raw batch | `~/Projects/connect/server/.../raw/RawBatchAdaptor.java` |
| Delimited batch | `~/Projects/connect/server/.../delimited/DelimitedBatchAdaptor.java` |
| NCPDP batch | `~/Projects/connect/server/.../ncpdp/NCPDPBatchAdaptor.java` |
| AutoResponder | `~/Projects/connect/donkey/.../message/AutoResponder.java` |
| HL7v2 auto responder | `~/Projects/connect/server/.../hl7v2/HL7v2AutoResponder.java` |
| Escape handler | `~/Projects/connect/server/.../hl7v2/XMLEncodedHL7Handler.java` |

## Verification

After all waves complete:
1. `tsc --noEmit` — zero errors
2. `npx jest` — all tests pass, 0 regressions
3. `npx jest --coverage` — statements ≥ 70%
4. No circular import warnings
5. Update `tasks/todo.md` — mark Phase C items complete
6. Archive plan to `plans/phase-c-implementation.md`
