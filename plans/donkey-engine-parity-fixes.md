<!-- Completed: 2026-02-07 | Status: Implemented -->

# Parity Fix Plan: Java↔Node.js Donkey Engine Gaps

## Context

A comprehensive parity-checker scan found **23 gaps** between Java Mirth's Donkey engine and the Node.js port. This plan addressed all **5 critical** and **10 major** issues across 3 agents in 2 waves.

## Results

| Metric | Value |
|--------|-------|
| Agents used | 3 (dao-foundation, pipeline-transactions, recovery-refactor) |
| Waves | 2 (sequential then parallel) |
| Tests added | 76 new tests |
| Total tests passing | 3,062 (147 suites) |
| Files modified | 8 |

## Changes Summary

### Phase 0: Bug Fixes
- **0A**: Fixed RESPONSE_ERROR content type — was using `15` (SOURCE_MAP), now uses `ContentType.RESPONSE_ERROR` (14)
- **0B**: Fixed `ConnectorMessage.clone()` — now copies sourceMap and responseMap (destinations can access `$s('key')`)
- **0C**: Fixed SOURCE_MAP to use `storeContent` (upsert) instead of `insertContent` — prevents duplicate key on reprocessing

### Phase 1: Transactional DAO Pattern
- **1A**: Added optional `conn?: DbConnection` parameter to 12 DAO functions — enables transaction reuse
- **1B**: Added `batchInsertContent()` for multi-row INSERT
- **1C**: Added `getConnectorMessagesByStatus()` and `getPendingConnectorMessages()` query methods
- **1D**: Exported table name helpers from DonkeyDao

### Phase 2: Transaction Boundaries in Pipeline
- **2A**: Added `persistInTransaction()` helper passing PoolConnection to each operation
- **2B**: Restructured `dispatchRawMessage()` into 4 transaction phases (Source Intake, Source Processing, Per-Destination, Finish)
- **2C**: SOURCE_MAP written early in Txn 2 (insertContent) and upserted at end (storeContent)
- **2D**: Used `storeContent` for retry-safe paths (SENT, RESPONSE, RESPONSE_TRANSFORMED, PROCESSED_RESPONSE)

### Phase 3: MetaDataReplacer Integration
- **3A**: Added `metaDataColumns` to ChannelConfig
- **3B**: Wired through ChannelBuilder from channel properties
- **3C**: Called `setMetaDataMap()` after source and destination transformers, gated by `storeCustomMetaData`

### Phase 4: RecoveryTask Refactor
- **4A**: Removed 4 duplicate table name helpers, imported from DonkeyDao
- **4B**: Replaced raw pool calls with typed DAO functions
- **4C**: Wrapped each message's recovery in `transaction()` for atomicity

### Phase 5: insertConnectorMessage Enhancement
- **5A**: Added `storeMaps` and `updateStats` options to `insertConnectorMessage`

## Files Modified

| File | Changes |
|------|---------|
| `src/db/DonkeyDao.ts` | conn param, batch insert, query methods, exports, bug fix |
| `src/model/ConnectorMessage.ts` | clone() map copying |
| `src/donkey/channel/Channel.ts` | Transaction boundaries, MetaDataReplacer, upsert fix |
| `src/donkey/channel/ChannelBuilder.ts` | metaDataColumns wiring |
| `src/donkey/channel/RecoveryTask.ts` | DAO-based recovery with transactions |
| `tests/unit/db/DonkeyDao.test.ts` | 62 tests |
| `tests/unit/model/ConnectorMessage.test.ts` | 16 tests |
| `tests/unit/donkey/channel/Channel.test.ts` | 78 tests |
| `tests/unit/donkey/channel/RecoveryTask.test.ts` | 8 tests |

## Agent Execution

```
Wave 1 (Sequential): dao-foundation
  └── DonkeyDao.ts + ConnectorMessage.ts (Phases 0A, 0B, 1A-D, 5A)

Wave 2 (Parallel):
  ├── pipeline-transactions → Channel.ts + ChannelBuilder.ts (Phases 0C, 2, 3, 5B)
  └── recovery-refactor → RecoveryTask.ts (Phases 4A-C)
```
