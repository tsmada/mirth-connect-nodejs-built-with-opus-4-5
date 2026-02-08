<!-- Planned: 2026-02-08 | Status: Pending -->

# Plan: Connect MessageArchiver to DataPruner Pipeline

## Context

The DataPruner is now fully operational (committed in `fix(datapruner): wire DataPruner into server lifecycle with per-channel pruning`). The remaining gap is **Gap 8: Archive Not Connected** — the `MessageArchiver` class exists with file writing, XML/JSON formatting, and directory management, but is never called from the pruning pipeline.

In Java Mirth, archiving is a **pre-deletion phase**: messages are exported to files before being deleted from the database. If archiving fails, deletion is skipped for that batch (data safety). The archive configuration is stored per-pruner (not per-channel) and supports zip/tar packaging, gzip compression, and optional encryption.

## Current State

| Component | Status | Notes |
|-----------|--------|-------|
| `MessageArchiver.ts` | Implemented | File writing, JSON/XML format, dir management |
| `MessageArchiver` tests | Missing | No test file exists |
| `DataPruner.archiveEnabled` | Wired | Setter/getter exist, plumbed through controller |
| `DataPruner.archiverBlockSize` | Wired | Default 50, configurable |
| `DataPrunerController` | Partial | Has `archiveEnabled`/`archivingBlockSize` in config but no `archiverOptions` |
| `DataPrunerServlet` | Complete | Config CRUD already works |
| Archive → Prune integration | **Missing** | `pruneChannel()` never calls archiver |

### What MessageArchiver Already Does

- `archiveMessages(channelId, messages[])` — writes batch to files
- `archiveMessage(channelId, message)` — writes single message
- `formatMessage()` — JSON (newline-delimited) or XML serialization
- `openNewFile(channelId)` — creates `{rootFolder}/{channelId}/{YYYY-MM-DD}/messages_{timestamp}.{ext}`
- `closeCurrentFile()` / `finalize()` — clean stream shutdown
- `getArchiveFiles(channelId)` — list archived files
- `deleteOldArchives(channelId, olderThan)` — cleanup old archive dirs
- File rotation: opens new file every `messagesPerFile` messages (default 1000)

### What MessageArchiver Is Missing vs Java Mirth

| Feature | Java Mirth | Node.js | Priority |
|---------|-----------|---------|----------|
| Zip/tar archive packaging | `MessageWriterArchive` wraps `MessageWriterFile` | Not implemented | Low (individual files work fine) |
| Gzip stream compression | `CompressorStreamFactory` | Commented out (line 17) | Medium |
| File pattern variables | `$channelName/$date/$messageId` | Hardcoded pattern | Low |
| Atomic temp→final rename | Writes to `.channelId` then renames | Writes directly | Low |
| Archive password encryption | AES-256-GCM on archive file | Option exists, not implemented | Low |

## Gaps to Fix

### Gap A: Wire Archiver into pruneChannel() (CRITICAL)

**File:** `src/plugins/datapruner/DataPruner.ts` → `pruneChannel()` + new `archiveAndGetIdsToPrune()`

Java Mirth's flow:
```
pruneChannel(task)
  ├─ Calculate thresholds
  ├─ IF archiveEnabled AND task.archiveEnabled:
  │   └─ archiveAndGetIdsToPrune(channelId, threshold, blockSize)
  │       ├─ Query message IDs in archiverBlockSize batches
  │       ├─ For each batch: load full messages from DAO → write to archiver
  │       └─ Return { messageIds, contentMessageIds }
  ├─ ELSE:
  │   └─ getIdsToPrune() (current behavior)
  └─ Delete using returned IDs
```

**Changes needed in `DataPruner.ts`:**

1. Add `private archiverOptions: MessageWriterOptions` field + getter/setter
2. New method `archiveAndGetIdsToPrune(channelId, dateThreshold, skipStatuses)`:
   - Query messages in `archiverBlockSize` batches using `DonkeyDao.getMessagesToPrune()`
   - For each batch, load full message data using `DonkeyDao.getMessage()` + `DonkeyDao.getConnectorMessages()` + `DonkeyDao.getContent()` + optionally `DonkeyDao.getAttachments()`
   - Build `ArchiveMessage` objects from DAO results
   - Call `messageArchiver.archiveMessages(channelId, archiveMessages)`
   - Collect and return message IDs for deletion
3. Modify `pruneChannel()` to call `archiveAndGetIdsToPrune()` when `this.archiveEnabled && task.archiveEnabled`
4. Call `messageArchiver.finalize()` in the `finally` block of `run()`

### Gap B: Build ArchiveMessage from DAO Data

**New helper:** `buildArchiveMessage(channelId, messageRow, connectorRows, contentRows, attachmentRows)`

This converts raw DAO rows into the `ArchiveMessage` interface that `MessageArchiver.archiveMessages()` expects. The mapping:

```typescript
ArchiveMessage = {
  messageId:    messageRow.ID,
  serverId:     messageRow.SERVER_ID,
  channelId:    channelId,
  receivedDate: messageRow.RECEIVED_DATE,
  processed:    messageRow.PROCESSED === 1,
  originalId:   messageRow.ORIGINAL_ID ?? undefined,
  connectorMessages: connectorRows.map(cm => ({
    metaDataId:    cm.METADATA_ID,
    channelId,
    channelName:   task.channelName,
    connectorName: cm.CONNECTOR_NAME,
    serverId:      messageRow.SERVER_ID,
    receivedDate:  cm.RECEIVED_DATE,
    status:        cm.STATUS,
    sendAttempts:  cm.SEND_ATTEMPTS,
    // Content loaded from D_MC rows, keyed by (MESSAGE_ID, METADATA_ID, CONTENT_TYPE)
    raw:           findContent(contentRows, cm, ContentType.RAW),
    transformed:   findContent(contentRows, cm, ContentType.TRANSFORMED),
    sent:          findContent(contentRows, cm, ContentType.SENT),
    response:      findContent(contentRows, cm, ContentType.RESPONSE),
    // Maps
    sourceMapContent:    findContentString(contentRows, cm, ContentType.SOURCE_MAP),
    connectorMapContent: findContentString(contentRows, cm, ContentType.CONNECTOR_MAP),
    channelMapContent:   findContentString(contentRows, cm, ContentType.CHANNEL_MAP),
    responseMapContent:  findContentString(contentRows, cm, ContentType.RESPONSE_MAP),
  })),
  attachments: attachmentRows.map(a => ({
    id:      a.ID,
    type:    a.TYPE ?? 'application/octet-stream',
    content: a.ATTACHMENT?.toString('base64') ?? '',
  })),
};
```

### Gap C: Expose archiverOptions in DataPrunerController

**File:** `src/plugins/datapruner/DataPrunerController.ts`

Add `archiverOptions` to `DataPrunerConfig`:
```typescript
export interface DataPrunerConfig {
  // ... existing fields ...
  archiverOptions?: MessageWriterOptions;
}
```

Wire through `applyConfiguration()`:
```typescript
if (this.config.archiverOptions) {
  dataPruner.setArchiverOptions(this.config.archiverOptions);
}
```

The servlet already handles arbitrary config updates via `PUT /extensions/datapruner/config`, so no servlet changes needed.

### Gap D: Enable gzip compression (optional enhancement)

**File:** `src/plugins/datapruner/MessageArchiver.ts` → `openNewFile()`

Uncomment and wire the zlib import:
```typescript
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

// In openNewFile():
if (this.options.compress) {
  const gzip = createGzip();
  const fileStream = fs.createWriteStream(this.currentFilePath);
  gzip.pipe(fileStream);
  this.currentFile = gzip as unknown as fs.WriteStream;  // duck-type compatible
} else {
  this.currentFile = fs.createWriteStream(this.currentFilePath);
}
```

### Gap E: DonkeyDao bulk content loading

**File:** `src/db/DonkeyDao.ts`

Add a method to load all content rows for a batch of message IDs (avoids N+1 queries):
```typescript
export async function getContentBatch(
  channelId: string,
  messageIds: number[]
): Promise<ContentRow[]> {
  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');
  const [rows] = await pool.query<ContentRow[]>(
    `SELECT * FROM ${contentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
    messageIds
  );
  return rows;
}
```

Similarly for attachments:
```typescript
export async function getAttachmentsBatch(
  channelId: string,
  messageIds: number[]
): Promise<AttachmentRow[]> {
  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');
  const [rows] = await pool.query<AttachmentRow[]>(
    `SELECT * FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders}) ORDER BY ID, SEGMENT_ID`,
    messageIds
  );
  return rows;
}
```

## Implementation Phases

### Phase 1: Core Integration (Gaps A, B, E)

Wire the archiver into the pruning pipeline with batch-efficient DAO queries.

| File | Changes |
|------|---------|
| `src/db/DonkeyDao.ts` | Add `getContentBatch()`, `getAttachmentsBatch()` (~20 lines) |
| `src/plugins/datapruner/DataPruner.ts` | Add `archiverOptions` field, `archiveAndGetIdsToPrune()`, `buildArchiveMessage()`, modify `pruneChannel()` (~100 lines) |

### Phase 2: Config & Controller (Gap C)

Make archive options configurable and persistent.

| File | Changes |
|------|---------|
| `src/plugins/datapruner/DataPrunerController.ts` | Add `archiverOptions` to config, wire through `applyConfiguration()` (~15 lines) |

### Phase 3: Compression (Gap D, optional)

Enable gzip compression for archive files.

| File | Changes |
|------|---------|
| `src/plugins/datapruner/MessageArchiver.ts` | Wire zlib gzip stream in `openNewFile()` (~15 lines) |

## Reusable Functions Already Available

- `DonkeyDao.getMessage(channelId, messageId)` → single message row
- `DonkeyDao.getMessages(channelId, messageIds[])` → batch message rows
- `DonkeyDao.getConnectorMessages(channelId, messageId)` → connector messages for one message
- `DonkeyDao.getContent(channelId, messageId, metaDataId, contentType)` → single content row
- `DonkeyDao.getAttachments(channelId, messageId)` → attachments for one message
- `MessageArchiver.archiveMessages(channelId, messages[])` → write batch to files
- `MessageArchiver.finalize()` → close all open file handles

## Verification Plan

1. **Unit tests for `buildArchiveMessage()`:**
   - Verify DAO rows are correctly mapped to `ArchiveMessage` interface
   - Verify missing content types produce `undefined` (not errors)
   - Verify attachments are base64 encoded

2. **Unit tests for `archiveAndGetIdsToPrune()`:**
   - Mock DonkeyDao to return message + content + attachment rows
   - Verify archiver is called with correctly built `ArchiveMessage` objects
   - Verify returned IDs match the messages that were archived
   - Verify archiver NOT called when `archiveEnabled=false`

3. **Integration test:**
   - Create temp directory for archives
   - Run pruner with archiveEnabled=true against mocked DAO
   - Verify archive files are created with correct JSON content
   - Verify messages are deleted after archiving

4. **MessageArchiver tests (new file):**
   - `archiveMessages()` creates directory structure
   - File rotation at `messagesPerFile` boundary
   - JSON and XML format output correctness
   - `finalize()` closes file handles
   - `deleteOldArchives()` cleans up date-based dirs

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Archive fails, messages still deleted | Archive BEFORE delete; on archiver error, skip deletion for that batch (matching Java Mirth behavior) |
| Disk space exhaustion from archives | `deleteOldArchives()` already implemented; add configurable retention |
| Slow archiving blocks pruner | archiverBlockSize (50) limits per-query load; batch DAO queries reduce round trips |
| Archive dir permissions | Use `fs.promises.mkdir({ recursive: true })` which handles existing dirs gracefully |

## Estimated Scope

- **~150 lines** of new/modified production code
- **~200 lines** of new tests
- **5 files** modified
- **1 new test file** (`MessageArchiver.test.ts`)
