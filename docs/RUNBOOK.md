# Node.js Mirth Connect Operational Runbook

This runbook covers day-to-day operations, troubleshooting, and maintenance of the Node.js Mirth Connect runtime. It is intended for DevOps engineers and system administrators who manage the application in development, staging, and production environments.

---

## Table of Contents

1. [Quick Reference](#1-quick-reference)
2. [Startup and Shutdown](#2-startup-and-shutdown)
3. [Health Monitoring](#3-health-monitoring)
4. [Logging and Debugging](#4-logging-and-debugging)
5. [Database Operations](#5-database-operations)
6. [Channel Operations](#6-channel-operations)
7. [Cluster Operations](#7-cluster-operations)
8. [Shadow Mode and Migration](#8-shadow-mode-and-migration)
9. [Security](#9-security)
10. [Troubleshooting Guide](#10-troubleshooting-guide)
11. [Backup and Recovery](#11-backup-and-recovery)
12. [Known Limitations](#12-known-limitations)

---

## 1. Quick Reference

### Health Check URLs

| Endpoint | Auth | Purpose | Healthy |
|----------|------|---------|---------|
| `GET /api/health` | No | Readiness probe | 200 |
| `GET /api/health/live` | No | Liveness probe | 200 (always) |
| `GET /api/health/startup` | No | Startup probe | 200 after channels deployed |
| `GET /api/health/channels/:id` | No | Per-channel readiness | 200 if STARTED |
| `GET /health` | No | Legacy health (basic) | 200 |

### Default Ports

| Port | Service |
|------|---------|
| 8080 | HTTP REST API (default, set via `PORT`) |
| 8443 | HTTPS (if configured, set via `HTTPS_PORT`) |
| 3306 | MySQL database (default) |

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP API listen port |
| `HTTPS_PORT` | `8443` | HTTPS API listen port |
| `MIRTH_MODE` | `auto` | Operational mode: `takeover`, `standalone`, `auto` |
| `MIRTH_SHADOW_MODE` | `false` | Read-only observer mode for safe migration |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | `mirthdb` | MySQL database name |
| `DB_USER` | `mirth` | MySQL username |
| `DB_PASSWORD` | `mirth` | MySQL password |
| `DB_POOL_SIZE` | `10` | Connection pool size |
| `DB_CONNECT_TIMEOUT` | `10000` | Connection timeout (ms) |
| `DB_QUEUE_LIMIT` | `0` | Pool queue limit (0 = unlimited) |
| `MIRTH_ENCRYPTION_KEY` | (none) | Base64-encoded AES key for content encryption |
| `MIRTH_SCRIPT_TIMEOUT` | `30000` | Script execution timeout (ms) |
| `MIRTH_SERVER_ID` | auto UUID | Stable server identity (use pod name in K8s) |
| `MIRTH_CLUSTER_ENABLED` | `false` | Enable cluster mode |
| `MIRTH_CLUSTER_REDIS_URL` | (none) | Redis URL for shared state |
| `MIRTH_CLUSTER_SECRET` | (none) | Inter-node API auth secret |
| `MIRTH_CLUSTER_HEARTBEAT_INTERVAL` | `10000` | Heartbeat interval (ms) |
| `MIRTH_CLUSTER_HEARTBEAT_TIMEOUT` | `30000` | Node suspect threshold (ms) |
| `MIRTH_CLUSTER_SEQUENCE_BLOCK` | `100` | Message ID pre-allocation block size |
| `LOG_LEVEL` | `INFO` | Global minimum: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `LOG_FORMAT` | `text` | Output format: `text` or `json` |
| `LOG_FILE` | (none) | File path for log output |
| `LOG_TIMESTAMP_FORMAT` | `mirth` | `mirth` (Log4j-style) or `iso` |
| `MIRTH_DEBUG_COMPONENTS` | (none) | Comma-separated components for DEBUG |
| `CORS_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `TLS_ENABLED` | (none) | Set to `true` for Secure cookie flag |
| `NODE_ENV` | (none) | `production` enables Secure cookie flag |
| `MIRTH_ARTIFACT_REPO` | (none) | Path to git repo for artifact sync |
| `MIRTH_ARTIFACT_ENV` | (none) | Active environment (dev, staging, prod) |
| `MIRTH_ARTIFACT_AUTO_SYNC` | `false` | Enable filesystem watcher for auto-sync |
| `MIRTH_SECRETS_PROVIDERS` | (none) | Comma-separated providers: `env`, `file`, `aws`, `azure`, `gcp`, `vault` |
| `MIRTH_SECRETS_CACHE_TTL` | `300` | Secrets cache TTL (seconds) |

### Log Output Location

- **Console**: stdout by default (text or JSON format)
- **File**: path specified by `LOG_FILE` environment variable (max 10 MB per file, 5 files rotated)
- **WebSocket**: real-time streaming at `ws://<host>:<port>/ws/serverlog`

---

## 2. Startup and Shutdown

### Startup Sequence

Start the server with:

```bash
# Direct invocation
node dist/index.js

# With environment configuration
PORT=8081 DB_HOST=db.example.com MIRTH_MODE=takeover node dist/index.js

# Via npm
npm start
```

The startup sequence proceeds in this order:

1. **Logging initialization** -- structured logger starts, reading `LOG_LEVEL`, `LOG_FORMAT`, `MIRTH_DEBUG_COMPONENTS`
2. **Database connection** -- pool created using `DB_*` environment variables
3. **Encryptor initialization** -- reads `MIRTH_ENCRYPTION_KEY` for content encryption
4. **Default credentials check** -- warns if `DB_USER`/`DB_PASSWORD` are still `mirth/mirth`
5. **Operational mode detection** -- checks `MIRTH_MODE` and detects takeover vs standalone
6. **Schema management**:
   - Standalone: creates all tables, seeds default admin user (`admin`/`admin`)
   - Takeover: verifies existing Java Mirth schema is compatible, creates Node.js-only tables
7. **Shadow mode check** -- if `MIRTH_SHADOW_MODE=true`, enables read-only observer mode
8. **Dashboard status controller** -- initialized with server ID
9. **Donkey engine start** -- message processing engine started
10. **REST API server start** -- Express server begins listening on `PORT`
11. **Server registration** -- registers in `D_SERVERS` table with heartbeat
12. **Cluster heartbeat** -- starts if `MIRTH_CLUSTER_ENABLED=true`
13. **Channel deployment** -- loads enabled channels from database and deploys them
14. **ChannelUtil initialization** -- wires user script helpers
15. **Startup complete** -- health probe `/api/health/startup` returns 200
16. **VMRouter initialization** -- enables cross-channel routing (skipped in shadow mode)
17. **DataPruner initialization** -- starts scheduled cleanup (skipped in shadow mode)
18. **Secrets manager** -- initialized if `MIRTH_SECRETS_PROVIDERS` is set
19. **Artifact sync** -- initialized if `MIRTH_ARTIFACT_REPO` is set

#### Expected Startup Logs (text format)

```
 INFO 2026-02-17 10:00:00,001 [server] Starting Mirth Connect Node.js Runtime...
 INFO 2026-02-17 10:00:00,010 [server] Connecting to database...
 INFO 2026-02-17 10:00:00,150 [server] Connected to database at localhost:3306
 INFO 2026-02-17 10:00:00,200 [server] Operational mode: standalone
 INFO 2026-02-17 10:00:00,500 [server] Core schema initialized
 WARN 2026-02-17 10:00:00,501 [server] SECURITY: Default admin/admin credentials seeded. Change the admin password before production use.
 INFO 2026-02-17 10:00:01,000 [api] Mirth Connect API server listening on http://0.0.0.0:8080
 INFO 2026-02-17 10:00:01,001 [api] WebSocket endpoints available at /ws/dashboardstatus and /ws/serverlog
 INFO 2026-02-17 10:00:01,100 [cluster] Registered server abc-123 (hostname:8080)
 INFO 2026-02-17 10:00:01,500 [server] Found 5 channel(s) in database
 INFO 2026-02-17 10:00:02,000 [server] Deployed channel: ADT Receiver (uuid-1)
 INFO 2026-02-17 10:00:02,500 [server] Deployed channel: Lab Router (uuid-2)
 INFO 2026-02-17 10:00:03,000 [server] VMRouter singletons initialized
 INFO 2026-02-17 10:00:03,100 [data-pruner] Data Pruner Controller initialized
 INFO 2026-02-17 10:00:03,200 [server] Mirth Connect started on port 8080 (HTTP)
```

### Graceful Shutdown (SIGTERM)

The server handles `SIGTERM` and `SIGINT` for graceful shutdown. The sequence:

1. **Health returns 503** -- load balancer stops routing new requests
2. **DataPruner shutdown** -- stops any in-progress pruning
3. **Heartbeat stopped** -- cluster peers detect eventual timeout
4. **Channels stopped** -- each running channel is stopped individually (in-flight messages complete)
5. **HTTP server closed** -- no new connections accepted; existing connections drain
6. **Donkey engine stopped** -- message engine fully stopped
7. **Server deregistered** -- `D_SERVERS` row updated to `STATUS='OFFLINE'`
8. **Secrets manager shutdown** -- provider connections closed
9. **Database pool closed** -- all MySQL connections released
10. **Logging flushed** -- Winston transports flush pending writes
11. **Process exits 0**

Send SIGTERM in production:

```bash
# Kubernetes (automatic on pod termination)
kubectl delete pod <pod-name> -n <namespace>

# Docker
docker stop <container-id>

# Manual
kill -SIGTERM <pid>
```

> **WARNING**: Set `terminationGracePeriodSeconds` to at least 30 seconds in Kubernetes to allow the full shutdown sequence to complete. The default of 30s is usually sufficient, but channels with long-running transactions may need more.

### Emergency Shutdown (SIGKILL)

Use `SIGKILL` only when the process is unresponsive to SIGTERM. This bypasses graceful shutdown:

```bash
kill -9 <pid>
```

**Consequences of SIGKILL:**
- In-flight messages may be left in `PROCESSED=0` state (recovered on next startup by the recovery task)
- Database connections are not cleanly released (MySQL will time them out)
- `D_SERVERS` row retains `STATUS='ONLINE'` until heartbeat timeout expires
- Log buffers may not be flushed

### Startup Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| `Database pool not initialized` | DB unreachable | Verify `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`. Check MySQL is running and accepting connections. |
| `Schema incompatible` | Schema version mismatch | In takeover mode, the existing schema must be Mirth 3.x. Check `SCHEMA_INFO` table version. |
| `EADDRINUSE: port XXXX` | Port already in use | Another process (possibly Java Mirth) is using the port. Check with `lsof -i :<port>`. |
| `SECURITY: Using default database credentials` | Default DB creds | Set `DB_USER` and `DB_PASSWORD` to non-default values. |
| `SECURITY: Default admin/admin credentials seeded` | Standalone mode first boot | Change the admin password immediately via API or CLI. |
| `CORS is set to allow all origins (*)` | Missing `CORS_ORIGINS` | Set `CORS_ORIGINS` to specific origins for production. |
| `Cluster mode: session store is in-memory` | Cluster without Redis | Sessions are not shared across nodes. Use sticky sessions at the LB or implement a shared session store. |
| `GlobalMap will use volatile in-memory storage` | Cluster without Redis | Set `MIRTH_CLUSTER_REDIS_URL` for persistent shared state. |
| `Failed to deploy channel` | Channel config issue | Check the error message. Common causes: unsupported connector type, missing dependencies, invalid script. |

---

## 3. Health Monitoring

### Health Check Endpoints

All health endpoints are unauthenticated and safe to call from orchestrator probes.

#### Readiness Probe: `GET /api/health`

Returns 200 when the server is ready to accept traffic, 503 during shutdown.

```bash
curl -s http://localhost:8080/api/health | jq .
```

**Response (healthy):**
```json
{
  "status": "ok",
  "serverId": "abc-123-def-456",
  "uptime": 3600,
  "mode": "takeover"
}
```

**Response (shutting down):**
```json
{
  "status": "shutting_down",
  "serverId": "abc-123-def-456",
  "uptime": 3600
}
```

**Response (shadow mode):**
```json
{
  "status": "ok",
  "serverId": "abc-123-def-456",
  "uptime": 3600,
  "mode": "takeover",
  "shadowMode": true,
  "promotedChannels": ["channel-id-1"]
}
```

#### Liveness Probe: `GET /api/health/live`

Always returns 200 as long as the process is alive. Use this to detect deadlocked or crashed processes.

```bash
curl -s http://localhost:8080/api/health/live | jq .
```

**Response:**
```json
{
  "status": "alive"
}
```

#### Startup Probe: `GET /api/health/startup`

Returns 503 until all channels are deployed, then 200. Use this for slow-start scenarios.

```bash
curl -s http://localhost:8080/api/health/startup | jq .
```

**Response (still starting):**
```json
{
  "status": "starting",
  "serverId": "abc-123-def-456"
}
```

**Response (ready):**
```json
{
  "status": "ready",
  "serverId": "abc-123-def-456"
}
```

#### Channel-Specific: `GET /api/health/channels/:channelId`

Returns 200 if the channel is deployed and STARTED, 503 otherwise. In shadow mode, STOPPED channels return 200 with `"status": "shadow"`.

```bash
curl -s http://localhost:8080/api/health/channels/abc-123 | jq .
```

### Kubernetes Probe Configuration

```yaml
startupProbe:
  httpGet:
    path: /api/health/startup
    port: 8080
  failureThreshold: 30
  periodSeconds: 5
  # Total: 150 seconds for startup

readinessProbe:
  httpGet:
    path: /api/health
    port: 8080
  periodSeconds: 10
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /api/health/live
    port: 8080
  periodSeconds: 15
  failureThreshold: 3
```

### Metrics and Monitoring Guidance

Node.js Mirth does not currently expose a Prometheus `/metrics` endpoint. To monitor:

- **Health**: Poll the readiness endpoint periodically
- **Channel statistics**: `GET /api/channels/statuses` (auth required) returns per-channel message counts
- **Cluster status**: `GET /api/system/cluster/status` (auth required) returns all node states
- **WebSocket dashboard**: Connect to `ws://<host>:<port>/ws/dashboardstatus` for real-time channel status updates
- **Log aggregation**: Set `LOG_FORMAT=json` and ship structured logs to your aggregation platform

### Expected Response Times

| Endpoint | Expected p95 |
|----------|-------------|
| `/api/health` | < 5 ms |
| `/api/health/live` | < 1 ms |
| `/api/health/startup` | < 5 ms |
| REST API (channel list) | < 12 ms |
| REST API (login) | < 10 ms |
| HL7 message processing | < 100 ms |

---

## 4. Logging and Debugging

### Log Formats

#### Text Format (default)

Matches Java Mirth's Log4j pattern:

```
 INFO 2026-02-17 10:00:00,042 [server] Starting Mirth Connect Node.js Runtime...
 WARN 2026-02-17 10:00:00,150 [server] SECURITY: Using default database credentials (mirth/mirth)
ERROR 2026-02-17 10:00:01,500 [engine] Failed to deploy channel Lab Orders
  at Error: EADDRINUSE: port 6661
    at TcpReceiver.start (src/connectors/tcp/TcpReceiver.ts:45)
```

#### JSON Format (`LOG_FORMAT=json`)

Structured output for log aggregation (CloudWatch, Datadog, ELK):

```json
{"level":"info","message":"Starting Mirth Connect Node.js Runtime...","component":"server","timestamp":"2026-02-17T10:00:00.042Z"}
{"level":"error","message":"Failed to deploy channel Lab Orders","component":"engine","errorStack":"Error: EADDRINUSE...","timestamp":"2026-02-17T10:00:01.500Z"}
```

### Registered Logging Components

All 17 registered components support per-component debug:

| Component | Description |
|-----------|-------------|
| `server` | Server lifecycle |
| `engine` | Channel deploy/start/stop |
| `api` | REST API server |
| `database` | DB pool, queries |
| `cluster` | Heartbeat, server registry |
| `data-pruner` | Pruning engine |
| `file-connector` | File polling/writing |
| `dicom-connector` | DICOM C-STORE/C-ECHO |
| `vm-connector` | Inter-channel routing |
| `jms-connector` | JMS messaging (STOMP) |
| `jdbc-connector` | Database connector |
| `js-connector` | JavaScript execution |
| `artifact` | Git artifact sync |
| `secrets` | Secret management |
| `dashboard-status` | Dashboard WebSocket |
| `server-log` | Server log WebSocket |
| `code-templates` | Code template management |

### Enable Debug at Startup

```bash
# Debug a single component
MIRTH_DEBUG_COMPONENTS=engine LOG_LEVEL=WARN node dist/index.js

# Debug multiple components
MIRTH_DEBUG_COMPONENTS=engine,jdbc-connector,database node dist/index.js

# TRACE level for a specific component
MIRTH_DEBUG_COMPONENTS=file-connector:TRACE LOG_LEVEL=WARN node dist/index.js

# Common troubleshooting combinations:
# MLLP/TCP issues
MIRTH_DEBUG_COMPONENTS=vm-connector:TRACE LOG_LEVEL=WARN node dist/index.js

# Database connector issues
MIRTH_DEBUG_COMPONENTS=jdbc-connector,database LOG_LEVEL=WARN node dist/index.js

# Full verbose mode
LOG_LEVEL=DEBUG node dist/index.js
```

### Enable Debug at Runtime (no restart)

Use the Logging REST API to change log levels without restarting the server.

**Check current state:**
```bash
curl -s http://localhost:8080/api/system/logging \
  -H "X-Session-ID: <session>" | jq .
```

**Enable DEBUG for a specific component:**
```bash
curl -X PUT http://localhost:8080/api/system/logging/components/engine \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: <session>" \
  -d '{"level":"DEBUG"}'
```

**Enable TRACE for deep debugging:**
```bash
curl -X PUT http://localhost:8080/api/system/logging/components/jdbc-connector \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: <session>" \
  -d '{"level":"TRACE"}'
```

**Raise global level to suppress noise while debugging one component:**
```bash
curl -X PUT http://localhost:8080/api/system/logging/level \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: <session>" \
  -d '{"level":"WARN"}'
```

**Clear component override (revert to global level):**
```bash
curl -X DELETE http://localhost:8080/api/system/logging/components/engine \
  -H "X-Session-ID: <session>"
```

### Common Log Patterns to Watch

| Pattern | Severity | Meaning |
|---------|----------|---------|
| `SECURITY: Using default database credentials` | WARN | Change DB credentials before production |
| `SECURITY: Default admin/admin credentials seeded` | WARN | Change admin password immediately |
| `CORS is set to allow all origins (*)` | WARN | Restrict CORS for production |
| `Failed to deploy channel` | ERROR | Channel configuration issue -- check channel config |
| `Error stopping channel` | ERROR | Channel stop failed -- check for stuck connections |
| `Heartbeat update failed` | ERROR | Database connectivity issue in cluster mode |
| `Schema incompatible` | FATAL | Cannot start in takeover mode against this schema |
| `GlobalMap will use volatile in-memory storage` | WARN | Cluster mode without Redis -- data loss on restart |

### Log Aggregation Guidance

| Platform | Configuration |
|----------|--------------|
| **CloudWatch** | Set `LOG_FORMAT=json`. Ship stdout via CloudWatch Logs agent or Fluent Bit sidecar. |
| **Datadog** | Set `LOG_FORMAT=json`. Use Datadog agent with container log collection. Parse `component` field as `service` facet. |
| **ELK Stack** | Set `LOG_FORMAT=json`. Use Filebeat or Fluent Bit. The `component` field maps well to Kibana `service.name`. |
| **Grafana Loki** | Set `LOG_FORMAT=json`. Use Promtail sidecar. Label on `component`. |

For file-based collection, set `LOG_FILE=/var/log/mirth/mirth.log`. Rotation is automatic: 10 MB max per file, 5 files retained.

---

## 5. Database Operations

### Connection Pool Configuration

The MySQL connection pool is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_POOL_SIZE` | `10` | Maximum concurrent connections |
| `DB_CONNECT_TIMEOUT` | `10000` | Connection establishment timeout (ms) |
| `DB_QUEUE_LIMIT` | `0` | Max queued connection requests (0 = unlimited) |

**Sizing guidance:**
- Single instance: `DB_POOL_SIZE=10` is usually sufficient
- High-throughput channels: increase to `20-50` depending on concurrent message volume
- Cluster (N nodes): each node maintains its own pool. Total connections = N x `DB_POOL_SIZE`. Ensure MySQL `max_connections` accommodates this.

### Pool Exhaustion Symptoms

| Symptom | Indicator |
|---------|-----------|
| Increasing API latency | Connections queued, waiting for pool release |
| `PROTOCOL_CONNECTION_LOST` errors | Connections timing out |
| Channel processing stalls | All pool connections held by long queries |
| `ER_CON_COUNT_ERROR` in MySQL | Total connections exceeded MySQL `max_connections` |

**Mitigation:**
1. Increase `DB_POOL_SIZE` (and MySQL `max_connections` accordingly)
2. Check for slow queries: `SHOW PROCESSLIST` in MySQL
3. Look for connection leaks: connections that are acquired but never released
4. Set `DB_QUEUE_LIMIT` to a finite value (e.g., `100`) to fail fast instead of queueing indefinitely

### Data Pruner Configuration

The data pruner removes old messages on a schedule. Configuration is stored in the `CONFIGURATION` table.

**View pruner status:**
```bash
curl -s http://localhost:8080/api/extensions/datapruner/status \
  -H "X-Session-ID: <session>" | jq .
```

**Start a manual prune:**
```bash
curl -X POST http://localhost:8080/api/extensions/datapruner/start \
  -H "X-Session-ID: <session>"
```

**Stop a running prune:**
```bash
curl -X POST http://localhost:8080/api/extensions/datapruner/stop \
  -H "X-Session-ID: <session>"
```

**Safety features:**
- Messages with `PROCESSED=0` are never pruned (in-flight protection)
- Channels with `messageStorageMode=DISABLED` are skipped
- Failed archive batches skip deletion (data safety)
- The pruner does not run in shadow mode

### Backup and Restore Considerations for Takeover Mode

When running against a shared database with Java Mirth:

- **Back up the entire database** -- Node.js Mirth adds tables (`D_SERVERS`, `D_CLUSTER_EVENTS`, `D_CHANNEL_DEPLOYMENTS`, `D_GLOBAL_MAP`, `D_ARTIFACT_SYNC`) that Java Mirth ignores but should be preserved.
- **Per-channel tables** (`D_M{id}`, `D_MM{id}`, `D_MC{id}`, etc.) contain message data from both engines, differentiated by `SERVER_ID`.
- **Point-in-time recovery**: message tables use `SERVER_ID` columns. Recovery tasks filter by the server's own ID to avoid processing another instance's messages.

---

## 6. Channel Operations

### Authentication

All channel management operations require authentication. Obtain a session first:

```bash
# Login
SESSION=$(curl -s -X POST http://localhost:8080/api/users/_login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin" \
  -D - 2>/dev/null | grep -i "X-Session-ID" | awk '{print $2}' | tr -d '\r')

echo "Session: $SESSION"
```

Or use the CLI:
```bash
mirth-cli login --user admin
```

### List Channels

```bash
# API
curl -s http://localhost:8080/api/channels \
  -H "X-Session-ID: $SESSION" | jq '.[] | {id, name, enabled}'

# CLI
mirth-cli channels
```

### Deploy / Undeploy

```bash
# Deploy a specific channel
curl -X POST "http://localhost:8080/api/channels/_deploy?returnErrors=true" \
  -H "Content-Type: application/xml" \
  -H "X-Session-ID: $SESSION" \
  -d '<set><string>CHANNEL_ID</string></set>'

# Undeploy a specific channel
curl -X POST "http://localhost:8080/api/channels/_undeploy?returnErrors=true" \
  -H "Content-Type: application/xml" \
  -H "X-Session-ID: $SESSION" \
  -d '<set><string>CHANNEL_ID</string></set>'

# CLI
mirth-cli channels deploy "ADT Receiver"
mirth-cli channels undeploy "ADT Receiver"
```

> **NOTE**: Always pass `?returnErrors=true` when calling deploy/undeploy/start/stop via the API. Without this flag, the API returns HTTP 204 (success) even on failure, matching Java Mirth's default behavior for backward compatibility. The CLI always passes this flag automatically.

### Start / Stop / Pause / Resume

```bash
# Start
curl -X POST "http://localhost:8080/api/channels/_start?returnErrors=true" \
  -H "Content-Type: application/xml" \
  -H "X-Session-ID: $SESSION" \
  -d '<set><string>CHANNEL_ID</string></set>'

# Stop
curl -X POST "http://localhost:8080/api/channels/_stop?returnErrors=true" \
  -H "Content-Type: application/xml" \
  -H "X-Session-ID: $SESSION" \
  -d '<set><string>CHANNEL_ID</string></set>'

# CLI (by name)
mirth-cli channels start "ADT Receiver"
mirth-cli channels stop "ADT Receiver"
mirth-cli channels pause "ADT Receiver"
mirth-cli channels resume "ADT Receiver"
```

### View Channel Statistics

```bash
# API
curl -s http://localhost:8080/api/channels/statuses \
  -H "X-Session-ID: $SESSION" | jq .

# CLI
mirth-cli channels stats
```

### Search Messages

```bash
# API - search by status
curl -s "http://localhost:8080/api/channels/CHANNEL_ID/messages?status=E&limit=10" \
  -H "X-Session-ID: $SESSION" | jq .

# CLI - find errors
mirth-cli messages CHANNEL_ID --status E
```

### Reprocess Messages

```bash
# Reprocess a single message
curl -X POST "http://localhost:8080/api/channels/CHANNEL_ID/messages/MESSAGE_ID/_reprocess" \
  -H "X-Session-ID: $SESSION"

# CLI
mirth-cli messages reprocess CHANNEL_ID MESSAGE_ID
```

### Cross-Channel Message Trace (Node.js-only)

Trace a message across VM-connected channels:

```bash
# API
curl -s "http://localhost:8080/api/messages/trace/CHANNEL_ID/MESSAGE_ID" \
  -H "X-Session-ID: $SESSION" | jq .

# CLI
mirth-cli trace "ADT Receiver" 123
mirth-cli trace "ADT Receiver" 123 --verbose      # Full content
mirth-cli trace "ADT Receiver" 123 --no-content    # Tree only
```

### Common Channel Failures

| Error | Cause | Resolution |
|-------|-------|------------|
| `EADDRINUSE` | Port already bound | Stop the other process using the port, or change the channel's listener port |
| `ECONNREFUSED` | Destination unreachable | Verify the destination host/port is running and accepting connections |
| `ER_ACCESS_DENIED_ERROR` | DB auth failure (JDBC connector) | Check the connector's database credentials |
| `Script execution timeout` | User script infinite loop | Increase `MIRTH_SCRIPT_TIMEOUT` or fix the script. Default is 30 seconds. |
| `Channel not deployed` | Channel not in deployed state | Deploy the channel first, then start it |

---

## 7. Cluster Operations

### Architecture Overview

Node.js Mirth uses container-native clustering (no JGroups, no commercial plugin required):

- **Identity**: Each node has a unique `MIRTH_SERVER_ID` (env var or auto UUID)
- **Discovery**: Nodes register in `D_SERVERS` table with heartbeat
- **Communication**: HTTP inter-node API or database polling (`D_CLUSTER_EVENTS`)
- **Shared state**: Redis (preferred), database (`D_GLOBAL_MAP`), or in-memory (single-instance only)

### Enable Cluster Mode

```bash
MIRTH_CLUSTER_ENABLED=true \
MIRTH_SERVER_ID=$(hostname) \
MIRTH_CLUSTER_REDIS_URL=redis://redis:6379 \
MIRTH_CLUSTER_SECRET=my-shared-secret \
node dist/index.js
```

### View Cluster Status

```bash
# All nodes with deployed channels
curl -s http://localhost:8080/api/system/cluster/status \
  -H "X-Session-ID: $SESSION" | jq .

# Node list (without channel details)
curl -s http://localhost:8080/api/system/cluster/nodes \
  -H "X-Session-ID: $SESSION" | jq .

# Aggregated statistics across all nodes
curl -s http://localhost:8080/api/system/cluster/statistics \
  -H "X-Session-ID: $SESSION" | jq .
```

### Adding Nodes (Scaling Up)

New nodes automatically register when they start:

```bash
# Kubernetes
kubectl scale -n mirth-cluster deployment/node-mirth --replicas=4

# Docker
docker run -e MIRTH_CLUSTER_ENABLED=true \
  -e MIRTH_CLUSTER_REDIS_URL=redis://redis:6379 \
  -e DB_HOST=db.example.com \
  node-mirth:latest
```

The new node will:
1. Insert into `D_SERVERS` with `STATUS='ONLINE'`
2. Start heartbeat
3. Deploy channels from the database
4. Begin processing messages

### Removing Nodes (Scaling Down)

```bash
# Kubernetes (graceful)
kubectl scale -n mirth-cluster deployment/node-mirth --replicas=2
```

The removed node receives SIGTERM and:
1. Returns 503 on readiness probe (LB stops routing)
2. Drains in-flight messages
3. Stops heartbeat
4. Updates `D_SERVERS` to `STATUS='OFFLINE'`
5. Exits cleanly

### What Happens When a Node Goes Down

| Scenario | Detection | Impact |
|----------|-----------|--------|
| Graceful shutdown (SIGTERM) | Immediate -- node sets `STATUS='OFFLINE'` | LB stops routing within seconds |
| Crash (SIGKILL, OOM) | Heartbeat timeout (`MIRTH_CLUSTER_HEARTBEAT_TIMEOUT`, default 30s) | LB readiness probe fails, stops routing |
| Network partition | Heartbeat timeout | Affected node appears offline to peers |

**Recovery**: When the crashed node restarts, its recovery task processes only its own unfinished messages (filtered by `SERVER_ID`). Other nodes' messages are not affected.

### GlobalMap Storage in Cluster Mode

| Backend | Config | Persistence | Shared |
|---------|--------|-------------|--------|
| In-memory (default) | No config needed | Lost on restart | No -- each node has its own copy |
| Database | Automatic when cluster enabled + no Redis | Persistent | Yes -- via `D_GLOBAL_MAP` table |
| Redis | `MIRTH_CLUSTER_REDIS_URL` | Persistent (if Redis is persistent) | Yes |

> **WARNING**: In-memory GlobalMap in cluster mode means each node has isolated state. Set `MIRTH_CLUSTER_REDIS_URL` or accept that `$g` variables are node-local.

### Kubernetes Pod Disruption Budget

For production, configure a PodDisruptionBudget:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: node-mirth-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: node-mirth
```

### Kubernetes Server ID via Downward API

Use the pod name as a stable server ID:

```yaml
env:
  - name: MIRTH_SERVER_ID
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
```

---

## 8. Shadow Mode and Migration

### Overview

Shadow mode enables safe, progressive migration from Java Mirth to Node.js Mirth. When active, channels are deployed (visible in dashboard) but not started (no ports bound, no message processing).

### Start in Shadow Mode

```bash
MIRTH_MODE=takeover \
MIRTH_SHADOW_MODE=true \
PORT=8081 \
DB_HOST=shared-mysql.example.com \
node dist/index.js
```

### Step-by-Step Cutover Procedure

**Step 1: Start Node.js in shadow mode**

```bash
MIRTH_MODE=takeover MIRTH_SHADOW_MODE=true PORT=8081 node dist/index.js
```

**Step 2: Verify shadow mode**

```bash
# Check health
curl -s http://localhost:8081/api/health | jq .
# Expected: "shadowMode": true

# Check shadow status
curl -s http://localhost:8081/api/system/shadow \
  -H "X-Session-ID: $SESSION" | jq .
# Expected: promotedChannels: []

# CLI
mirth-cli shadow status
# Expected: "12 channels deployed, 0 promoted"
```

**Step 3: Stop a channel on Java Mirth**

Using the Java Mirth Administrator GUI or API, stop the channel you want to migrate (e.g., "ADT Receiver"). This frees the listener port.

**Step 4: Promote the channel on Node.js**

```bash
# API
curl -X POST http://localhost:8081/api/system/shadow/promote \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $SESSION" \
  -d '{"channelId":"CHANNEL_ID_HERE"}'

# CLI
mirth-cli shadow promote "ADT Receiver"
```

The channel will start on Node.js, binding its listener port.

**Step 5: Test**

Send test messages to the promoted channel. Verify processing through the dashboard or message search.

**Step 6: Rollback (if needed)**

```bash
# Demote the channel back to shadow
curl -X POST http://localhost:8081/api/system/shadow/demote \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $SESSION" \
  -d '{"channelId":"CHANNEL_ID_HERE"}'

# CLI
mirth-cli shadow demote "ADT Receiver"
```

Then restart the channel on Java Mirth.

**Step 7: Repeat for each channel**

Repeat steps 3-6 for each channel, one at a time.

**Step 8: Full cutover**

Once all channels are validated:

```bash
# Promote all and disable shadow mode
curl -X POST http://localhost:8081/api/system/shadow/promote \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $SESSION" \
  -d '{"all":true}'

# CLI (interactive guided cutover)
mirth-cli shadow cutover
```

**Step 9: Shut down Java Mirth**

After full cutover, the Java Mirth instance can be shut down.

### Shadow Mode Behavior Summary

| Aspect | Shadow Active | Channel Promoted | Full Cutover |
|--------|--------------|-----------------|--------------|
| Channel deployed | Yes | Yes | Yes |
| Dashboard visible | Yes (STOPPED) | Yes (STARTED) | Yes (STARTED) |
| Connectors started | No | Yes | Yes |
| Message processing | No | Yes | Yes |
| API writes | Blocked (409) | Allowed (per-channel) | Allowed |
| VMRouter | Not initialized | Not initialized | Initialized |
| DataPruner | Not initialized | Not initialized | Initialized |
| D_SERVERS status | SHADOW | SHADOW | ONLINE |

> **WARNING**: Shadow mode does not automatically detect port conflicts. Before promoting a channel, stop it on Java Mirth first to free the listener port. EADDRINUSE errors will surface naturally if the port is still bound.

---

## 9. Security

### CORS Configuration

```bash
# Development (allow all -- NOT for production)
CORS_ORIGINS=*

# Production (specific origins)
CORS_ORIGINS=https://admin.example.com,https://dashboard.example.com
```

The server warns at startup if `CORS_ORIGINS=*` is active.

### TLS and Cookie Flags

Session cookies are set with `HttpOnly` and `SameSite=Strict` by default. The `Secure` flag is added when:
- `TLS_ENABLED=true`, or
- `NODE_ENV=production`

For HTTPS termination at a reverse proxy (common in Kubernetes), set `TLS_ENABLED=true` even if the Node.js process itself speaks HTTP.

### Rate Limiting

Login endpoint (`POST /api/users/_login`) is rate-limited to **10 requests per minute per IP** using `express-rate-limit`. This is not configurable via environment variable.

### Content Encryption

Enable encryption for message content stored in `D_MC` tables:

```bash
# Generate a 256-bit AES key
openssl rand -base64 32

# Set the key
MIRTH_ENCRYPTION_KEY=<base64-encoded-key> node dist/index.js
```

Encryption uses AES-256-CBC with PKCS7 padding. The format is `base64(iv):base64(ciphertext)`. Decryption failure returns `null`, never exposing ciphertext.

> **WARNING**: If `MIRTH_ENCRYPTION_KEY` is not set but channels have `encryptData=true`, content will be stored as plaintext. Always set this variable if any channel uses content encryption.

### Session Management

Sessions are stored in-memory with a 30-minute inactivity timeout. Expired sessions are cleaned every 5 minutes.

**Implications for cluster mode**: Sessions are not shared across nodes. Options:
1. **Sticky sessions**: Configure the load balancer to route a client to the same node (recommended)
2. **Accept re-auth**: Clients will need to re-authenticate if routed to a different node

### Security Headers

The `helmet` middleware adds standard security headers (X-Content-Type-Options, X-Frame-Options, etc.). Content Security Policy (CSP) is disabled since this is an API-only server.

### Secrets Management

For production credential management, configure external secrets providers:

```bash
# Environment variables (simplest)
MIRTH_SECRETS_PROVIDERS=env

# File-based (Kubernetes secrets mounted as files)
MIRTH_SECRETS_PROVIDERS=file
MIRTH_SECRETS_FILE_PATH=/run/secrets

# AWS Secrets Manager
MIRTH_SECRETS_PROVIDERS=aws
MIRTH_SECRETS_AWS_REGION=us-east-1
MIRTH_SECRETS_AWS_PREFIX=mirth/

# HashiCorp Vault
MIRTH_SECRETS_PROVIDERS=vault
MIRTH_SECRETS_VAULT_ADDR=https://vault.example.com
MIRTH_SECRETS_VAULT_AUTH=kubernetes
MIRTH_SECRETS_VAULT_K8S_ROLE=mirth

# Multiple providers (first match wins)
MIRTH_SECRETS_PROVIDERS=vault,aws,env
```

Secrets are accessible in channel scripts via `$secrets('key')` and as a fallback for `$cfg('key')`.

---

## 10. Troubleshooting Guide

### "Channel Won't Start" Checklist

1. **Is the channel deployed?**
   ```bash
   curl -s http://localhost:8080/api/channels/statuses -H "X-Session-ID: $SESSION" | jq '.[] | select(.channelId == "CHANNEL_ID")'
   ```

2. **Is the port already in use?**
   ```bash
   lsof -i :<port> | grep LISTEN
   ```

3. **Is the channel enabled in the database?**
   ```bash
   # Check channel config
   curl -s http://localhost:8080/api/channels/CHANNEL_ID -H "X-Session-ID: $SESSION" | jq .enabled
   ```

4. **Are there deploy errors?** Check the logs:
   ```bash
   # Look for deploy failures
   # (or enable engine debug at runtime)
   curl -X PUT http://localhost:8080/api/system/logging/components/engine \
     -H "Content-Type: application/json" -H "X-Session-ID: $SESSION" \
     -d '{"level":"DEBUG"}'
   ```

5. **Is this shadow mode?** Channels are intentionally STOPPED in shadow mode.
   ```bash
   curl -s http://localhost:8080/api/health | jq .shadowMode
   ```

6. **Does the connector type require external dependencies?** (e.g., SFTP requires reachable SSH server, JMS requires ActiveMQ/RabbitMQ broker)

### "Messages Stuck in QUEUED" Checklist

1. **Is the destination reachable?**
   ```bash
   # Test connectivity to the destination
   nc -zv <dest-host> <dest-port>
   ```

2. **Is the destination connector started?** A stopped destination connector will leave messages queued.

3. **Is the queue full?** Check queue size in channel statistics.

4. **Is there a database lock?** Check MySQL for long-running transactions:
   ```sql
   SHOW PROCESSLIST;
   SELECT * FROM information_schema.innodb_locks;
   ```

5. **Enable connector debug logging:**
   ```bash
   curl -X PUT http://localhost:8080/api/system/logging/components/jdbc-connector \
     -H "Content-Type: application/json" -H "X-Session-ID: $SESSION" \
     -d '{"level":"DEBUG"}'
   ```

### "High Memory Usage" Checklist

1. **Check Node.js heap:**
   ```bash
   # If you have access to the process
   node --max-old-space-size=2048 dist/index.js
   ```

2. **Check for large messages:** Very large HL7 or XML messages can consume significant memory during parsing.

3. **Check connection pool size:** Each MySQL connection holds buffers.
   ```bash
   echo "DB_POOL_SIZE=${DB_POOL_SIZE:-10}"
   ```

4. **Check for memory leaks:** If memory grows continuously, take a heap snapshot:
   ```bash
   # Send SIGUSR2 to Node.js process to generate heap dump (requires --heapsnapshot-signal flag)
   kill -USR2 <pid>
   ```

5. **Idle memory baseline:** Node.js Mirth uses approximately 56 MB at idle (compared to 504 MB for Java Mirth).

### "Connection Refused" by Connector Type

| Connector | Common Causes |
|-----------|--------------|
| **TCP/MLLP** | Destination host/port not listening. Firewall blocking. Connection timeout too short. |
| **HTTP** | Destination URL unreachable. TLS certificate issue. Proxy not configured. |
| **JDBC** | Database host unreachable. Wrong credentials. Connection limit exceeded. |
| **SMTP** | Mail server unreachable. Wrong port (25 vs 587 vs 465). TLS required but not configured. |
| **JMS (STOMP)** | Broker not running. Wrong STOMP port (61613 for ActiveMQ). Queue/topic does not exist. |
| **SFTP** | SSH host key verification failure. Wrong credentials/key file. Port 22 not reachable. |
| **DICOM** | PACS not accepting associations. Wrong AE title. Transfer syntax mismatch. |

### Database Connection Issues

| Error | Cause | Resolution |
|-------|-------|------------|
| `ECONNREFUSED` | MySQL not running or wrong host/port | Verify MySQL is up: `mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p` |
| `ER_ACCESS_DENIED_ERROR` | Wrong credentials | Verify `DB_USER`/`DB_PASSWORD` |
| `ER_BAD_DB_ERROR` | Database does not exist | Create it: `CREATE DATABASE mirthdb;` |
| `PROTOCOL_CONNECTION_LOST` | Connection dropped | Check MySQL `wait_timeout` setting, increase if needed |
| `ER_CON_COUNT_ERROR` | Too many connections | Increase MySQL `max_connections` or reduce `DB_POOL_SIZE` |
| `ETIMEDOUT` | Network timeout | Check network connectivity, increase `DB_CONNECT_TIMEOUT` |

### Common Error Messages

| Error | Meaning |
|-------|---------|
| `Mirth is already running` | Attempted to call `start()` twice |
| `Database pool not initialized. Call initPool() first.` | Server not started or DB connection failed |
| `Schema incompatible` | Takeover mode: existing schema is too old/new |
| `Channel not deployed: <id>` | VMRouter tried to route to an undeployed channel |
| `RedisMapBackend requires the ioredis package` | Redis URL configured but ioredis not installed |
| `Invalid AES key length` | `MIRTH_ENCRYPTION_KEY` is not 16, 24, or 32 bytes when decoded |

---

## 11. Backup and Recovery

### What to Backup

| Component | Location | Frequency | Notes |
|-----------|----------|-----------|-------|
| MySQL database | All tables | Daily + before upgrades | Full dump with `mysqldump --single-transaction` |
| Git artifact repo | `MIRTH_ARTIFACT_REPO` path | Automated via git push | Channel configs as code |
| Environment config | `.env` file or K8s ConfigMaps/Secrets | Version controlled | All `MIRTH_*` variables |
| Encryption key | `MIRTH_ENCRYPTION_KEY` | Secure storage (Vault, KMS) | Required to decrypt content |

### Database Backup

```bash
# Full backup
mysqldump --single-transaction --routines --triggers \
  -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME > backup.sql

# Restore
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME < backup.sql
```

### Recovery Task Behavior

When a Node.js Mirth instance starts, it runs a recovery task for each deployed channel to process messages left in an incomplete state (e.g., from a crash).

**Key safety feature**: The recovery task filters by `SERVER_ID`. This means:
- Instance A only recovers Instance A's messages
- Instance B's messages are not touched
- Java Mirth's messages are not touched (different `SERVER_ID` namespace)

This prevents duplicate processing in multi-instance or hybrid (Java + Node.js) deployments.

### Git Artifact Recovery

If the database is lost but the git artifact repository is preserved:

```bash
# Initialize a fresh standalone instance
MIRTH_MODE=standalone node dist/index.js

# Import all channels from git
mirth-cli artifact import --all --env prod
```

### Point-in-Time Recovery Considerations

- Message tables (`D_M{id}`, `D_MM{id}`, etc.) have `SERVER_ID` columns
- Statistics tables (`D_MS{id}`) have per-node rows keyed by `(METADATA_ID, SERVER_ID)`
- Sequence tables (`D_MSQ{id}`) use row-level locks for ID generation -- gaps from block pre-allocation are harmless
- Cluster tables (`D_SERVERS`, `D_CLUSTER_EVENTS`) are Node.js-only and will be recreated automatically

---

## 12. Known Limitations

### In-Memory Session Store

**Severity**: MEDIUM

Sessions are stored in process memory. In cluster mode, sessions are not shared across nodes.

**Workaround**: Configure sticky sessions (session affinity) at the load balancer. All major LBs support this (AWS ALB, NGINX, HAProxy, Kubernetes Ingress).

### AlertServlet `changedChannels`

**Severity**: LOW

The `changedChannels` field in alert responses always returns an empty array. This is a cosmetic issue that does not affect alerting functionality.

### DICOM Storage Commitment

**Severity**: LOW

N-ACTION and N-EVENT-REPORT operations (storage commitment protocol) are not implemented. Standard C-STORE and C-ECHO operations work correctly. Storage commitment is rarely used in practice.

### stompit JMS Library

**Severity**: LOW

JMS functionality is implemented via the STOMP protocol using the `stompit` library, which is currently unmaintained. STOMP connectivity works correctly with ActiveMQ and RabbitMQ. If issues arise, consider migrating to a maintained STOMP client or implementing native AMQP support.

### Redis MapBackend Not Bundled

**Severity**: LOW

The `RedisMapBackend` requires `ioredis` to be installed separately. If `MIRTH_CLUSTER_REDIS_URL` is set without ioredis installed, an actionable error message is displayed: "Install with: npm install ioredis".

### JavaScript Runtime Minor Gaps

**Severity**: LOW (14 edge cases)

Minor deviations from Java Mirth's Rhino JavaScript runtime:

- `Namespace()` and `QName()` E4X constructors (use `XMLProxy` API instead)
- `importClass` (logs deprecation, not functional)
- `resultMap` not injected for Database Reader scripts
- Convenience variables (`regex`, `xml`, `xmllist`) not injected into scope
- `XML.ignoreWhitespace` global setting not implemented

These affect less than 1% of production channels. Channels using these features should be tested during migration.

### Connector Minor Gaps

**Severity**: LOW (6 edge cases)

- HTTP Receiver plugin-based authentication (AuthenticatorProvider interface) -- use API gateway authentication instead
- WebService Receiver authentication -- use API gateway or network-level authentication
- File connector FTP/S3/SMB backends -- SFTP is fully supported; FTP/S3/SMB require additional implementation
- DICOM storage commitment (N-ACTION/N-EVENT-REPORT) -- see above
- HTTP Digest authentication edge cases -- Basic and Bearer auth fully supported
- JDBC Receiver parameterized queries -- use inline SQL parameters instead

### Worker Exit Warning in Tests

**Severity**: LOW (cosmetic)

A "worker exiting" warning may appear in test output due to Winston transport lifecycle. This is cosmetic and does not affect functionality. `.unref()` is applied to prevent the timer from keeping the process alive.

---

## Appendix A: Complete Environment Variable Reference

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `HTTPS_PORT` | `8443` | HTTPS listen port |
| `MIRTH_MODE` | `auto` | `takeover`, `standalone`, or `auto` |
| `MIRTH_SHADOW_MODE` | `false` | Enable read-only shadow mode |
| `MIRTH_ENCRYPTION_KEY` | (none) | Base64 AES key for content encryption |
| `MIRTH_SCRIPT_TIMEOUT` | `30000` | Script execution timeout (ms) |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | `mirthdb` | Database name |
| `DB_USER` | `mirth` | Username |
| `DB_PASSWORD` | `mirth` | Password |
| `DB_POOL_SIZE` | `10` | Connection pool size |
| `DB_CONNECT_TIMEOUT` | `10000` | Connection timeout (ms) |
| `DB_QUEUE_LIMIT` | `0` | Queue limit (0 = unlimited) |

### Cluster

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_SERVER_ID` | auto UUID | Unique instance identifier |
| `MIRTH_CLUSTER_ENABLED` | `false` | Enable cluster-aware behavior |
| `MIRTH_CLUSTER_REDIS_URL` | (none) | Redis URL for shared state |
| `MIRTH_CLUSTER_SECRET` | (none) | Inter-node API auth secret |
| `MIRTH_CLUSTER_HEARTBEAT_INTERVAL` | `10000` | Heartbeat interval (ms) |
| `MIRTH_CLUSTER_HEARTBEAT_TIMEOUT` | `30000` | Node suspect threshold (ms) |
| `MIRTH_CLUSTER_SEQUENCE_BLOCK` | `100` | Message ID block size |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Global minimum level |
| `LOG_FORMAT` | `text` | `text` or `json` |
| `LOG_FILE` | (none) | File transport path |
| `LOG_TIMESTAMP_FORMAT` | `mirth` | `mirth` or `iso` |
| `MIRTH_DEBUG_COMPONENTS` | (none) | Comma-separated component debug list |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `TLS_ENABLED` | (none) | Enable Secure cookie flag |
| `NODE_ENV` | (none) | `production` enables Secure cookies |

### Artifact Management

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_ARTIFACT_REPO` | (none) | Git repository path |
| `MIRTH_ARTIFACT_ENV` | (none) | Active environment name |
| `MIRTH_ARTIFACT_AUTO_SYNC` | `false` | Enable filesystem watcher |
| `MIRTH_ARTIFACT_REMOTE` | `origin` | Git remote name |

### Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_SECRETS_PROVIDERS` | (none) | Comma-separated providers |
| `MIRTH_SECRETS_CACHE_TTL` | `300` | Cache TTL (seconds) |
| `MIRTH_SECRETS_FILE_PATH` | `/run/secrets` | File-based secrets path |
| `MIRTH_CONFIG_FILE` | (none) | Properties/env file path |
| `MIRTH_SECRETS_AWS_REGION` | (none) | AWS region |
| `MIRTH_SECRETS_AWS_PREFIX` | `mirth/` | AWS prefix |
| `MIRTH_SECRETS_GCP_PROJECT` | (none) | GCP project ID |
| `MIRTH_SECRETS_AZURE_VAULT_URL` | (none) | Azure Key Vault URL |
| `MIRTH_SECRETS_VAULT_ADDR` | (none) | Vault server address |
| `MIRTH_SECRETS_VAULT_TOKEN` | (none) | Vault token |
| `MIRTH_SECRETS_VAULT_PATH` | `secret/data/mirth` | Vault secret path |
| `MIRTH_SECRETS_VAULT_AUTH` | `token` | Auth method: `token`, `approle`, `kubernetes` |
| `MIRTH_SECRETS_VAULT_ROLE_ID` | (none) | AppRole role ID |
| `MIRTH_SECRETS_VAULT_SECRET_ID` | (none) | AppRole secret ID |
| `MIRTH_SECRETS_VAULT_K8S_ROLE` | (none) | K8s auth role name |
| `MIRTH_SECRETS_ENCRYPT_CACHE` | `false` | Encrypt local secret cache |
| `MIRTH_SECRETS_CFG_KEYS` | (none) | Comma-separated keys to preload |

---

## Appendix B: API Quick Reference

### Authentication

```bash
# Login
curl -X POST http://localhost:8080/api/users/_login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin"
# Returns X-Session-ID header

# Logout
curl -X POST http://localhost:8080/api/users/_logout \
  -H "X-Session-ID: $SESSION"
```

### Channel Management

```bash
# List channels
curl http://localhost:8080/api/channels -H "X-Session-ID: $SESSION"

# Get channel statuses
curl http://localhost:8080/api/channels/statuses -H "X-Session-ID: $SESSION"

# Deploy
curl -X POST "http://localhost:8080/api/channels/_deploy?returnErrors=true" \
  -H "Content-Type: application/xml" -H "X-Session-ID: $SESSION" \
  -d '<set><string>CHANNEL_ID</string></set>'

# Start / Stop / Pause / Resume (same pattern, change _deploy to _start etc.)
```

### System

```bash
# Server info
curl http://localhost:8080/api/system/info -H "X-Session-ID: $SESSION"

# Cluster status
curl http://localhost:8080/api/system/cluster/status -H "X-Session-ID: $SESSION"

# Shadow status
curl http://localhost:8080/api/system/shadow -H "X-Session-ID: $SESSION"

# Logging status
curl http://localhost:8080/api/system/logging -H "X-Session-ID: $SESSION"
```

### Data Pruner

```bash
# Status
curl http://localhost:8080/api/extensions/datapruner/status -H "X-Session-ID: $SESSION"

# Start manual prune
curl -X POST http://localhost:8080/api/extensions/datapruner/start -H "X-Session-ID: $SESSION"

# Stop running prune
curl -X POST http://localhost:8080/api/extensions/datapruner/stop -H "X-Session-ID: $SESSION"
```

### WebSocket Endpoints

```
ws://localhost:8080/ws/dashboardstatus   # Real-time channel status
ws://localhost:8080/ws/serverlog         # Real-time log streaming
```
