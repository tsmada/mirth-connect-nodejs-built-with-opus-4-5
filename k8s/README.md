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

# 5. Cleanup
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
  k6/
    configmap.yaml                   # k6 test scripts
    job-api-load.yaml                # REST API throughput test
    job-mllp-load.yaml               # HL7 message load test
    scripts/                         # k6 JavaScript test files
  scripts/
    setup.sh                         # Build image + deploy base
    teardown.sh                      # Delete all namespaces
    build-image.sh                   # Rebuild Node.js Mirth image
    deploy-kitchen-sink.sh           # Upload 34 channels + deploy
    wait-for-ready.sh                # Wait for pods in a namespace
    port-forward.sh                  # Expose infra services locally
    run-k6.sh                        # Launch k6 Job + tail logs
```

## Namespace Strategy

| Namespace | Contents | Purpose |
|-----------|----------|---------|
| `mirth-infra` | MySQL, Java Mirth, MailHog, ActiveMQ, Castlemock, Orthanc, SFTP | Shared infrastructure |
| `mirth-standalone` | Node.js Mirth + separate MySQL | Fresh DB testing |
| `mirth-takeover` | Node.js Mirth (ExternalName → infra MySQL) | Shared DB testing |
| `mirth-shadow` | Node.js Mirth in shadow mode | Progressive cutover testing |
| `mirth-cluster` | 3x Node.js Mirth replicas | Horizontal scaling testing |
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

## Rebuilding the Image

After code changes:
```bash
./k8s/scripts/build-image.sh           # Rebuild
kubectl rollout restart -n mirth-cluster deployment/node-mirth  # Restart pods
```
