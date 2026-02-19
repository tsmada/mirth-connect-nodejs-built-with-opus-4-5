# Deep Functional Validation Suite

Production resilience testing for Node.js Mirth Connect: chaos engineering, multi-hop integration patterns, heavy JavaScript/E4X transformer stress, protocol edge cases, and end-to-end data integrity verification on real K8s infrastructure.

## Quick Start

```bash
# 1. Setup infrastructure (builds image, deploys infra + cluster overlay)
./k8s/scripts/setup.sh

# 2. Deploy cluster overlay
kubectl apply -k k8s/overlays/cluster/

# 3. Port-forward the API
kubectl port-forward -n mirth-cluster svc/node-mirth 8080:8080 &

# 4. Deploy DV channels (alongside existing kitchen-sink channels)
./k8s/deep-validation/scripts/deploy-channels.sh http://localhost:8080

# 5. Run full validation suite
./k8s/deep-validation/scripts/run-deep-validation.sh

# 6. Run single stage
./k8s/deep-validation/scripts/run-deep-validation.sh --stage correctness
./k8s/deep-validation/scripts/run-deep-validation.sh --stage chaos

# 7. Run with 2-hour soak (pre-release certification)
./k8s/deep-validation/scripts/run-deep-validation.sh --full-soak

# 8. View report
open k8s/deep-validation/reports/dv-*/report.html
```

## Directory Structure

```
k8s/deep-validation/
  README.md                              # This file
  channels/                              # 12 purpose-built channels
    dv01-adt-enrichment-pipeline.xml     # HL7 intake -> JS enrichment -> multi-dest
    dv02-json-api-gateway.xml            # JSON -> E4X transform -> VM fan-out to 3 channels
    dv03-json-dest-a.xml                 # VM receiver route A -> JDBC + File
    dv04-json-dest-b.xml                 # VM receiver route B -> JDBC
    dv05-json-dest-c.xml                 # VM receiver route C -> JDBC + JMS
    dv06-batch-processor.xml             # File poll -> batch HL7 split -> JDBC + custom metadata
    dv07-heavy-transformer.xml           # MLLP -> 120-line JS (E4X, maps, utilities) -> File
    dv08-error-injection.xml             # Configurable failure rate via $g('dv08FailRate')
    dv09-chain-a.xml                     # Chain entry (HTTP) -> VM dispatch to DV10
    dv10-chain-b.xml                     # VM receiver -> VM dispatch to DV11
    dv11-chain-c.xml                     # VM receiver -> VM dispatch to DV12
    dv12-chain-d.xml                     # VM receiver terminal -> File + JDBC (verify hop_count=4)
  code-templates/
    dv-enrichment-lib.xml                # DB lookup, HTTP callout, date/MRN helpers
    dv-e4x-stress-lib.xml               # E4X manipulation library (XML builder, PHI scrub)
  messages/
    adt-enrichment.hl7                   # Rich ADT A01 with Z-segments, repeating PID.3
    patient-api.json                     # JSON gateway payload (name, identifiers, telecom)
    batch-10-messages.hl7                # 10 HL7 messages for batch split testing
    heavy-transform-input.hl7            # 15 OBX, 3 NK1, IN1/IN2, ZPI/ZMG segments
    chain-payload.json                   # Simple JSON for chain tracing
    malformed-hl7.hl7                    # Missing MSH.9, wrong delimiters, truncated
    oversized-payload.hl7                # ~1MB HL7 with 500 OBX segments
  sql/
    setup.sql                            # Create dv_* tables for verification
    teardown.sql                         # Drop all dv_* tables
    verify-messages.sql                  # Stuck message detection (PROCESSED=0)
    verify-statistics.sql                # D_MS vs D_MM count comparison
    verify-integrity.sql                 # Orphaned content, duplicate IDs, server distribution
  k6/
    configmap.yaml                       # k6 scripts as ConfigMap (6 scripts)
    job-sustained-load.yaml              # 30-min multi-protocol flow
    job-spike-test.yaml                  # 10x traffic spike + recovery
    job-soak-test.yaml                   # 30-min leak detection (2hr with FULL_SOAK)
    job-chaos-load.yaml                  # Continuous injection during disruption
    job-correctness.yaml                 # 100 known messages with verified output
    job-protocol-edge.yaml               # Malformed, oversized, wrong content-type
  chaos/
    pod-kill.sh                          # Kill pod during processing -> verify recovery
    mysql-restart.sh                     # Restart MySQL -> verify reconnect
    scale-down-under-load.sh             # 3->1 replicas -> verify graceful drain
    memory-pressure.sh                   # Reduce limits -> verify OOM handling
    network-partition.sh                 # Block MySQL -> verify health 503
    chaos-orchestrator.sh                # Sequential all-chaos suite
  validation/
    verify-all.sh                        # Master: run all checks, produce JSON summary
    verify-messages.sh                   # No stuck PROCESSED=0 or STATUS=R/P
    verify-statistics.sh                 # D_MS counts match D_MM actuals
    verify-integrity.sh                  # No orphans, no dup IDs, server distribution
    verify-recovery.sh                   # Post-chaos: messages recovered or terminal
    generate-report.sh                   # HTML/JSON report generation
  scripts/
    setup.sh                             # SQL setup + global map initialization
    teardown.sh                          # Remove DV channels + clean tables
    deploy-channels.sh                   # Upload templates + channels + deploy
    run-deep-validation.sh               # Master orchestrator
  reports/                               # Generated reports (gitignored)
```

## Test Channels

### Channel Map

| Channel | Port | Source | Destinations | Key Tests |
|---------|------|--------|-------------|-----------|
| DV01 | 8110 | HTTP/HL7 | JDBC, File, SMTP, VM | Multi-dest, enrichment, $c/$gc/$s maps |
| DV02 | 8111 | HTTP/JSON | VM x3 (fan-out) | E4X transforms, routing, response aggregation |
| DV03 | VM | Channel Reader | JDBC, File | Route A receiver |
| DV04 | VM | Channel Reader | JDBC | Route B receiver |
| DV05 | VM | Channel Reader | JDBC, JMS | Route C receiver + JMS |
| DV06 | File | File Reader | JDBC, File+metadata | Batch HL7 split, custom metadata |
| DV07 | 6675 | MLLP/TCP | File x2 | ALL 7 script types, 120-line transformer |
| DV08 | 8112 | HTTP | File x2 | Configurable error injection |
| DV09 | 8113 | HTTP/JSON | VM (chain) | Chain entry, hop tracking |
| DV10 | VM | Channel Reader | VM (chain) | Hop 2 |
| DV11 | VM | Channel Reader | VM (chain) | Hop 3 |
| DV12 | VM | Channel Reader | JDBC, File | Chain terminal, verify hop_count=4 |

### What Each Channel Exercises

**DV01 (ADT Enrichment Pipeline)**: The workhorse. Tests HL7v2 parsing with repeating PID.3 fields, code template function calls (`normalizePatientName`, `lookupPatientByMRN`, `buildEventDescription`, `formatMirthDate`), multi-destination routing (JDBC, File, SMTP, VM), map variable propagation ($c, $gc), and destination-level filtering (SMTP only fires for A01 events).

**DV02 (JSON API Gateway)**: E4X stress test. Parses JSON input, builds XML using E4X patterns (`buildPatientXml` code template), performs age/gender-based routing to three VM destinations. Tests E4X XML literals, @attr writes, descendant access, for-each loops, += append, filter predicates, `toXMLString()`, `elements()`, `text()`.

**DV03-DV05 (VM Receiver Routes)**: Validate deterministic routing. Each message should appear in exactly one route table based on the routing key set by DV02. DV05 additionally tests JMS dispatch to ActiveMQ.

**DV06 (Batch Processor)**: File-based batch HL7 ingestion. Tests File Reader polling, MSH-based batch splitting (10 messages per file), per-message JDBC persistence, and custom metadata via `connectorMessage.setMetaDataMap()`. Verifies batch sequence tracking and D_MCM table persistence.

**DV07 (Heavy Transformer)**: The JavaScript runtime stress test. All 7 script types: deploy, undeploy, preprocessor, source transformer (120 lines), filter, destination transformer, response transformer, postprocessor. Uses ALL 6 map variable types ($c, $s, $gc, $g, $cfg, $co). Calls code template functions, utility classes (DateUtil, Lists, Maps), DatabaseConnection, `validate()`, `createSegment()`, `createSegmentAfter()`.

**DV08 (Error Injection)**: Configurable failure rate via `$g('dv08FailRate')`. Dest 1 throws conditionally, Dest 2 always succeeds. Validates that ERROR count matches expected rate within tolerance, and that successful destinations aren't affected by sibling failures.

**DV09-DV12 (4-Hop Chain)**: Tests cross-channel VM routing and sourceMap propagation across 4 channels. DV09 initializes `chainId` and `hopCount`, each subsequent channel reads from `$s()` (sourceMap) and increments. Terminal DV12 writes to JDBC with final `hop_count=4`. Validates the Trace API can reconstruct the full 4-level tree.

## k6 Test Scenarios

| Scenario | Duration | VUs | Target | Thresholds |
|----------|----------|-----|--------|-----------|
| Sustained Load | 30 min | 5-10 per protocol | DV01, DV02, DV07 | p95<500ms HTTP, <1s MLLP, err<1% |
| Spike Test | ~10 min | 5->50->5 | DV01, DV02 | p99<5s during spike, err<5% |
| Soak Test | 30 min / 2hr | 3 msg/sec constant | DV01, DV02 | Last-5min p95 < 2x first-5min, err<0.1% |
| Chaos Load | 10 min | 5 msg/sec | DV01, DV08 | err<30% (relaxed for disruption) |
| Correctness | ~5 min | 1 (sequential) | DV01, DV02, DV09 | 100 messages, exact count verification |
| Protocol Edge | ~5 min | 1-50 burst | DV01, DV08 | No 5xx crashes, appropriate 4xx |

## Chaos Engineering Scenarios

| Scenario | Script | What It Tests |
|----------|--------|---------------|
| Pod Kill | `pod-kill.sh` | RecoveryTask picks up in-flight messages from killed pod |
| MySQL Restart | `mysql-restart.sh` | Connection pool reconnect, deadlock retry via `withRetry()` |
| Scale Down | `scale-down-under-load.sh` | Graceful drain (health 503, in-flight complete, OFFLINE in D_SERVERS) |
| Memory Pressure | `memory-pressure.sh` | OOM behavior with heavy transformers (informational) |
| Network Partition | `network-partition.sh` | Health endpoint degrades, recovery after partition heals |

## Verification Criteria

### Mandatory (all must pass)

| Check | Criteria | Script |
|-------|----------|--------|
| No stuck messages | `PROCESSED=0` count = 0 across all DV channels | `verify-messages.sh` |
| No pending connectors | No `STATUS='R'` or `STATUS='P'` in any D_MM | `verify-messages.sh` |
| Statistics accuracy | D_MS counts match actual D_MM status counts | `verify-statistics.sh` |
| No duplicate IDs | No duplicate MESSAGE_ID in any D_M table | `verify-integrity.sh` |
| No orphaned content | Every D_MC row has matching D_MM row | `verify-integrity.sh` |
| Chain integrity | All `dv_chain_results.hop_count == 4` | `verify-integrity.sh` |
| Route determinism | No message in multiple route tables | `verify-integrity.sh` |
| Enrichment completeness | All dv_enriched_messages have non-null mrn + event_desc | `verify-messages.sh` |
| Post-chaos recovery | No messages stuck after pod kill | `verify-recovery.sh` |
| Post-MySQL-restart | Health 200, new messages process | `verify-recovery.sh` |
| Graceful shutdown | Terminated pods show OFFLINE in D_SERVERS | `verify-recovery.sh` |
| Server ID distribution | Messages spread across 3 server IDs (cluster) | `verify-integrity.sh` |

### Performance Thresholds

| Metric | Threshold |
|--------|-----------|
| Sustained p95 | < 500ms HTTP, < 1s MLLP |
| Sustained error rate | < 1% |
| Spike error rate | < 5% during 10x |
| Spike recovery | p95 baseline within 60s of spike end |
| Soak degradation | Last-5-min p95 < 2x first-5-min p95 |
| Soak error rate | < 0.1% over test duration |
| Chaos error rate | < 30% during disruption |

## Database Tables

Created by `sql/setup.sql`:

| Table | Purpose | Written By |
|-------|---------|-----------|
| `dv_enriched_messages` | ADT enrichment results | DV01 |
| `dv_route_a` | JSON gateway route A | DV03 |
| `dv_route_b` | JSON gateway route B | DV04 |
| `dv_route_c` | JSON gateway route C | DV05 |
| `dv_batch_results` | Batch HL7 processing | DV06 |
| `dv_chain_results` | Multi-hop chain terminal | DV12 |
| `dv_message_summary` | Summary view (all counts) | VIEW |

## Ports Used

| Port | Channel | Protocol |
|------|---------|----------|
| 8110 | DV01 | HTTP (HL7v2 body) |
| 8111 | DV02 | HTTP (JSON body) |
| 8112 | DV08 | HTTP (any body) |
| 8113 | DV09 | HTTP (JSON body) |
| 6675 | DV07 | TCP/MLLP |

These ports are added to both `cluster` and `standalone` overlay deployments and services.

## Run Stages

The `run-deep-validation.sh` orchestrator runs these stages in order:

1. **Setup** - SQL table creation, global map initialization
2. **Deploy** - Upload code templates + 12 DV channels, wait for STARTED
3. **Correctness** - 100 known messages, verify exact counts
4. **Sustained Load** - 30 min multi-protocol flow
5. **Spike Test** - 10x traffic burst and recovery
6. **Chaos Suite** - All 5 chaos scenarios with verification between each
7. **Soak Test** - 30 min (or 2hr with `--full-soak`)
8. **Final Verification** - All checks + HTML report generation

## Relationship to Kitchen Sink

The 12 DV channels deploy **alongside** the existing 34 kitchen-sink channels for maximum realism:
- Real resource contention (CPU, memory, DB connections)
- Real port allocation pressure (46 total channels)
- Real connection pool sharing
- VM routing crosses between KS and DV channels (DV01 -> DV08)

This is intentional. Production Mirth instances run many channels simultaneously.
