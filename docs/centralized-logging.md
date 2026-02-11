[← Back to README](../README.md)

# Centralized Logging

A transport-pluggable logging system built on Winston 3.x, replacing direct `console.*` calls with per-component named loggers. Each logger writes to both Winston transports (console/file) and the ServerLogController (WebSocket dashboard streaming).

## How It Works

```
getLogger('engine')  →  Logger  →  Winston (console/file/cloud)
                              ↘  ServerLogController (WebSocket streaming)
```

**Level hierarchy:** Per-component override > Global `LOG_LEVEL`

The existing `hookConsole()` backward-compatibility bridge remains active for any unmigrated `console.*` calls (they flow into the dashboard with category `'console'`). Migrated code uses named loggers with proper component categories.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Global minimum level: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `MIRTH_DEBUG_COMPONENTS` | (none) | Comma-separated list of components to set to DEBUG (or `name:LEVEL`) |
| `LOG_FORMAT` | `text` | Output format: `text` (human-readable) or `json` (structured) |
| `LOG_FILE` | (none) | Optional file path for file transport (10MB rotation, 5 files) |
| `LOG_TIMESTAMP_FORMAT` | `mirth` | `mirth` = `yyyy-MM-dd HH:mm:ss,SSS`, `iso` = ISO 8601 |

## Enabling Debug for Specific Components

The `MIRTH_DEBUG_COMPONENTS` environment variable enables targeted debugging without changing the global log level:

```bash
# Debug HTTP connector only (everything else stays at WARN)
LOG_LEVEL=WARN MIRTH_DEBUG_COMPONENTS=http-connector node dist/index.js

# Debug multiple connectors
MIRTH_DEBUG_COMPONENTS=http-connector,tcp-connector,jdbc-connector node dist/index.js

# Debug with specific levels per component
MIRTH_DEBUG_COMPONENTS=http-connector:TRACE,engine:DEBUG node dist/index.js

# Debug all file-related operations
MIRTH_DEBUG_COMPONENTS=file-connector node dist/index.js

# Debug the entire message pipeline
MIRTH_DEBUG_COMPONENTS=engine,channel node dist/index.js
```

## Available Component Names

Components register themselves at module load time. Currently migrated:

| Component | Description | Debug Use Case |
|-----------|-------------|----------------|
| `server` | Server lifecycle (startup, shutdown) | Startup sequencing issues |
| `engine` | Channel deploy/start/stop | Deployment or state transition problems |

Future phases will register these additional components:

| Component | Description | Debug Use Case |
|-----------|-------------|----------------|
| `channel` | Message processing pipeline | Message routing, filter/transformer issues |
| `http-connector` | HTTP source/destination | HTTP request/response debugging |
| `tcp-connector` | TCP/MLLP connections | MLLP framing, connection lifecycle |
| `file-connector` | File/SFTP/S3 polling | File polling, read/write failures |
| `jdbc-connector` | Database connector | SQL queries, connection pooling |
| `jms-connector` | JMS messaging (STOMP) | Queue/topic subscription issues |
| `smtp-connector` | Email sending | SMTP connection, authentication |
| `webservice-connector` | SOAP/WSDL | SOAP envelope, MTOM attachments |
| `dicom-connector` | DICOM/DIMSE | Association negotiation, transfer syntax |
| `vm-connector` | Channel Writer/Reader | Cross-channel message routing |
| `database` | DB pool/queries | Connection pool, query performance |
| `javascript` | Script execution | Script compilation, scope variable issues |
| `api` | REST API server | Request handling, auth middleware |
| `cluster` | Cluster operations | Heartbeat, node registration |
| `data-pruner` | Pruning operations | Retention calculations, batch deletes |
| `secrets` | Secret management | Provider initialization, cache behavior |

## Runtime Log Level API

Change log levels at runtime without restarting the server:

```bash
# View current log configuration
curl http://localhost:8081/api/system/logging

# Set global level to DEBUG
curl -X PUT http://localhost:8081/api/system/logging/level \
  -H "Content-Type: application/json" -d '{"level":"DEBUG"}'

# Enable debug for a specific component
curl -X PUT http://localhost:8081/api/system/logging/components/engine \
  -H "Content-Type: application/json" -d '{"level":"DEBUG"}'

# Clear a component override (revert to global level)
curl -X DELETE http://localhost:8081/api/system/logging/components/engine
```

## Output Formats

**Text format** (default) — matches Java Mirth's Log4j pattern:
```
INFO  2026-02-10 14:30:15,042 [server] Starting Mirth Connect Node.js Runtime...
INFO  2026-02-10 14:30:15,150 [server] Connected to database at localhost:3306
INFO  2026-02-10 14:30:15,320 [engine] Deployed channel: ADT Receiver (abc-123)
DEBUG 2026-02-10 14:30:15,321 [engine] Channel state transition: STOPPED → STARTED
```

**JSON format** (`LOG_FORMAT=json`) — for log aggregation (CloudWatch, Datadog, ELK):
```json
{"level":"info","message":"Starting Mirth Connect...","component":"server","timestamp":"2026-02-10T14:30:15.042Z"}
{"level":"info","message":"Deployed channel: ADT Receiver","component":"engine","channelId":"abc-123","timestamp":"2026-02-10T14:30:15.320Z"}
```

## Logging API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/logging` | GET | Current global level + all component overrides |
| `/api/system/logging/level` | PUT | Set global level `{ level: "DEBUG" }` |
| `/api/system/logging/components/:name` | PUT | Set per-component override `{ level: "DEBUG" }` |
| `/api/system/logging/components/:name` | DELETE | Clear component override (revert to global) |

All endpoints require authentication.
