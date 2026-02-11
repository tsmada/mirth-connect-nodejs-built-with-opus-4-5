[← Back to README](../README.md)

# Horizontal Scaling (Container-Native)

Node.js Mirth supports running multiple instances behind an external load balancer, sharing a single MySQL database. Each instance is a stateless container that can be scaled up/down by your orchestration platform.

```
External Load Balancer (managed by orchestrator / sysadmin)
├─ L4 for MLLP/TCP (round-robin or sticky)
├─ L7 for HTTP/REST API (round-robin)
└─ Health checks: GET /api/health → 200/503

┌──────────┐  ┌──────────┐  ┌──────────┐
│ Instance 1│  │ Instance 2│  │ Instance N│  ← auto-scaled 1..N
│ SERVER_ID │  │ SERVER_ID │  │ SERVER_ID │  ← unique UUID per instance
│ =abc-001  │  │ =abc-002  │  │ =abc-00N  │
└────┬──────┘  └────┬──────┘  └────┬──────┘
     └──────────────┼──────────────┘
                    │
     Shared MySQL (managed DB)
```

## How It Works

1. **Each instance gets a unique SERVER_ID** (from `MIRTH_SERVER_ID` env var, or auto-generated UUID)
2. **All instances deploy all channels** — the external LB distributes incoming connections
3. **Each message is tagged with the receiving instance's SERVER_ID** — no duplicate processing
4. **Recovery tasks only touch their own messages** (`WHERE SERVER_ID = ?`)
5. **Statistics are aggregated across instances** via the cluster statistics endpoint
6. **Global maps can be shared** via database (D_GLOBAL_MAP) or Redis

## Quick Start (Clustered)

```bash
# Instance 1
MIRTH_CLUSTER_ENABLED=true \
MIRTH_SERVER_ID=instance-1 \
PORT=8081 \
npm start

# Instance 2 (same database)
MIRTH_CLUSTER_ENABLED=true \
MIRTH_SERVER_ID=instance-2 \
PORT=8082 \
npm start
```

## Health Check Endpoints

These endpoints require **no authentication** and are designed for orchestrator probes:

| Endpoint | Purpose | Orchestrator Mapping |
|----------|---------|---------------------|
| `GET /api/health` | Readiness — returns 503 during shutdown | K8s `readinessProbe`, ECS health check |
| `GET /api/health/live` | Liveness — always returns 200 | K8s `livenessProbe` |
| `GET /api/health/startup` | Startup — returns 503 until channels deployed | K8s `startupProbe`, Cloud Run startup |
| `GET /api/health/channels/:id` | Channel health — 200 if channel STARTED | Custom routing rules |

## Cluster API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/system/cluster/status` | Yes | All instances with deployed channels and heartbeat |
| `GET /api/system/cluster/nodes` | Yes | Node list (SERVER_ID, hostname, status) |
| `GET /api/system/cluster/statistics` | Yes | Cross-instance aggregated message statistics |
| `POST /api/internal/dispatch` | Cluster secret | Inter-instance message forwarding |

## Kubernetes Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mirth-nodejs
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: mirth
          image: mirth-nodejs:latest
          ports:
            - containerPort: 8081  # REST API
            - containerPort: 6662  # MLLP
          env:
            - name: MIRTH_CLUSTER_ENABLED
              value: "true"
            - name: MIRTH_SERVER_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name  # Pod name as SERVER_ID
            - name: DB_HOST
              value: mysql-service
            - name: MIRTH_CLUSTER_SECRET
              valueFrom:
                secretKeyRef:
                  name: mirth-secrets
                  key: cluster-secret
          readinessProbe:
            httpGet:
              path: /api/health
              port: 8081
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: 8081
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /api/health/startup
              port: 8081
            failureThreshold: 30
            periodSeconds: 2
---
apiVersion: v1
kind: Service
metadata:
  name: mirth-service
spec:
  selector:
    app: mirth-nodejs
  ports:
    - name: api
      port: 8081
      targetPort: 8081
    - name: mllp
      port: 6662
      targetPort: 6662
```

## Differences from Java Mirth Clustering

| Aspect | Java Mirth (Clustering Plugin) | Node.js Mirth (Container-Native) |
|--------|-------------------------------|----------------------------------|
| **Availability** | Commercial add-on (license required) | Built into core engine (free) |
| **Node Discovery** | JGroups (TCP/UDP multicast) | Database (D_SERVERS) or Redis |
| **Communication** | JGroups protocol stack | HTTP internal API + DB polling or Redis pub/sub |
| **Server ID Storage** | `CONFIGURATION` table (`server.id` key) | `MIRTH_SERVER_ID` env var + `D_SERVERS` table |
| **Global Map Sharing** | JGroups replicated cache | D_GLOBAL_MAP table or Redis |
| **Event Bus** | JGroups channel | D_CLUSTER_EVENTS table or Redis pub/sub |
| **Sequence IDs** | Single `FOR UPDATE` per message | Block-allocated (100 IDs per lock, ~99% less contention) |
| **Load Balancing** | Built-in (plugin manages routing) | External (K8s Service, ALB, nginx, etc.) |
| **Config** | Mirth Administrator GUI | Environment variables |
| **Hybrid Support** | N/A | Java + Node.js can share same DB with different SERVER_IDs |

## Cluster Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_SERVER_ID` | auto UUID | Unique instance ID. Use pod name in K8s, task ID in ECS. |
| `MIRTH_CLUSTER_ENABLED` | `false` | Enable cluster-aware features (heartbeat, SERVER_ID tagging) |
| `MIRTH_CLUSTER_REDIS_URL` | (none) | Redis for fast maps + events. Falls back to database polling. |
| `MIRTH_CLUSTER_SECRET` | (none) | Shared secret for inter-instance API. Set via secrets manager. |
| `MIRTH_CLUSTER_HEARTBEAT_INTERVAL` | `10000` | How often to update D_SERVERS heartbeat (ms) |
| `MIRTH_CLUSTER_HEARTBEAT_TIMEOUT` | `30000` | Mark instance suspect after this long without heartbeat (ms) |
| `MIRTH_CLUSTER_SEQUENCE_BLOCK` | `100` | Pre-allocate this many message IDs per lock acquisition |

## Graceful Shutdown

On SIGTERM (sent by orchestrators during scale-down/rolling updates):
1. Health probe returns 503 immediately (LB stops routing)
2. In-flight messages complete processing
3. Heartbeat stops, server deregisters from D_SERVERS
4. Database pool closes
5. Process exits 0

## Further Reading

See also the [Horizontal Scaling Analysis](horizontal-scaling-analysis.md) for the original design analysis.
