# Mirth Connect Node.js Runtime

A Node.js/TypeScript replacement for the Mirth Connect Java integration engine, maintaining **100% API compatibility** with Mirth Connect Administrator.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Mirth Compatible](https://img.shields.io/badge/Mirth-3.9.x-orange)](https://www.nextgen.com/solutions/interoperability/mirth-integration-engine)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## Overview

This project provides a modern, TypeScript-based implementation of the Mirth Connect integration engine. It allows you to run Mirth channels designed for the Java engine on Node.js, with full support for:

- **E4X JavaScript** — Legacy E4X scripts are automatically transpiled to modern JavaScript
- **HL7v2, XML, JSON** — Full data type support with parsing, serialization, and ACK generation
- **MLLP, HTTP, TCP, File, Database** — All major connector protocols
- **Mirth Administrator Compatibility** — Use the existing Mirth Administrator GUI

## Incremental Takeover Strategy

**The key differentiator: Node.js Mirth can seamlessly replace Java Mirth without any migration.**

The only difference between the Java and Node.js engines is the **operational mode**:

| Mode | Command | Use Case |
|------|---------|----------|
| **Takeover** | `MIRTH_MODE=takeover npm start` | Connect to existing Java Mirth database. Zero migration. |
| **Standalone** | `MIRTH_MODE=standalone npm start` | Fresh installation with auto-created schema. |
| **Auto** | `npm start` | Auto-detect: uses existing DB if found, else creates new. |

- **Zero Data Migration**: Point Node.js at your existing MySQL database — all channels, messages, users, and configuration are immediately available
- **Rollback Safety**: If issues arise, switch back to Java Mirth instantly (same database)
- **Gradual Adoption**: Test channel-by-channel before full cutover
- **Same Admin GUI**: Mirth Administrator works identically with both engines

See the full [Migration & Shadow Mode Guide](docs/migration-and-shadow-mode.md) for the migration timeline and progressive cutover workflow.

## Shadow Mode

Shadow mode enables safe, progressive cutover from Java to Node.js. The Node.js engine deploys all channels in a read-only observer state, and the operator promotes them one-by-one. See the full [Migration & Shadow Mode Guide](docs/migration-and-shadow-mode.md#shadow-mode-safe-takeover).

## Centralized Logging

Transport-pluggable logging (Winston 3.x) with per-component debug control, runtime log level API, and text/JSON output formats. See the full [Centralized Logging Guide](docs/centralized-logging.md).

## Git-Backed Configuration Management

Manage Mirth configurations as code: decompose channel XML into reviewable file trees, sync with git, promote across environments, and deploy only what changed. See the full [Artifact Management Guide](docs/artifact-management.md).

## Horizontal Scaling

Container-native clustering with health probes, block-allocated sequences, and database-backed global maps. No commercial clustering plugin required. See the full [Horizontal Scaling Guide](docs/horizontal-scaling.md).

## Kubernetes Deployment

Full container-native testing platform with Kustomize overlays for all 4 operational modes. Validated on Rancher Desktop k3s (Apple Silicon). See the full [Kubernetes Guide](k8s/README.md).

```bash
# Build image + deploy base infra (MySQL, Java Mirth, mock services)
./k8s/scripts/setup.sh

# Deploy an overlay
kubectl apply -k k8s/overlays/standalone/   # Fresh DB
kubectl apply -k k8s/overlays/takeover/     # Shared DB with Java Mirth
kubectl apply -k k8s/overlays/shadow/       # Shadow mode (read-only observer)
kubectl apply -k k8s/overlays/cluster/      # 3 replicas, horizontal scaling

# Deploy Kitchen Sink (34 channels) + run k6 load tests
./k8s/scripts/deploy-kitchen-sink.sh
./k8s/scripts/run-k6.sh api-load
```

## Features

| Category | Features |
|----------|----------|
| **Connectors** | HTTP, TCP/MLLP, JDBC, File/SFTP/S3, VM, SMTP, JMS, WebService (SOAP), DICOM |
| **Data Types** | HL7v2 (ACK generation), XML, JSON, Raw, Delimited, EDI/X12, HL7v3 (CDA), NCPDP, DICOM |
| **JavaScript** | E4X transpilation (incl. attribute write, XML append), Mirth scope variables ($c, $s, $g, $r, etc.), ScriptBuilder helpers (type coercion, auto-serialization), VMRouter, DestinationSet, FileUtil, HTTPUtil, DICOMUtil, XmlUtil, JsonUtil |
| **API** | Full REST API compatible with Mirth Administrator (14 servlets) with message import/export and attachments |
| **Logging** | Centralized Winston-based logging with per-component debug control, runtime log level API, text/JSON output, file rotation |
| **Plugins** | Code Templates, Data Pruner, XSLT, JavaScriptRule, JavaScriptStep, Mapper, MessageBuilder, ServerLog, DashboardStatus |
| **CLI Tool** | Terminal-based monitor and management utility |
| **Userutil** | DatabaseConnection, AttachmentUtil, ChannelUtil, AlertSender, Future, UUIDGenerator, NCPDPUtil, ContextFactory, XmlUtil, JsonUtil, Lists, Maps |
| **Shadow Mode** | Safe read-only takeover with progressive per-channel cutover from Java Mirth |
| **Cluster** | Container-native horizontal scaling, health probes, block-allocated sequences, database-backed global maps, graceful shutdown |
| **Kubernetes** | Kustomize overlays for standalone/takeover/shadow/cluster modes, Dockerfile, k6 load tests, Kitchen Sink deployment scripts |
| **Artifact Management** | Git-backed config management: decompose/assemble, export/import, structural diff, env promotion, delta deploy |
| **Utilities** | ValueReplacer, ACKGenerator, JsonXmlUtil, SerializerFactory, ErrorMessageBuilder |

## Quick Start

### Prerequisites

- Node.js 18+
- MySQL 5.7+ or 8.0 (uses existing Mirth schema)
- Docker (optional, for validation suite)
- Rancher Desktop (optional, for Kubernetes deployment)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/mirth-connect-nodejs.git
cd mirth-connect-nodejs

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration

Create a `.env` file in the project root:

```env
# Operational Mode (the ONLY difference between Java and Node.js Mirth)
# Options: takeover | standalone | auto (default: auto)
MIRTH_MODE=auto

# Database (same as Java Mirth - point to existing DB for takeover mode)
DB_HOST=localhost
DB_PORT=3306
DB_USER=mirth
DB_PASSWORD=mirth
DB_NAME=mirthdb

# Server
PORT=8081
NODE_ENV=development

# Logging (centralized, transport-pluggable)
LOG_LEVEL=INFO                                    # TRACE, DEBUG, INFO, WARN, ERROR
# MIRTH_DEBUG_COMPONENTS=http-connector,engine    # Per-component debug (comma-separated)
# LOG_FORMAT=text                                 # text (human) or json (structured)
# LOG_FILE=/var/log/mirth/server.log              # Optional file transport
# LOG_TIMESTAMP_FORMAT=mirth                      # mirth (Java-style) or iso

# Shadow Mode (optional — for safe Java → Node.js takeover)
# MIRTH_SHADOW_MODE=true              # Deploy channels read-only, promote one-by-one

# Horizontal Scaling (optional — single-instance by default)
# MIRTH_SERVER_ID=my-instance-1       # Unique ID (auto-generated UUID if omitted)
# MIRTH_CLUSTER_ENABLED=true          # Enable cluster-aware behavior
# MIRTH_CLUSTER_REDIS_URL=redis://... # Optional: Redis for maps + events
# MIRTH_CLUSTER_SECRET=my-secret      # Inter-instance API auth
# MIRTH_CLUSTER_HEARTBEAT_INTERVAL=10000  # Heartbeat interval (ms)
# MIRTH_CLUSTER_HEARTBEAT_TIMEOUT=30000   # Suspect threshold (ms)
# MIRTH_CLUSTER_SEQUENCE_BLOCK=100        # Sequence block pre-allocation

# Git-Backed Artifact Management (optional — for config-as-code workflows)
# MIRTH_ARTIFACT_REPO=./mirth-config     # Path to git repo for artifact sync
# MIRTH_ARTIFACT_ENV=dev                  # Active environment (dev/staging/prod)
# MIRTH_ARTIFACT_AUTO_SYNC=false          # Enable fs watcher for auto-sync
# MIRTH_ARTIFACT_REMOTE=origin            # Git remote name
```

### Operational Modes Explained

| Mode | Schema Management | Default Credentials | Use Case |
|------|-------------------|---------------------|----------|
| `takeover` | Uses existing schema, verifies compatibility | Uses existing users | Replace running Java Mirth |
| `standalone` | Creates all tables, seeds defaults | admin/admin | Fresh Node.js installation |
| `auto` | Detects: existing schema → takeover, empty DB → standalone | Depends on detection | Development, testing |

### Running

```bash
# Production
npm start

# Development (with hot reload)
npm run dev
```

The server will start on `http://localhost:8081`. Connect Mirth Administrator to this endpoint.

## CLI Tool

The `mirth-cli` command provides a terminal-based interface for monitoring and managing Mirth Connect channels.

```bash
# Install globally
npm run cli:link

# Core commands
mirth-cli login -u admin -p admin
mirth-cli channels                     # List channels with status
mirth-cli messages search <id> -s E    # Find errors
mirth-cli send mllp localhost:6662 @test.hl7
mirth-cli dashboard                    # Interactive real-time view
```

See the full [CLI Reference](docs/cli-reference.md) for all commands, options, keyboard shortcuts, and example sessions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         REST API Layer                          │
│      (Express + Content Negotiation + Health Probes)           │
├─────────────────────────────────────────────────────────────────┤
│  Controllers       │  Cluster Module                           │
│  Channel, Config   │  ClusterIdentity, ServerRegistry          │
│  Engine, User      │  SequenceAllocator, HealthCheck           │
│                    │  EventBus, MapBackend, RemoteDispatcher   │
├─────────────────────────────────────────────────────────────────┤
│                      Donkey Engine                              │
│    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│    │   Source    │───▶│  Filter/    │───▶│ Destination │       │
│    │  Connector  │    │ Transformer │    │  Connector  │       │
│    └─────────────┘    └─────────────┘    └─────────────┘       │
├─────────────────────────────────────────────────────────────────┤
│  Connectors        │  Data Types      │  JavaScript Runtime    │
│  HTTP, MLLP, TCP   │  HL7v2, XML      │  E4X Transpiler        │
│  JDBC, File, SFTP  │  JSON, Raw       │  Scope Builder         │
│  SMTP, JMS, SOAP   │  EDI, HL7v3      │  32 Userutil Classes   │
│  DICOM             │  NCPDP, DICOM    │  Script Builder        │
├─────────────────────────────────────────────────────────────────┤
│  Artifact Management (Git-Backed Config-as-Code)               │
│  Decompose/Assemble │ Git Sync │ Env Vars │ Promote │ Deploy   │
├─────────────────────────────────────────────────────────────────┤
│  Logging (Winston 3.x + ServerLogController)                   │
│  Per-Component Debug │ Runtime API │ Text/JSON │ File Rotation  │
├─────────────────────────────────────────────────────────────────┤
│                      Database Layer                             │
│   (MySQL - Existing Mirth Schema + Cluster/Artifact Tables)    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Description |
|-----------|----------|-------------|
| **Donkey Engine** | `src/donkey/` | Message processing pipeline (Statistics, Queues, DestinationChain, ResponseSelector) |
| **Connectors** | `src/connectors/` | 11 protocol implementations (HTTP, TCP, JDBC, File, VM, SMTP, JMS, WebService, DICOM) |
| **JavaScript Runtime** | `src/javascript/` | E4X transpilation, script execution, 32 userutil classes, ScriptBuilder with Java-parity helpers |
| **Data Types** | `src/datatypes/` | 9 types: HL7v2, XML, JSON, Raw, Delimited, EDI/X12, HL7v3, NCPDP, DICOM |
| **REST API** | `src/api/` | Express-based API compatible with Mirth Administrator (14 servlets) |
| **CLI Tool** | `src/cli/` | Terminal-based monitor and management utility |
| **Plugins** | `src/plugins/` | Code Templates, Data Pruner, XSLT, JavaScriptRule, JavaScriptStep, Mapper, MessageBuilder, ServerLog, DashboardStatus |
| **Cluster** | `src/cluster/` | Horizontal scaling: ClusterIdentity, ServerRegistry, SequenceAllocator, HealthCheck, EventBus, MapBackend |
| **Artifact Management** | `src/artifact/` | Git-backed config: ChannelDecomposer, GitSyncService, PromotionPipeline, DeltaDetector, VariableResolver |
| **Logging** | `src/logging/` | Centralized logging: LoggerFactory, Logger, DebugModeRegistry, ConsoleTransport, FileTransport |
| **Utilities** | `src/util/` | ValueReplacer, ACKGenerator, JsonXmlUtil, ErrorMessageBuilder, SerializerFactory |

## API Endpoints

The REST API mirrors the Mirth Connect Server API with 14 fully-implemented servlets plus Node.js-only extensions for clustering, logging, shadow mode, and artifact management. See the full [API Reference](docs/api-reference.md).

## JavaScript Runtime

Full E4X transpilation (including attribute write, XML append, named property deletion), Mirth scope variables ($c, $s, $g, $r, $cfg, etc.), ScriptBuilder with Java-parity helper functions (type coercion, auto-serialization, validate replacement), and 32 userutil classes injected into script scope. See the full [JavaScript Runtime Reference](docs/javascript-runtime.md).

## Development

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Development server with hot reload |
| `npm start` | Production server |
| `npm test` | Run test suite (5,289 tests) |
| `npm run test:coverage` | Generate coverage report |
| `npm run lint` | Check code style |
| `npm run typecheck` | Type check without compiling |

See the full [Development Guide](docs/development-guide.md) for project structure, test organization, and code quality tools.

## Testing & Validation

**5,289 tests passing** (2,559 core + 417 artifact + 2,313 parity/unit). The `validation/` directory validates Node.js behavior against the Java engine across all priority levels (export compatibility, MLLP, JavaScript, connectors, data types, advanced, operational modes). Kubernetes deployment validated across all 4 operational modes on Rancher Desktop k3s. See the full [Development Guide](docs/development-guide.md#validation-suite).

## Version Management

Currently targets Mirth Connect **3.9.1**. Includes tooling for version diffing, upgrade task generation, and compatibility validation. See the full [Development Guide](docs/development-guide.md#version-management).

## Database

Uses the existing Mirth MySQL schema with no modifications in takeover mode. Node.js-only tables (D_SERVERS, D_CLUSTER_EVENTS, D_GLOBAL_MAP, D_ARTIFACT_SYNC) are additive and safe in shared databases. See the full [Database Schema & Engine Behavior](docs/database-schema.md).

## Troubleshooting

### Common Issues

**E4X Transpilation Errors**
```
Error: Unexpected token in E4X expression
```
Ensure your scripts don't mix E4X with template literals. The transpiler handles standard E4X patterns including XML literals, attribute read/write (`.@attr`), descendant access (`..`), `for each...in`, XML append (`+=`), and named property deletion (`delete msg.PID['PID.6']`).

**Database Connection Failed**
```
Error: ECONNREFUSED 127.0.0.1:3306
```
Verify MySQL is running and credentials in `.env` are correct.

**Channel Deploy Timeout**
```
Error: Deploy timeout exceeded
```
Java Mirth under QEMU (M1 Mac) is slow. The timeout is set to 120 seconds in `MirthApiClient.ts`.

## Production Configuration

When deploying to production, review these settings to harden security and reliability.

### Security

| Variable | Default | Production Recommendation |
|----------|---------|--------------------------|
| `CORS_ORIGINS` | `*` (all origins) | Set to specific admin UI origins: `https://mirth-admin.example.com` |
| `MIRTH_API_RATE_LIMIT` | `100` | Requests per minute per IP. Adjust based on expected API traffic. Health endpoints are exempt. |
| `NODE_ENV` | `development` | Set to `production` to suppress stack traces in error responses |

### Database Resilience

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_POOL_SIZE` | `10` | Max concurrent connections. Increase for high-volume channels. |
| `DB_DEADLOCK_RETRIES` | `3` | Auto-retry on MySQL deadlock (error 1213) and lock wait timeout (1205). Exponential backoff. |
| `DB_CONNECT_TIMEOUT` | `10000` | Connection timeout in ms |
| `DB_QUEUE_LIMIT` | `0` | Max queued connection requests (0 = unlimited) |

### Script Execution

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_SCRIPT_TIMEOUT` | `30000` | CPU timeout for user scripts (vm.Script timeout in ms) |
| `MIRTH_SCRIPT_WALL_TIMEOUT` | `60000` | Wall-clock warning threshold (ms). Logs a warning if execution exceeds this — catches blocking I/O. |

### Cluster Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_CLUSTER_ENABLED` | `false` | Enable cluster-aware behavior (D_SERVERS registration, heartbeat) |
| `MIRTH_CLUSTER_REDIS_URL` | (none) | Redis URL for shared sessions and cluster communication. Required for multi-instance session persistence. |
| `MIRTH_CLUSTER_QUORUM_ENABLED` | `false` | Health check returns 503 if alive nodes < ceil(total/2). Prevents split-brain. |
| `MIRTH_CLUSTER_DEAD_NODE_CLEANUP` | `true` | Auto-mark nodes as OFFLINE when heartbeat expires |
| `MIRTH_CLUSTER_SECRET` | (none) | Shared secret for inter-instance API authentication |
| `MIRTH_CLUSTER_HEARTBEAT_INTERVAL` | `10000` | Heartbeat interval in ms |
| `MIRTH_CLUSTER_HEARTBEAT_TIMEOUT` | `30000` | Node suspect threshold in ms |
| `MIRTH_CLUSTER_SEQUENCE_BLOCK` | `100` | Pre-allocated message ID block size |

### Process Safety

The server registers handlers for `uncaughtException` and `unhandledRejection`. On either event:
1. The error is logged
2. A graceful shutdown is attempted (in-flight messages drain)
3. After a 5-second safety timeout, the process exits with code 1

Container orchestrators (Kubernetes, ECS) should configure restart policies to automatically recover from these exits.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Run linting (`npm run lint:fix`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Development Guidelines

- Follow the patterns in `CLAUDE.md`
- Write tests for new functionality
- Validate against Java Mirth for API changes
- Use E4X transpiler for any user script execution

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [NextGen Healthcare](https://www.nextgen.com/) for the original Mirth Connect
- The Mirth Connect open-source community
