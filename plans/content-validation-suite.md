# Message Lifecycle & Transformer Content Validation Plan

<!-- Completed: 2026-02-21 | Status: Implemented | Result: 37/37 PASS -->

## Context

We need to validate that the Node.js Mirth port's message pipeline produces correct **content** at every stage when deployed to Kubernetes — not just correct status codes. While 8,326 unit/integration tests verify code correctness and the deep validation suite checks message counts/integrity, no test currently sends a known message through a deployed channel and then inspects the D_MC content tables to verify the actual transformed data matches expectations.

### Lifecycle Audit Summary (Completed)

The Node.js port correctly implements the Java Mirth 4-transaction pipeline:

| Transaction | Source Status | Content Persisted | Verified |
|-------------|-------------|-------------------|----------|
| Txn 1: Source intake | RECEIVED | RAW, sourceMap (optional) | Yes |
| Txn 2: Source processing | FILTERED or TRANSFORMED | PROCESSED_RAW, TRANSFORMED, ENCODED, SOURCE_MAP, custom metadata | Yes |
| Txn 3: Per-destination | SENT / QUEUED / ERROR | ENCODED, SENT, RESPONSE, RESPONSE_TRANSFORMED, PROCESSED_RESPONSE | Yes |
| Txn 4: Finish | (source updated) | Source RESPONSE, merged responseMap, PROCESSED flag | Yes |

All 7 statuses defined: R(RECEIVED), F(FILTERED), T(TRANSFORMED), S(SENT), Q(QUEUED), E(ERROR), P(PENDING). Status transitions match Java exactly. StorageSettings DEVELOPMENT mode persists all 15+ content types (`StorageSettings.ts` — all flags default `true`).

**One simplification vs Java**: No inline retry loop in `Channel.ts` send path (Java has `retryCount`/`retryIntervalMillis`). Node.js delegates all retry to the destination queue. Functional outcome is identical for queue-enabled destinations.

### The Gap

No test validates that **the text content** of D_MC rows at each pipeline stage matches expected output after real E4X transpilation, XML serialization, filter execution, and transformer scope readback in a deployed environment with real MySQL persistence.

---

## Plan: Content Validation Test Suite

### Approach

Create 6 purpose-built **Content Validation (CV)** channels, each targeting specific pipeline stages. Deploy to Rancher Desktop standalone overlay, send deterministic test messages, query D_MC tables, compare against baseline files.

### Why New Channels (Not Kitchen Sink)

Kitchen Sink channels have external dependencies (SMTP/MailHog, JDBC to `ks_messages`, File writes, cross-channel VM routing) that introduce non-determinism and ordering dependencies. CV channels are **self-contained**: HTTP source → JavaScript transforms → VM sink. No external infra beyond Mirth's own MySQL.

### Channel Designs

#### CV01: HL7 Filter/Transform
- **Port**: 8120, contextPath `/cv01`
- **Data types**: HL7V2 → HL7V2
- **Preprocessor**: Sets `$c('preprocessorRan', 'true')`, returns message unchanged
- **Source filter**: Accept only `ADT` message types (E4X: `msg['MSH']['MSH.9']['MSH.9.1']`)
- **Source transformer**: Extract PID.3.1 (patientId), PID.5 (name), PID.8 (gender) into channelMap
- **Mapper step**: `patientGender` from `msg['PID']['PID.8']`
- **Destination**: 1x VM sink
- **Postprocessor**: Sets `$c('postprocessorRan', 'true')`
- **Validates**: RAW, PROCESSED_RAW, TRANSFORMED, ENCODED, SOURCE_MAP, dest SENT
- **Storage mode**: DEVELOPMENT

#### CV02: JSON Transform + Response Transformer
- **Port**: 8121, contextPath `/cv02`
- **Data types**: RAW → RAW
- **Source transformer**: Parse JSON body, build XML result string, write to `msg`
- **Destination**: 1x VM sink
- **Response transformer**: Set `responseStatus=SENT`, `responseStatusMessage='CV02_OK'`, write to channelMap
- **Validates**: TRANSFORMED, RESPONSE, RESPONSE_TRANSFORMED, response status readback

#### CV03: Multi-Destination + DestinationSet
- **Port**: 8122, contextPath `/cv03`
- **Data types**: RAW → RAW
- **Source transformer**: Parse JSON, conditionally call `destinationSet.remove('Dest 2')`
- **Destinations**: 3x VM sinks (Dest 1, Dest 2, Dest 3)
- **Validates**: Dest 2 has FILTERED status + no SENT content; Dest 1/3 have ENCODED + SENT

#### CV04: Postprocessor Response + $r() Access
- **Port**: 8123, contextPath `/cv04`
- **Data types**: RAW → RAW
- **Destination**: 1x VM sink
- **Postprocessor**: Access `$r('d1')`, return `new Response(SENT, JSON.stringify(...))`
- **Validates**: PROCESSED_RESPONSE on source, SOURCE_MAP contains `$r()` data

#### CV05: Source Filter Reject
- **Port**: 8124, contextPath `/cv05`
- **Data types**: RAW → RAW
- **Source filter**: Reject messages not containing "ACCEPT"
- **Validates**: Status=FILTERED, only RAW exists, no TRANSFORMED/ENCODED/SENT rows

#### CV06: E4X Deep Operations
- **Port**: 8125, contextPath `/cv06`
- **Data types**: HL7V2 → HL7V2
- **Source transformer** (4 steps):
  1. Descendant access: `msg..OBX`, count to channelMap
  2. For-each iteration: collect OBX values
  3. Delete operation: `delete msg['NTE']`
  4. createSegment: add ZCV custom segment
- **Validates**: TRANSFORMED has NTE removed + ZCV added, SOURCE_MAP has extracted values

### Pipeline Coverage Matrix

| Stage | CV01 | CV02 | CV03 | CV04 | CV05 | CV06 |
|-------|------|------|------|------|------|------|
| Preprocessor | X | | | | | |
| Source filter (accept) | X | | | | | |
| Source filter (reject) | | | | | X | |
| Source transformer | X | X | X | X | | X |
| Mapper step | X | | | | | |
| DestinationSet | | | X | | | |
| Dest filter | X | X | X | | | X |
| Response transformer | | X | | | | |
| Postprocessor | X | | | X | | |
| `$r()` access | | | | X | | |
| E4X descendant `..` | | | | | | X |
| E4X for-each | | | | | | X |
| E4X delete | | | | | | X |
| E4X createSegment | | | | | | X |

### Content Type Coverage

| ContentType | CV01 | CV02 | CV03 | CV04 | CV05 | CV06 |
|-------------|------|------|------|------|------|------|
| RAW (1) | src | src | src | src | src | src |
| PROCESSED_RAW (2) | src | | | | | |
| TRANSFORMED (3) | src | src | src | | ABSENT | src |
| ENCODED (4) | src+d1 | src+d1 | d1,d3 | src+d1 | ABSENT | src+d1 |
| SENT (5) | d1 | d1 | d1,d3 | d1 | ABSENT | d1 |
| RESPONSE (6) | | d1 | | d1 | | |
| RESPONSE_XFORM (7) | | d1 | | | | |
| PROCESSED_RESP (8) | | | | src | | |
| SOURCE_MAP (15) | src | src | src | src | | src |

### Test Messages (Deterministic)

All messages use fixed timestamps, IDs, and patient data — fully reproducible.

- `cv01-adt-a01.hl7` — HL7 ADT A01 with MRN `CV12345`, patient `SMITH^JOHN`, DOB `19800101`
- `cv01-non-adt.hl7` — HL7 ORU (triggers filter reject on CV01)
- `cv02-patient.json` — `{"id":"CV_PAT_002","name":{"given":"ALICE","family":"JOHNSON"}}`
- `cv03-multi-dest.json` — `{"route":"SKIP_D2","payload":"multi-dest-validation"}`
- `cv04-postprocessor.json` — `{"testId":"CV04","action":"verify_postprocessor"}`
- `cv05-reject.json` — `{"action":"REJECT_THIS"}` (no "ACCEPT" → filtered)
- `cv06-lab-oru.hl7` — HL7 ORU R01 with 3 OBX segments + 1 NTE

### Baseline Strategy (Two-Phase)

**Phase 1 — Bootstrap**: Run validation once with `--generate-baselines` flag. Script captures actual D_MC content and writes to `baselines/` directory. Operator reviews for correctness.

**Phase 2 — Regression**: Subsequent runs compare against reviewed baselines. Any diff = FAIL.

**Comparison modes**:
- **EXACT**: Byte-for-byte after whitespace normalization (for RAW, TRANSFORMED, ENCODED, SENT)
- **JSON_SUBSET**: Parse as JSON, verify expected keys exist with correct values (for SOURCE_MAP)
- **CONTAINS**: Grep for expected substrings (for RESPONSE content with possible timestamps)
- **ABSENT**: Verify query returns zero rows (for CV05 filtered content)

### Verification Script Design

**`run-content-validation.sh`** — end-to-end orchestrator:

```
Phase 1: Prerequisites
  └─ Verify k3s running, standalone overlay deployed, MySQL ready

Phase 2: Deploy CV Channels
  └─ Upload 6 channels via REST API, deploy, wait for STARTED

Phase 3: Send Test Messages
  └─ curl POST to each port/contextPath, wait 5s for pipeline completion

Phase 4: Resolve Table Names
  └─ Query D_CHANNELS for LOCAL_CHANNEL_ID → build D_MC table name map

Phase 5: Verify Content (~55 checks)
  └─ For each (channel, metadataId, contentType):
     query D_MC, compare against baseline, report PASS/FAIL

Phase 6: Verify Statuses
  └─ Query D_MM for expected status values per connector message

Phase 7: Report
  └─ Summary: X/Y checks passed, exit code 0 or 1
```

### Directory Structure

```
k8s/content-validation/
├── channels/                          # 6 channel XML files
│   ├── cv01-hl7-filter-transform.xml
│   ├── cv02-json-response-transform.xml
│   ├── cv03-multi-dest-fan-out.xml
│   ├── cv04-postprocessor-response.xml
│   ├── cv05-source-filter-reject.xml
│   └── cv06-e4x-deep-ops.xml
├── messages/                          # 8 deterministic test messages
│   ├── cv01-adt-a01.hl7
│   ├── cv01-non-adt.hl7
│   ├── cv02-patient.json
│   ├── cv03-multi-dest.json
│   ├── cv04-postprocessor.json
│   ├── cv05-reject.json
│   └── cv06-lab-oru.hl7
├── baselines/                         # Generated on first run, reviewed, committed
│   ├── cv01/
│   │   ├── source-raw.txt
│   │   ├── source-processed-raw.txt
│   │   ├── source-transformed.txt
│   │   ├── source-encoded.txt
│   │   ├── source-map.json
│   │   ├── dest1-encoded.txt
│   │   └── dest1-sent.txt
│   ├── cv02/ ... cv06/
│   └── .generated                     # Sentinel: delete to force regeneration
├── sql/
│   ├── setup-cv.sql                   # Helper procs for table resolution
│   └── verify-content.sql             # Parameterized content queries
├── scripts/
│   ├── deploy-cv-channels.sh          # Upload + deploy + wait
│   ├── send-test-messages.sh          # Send messages via curl
│   ├── verify-content.sh              # Query DB + compare baselines
│   └── run-content-validation.sh      # End-to-end orchestrator
└── patches/
    └── standalone-cv-ports.yaml       # Kustomize strategic merge for ports 8120-8125
```

### Kustomize Port Patch

Add ports 8120-8125 to the standalone overlay's Deployment and Service via strategic merge patch. Existing standalone overlay remains unchanged — the CV patch layers on top.

### Implementation Steps

1. **Create channel XML files** (6 files, ~200 lines each) — follow DV01 XML structure as template
2. **Create test messages** (8 files, ~5-15 lines each)
3. **Create Kustomize port patch** (1 file)
4. **Create `deploy-cv-channels.sh`** (~150 lines) — follows `deploy-kitchen-sink.sh` pattern
5. **Create `send-test-messages.sh`** (~80 lines) — curl-based message sending
6. **Create `verify-content.sh`** (~350 lines) — SQL query + baseline comparison engine
7. **Create `run-content-validation.sh`** (~120 lines) — end-to-end orchestrator
8. **Create SQL helpers** (~100 lines)
9. **Bootstrap run** — deploy, send, generate baselines, review
10. **Commit reviewed baselines** — lock in expected outputs

### Estimated Scope

| Component | Files | Lines |
|-----------|-------|-------|
| Channel XML | 6 | ~1,200 |
| Test messages | 8 | ~60 |
| Shell scripts | 4 | ~700 |
| SQL helpers | 2 | ~100 |
| Kustomize patch | 1 | ~40 |
| Baselines (generated) | ~30 | ~600 |
| **Total** | **~51** | **~2,700** |

~55 individual content/status checks across 6 channels.

### Success Criteria

- All ~55 content checks pass on fresh standalone deployment
- `run-content-validation.sh` exits 0
- Reproducible: running twice produces identical results
- Completes in under 3 minutes (deploy + send + verify)
- No manual intervention after initial baseline review

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| HL7V2 XML serialization format varies | Generate baselines from first run; review once |
| MESSAGE_ID is auto-incremented | Use `MIN(MESSAGE_ID)` not hardcoded 1 |
| D_MC whitespace varies | Normalize with `tr -d '\r'` + trim |
| Channel local ID depends on deploy order | Resolve dynamically from D_CHANNELS |
| kubectl exec line endings | Normalize all comparisons |

### Key Reference Files

| File | Why |
|------|-----|
| `src/donkey/channel/Channel.ts:982-1670` | All 4 transactions with content persistence |
| `src/donkey/channel/StorageSettings.ts` | DEVELOPMENT mode = all content types stored |
| `src/javascript/runtime/JavaScriptExecutor.ts:181-405` | Filter/transformer/response transformer execution + scope readback |
| `src/model/Status.ts` | 7 status values + isFinalStatus() |
| `k8s/deep-validation/channels/dv01-*.xml` | Channel XML template to follow |
| `k8s/deep-validation/sql/verify-messages.sql` | SQL pattern for D_MC table resolution |
