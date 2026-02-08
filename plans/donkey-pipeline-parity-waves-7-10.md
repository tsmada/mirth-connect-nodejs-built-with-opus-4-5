<!-- Completed: 2026-02-07 | Status: Implemented -->
# Parity Gap Fixes — Donkey Engine Pipeline

## Context

The parity-checker agent identified **22 gaps** between the Java Mirth Connect Donkey engine and the Node.js port (3 critical, 7 major, 8 minor). Despite strong overall coverage (90% DAO methods, 100% content types, 90% pipeline steps), the two most impactful gaps — **destination queue retry** and **source queue async processing** — mean messages that fail delivery are permanently lost to ERROR status instead of being queued for retry. This plan organizes fixes into 4 implementation waves using **agent teams** (TeamCreate + TaskList coordination) with git worktrees for isolation.

---

## Execution Strategy: Agent Teams

Each wave runs as an **agent team** with a team lead coordinating parallel teammates via TaskList:

```
┌─────────────────────────────────────────────────────────────┐
│  TEAM LEAD (me)                                              │
│  - Creates team via TeamCreate                               │
│  - Creates tasks via TaskCreate                              │
│  - Spawns teammates via Task tool with team_name             │
│  - Assigns tasks to teammates via TaskUpdate                 │
│  - Monitors progress via TaskList + messages                 │
│  - Merges branches after teammates complete                  │
│  - Shuts down team via SendMessage shutdown_request          │
└─────────────────────────────────────────────────────────────┘
         │
         ├──► Teammate: dao-porter (mirth-porter agent)
         ├──► Teammate: validator-porter (mirth-porter agent)
         ├──► Teammate: chain-porter (mirth-porter agent)
         └──► Teammate: attachment-porter (mirth-porter agent)
```

**Per-wave workflow:**
1. `TeamCreate` with team name (e.g., `wave-7-foundation`)
2. `TaskCreate` for each agent's work item with description, branch, and file list
3. `Task` tool to spawn teammates with `team_name` and `subagent_type: "mirth-porter"`
4. `TaskUpdate` to assign tasks to teammates
5. Teammates work autonomously: create worktree, implement, test, commit
6. Team lead monitors via `TaskList` and teammate messages
7. After all teammates complete: merge branches, resolve conflicts, run full test suite
8. `SendMessage` shutdown_request to each teammate, then `TeamDelete`

---

## Wave 7: Foundation (DAO Methods + ResponseValidator + Chain Fix + Attachments)

**Team**: `wave-7-foundation`
**Rationale**: Prerequisites that unblock the critical queue processing in Wave 8. All independent — run in parallel.
**Teammates**: 4 `mirth-porter` agents | **Est. Duration**: 2-3 hrs

### Task 7A: Missing DonkeyDao Methods

**Teammate**: `dao-porter`
**Branch**: `feature/donkey-dao-parity`
**Files**: `src/db/DonkeyDao.ts`

Add 5 new functions:
1. `deleteAllMessages(channelId)` — Truncates D_M, D_MM, D_MC, D_MA, D_MCM for a channel
2. `getConnectorMessageCount(channelId, serverId, metaDataId, status)` — COUNT query on D_MM (needed by queue tracking)
3. `getConnectorMessageStatuses(channelId, messageId, checkProcessed)` — Returns `Map<number, Status>` of metaDataId→status (needed by `removeContent` DB check)
4. `getMaxConnectorMessageId(channelId)` — MAX(MESSAGE_ID) from D_MM (needed by queue recovery)
5. `removeMetaDataColumn(channelId, columnName)` — ALTER TABLE D_MCM DROP COLUMN

**Java Reference**: `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/data/DonkeyDao.java` (lines 63-136)
**Tests**: ~15-20 (in `tests/unit/db/DonkeyDao.test.ts` or new file)

### Task 7B: ResponseValidator

**Teammate**: `validator-porter`
**Branch**: `feature/response-validator`
**New file**: `src/donkey/message/ResponseValidator.ts`
**Modify**: `src/donkey/channel/DestinationConnector.ts`

Create interface + `DefaultResponseValidator` (pass-through). Wire into `DestinationConnector` — after `send()` returns, call `responseValidator.validate(response, connectorMessage)`. Needed by queue processing to detect failed responses (e.g., HL7 NAK) that should trigger retry.

**Java Reference**: `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/DestinationConnector.java` (lines 899-905)
**Tests**: ~8-10

### Task 7C: Destination Chain Chaining Fix

**Teammate**: `chain-porter`
**Branch**: `feature/destination-chain-chaining`
**Files**: `src/donkey/channel/DestinationChain.ts`, `src/donkey/channel/Channel.ts`

Two bugs to fix:
1. **Channel.ts uses a flat loop instead of DestinationChain** (line 694-837): Replace flat `for` loop with proper `DestinationChain.call()` invocation. Group destinations into chains based on `waitForPrevious` flag.
2. **DestinationChain.createNextMessage copies raw instead of encoded** (line 312-321): Java copies the current destination's **ENCODED output** as the next destination's RAW input. Node.js copies `rawContent` — wrong for chained destinations.

**Java Reference**: `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/DestinationChain.java` (lines 69-211)
**Tests**: ~10-12 (test D1 output is D2 input, not source output)

### Task 7D: Attachment Extraction in Pipeline

**Teammate**: `attachment-porter`
**Branch**: `feature/attachment-extraction`
**New file**: `src/donkey/message/AttachmentHandler.ts`
**Modify**: `src/donkey/channel/Channel.ts` (around line 590), `src/donkey/channel/ChannelBuilder.ts`

Create `AttachmentHandler` interface + `NoOpAttachmentHandler`. Wire into `Channel.dispatchRawMessage()` — after raw content is set, before storing to DB: extract attachments, store to D_MA, replace inline content with tokens. DICOM handler can be wired later.

**Java Reference**: `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Channel.java` (lines 1412-1468)
**Tests**: ~8-10

---

## Wave 8: Queue Processing (Critical)

**Team**: `wave-8-queue-processing`
**Rationale**: The #1 and #2 critical findings. Destination queue retry is the most complex single piece of work. Depends on Wave 7A (DAO methods) being merged first.
**Teammates**: 3 `mirth-porter` agents | **Est. Duration**: 4-6 hrs

### Task 8A: Destination Queue Processing Loop

**Teammate**: `dest-queue-porter`
**Branch**: `feature/destination-queue-processing`
**Files**: `src/donkey/channel/DestinationConnector.ts` (major: ~200 lines added), `src/donkey/channel/Channel.ts` (error handling change at line 816)

Implement Java's `DestinationConnector.run()` as an async background loop:
- `startQueueProcessing()` / `stopQueueProcessing()` methods
- Loop: `queue.acquire()` → retry delay → optional re-filter/transform → `send()` → `afterSend()` (persist response, PENDING status, response transformer) → `afterResponse()` (set final status)
- Use `setTimeout`-based loop with `AbortController` for graceful shutdown (replacing Java threads)
- **Critical Channel.ts fix**: In catch block at line 816, when `dest.isQueueEnabled()`, set status to QUEUED + add to queue instead of ERROR

**Java Reference**: `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/DestinationConnector.java` (lines 299-878)
**Tests**: ~25-30 (queue loop, retry backoff, max retries→ERROR, stop, concurrent, filter-in-queue)

### Task 8B: Source Queue Processing

**Teammate**: `source-queue-porter`
**Branch**: `feature/source-queue-processing`
**Files**: `src/donkey/channel/SourceConnector.ts`, `src/donkey/channel/Channel.ts`, `src/donkey/channel/ChannelBuilder.ts`

Implement Java's "Queue on Source" mode:
- Add `respondAfterProcessing: boolean` to `SourceConnector` (default: true)
- In `Channel.dispatchRawMessage()`: if false, persist raw + ACK immediately, add to sourceQueue, return
- Add `processSourceQueue()` background loop in Channel (started in `start()`, stopped in `stop()`)
- Wire `respondAfterProcessing` from channel XML in `ChannelBuilder`

**Java Reference**: `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Channel.java` (lines 1170-1303, 1836-1881)
**Tests**: ~15-20

### Task 8C: PENDING Status + removeContent DB Check

**Teammate**: `pending-porter`
**Branch**: `feature/pending-status-recovery`
**Files**: `src/donkey/channel/Channel.ts`, `src/donkey/channel/DestinationConnector.ts`

Two fixes:
1. **PENDING status** (PC-MPS-003): Before `dest.executeResponseTransformer()` at Channel.ts:751, set status to PENDING and persist. Creates crash-recovery checkpoint.
2. **removeContent DB check** (PC-MTB-001): At Channel.ts:903, replace in-memory check with `getConnectorMessageStatuses()` DB query to verify all destinations complete before pruning content.

**Java Reference**: `DestinationConnector.java` (lines 938-943, 553-603)
**Tests**: ~12-15

---

## Wave 9: Batch Processing + Minor Fixes + Encryption

**Team**: `wave-9-extras`
**Rationale**: Independent of Waves 7-8. Can run in parallel with Wave 8. Batch processing is major but isolated. Minor fixes are small and bundled. Encryption is environment-dependent and scoped to decryption only.
**Teammates**: 3 agents | **Est. Duration**: 2-3 hrs

### Task 9A: Batch Message Processing

**Teammate**: `batch-porter` (mirth-porter)
**Branch**: `feature/batch-processing`
**New files**: `src/donkey/message/BatchAdaptor.ts`, `src/donkey/message/BatchAdaptorFactory.ts`
**Modify**: `src/donkey/channel/SourceConnector.ts`, `src/donkey/channel/Channel.ts`

Implement Java's `SourceConnector.dispatchBatchMessage()`:
- `BatchAdaptor` interface: `getMessage()`, `getBatchSequenceId()`, `isBatchComplete()`, `cleanup()`
- `BatchAdaptorFactory` creates adaptors per data type (HL7v2 splits on MSH, delimited splits on row separator)
- Each sub-message dispatched through `channel.dispatchRawMessage()` with batch metadata in sourceMap

**Java Reference**: `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/SourceConnector.java` (lines 195-290)
**Tests**: ~12-15

### Task 9B: Minor Fixes Bundle

**Teammate**: `minor-fixes` (general-purpose)
**Branch**: `feature/minor-fixes`
**Files**: `src/donkey/channel/Channel.ts`, `src/donkey/channel/DestinationConnector.ts`, `src/db/DonkeyDao.ts`

- **PC-HV-002**: Fix `dataType: 'RAW'` hardcoding at Channel.ts:593,627,746 → use `sourceConnector.getInboundDataType()`. Add `getInboundDataType()` to SourceConnector.
- **PC-IMO-001**: Wrap `this.stats.received++` (line 607) to only update after DB transaction succeeds
- **PC-SI-001**: Make `DestinationConnector.start()/stop()` call `onStart()/onStop()` hooks, dispatch state events
- Add missing DAO overloads: `deleteMessage(channelId, messageId)` single variant, `getMessages(channelId, messageIds[])` bulk

**Tests**: ~15-18

### Task 9C: Encryption Support (Decryption Path Only)

**Teammate**: `encryption-porter` (mirth-porter)
**Branch**: `feature/encryption-support`
**New file**: `src/db/Encryptor.ts`
**Modify**: `src/db/DonkeyDao.ts`

Implement decryption for takeover mode (read encrypted content from Java Mirth):
- `Encryptor` interface with `encrypt()`/`decrypt()`
- Module-level `setDecryptData(flag)` in DonkeyDao
- In `getContent()` and content queries: check `IS_ENCRYPTED` column, decrypt if needed
- Key from env var `MIRTH_ENCRYPTION_KEY` or Java keystore

**Note**: Can be deferred if not needed for current deployment. The interface can be stubbed now.
**Tests**: ~8-10

---

## Wave 10: Integration Wiring + Validation

**Team**: `wave-10-integration`
**Rationale**: Wire all new components together end-to-end. Integration test across waves.
**Teammates**: 2 (sequential, since this is integration) | **Est. Duration**: 2-3 hrs

### Task 10A: ChannelBuilder Wiring + E2E Tests

**Teammate**: `integration-porter` (mirth-porter)
**Branch**: `feature/parity-integration`
**Files**: `src/donkey/channel/ChannelBuilder.ts`, `src/donkey/channel/Channel.ts`

Wire in ChannelBuilder: responseValidator, attachmentHandler, respondAfterProcessing, batchAdaptorFactory, destination chains. Integration tests:
- Queue-enabled destination: send fails → queued → retry → sent
- Source queue: message queued immediately → background processing completes
- Chained destinations: D1 output is D2 input
- PENDING status survives simulated crash + recovery

### Task 10B: Validation Scenarios

**Teammate**: `validation-porter` (mirth-porter)
**Branch**: `feature/parity-validation`
**New**: `validation/scenarios/07-queue-processing/`, `validation/scenarios/07-batch-processing/`

Side-by-side validation against Java Mirth for queue and batch behavior.

---

## Summary

| Wave | Team Name | Teammates | Findings Fixed | Est. Tests | Est. Duration |
|------|-----------|-----------|---------------|------------|---------------|
| 7 | wave-7-foundation | 4 mirth-porter | DAO gaps, ResponseValidator, Chain fix, Attachments | ~45 | 2-3 hrs |
| 8 | wave-8-queue-processing | 3 mirth-porter | Dest queue (CRITICAL), Source queue (CRITICAL), PENDING+removeContent | ~55 | 4-6 hrs |
| 9 | wave-9-extras | 2 mirth-porter + 1 general | Batch processing, Minor fixes, Encryption | ~38 | 2-3 hrs |
| 10 | wave-10-integration | 2 mirth-porter | Integration wiring, Validation scenarios | ~20 | 2-3 hrs |
| **Total** | **4 teams** | **12 agents** | **18 findings** | **~158** | **~10-15 hrs** |

## Team Lifecycle Per Wave

```
1. TeamCreate(team_name="wave-N-xxx")
2. TaskCreate × N (one per agent's work item)
3. Task(subagent_type="mirth-porter", team_name="wave-N-xxx", name="agent-name") × N
4. TaskUpdate(owner="agent-name") × N to assign tasks
5. Monitor: TaskList + auto-delivered messages from teammates
6. After all complete: merge branches on master, resolve conflicts
7. Bash: npm test (verify all tests pass including new ones)
8. SendMessage(type="shutdown_request") × N
9. TeamDelete()
10. Proceed to next wave
```

## Merge Order

1. **7A first** (DAO methods unblock 8A/8C)
2. 7B, 7C, 7D in any order
3. Wave 8 after Wave 7 merged (8A depends on 7A DAO methods, 8C depends on 7A `getConnectorMessageStatuses`)
4. Wave 9 can run in parallel with Wave 8 (no dependencies)
5. Wave 10 last (needs all prior waves)

## Expected Merge Conflicts

`Channel.ts`, `DestinationConnector.ts`, and `DonkeyDao.ts` will be modified by multiple agents across waves. Plan to resolve index file conflicts during merge phase between waves (same pattern as Waves 1-6).

## Verification

After each wave:
1. Run `npm test` — all existing 2,559 tests + new tests must pass
2. Run `npm run validate` — all priority 0-6 scenarios still pass
3. For Wave 8: manually test with a channel that has queue-enabled destinations to verify retry behavior
4. For Wave 10: run integration tests against Java Mirth Docker container

## Critical Files

- `src/donkey/channel/Channel.ts` — Central pipeline; touched by 7C, 7D, 8A, 8B, 8C, 9B
- `src/donkey/channel/DestinationConnector.ts` — Queue loop; touched by 7B, 8A, 9B
- `src/db/DonkeyDao.ts` — DAO methods; touched by 7A, 9B, 9C
- `src/donkey/channel/DestinationChain.ts` — Chain fix; touched by 7C
- `src/donkey/channel/ChannelBuilder.ts` — Wiring; touched by 7D, 8B, 10A
- `src/donkey/channel/SourceConnector.ts` — Source queue; touched by 8B, 9A
