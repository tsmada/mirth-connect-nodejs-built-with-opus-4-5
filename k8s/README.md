# Kubernetes Validation & Testing Platform

Container-native testing platform for Node.js Mirth Connect on Rancher Desktop (k3s).

## Prerequisites

- **Rancher Desktop** with k3s enabled (provides `kubectl`, `nerdctl`)
- Verify: `kubectl get nodes` should show `rancher-desktop` as Ready

## Quick Start

```bash
# 1. Build image + deploy base infrastructure (MySQL, Java Mirth, mock services)
./k8s/scripts/setup.sh

# 2. Deploy an overlay (pick one)
kubectl apply -k k8s/overlays/standalone/   # Fresh DB
kubectl apply -k k8s/overlays/takeover/     # Shared DB with Java Mirth
kubectl apply -k k8s/overlays/shadow/       # Shadow mode (read-only observer)
kubectl apply -k k8s/overlays/cluster/      # 3 replicas, horizontal scaling

# 3. Deploy Kitchen Sink (34 channels, 5 code template libraries)
./k8s/scripts/deploy-kitchen-sink.sh

# 4. Run k6 load tests
./k8s/scripts/run-k6.sh api-load
./k8s/scripts/run-k6.sh mllp-load

# 5. Run side-by-side benchmark (Java Mirth vs Node.js Mirth)
./k8s/scripts/run-benchmark.sh

# 6. Cleanup
./k8s/scripts/teardown.sh
```

## Directory Structure

```
k8s/
  Dockerfile                         # Multi-stage Node.js Mirth image
  base/                              # Shared infra (mirth-infra namespace)
    mysql-statefulset.yaml           # MySQL 8.0 + PVC
    java-mirth-deployment.yaml       # nextgenhealthcare/connect:3.9
    mailhog-deployment.yaml          # Mock SMTP (port 1025)
    activemq-deployment.yaml         # JMS broker (STOMP 61613)
    castlemock-deployment.yaml       # Mock SOAP
    orthanc-deployment.yaml          # DICOM PACS (port 4242)
    sftp-deployment.yaml             # SFTP server
    kustomization.yaml
  overlays/
    standalone/                      # MIRTH_MODE=standalone, separate MySQL
    takeover/                        # MIRTH_MODE=takeover, shared DB
    shadow/                          # MIRTH_SHADOW_MODE=true
    cluster/                         # 3 replicas, MIRTH_CLUSTER_ENABLED=true
    benchmark/                       # Side-by-side Java vs Node.js benchmark
  benchmark-channels/                # Channel XML templates (PORT_PLACEHOLDER)
    http-echo.xml                    # HTTP Echo channel
    json-transform.xml               # JSON Transform channel
    hl7-http.xml                     # HL7 via HTTP channel
  k6/
    configmap.yaml                   # k6 test scripts
    job-api-load.yaml                # REST API throughput test
    job-mllp-load.yaml               # HL7 message load test
    job-benchmark.yaml               # Side-by-side benchmark Job
    scripts/                         # k6 JavaScript test files
      benchmark-api.js               # REST API comparison
      benchmark-hl7.js               # HL7 message comparison
      benchmark-json.js              # JSON transform comparison
  scripts/
    setup.sh                         # Build image + deploy base
    teardown.sh                      # Delete all namespaces
    build-image.sh                   # Rebuild Node.js Mirth image
    deploy-kitchen-sink.sh           # Upload 34 channels + deploy
    wait-for-ready.sh                # Wait for pods in a namespace
    port-forward.sh                  # Expose infra services locally
    run-k6.sh                        # Launch k6 Job + tail logs
    run-benchmark.sh                 # Side-by-side benchmark orchestrator
```

## Namespace Strategy

| Namespace | Contents | Purpose |
|-----------|----------|---------|
| `mirth-infra` | MySQL, Java Mirth, MailHog, ActiveMQ, Castlemock, Orthanc, SFTP | Shared infrastructure |
| `mirth-standalone` | Node.js Mirth + separate MySQL | Fresh DB testing |
| `mirth-takeover` | Node.js Mirth (ExternalName → infra MySQL) | Shared DB testing |
| `mirth-shadow` | Node.js Mirth in shadow mode | Progressive cutover testing |
| `mirth-cluster` | 3x Node.js Mirth replicas | Horizontal scaling testing |
| `mirth-benchmark` | Node.js Mirth + separate MySQL | Side-by-side benchmark |
| `mirth-k6` | k6 load test Jobs | Performance testing |

## Kitchen Sink Channel Ports

When the Kitchen Sink is deployed, these listener ports are bound:

| Port | Protocol | Channel |
|------|----------|---------|
| 6670 | MLLP/TCP | CH1 ADT Receiver |
| 6671 | MLLP/TCP | CH19 E4X Core |
| 6672 | MLLP/TCP | CH28 Batch HL7 |
| 8090-8102 | HTTP | CH2, CH8-CH9, CH13-CH18, CH25, CH29, CH31-CH34 |
| 11112 | DICOM | CH10 DICOM SCP |

All ports are exposed via `type: LoadBalancer` Services (k3s ServiceLB binds to localhost).

## Testing Workflows

### Standalone Mode
```bash
kubectl apply -k k8s/overlays/standalone/
kubectl wait -n mirth-standalone --for=condition=ready pod -l app=node-mirth --timeout=120s
curl http://localhost:8080/api/health  # mode=standalone
```

### Takeover Mode
```bash
kubectl apply -k k8s/overlays/takeover/
curl http://localhost:8080/api/health  # mode=takeover
```

### Shadow Mode
```bash
kubectl apply -k k8s/overlays/shadow/
curl http://localhost:8080/api/health  # shadowMode=true
# Promote a channel:
curl -X POST http://localhost:8080/api/system/shadow/promote \
  -H "Content-Type: application/json" -d '{"channelId":"..."}'
```

### Horizontal Scaling
```bash
kubectl apply -k k8s/overlays/cluster/
# Verify 3 different serverIds
for i in {1..6}; do curl -s http://localhost:8080/api/health | jq .serverId; done

# Scale test
kubectl scale -n mirth-cluster deployment/node-mirth --replicas=2
kubectl scale -n mirth-cluster deployment/node-mirth --replicas=4
```

### Kitchen Sink + k6 Load Test
```bash
# Deploy channels (stays running)
./k8s/scripts/deploy-kitchen-sink.sh

# Run load tests
./k8s/scripts/run-k6.sh api-load    # REST API throughput
./k8s/scripts/run-k6.sh mllp-load   # HL7 message load via HTTP gateway
```

## Infrastructure Access

Primary services are exposed via LoadBalancer. For secondary services:

```bash
./k8s/scripts/port-forward.sh
# MySQL:    localhost:3306
# MailHog:  localhost:8025
# ActiveMQ: localhost:8161
# Orthanc:  localhost:8042
# SFTP:     localhost:2222
```

## Validation Results (2026-02-15)

All scenarios validated on Rancher Desktop k3s (Apple Silicon, k3s v1.27.1):

| Scenario | Status | Key Verification |
|----------|--------|------------------|
| Standalone | PASS | Fresh schema creation, admin seeding, own MySQL instance |
| Takeover (real Java Mirth DB) | PASS | Connected to Java 3.9.1's live database, schema verified, auth works |
| Shadow Mode | PASS | `shadowMode: true` in health, 409 on writes, VMRouter/DataPruner deferred |
| Cluster (3 replicas) | PASS | Pod-name SERVER_IDs (Downward API), D_SERVERS registration, cluster API |
| Scale-Down (3 to 2) | PASS | Graceful OFFLINE deregistration via SIGTERM |
| Scale-Up (2 to 4 to 3) | PASS | Instant ONLINE registration for new pods |
| Java Mirth Coexistence | PASS | Both engines sharing MySQL (18 tables), no interference |

### Coexistence Details

When Node.js Mirth runs in takeover mode alongside Java Mirth:
- Java Mirth creates 13 standard tables (CHANNEL, CONFIGURATION, PERSON, etc.)
- Node.js Mirth adds 5 cluster tables (D_SERVERS, D_CLUSTER_EVENTS, D_CHANNEL_DEPLOYMENTS, D_GLOBAL_MAP, D_ARTIFACT_SYNC)
- Java Mirth ignores the Node.js-only tables (safe coexistence)
- Both engines authenticate against the same PERSON table
- Separate SERVER_IDs prevent message recovery conflicts

### Health Probe Mapping

| Probe | Endpoint | Behavior |
|-------|----------|----------|
| startupProbe | `/api/health/startup` | 200 after channels deployed |
| readinessProbe | `/api/health` | 200 when ready, 503 during shutdown |
| livenessProbe | `/api/health/live` | Always 200 |

## Side-by-Side Benchmark: Java Mirth vs Node.js Mirth

Compares Java Mirth 3.9.1 and Node.js Mirth side-by-side on identical hardware with identical resource allocations. Uses [k6](https://k6.io/) for load generation with tagged metrics for per-engine breakdowns.

### Running the Benchmark

```bash
# Full run: deploy infrastructure + channels + run k6 (~15 minutes)
./k8s/scripts/run-benchmark.sh

# Re-run k6 only (infrastructure already deployed)
./k8s/scripts/run-benchmark.sh --skip-deploy
```

The benchmark deploys a `mirth-benchmark` namespace with a dedicated Node.js Mirth + MySQL instance, patches the existing Java Mirth in `mirth-infra` with benchmark ports, deploys 3 channel pairs (HTTP echo, JSON transform, HL7 via HTTP), then runs k6 sequentially — Java first, then Node.js — to avoid CPU contention.

### Benchmark Architecture

```
mirth-infra                         mirth-benchmark
┌─────────────────────────┐        ┌─────────────────────────┐
│ MySQL (infra)           │        │ MySQL (benchmark)       │
│ Java Mirth 3.9.1        │        │ Node.js Mirth           │
│   :8443 API (HTTPS)     │        │   :8080 API (HTTP)      │
│   :7090 HTTP Echo       │        │   :7080 HTTP Echo       │
│   :7091 JSON Transform  │        │   :7081 JSON Transform  │
│   :7092 HL7 via HTTP    │        │   :7082 HL7 via HTTP    │
└─────────────────────────┘        └─────────────────────────┘
         ▲                                   ▲
         └───────── k6 benchmark Job ────────┘
                   (mirth-k6 namespace)
```

### Resource Allocation (Equal)

Both engines run with identical resource limits:

| Resource | Java Mirth | Node.js Mirth |
|----------|-----------|---------------|
| CPU limit | 1 core | 1 core |
| Memory limit | 1 Gi | 1 Gi |
| CPU request | 500m | 500m |
| Memory request | 512 Mi | 512 Mi |

### Performance Results (2026-02-16)

Tested on Rancher Desktop k3s, Apple Silicon (ARM64). Both engines running natively — no QEMU emulation.

#### Phase 1: REST API (health, login, channel list, channel statuses)

| Endpoint | Java p50 | Java p95 | Java p99 | Node.js p50 | Node.js p95 | Node.js p99 |
|----------|----------|----------|----------|-------------|-------------|-------------|
| health | 1ms | 2ms | 6ms | **0ms** | **1ms** | **3ms** |
| login | 6ms | 11ms | 31ms | **3ms** | **7ms** | **13ms** |
| channel list | 5ms | 9ms | 18ms | **3ms** | **7ms** | **12ms** |
| statuses | 4ms | 8ms | 25ms | **3ms** | **5ms** | **9ms** |

| Metric | Java | Node.js |
|--------|------|---------|
| Total requests | 10,472 | **10,656** |
| Error rate | 0.00% | 0.00% |

**Node.js wins every REST API metric.** Login latency is 2x lower (3ms vs 6ms p50). The p99 gap is especially notable — Java spikes to 25-31ms while Node.js stays under 13ms.

#### Phase 2: HL7 Message Processing

| Metric | Java | Node.js |
|--------|------|---------|
| p50 latency | **30ms** | 53ms |
| p95 latency | 93ms | **92ms** |
| p99 latency | **136ms** | 143ms |
| Total messages | **3,067** | 2,744 |
| Error rate | 0.00% | 0.00% |

**Java wins at median (1.77x faster p50), but p95 converges** — both engines hit ~93ms under sustained load.

#### Phase 3: JSON Transform

| Metric | Java | Node.js |
|--------|------|---------|
| p50 latency | **21ms** | 43ms |
| p95 latency | 64ms | **62ms** |
| p99 latency | **91ms** | 119ms |
| Total messages | **3,360** | 2,979 |
| Error rate | 0.00% | 0.00% |

**Java wins at median (2.05x faster p50), Node.js wins at p95** — under peak load both engines are bound by MySQL write latency rather than CPU.

#### Memory Footprint

| Metric | Java Mirth | Node.js Mirth | Ratio |
|--------|-----------|---------------|-------|
| Idle memory | 504 Mi | 56 Mi | **Java uses 9x more** |

#### Summary

| Workload | Latency Winner | Throughput Winner | Notes |
|----------|---------------|-------------------|-------|
| REST API | **Node.js** (2x) | **Node.js** | Lower latency at all percentiles |
| HL7 processing | **Java** (p50), **tie** (p95) | **Java** (12%) | Converges under load |
| JSON transform | **Java** (p50), **Node.js** (p95) | **Java** (13%) | Converges under load |
| Memory efficiency | **Node.js** (9x less) | — | 56 Mi vs 504 Mi at idle |

**Key takeaway:** Node.js is faster for REST APIs, comparable for message processing under sustained load (p95 convergence), and dramatically more memory-efficient. In a cloud environment, you can run ~9 Node.js instances for the memory cost of 1 Java instance.

### k6 Test Scripts

| Script | Phase | VU Profile | Duration |
|--------|-------|------------|----------|
| `benchmark-api.js` | REST API | warmup 5→steady 10→peak 25 VU | ~5.5 min |
| `benchmark-hl7.js` | HL7 messages | warmup 3→load 10 VU | ~3 min |
| `benchmark-json.js` | JSON transforms | warmup 3→load 10 VU | ~3 min |

### Benchmark Channels

| Channel | Node.js Port | Java Port | Tests |
|---------|-------------|-----------|-------|
| HTTP Echo | 7080 | 7090 | HTTP ingestion + JS transformer + DB persistence |
| JSON Transform | 7081 | 7091 | JSON parsing + field mapping + XML output |
| HL7 via HTTP | 7082 | 7092 | HL7v2 parsing + ACK generation + serialization |

## Rebuilding the Image

After code changes:
```bash
./k8s/scripts/build-image.sh           # Rebuild
kubectl rollout restart -n mirth-cluster deployment/node-mirth  # Restart pods
```
