<!-- Completed: 2026-02-17 | Status: Implemented -->
# Production Readiness Determination Plan — Node.js Mirth Connect

## Context

The Node.js port of Java Mirth Connect (3.9.1) has been under development across 21 parallel porting waves. Two prior production readiness assessments have been completed:

- **Phase 1** (`plans/production-readiness-assessment.md`): Scored 88% CONDITIONAL GO — fixed all BLOCKER/CRITICAL security issues
- **Phase 2** (`tasks/production-readiness-report.md`): Scored 96% AUTOMATIC GO — completed logging migration, parity verification (0 new findings from 3 automated scanners)

**Why another assessment?** The prior reports focused on functional parity, security hardening, and data safety. A fresh exploration revealed gaps in **observability**, **performance validation**, **resource sizing**, and **startup robustness**. This plan performs a comprehensive determination across ALL production dimensions, then implements **OpenTelemetry auto-instrumentation** to close the observability gap with maximum return on investment.

**Goal:** Produce a definitive GO / NO-GO recommendation, then implement OTEL for APM, metrics, and distributed tracing — with transport to Datadog/Prometheus/any OTLP backend.

---

## Part A: Assessment (Read-Only)

### Assessment Framework

Eight dimensions, each scored PASS / CONDITIONAL / FAIL:

| # | Dimension | Weight | Prior Assessment | This Plan |
|---|-----------|--------|-----------------|-----------|
| 1 | Functional Parity | 20% | Covered (96%) | Re-validate |
| 2 | Security | 15% | Covered (all fixed) | Re-validate |
| 3 | Data Safety | 15% | Covered (all pass) | Re-validate |
| 4 | Operational Readiness | 15% | Covered (logging done) | Re-validate + gaps |
| 5 | Observability | 10% | **NOT COVERED** | New assessment + OTEL implementation |
| 6 | Performance & Scalability | 10% | Deferred | New assessment |
| 7 | Deployment Readiness | 10% | Partial (k3s only) | Deepen |
| 8 | Documentation & Runbook | 5% | Partial | Deepen |

---

### Step 1: Re-Validate Prior Assessment (Gate Check)

Confirm Phase 2 results still hold. Quick, automated checks only.

| Check | Command/Method | Pass Criteria |
|-------|---------------|---------------|
| 1.1 Full Jest suite | `npm test` | All tests pass, 0 failures |
| 1.2 TypeScript build | `npm run build` | 0 errors |
| 1.3 Security fixes intact | Grep for `helmet`, `loginLimiter`, `SameSite`, `initEncryptorFromEnv` | All present in expected files |
| 1.4 Logging migration intact | Grep for `console.` in `src/` excluding `cli/`, `logging/transports.ts`, `ScopeBuilder.ts` | 0 calls in production code |
| 1.5 Parity deferred items | Review 20 deferred items in report | Confirm none escalated to blocking |

**Effort:** ~10 min. PASS → proceed. Any failure → stop and fix first.

---

### Step 2: Observability Gap Assessment

Confirm that no OTEL or metrics infrastructure exists today (expected: none).

| Check | What to Look For | Expected |
|-------|-----------------|----------|
| 2.1 OTEL packages | `@opentelemetry/*` in `package.json` | Not present |
| 2.2 Prometheus endpoint | Route for `/metrics` | Not present |
| 2.3 Custom metrics | Grep for `Counter`, `Histogram`, `Gauge`, `prom-client` | Not present |
| 2.4 Trace propagation | `traceparent` header handling | Not present |
| 2.5 Structured logging (already done) | JSON format, 17 components registered | Present ✅ |
| 2.6 WebSocket monitoring | `/ws/dashboardstatus` | Present ✅ |

**Severity:** No APM/metrics/tracing = CONDITIONAL for production. Structured logging is good but insufficient for SLA monitoring, alerting, and performance debugging in production.

---

### Steps 3-6: Performance, Startup, Deployment, Documentation

*(Same checks as before — abbreviated here for plan clarity)*

**Step 3 — Performance:** Hot path analysis (Channel.ts), resource bounding (queues, pools), cluster scalability (SequenceAllocator, EventBus), load test infrastructure review.

**Step 4 — Startup robustness:** Env var validation before pool.init(), cluster mode Redis guard, port conflict detection, logger-before-pool ordering.

**Step 5 — Deployment:** K8s manifest review (memory limits, HPA, PDB, secrets), operational mode re-verification.

**Step 6 — Documentation:** Runbook completeness, incident playbook, upgrade procedure.

---

### Step 7: Synthesize Assessment Verdict

Combine all dimension scores. Expected outcome based on exploration:

| Dimension | Expected Score | Rationale |
|-----------|---------------|-----------|
| Functional Parity | PASS | 5,873 tests, 3 parity scanners clean |
| Security | PASS | All BLOCKER/CRITICAL/HIGH fixed |
| Data Safety | PASS | All 7 critical checks verified |
| Operational Readiness | PASS | Logging complete, health checks, graceful shutdown |
| Observability | CONDITIONAL → **PASS after Part B** | No APM/metrics today; OTEL implementation fixes this |
| Performance | CONDITIONAL | Architecturally sound; no published load results |
| Deployment | CONDITIONAL | K8s validated on k3s; memory limits need tuning |
| Documentation | CONDITIONAL | K8s README exists; no runbook/playbook |

**Expected verdict before Part B:** CONDITIONAL GO
**Expected verdict after Part B:** GO (observability gap closed)

---

## Part B: OpenTelemetry Implementation

### Why OTEL Auto-Instrumentation

OpenTelemetry auto-instrumentation gives maximum observability with minimal code changes:

| What You Get for Free | Library | Notes |
|----------------------|---------|-------|
| Express request spans | `@opentelemetry/instrumentation-express` | Route, method, status, latency |
| MySQL query spans | `@opentelemetry/instrumentation-mysql2` | SQL statement, table, latency |
| HTTP client spans | `@opentelemetry/instrumentation-http` | Outbound requests (fetch, http.Agent) |
| TCP/net spans | `@opentelemetry/instrumentation-net` | Socket connections (MLLP!) |
| DNS lookup spans | `@opentelemetry/instrumentation-dns` | DNS resolution timing |
| `undici`/`fetch` spans | `@opentelemetry/instrumentation-undici` | Native fetch in Node 20+ |
| Trace context propagation | W3C `traceparent` header | Automatic across HTTP calls |

**Not auto-instrumented** (must add manually):
- WebSocket (`ws` library) — needs `opentelemetry-instrumentation-ws`
- Mirth-specific custom metrics (messages processed, queue depth, etc.)

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Mirth Connect                                          │
│                                                                 │
│  src/instrumentation.ts (loaded via --import before all else)   │
│  ├── NodeSDK with auto-instrumentations                         │
│  ├── OTLP trace exporter (proto) ── always on                  │
│  ├── OTLP metrics exporter (proto) ── always on                │
│  ├── Prometheus scrape ── optional (MIRTH_OTEL_PROMETHEUS_PORT) │
│  └── ws instrumentation (manual add)                            │
│                                                                 │
│  src/telemetry/metrics.ts (custom Mirth metrics)                │
│  ├── mirth.messages.processed (counter)                         │
│  ├── mirth.messages.errors (counter)                            │
│  ├── mirth.message.duration (histogram)                         │
│  ├── mirth.queue.depth (up-down counter)                        │
│  ├── mirth.channels.deployed (observable gauge)                 │
│  ├── mirth.db.pool.active (observable gauge)                    │
│  └── mirth.ws.connections (up-down counter)                     │
│                                                                 │
└──────────────────┬──────────────────────┬───────────────────────┘
                   │ OTLP/proto :4318     │ Prometheus :9464
                   │ (always)             │ (optional)
                   ▼                      ▼
     ┌──────────────────────┐   ┌──────────────────┐
     │  OTEL Collector      │   │ Prometheus Server │
     │  (fan-out to all)    │   │  (direct scrape)  │
     └──────────┬───────────┘   └──────────────────┘
                │
     ┌──────────┼──────────┬──────────┐
     ▼          ▼          ▼          ▼
 Datadog    Grafana     Jaeger    Prometheus
                                  (via Collector)
```

**Recommended production topology:** Deploy an OTEL Collector as a sidecar or DaemonSet. The Collector receives OTLP from Mirth and fans out to any combination of Datadog, Grafana Cloud, Jaeger, Prometheus Remote Write, etc. This decouples the app from backend choice — switch backends by reconfiguring the Collector, not the app.

### Step 8: Install OTEL Dependencies

```bash
npm install \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/exporter-metrics-otlp-proto \
  @opentelemetry/exporter-prometheus \
  @opentelemetry/sdk-metrics \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  opentelemetry-instrumentation-ws
```

**All are runtime dependencies.** No dev-only — telemetry runs in production.

---

### Step 9: Create Instrumentation Bootstrap

**New file:** `src/instrumentation.ts`

This file must load **before all other imports** to monkey-patch modules. Uses `--import` flag (ESM).

```typescript
// src/instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'mirth-connect-node',
    [ATTR_SERVICE_VERSION]: '0.1.0',
    'deployment.environment': process.env.NODE_ENV ?? 'development',
    'service.instance.id': process.env.MIRTH_SERVER_ID ?? 'standalone',
  }),
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 60_000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => { sdk.shutdown(); });
```

Key decisions:
- **`fs` instrumentation disabled** — too noisy for file-heavy channels
- **OTLP proto** — most efficient format for server-to-server export
- **Prometheus exporter** — optional second metrics reader (see Step 12 for dual export)
- **`service.instance.id`** = `MIRTH_SERVER_ID` — ties APM traces to specific cluster nodes

---

### Step 10: Create Custom Mirth Metrics Module

**New file:** `src/telemetry/metrics.ts`

Custom metrics for Mirth-specific observability. These complement the auto-instrumented Express/MySQL/HTTP spans.

| Metric | Type | Attributes | Where Instrumented |
|--------|------|-----------|-------------------|
| `mirth.messages.processed` | Counter | channel.name, message.status | `Channel.ts` after pipeline completion |
| `mirth.messages.errors` | Counter | channel.name, error.type | `Channel.ts` catch blocks |
| `mirth.message.duration` | Histogram | channel.name | `Channel.ts` dispatchRawMessage timing |
| `mirth.queue.depth` | UpDownCounter | channel.name, queue.type | `SourceQueue.ts`, `DestinationQueue.ts` |
| `mirth.channels.deployed` | ObservableGauge | — | Reads from EngineController |
| `mirth.channels.started` | ObservableGauge | — | Reads from EngineController |
| `mirth.db.pool.active` | ObservableGauge | — | Reads from mysql2 pool stats |
| `mirth.db.pool.idle` | ObservableGauge | — | Reads from mysql2 pool stats |
| `mirth.pruner.messages.deleted` | Counter | channel.name | `DataPruner.ts` |
| `mirth.ws.connections` | UpDownCounter | ws.path | WebSocket upgrade handler |

Implementation pattern:
```typescript
import { metrics } from '@opentelemetry/api';
const meter = metrics.getMeter('mirth-connect');
export const messagesProcessed = meter.createCounter('mirth.messages.processed', { ... });
// etc.
```

**Files modified** to record metrics (minimal changes — single-line `.add()` / `.record()` calls):

| File | Metric Calls Added | What |
|------|--------------------|------|
| `src/donkey/channel/Channel.ts` | 3 | messages.processed, messages.errors, message.duration |
| `src/donkey/queue/SourceQueue.ts` | 2 | queue.depth +1 (enqueue), -1 (dequeue) |
| `src/donkey/queue/DestinationQueue.ts` | 2 | queue.depth +1, -1 |
| `src/plugins/datapruner/DataPruner.ts` | 1 | pruner.messages.deleted |
| `src/api/server.ts` | 1 | ws.connections (on upgrade) |

~15 lines of metric recording calls total across 5 existing files.

---

### Step 11: Wire OTEL into Server Lifecycle

**Modify:** `package.json` — update start script

```json
{
  "scripts": {
    "start": "node --import ./dist/instrumentation.js dist/index.js",
    "start:no-otel": "node dist/index.js"
  }
}
```

**Modify:** `src/server/Mirth.ts` — add SDK shutdown to graceful shutdown sequence

```typescript
// In stop() method, before pool.end():
try {
  const { shutdown } = await import('../instrumentation.js');
  await shutdown();
} catch { /* OTEL not loaded — ok */ }
```

**Modify:** `k8s/Dockerfile` — use OTEL-aware start command

```dockerfile
CMD ["node", "--import", "./dist/instrumentation.js", "dist/index.js"]
```

**Modify:** `k8s/overlays/*/` — add OTEL env vars per overlay:

```yaml
env:
  - name: OTEL_SERVICE_NAME
    value: "mirth-connect-node"
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector:4318"   # or DD Agent
  - name: OTEL_RESOURCE_ATTRIBUTES
    value: "deployment.environment=production"
  - name: MIRTH_OTEL_PROMETHEUS_PORT
    value: "9464"  # optional: Prometheus scrape port
```

---

### Step 12: Prometheus Scrape Endpoint (Optional Dual Export)

If `MIRTH_OTEL_PROMETHEUS_PORT` is set, start a Prometheus scrape endpoint alongside OTLP export.

**In `src/instrumentation.ts`:**
```typescript
const readers = [
  new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), ... }),
];

const promPort = process.env.MIRTH_OTEL_PROMETHEUS_PORT;
if (promPort) {
  readers.push(new PrometheusExporter({ port: parseInt(promPort) }));
}
```

This gives operators both:
- **Push** (OTLP → Datadog/Grafana/Collector) for APM + traces
- **Pull** (Prometheus scrape on `:9464/metrics`) for existing Prometheus stacks

---

### Step 13: Datadog Integration Guide

**For Datadog users**, configure the Datadog Agent to receive OTLP:

```yaml
# datadog.yaml (or via DD_ env vars in k8s)
otlp_config:
  receiver:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
```

**K8s Mirth Deployment:**
```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://datadog-agent.monitoring:4318"
```

No Datadog API key in the Mirth app — the DD Agent holds credentials and forwards to Datadog. This is the recommended architecture.

**For Grafana Cloud / Jaeger / any OTLP backend**, just change `OTEL_EXPORTER_OTLP_ENDPOINT`.

---

### Step 14: Tests for OTEL Integration

**New file:** `tests/unit/telemetry/metrics.test.ts`

| Test | What it Verifies |
|------|-----------------|
| Metric creation | All 10 custom metrics created without error |
| Counter increment | `messagesProcessed.add(1, attrs)` doesn't throw |
| Histogram record | `messageDuration.record(42, attrs)` doesn't throw |
| Observable gauge callback | Gauge callback executes and returns number |
| SDK disabled | `OTEL_SDK_DISABLED=true` → metrics are no-ops (no crash) |
| No OTLP endpoint | Missing `OTEL_EXPORTER_OTLP_ENDPOINT` → SDK starts with console exporter or silently drops |

~30-40 lines of tests. These verify the metrics module works in isolation without needing a running collector.

---

### OTEL Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_SERVICE_NAME` | `mirth-connect-node` | Service name in APM/traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector/agent endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | `grpc`, `http/protobuf`, `http/json` |
| `OTEL_EXPORTER_OTLP_HEADERS` | (none) | Auth headers (e.g., `DD-API-KEY=...`) |
| `OTEL_RESOURCE_ATTRIBUTES` | (none) | `deployment.environment=prod,service.namespace=mirth` |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Sampling strategy |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | Sampling ratio (0.1 = 10%) |
| `OTEL_SDK_DISABLED` | `false` | Kill switch — disables all telemetry |
| `OTEL_NODE_DISABLED_INSTRUMENTATIONS` | (none) | Disable specific auto-instrumentations |
| `MIRTH_OTEL_PROMETHEUS_PORT` | (none) | Set to enable Prometheus scrape endpoint |

---

## Part C: Additional Remediation (Small Items)

These are quick fixes identified during assessment that should land alongside OTEL:

| # | Fix | File | Effort | Why |
|---|-----|------|--------|-----|
| C.1 | Startup env var validation | `src/server/Mirth.ts` | ~15 min | DB_HOST/DB_NAME/DB_USER fail-fast before pool.init() |
| C.2 | Enforce Redis in cluster mode | `src/server/Mirth.ts` | ~5 min | Error (not warning) if MIRTH_CLUSTER_ENABLED=true without Redis URL |
| C.3 | Increase K8s memory requests | `k8s/overlays/*/` | ~2 min | 256Mi → 512Mi (prevents OOM under typical load) |
| C.4 | Add Prometheus scrape port to K8s | `k8s/overlays/*/` | ~5 min | Port 9464 on pod, ServiceMonitor if available |

---

## Execution Strategy

```
Part A: Assessment (read-only)
  Step 1:  Gate check                        ~10 min
  Steps 2-6: Parallel exploration agents     ~45 min
  Step 7:  Synthesize verdict                ~30 min
                                             ─────────
  Assessment subtotal:                       ~1.5 hours

Part B: OTEL Implementation
  Step 8:  Install dependencies              ~5 min
  Step 9:  Create instrumentation.ts         ~30 min
  Step 10: Create metrics.ts + instrument    ~45 min
  Step 11: Wire into lifecycle + K8s         ~30 min
  Step 12: Prometheus dual export            ~15 min
  Step 13: Datadog guide (docs only)         ~15 min
  Step 14: Tests                             ~20 min
                                             ─────────
  OTEL subtotal:                             ~2.5 hours

Part C: Small remediation items              ~30 min
                                             ─────────
Total:                                       ~4.5 hours
```

**Parallelization:**
- Steps 2-6 run as parallel Explore agents
- Steps 9-10 can run in parallel (separate files)
- Part C can run in parallel with Step 14 (different files)

---

## New Files Created

| File | Purpose | ~Lines |
|------|---------|--------|
| `src/instrumentation.ts` | OTEL SDK bootstrap (loaded via `--import`) | ~60 |
| `src/telemetry/metrics.ts` | Custom Mirth metrics definitions | ~80 |
| `src/telemetry/index.ts` | Barrel exports | ~5 |
| `tests/unit/telemetry/metrics.test.ts` | Metric creation/recording tests | ~40 |

## Existing Files Modified

| File | Change | ~Lines |
|------|--------|--------|
| `package.json` | OTEL deps + start script | ~15 |
| `src/donkey/channel/Channel.ts` | 3 metric recording calls | ~5 |
| `src/donkey/queue/SourceQueue.ts` | 2 metric calls (enqueue/dequeue) | ~3 |
| `src/donkey/queue/DestinationQueue.ts` | 2 metric calls | ~3 |
| `src/plugins/datapruner/DataPruner.ts` | 1 metric call | ~2 |
| `src/api/server.ts` | 1 metric call (WS connections) | ~2 |
| `src/server/Mirth.ts` | SDK shutdown + env var validation | ~15 |
| `k8s/Dockerfile` | `--import` in CMD | ~1 |
| `k8s/overlays/*/` | OTEL env vars + memory limits | ~20 |

**Total new code:** ~185 lines + ~40 lines tests
**Total modifications:** ~65 lines across 9 existing files

---

## Verification

After all steps complete:

1. `npm run build` — 0 TypeScript errors (new OTEL code compiles)
2. `npm test` — all existing tests pass + new telemetry tests pass
3. `OTEL_SDK_DISABLED=true npm start` — server starts normally (OTEL is no-op)
4. `npm start` — server starts with OTEL, auto-instrumentation logs visible at startup
5. `curl localhost:9464/metrics` — Prometheus scrape returns custom Mirth metrics (if port configured)
6. Send test HL7 message → verify `mirth.messages.processed` counter increments
7. K8s deploy → verify traces appear in Datadog/Grafana/Jaeger (if collector configured)

---

## Expected Final Verdict

| Dimension | Before | After |
|-----------|--------|-------|
| Functional Parity | PASS | PASS |
| Security | PASS | PASS |
| Data Safety | PASS | PASS |
| Operational Readiness | PASS | PASS |
| **Observability** | **CONDITIONAL** | **PASS** (OTEL implemented) |
| Performance | CONDITIONAL | CONDITIONAL (architecture sound; load tests still needed) |
| Deployment | CONDITIONAL | PASS (memory fixed, OTEL env vars in manifests) |
| Documentation | CONDITIONAL | CONDITIONAL (runbook still TBD) |

**Final verdict: CONDITIONAL GO** — production ready with two documented conditions:
1. Run sustained load test before high-volume deployment (k6 scripts exist, results not yet published)
2. Write operational runbook before handoff to ops team

Both conditions are post-deployment items that don't block initial production use.
