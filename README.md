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

## 🔄 Incremental Takeover Strategy

**The key differentiator: Node.js Mirth can seamlessly replace Java Mirth without any migration.**

The only difference between the Java and Node.js engines is the **operational mode** — a single environment variable that determines how the Node.js runtime interacts with the database:

| Mode | Command | Use Case |
|------|---------|----------|
| **Takeover** | `MIRTH_MODE=takeover npm start` | Connect to existing Java Mirth database. Zero migration. |
| **Standalone** | `MIRTH_MODE=standalone npm start` | Fresh installation with auto-created schema. |
| **Auto** | `npm start` | Auto-detect: uses existing DB if found, else creates new. |

### Migration Path: Java → Node.js

```
Week 1: Run Node.js Mirth in TAKEOVER mode alongside Java Mirth
        ↓ Both engines share the same MySQL database
        ↓ Use Java Mirth as primary, Node.js for testing

Week 2: Gradually route traffic to Node.js endpoints
        ↓ Compare behavior, validate messages

Week 3: Switch primary to Node.js
        ↓ Keep Java Mirth as fallback

Week 4: Decommission Java Mirth
        ↓ Node.js runs standalone
```

### Why This Matters

- **Zero Data Migration**: Point Node.js at your existing MySQL database — all channels, messages, users, and configuration are immediately available
- **Rollback Safety**: If issues arise, switch back to Java Mirth instantly (same database)
- **Gradual Adoption**: Test channel-by-channel before full cutover
- **Same Admin GUI**: Mirth Administrator works identically with both engines

## Features

| Category | Features |
|----------|----------|
| **Connectors** | HTTP, TCP/MLLP, JDBC, File/SFTP/S3, VM, **SMTP (email)**, **JMS (messaging)**, **WebService (SOAP)**, **DICOM (medical imaging)** |
| **Data Types** | HL7v2 (ACK generation), XML, JSON, Raw, Delimited, EDI/X12, **HL7v3 (CDA)**, **NCPDP (pharmacy)**, **DICOM** |
| **JavaScript** | E4X transpilation, Mirth scope variables ($c, $s, $g, $r, etc.), VMRouter, DestinationSet, FileUtil, HTTPUtil, **DICOMUtil** |
| **API** | Full REST API compatible with Mirth Administrator (14 servlets) with **message import/export** and **attachments** |
| **Plugins** | Code Templates, Data Pruner, XSLT, JavaScriptRule, JavaScriptStep, Mapper, MessageBuilder, **ServerLog**, **DashboardStatus** |
| **CLI Tool** | Terminal-based monitor and management utility |
| **Userutil** | DatabaseConnection, AttachmentUtil, ChannelUtil, AlertSender, Future, **UUIDGenerator**, **NCPDPUtil**, **ContextFactory** |
| **Utilities** | ValueReplacer, ACKGenerator, JsonXmlUtil, SerializerFactory, **ErrorMessageBuilder** |

## Quick Start

### Prerequisites

- Node.js 18+
- MySQL 5.7+ or 8.0 (uses existing Mirth schema)
- Docker (optional, for validation suite)

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

# Logging
LOG_LEVEL=info
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

The `mirth-cli` command provides a terminal-based interface for monitoring and managing Mirth Connect channels, offering an alternative to the Mirth Administrator GUI.

### CLI Installation

```bash
# Option 1: Install globally (recommended for development)
npm run cli:link

# Verify installation
which mirth-cli        # Should show: ~/.nvm/versions/node/vX.X.X/bin/mirth-cli
mirth-cli --version    # Should show: 0.1.0

# Option 2: Run directly without global install
node dist/cli/index.js <command>

# Option 3: Run via npm script (requires -- to pass arguments)
npm run cli -- <command>

# To uninstall the global link
npm run cli:unlink
```

**Note**: `npm run cli:link` builds the project and creates a global symlink, so you can use `mirth-cli` from anywhere. Changes to the source code take effect immediately after rebuilding (`npm run build`).

### CLI Configuration

```bash
# Set server URL
mirth-cli config set url http://localhost:8081

# Login and save session
mirth-cli login --user admin --password admin

# View current configuration
mirth-cli config
```

Configuration is stored in `~/.mirth-cli.json`.

### CLI Commands

#### Authentication
```bash
mirth-cli login                     # Interactive login
mirth-cli login -u admin -p admin   # Login with credentials
mirth-cli logout                    # Clear session
mirth-cli whoami                    # Show current user
```

#### Channel Management
```bash
mirth-cli channels                  # List all channels with status
mirth-cli channels list             # Same as above
mirth-cli channels get <id|name>    # Get channel details
mirth-cli channels deploy <id|name> # Deploy a channel
mirth-cli channels undeploy <id|name>
mirth-cli channels start <id|name>
mirth-cli channels stop <id|name>
mirth-cli channels pause <id|name>
mirth-cli channels resume <id|name>
mirth-cli channels stats            # Show statistics for all channels
mirth-cli channels stats <id|name>  # Show statistics for one channel
```

#### Message Browsing
```bash
mirth-cli messages list <channelId>              # List recent messages
mirth-cli messages search <channelId>            # Search with filters
  --status <R|F|T|S|Q|E|P>                       # Filter by status
  --from <datetime>                              # Messages from date
  --to <datetime>                                # Messages to date
  --limit <n>                                    # Limit results
mirth-cli messages get <channelId> <messageId>   # Get message details
mirth-cli messages export <channelId>            # Export messages
  --output <file>                                # Output file
  --format <json|xml>                            # Export format
```

#### Message Sending
```bash
# Send MLLP message
mirth-cli send mllp localhost:6662 "MSH|^~\&|..."
mirth-cli send mllp localhost:6662 @message.hl7  # From file

# Send HTTP message
mirth-cli send http http://localhost:8083/api @payload.json
  --method POST                                  # HTTP method
  --content-type application/json                # Content type
  --header "Authorization: Bearer token"         # Add headers

# Send HL7 (MLLP shorthand)
mirth-cli send hl7 localhost:6662 @adt.hl7
```

#### Server Information
```bash
mirth-cli server info               # Show server version and info
mirth-cli server status             # Show server status
mirth-cli server stats              # Show system statistics
```

#### Event Browsing
```bash
mirth-cli events                    # List recent events
mirth-cli events list               # Same as above
mirth-cli events search             # Search with filters
  --from <datetime>                 # Events from date
  --to <datetime>                   # Events to date
  --level <INFO|WARN|ERROR>         # Filter by level
mirth-cli events errors             # Show only error events
```

#### Cross-Channel Message Trace
```bash
# Trace a message across VM-connected channels
mirth-cli trace "ADT Receiver" 123

# Verbose mode (full content, 2000 char limit)
mirth-cli trace "ADT Receiver" 123 --verbose

# Trace only backward (find root) or forward (find destinations)
mirth-cli trace "ADT Receiver" 123 --direction backward
mirth-cli trace "ADT Receiver" 123 --direction forward

# Hide message content, show tree structure only
mirth-cli trace "ADT Receiver" 123 --no-content

# JSON output for scripting
mirth-cli trace "ADT Receiver" 123 --json
```

The trace command reconstructs the complete message journey across VM-connected channels (Channel Writer/Reader), showing every hop from source to final destination(s).

**Example output:**
```
Message Trace: ADT Receiver → HL7 Router → EMR Writer, Audit Log
Hops: 4 | Depth: 2 | Latency: 222ms | Errors: 1

● [SENT] ADT Receiver (msg #123)  14:30:45.123
│  RAW: MSH|^~\&|EPIC|... (2,450 chars)
│
├──► [SENT] HL7 Router (msg #456)  +111ms
│    │
│    └──► [SENT] EMR Writer (msg #789)  +222ms
│
└──► [ERROR] Audit Log (msg #101)  +177ms
     ERROR: Connection refused: localhost:5432
```

| Option | Default | Description |
|--------|---------|-------------|
| `-v, --verbose` | false | Full content display (2000 char limit vs 200) |
| `-c, --content <types>` | `raw,transformed,response,error` | Content types to show |
| `--max-depth <n>` | 10 | Maximum trace depth |
| `--direction <dir>` | `both` | `both`, `backward`, or `forward` |
| `--no-content` | - | Hide content, show tree structure only |
| `--json` | - | Output raw JSON |

#### Interactive Dashboard
```bash
mirth-cli dashboard                 # Launch interactive dashboard with WebSocket
mirth-cli dashboard --no-websocket  # Polling-only mode
mirth-cli dashboard --refresh 10    # Custom polling interval (seconds)
```

The dashboard provides **real-time channel status monitoring** with WebSocket updates and comprehensive keyboard navigation.

**Features:**
- ✅ Real-time updates via WebSocket (`/ws/dashboardstatus`)
- ✅ Automatic polling fallback when WebSocket unavailable
- ✅ Channel groups with expand/collapse (▼/▶)
- ✅ Multi-channel selection and batch operations
- ✅ Search/filter mode (`/`)
- ✅ Detail view panel with tabs
- ✅ Vim-style navigation (`j`/`k`)
- ✅ Help overlay (`?`)

**Keyboard Shortcuts:**

| Key | Action |
|-----|--------|
| `↑`/`k` | Move up |
| `↓`/`j` | Move down |
| `Enter` | Expand group / Show details |
| `Space` | Toggle selection |
| `s` | Start channel(s) |
| `t` | Stop channel(s) |
| `p` | Pause/resume |
| `d` | Deploy |
| `u` | Undeploy |
| `/` | Search |
| `?` | Help |
| `a` | Select all |
| `c` | Clear selection |
| `r` | Refresh |
| `q` | Quit |

### Global Options

All commands support these options:

```bash
--url <url>         # Override server URL
--json              # Output as JSON (for scripting)
-v, --verbose       # Verbose output
```

### Example Session

```bash
# Setup and login
$ mirth-cli config set url http://localhost:8081
✔ Set url = http://localhost:8081

$ mirth-cli login -u admin -p admin
✔ Logged in as admin

# Check channels
$ mirth-cli channels
┌──────────────────────────────────────┬──────────────────┬─────────┬──────┬──────┬─────┐
│ ID                                   │ Name             │ Status  │ Recv │ Sent │ Err │
├──────────────────────────────────────┼──────────────────┼─────────┼──────┼──────┼─────┤
│ 550e8400-e29b-41d4-a716-446655440000 │ MLLP Router      │ STARTED │  150 │  148 │   2 │
│ 6ba7b810-9dad-11d1-80b4-00c04fd430c8 │ HTTP Passthrough │ STOPPED │    0 │    0 │   0 │
└──────────────────────────────────────┴──────────────────┴─────────┴──────┴──────┴─────┘

# View errors
$ mirth-cli messages search 550e8400... --status E
$ mirth-cli messages get 550e8400... 147

# Send test message
$ mirth-cli send mllp localhost:6662 @test.hl7
✔ Message sent successfully
Response: MSA|AA|12345

# JSON output for scripting
$ mirth-cli channels --json | jq '.[] | select(.status == "STARTED")'
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         REST API Layer                          │
│              (Express + Content Negotiation)                    │
├─────────────────────────────────────────────────────────────────┤
│                         Controllers                             │
│         Channel │ Configuration │ Engine │ User                 │
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
│  SMTP, JMS, SOAP   │  EDI, HL7v3      │  28 Userutil Classes   │
│  DICOM             │  NCPDP, DICOM    │                        │
├─────────────────────────────────────────────────────────────────┤
│                      Database Layer                             │
│              (MySQL - Existing Mirth Schema)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Description |
|-----------|----------|-------------|
| **Donkey Engine** | `src/donkey/` | Message processing pipeline (Statistics, Queues, DestinationChain, ResponseSelector) |
| **Connectors** | `src/connectors/` | 11 protocol implementations (HTTP, TCP, JDBC, File, VM (fully wired cross-channel routing), SMTP, JMS, WebService, DICOM) |
| **JavaScript Runtime** | `src/javascript/` | E4X transpilation, script execution, 28 userutil classes |
| **Userutil Classes** | `src/javascript/userutil/` | VMRouter, FileUtil, HTTPUtil, DatabaseConnection, AttachmentUtil, ChannelUtil, AlertSender, Future, UUIDGenerator, NCPDPUtil, DICOMUtil |
| **Data Types** | `src/datatypes/` | 9 types: HL7v2, XML, JSON, Raw, Delimited, EDI/X12, HL7v3, NCPDP, DICOM |
| **REST API** | `src/api/` | Express-based API compatible with Mirth Administrator (14 servlets, import/export, attachments) |
| **CLI Tool** | `src/cli/` | Terminal-based monitor and management utility |
| **Plugins** | `src/plugins/` | Code Templates, Data Pruner, XSLT, JavaScriptRule, JavaScriptStep, Mapper, MessageBuilder, ServerLog, DashboardStatus |
| **Utilities** | `src/util/` | ValueReplacer, ACKGenerator, JsonXmlUtil, ErrorMessageBuilder, SerializerFactory |

## API Endpoints

The REST API mirrors the Mirth Connect Server API with **14 fully-implemented servlets**:

### Channel Operations
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/channels` | GET, POST, PUT, DELETE | Channel CRUD operations |
| `/api/channels/{id}/status` | GET, POST | Channel status and control |
| `/api/channels/_deploy` | POST | Deploy channels |
| `/api/channels/_undeploy` | POST | Undeploy channels |
| `/api/channels/statistics` | GET, POST | Channel statistics |
| `/api/channels/{id}/messages` | GET, POST, DELETE | Message operations |
| `/api/channels/{id}/messages/_search` | POST | Search with filters |
| `/api/channels/{id}/messages/_reprocess` | POST | Reprocess messages |

### Message Tracing (Node.js Extension)
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/messages/trace/{channelId}/{messageId}` | GET | Trace message across VM-connected channels |

Query parameters: `includeContent`, `contentTypes`, `maxContentLength`, `maxDepth`, `maxChildren`, `direction`

### Server & Configuration
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/server/configuration` | GET, PUT | Server configuration |
| `/api/system/info` | GET | System information |
| `/api/system/stats` | GET | System statistics |
| `/api/usageData` | GET | Usage reporting |
| `/api/databaseTasks` | GET, POST | Database maintenance |

### Administration
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/users` | GET, POST, PUT, DELETE | User management |
| `/api/events` | GET, POST, DELETE | Audit log |
| `/api/events/_search` | POST | Event search |
| `/api/alerts` | GET, POST, PUT, DELETE | Alert management |
| `/api/extensions` | GET, PUT | Plugin management |
| `/api/channelgroups` | GET, POST | Channel groups |
| `/api/codeTemplates` | GET, POST, PUT, DELETE | Code template library |

## JavaScript Runtime

### E4X Support

All user scripts containing E4X syntax are automatically transpiled:

```javascript
// Original E4X (Mirth script)
var patient = msg.PID['PID.5']['PID.5.1'].toString();
msg.PID['PID.5']['PID.5.1'] = patient.toUpperCase();

// Automatically transpiled to modern JavaScript
var patient = msg.get('PID').get('PID.5').get('PID.5.1').toString();
msg.get('PID').get('PID.5').get('PID.5.1').setValue(patient.toUpperCase());
```

### Scope Variables

All standard Mirth scope variables are available:

| Variable | Description |
|----------|-------------|
| `$c` / `channelMap` | Channel-scoped variables |
| `$s` / `sourceMap` | Source connector variables |
| `$g` / `globalMap` | Global variables (all channels) |
| `$gc` / `globalChannelMap` | Global channel variables |
| `$cfg` / `configurationMap` | Configuration variables |
| `$r` / `responseMap` | Response variables |
| `$co` / `connectorMap` | Connector variables |
| `msg` | Current message |
| `logger` | Logging utility |

### Message Status Codes

| Code | Status | Description |
|------|--------|-------------|
| R | RECEIVED | Message received by source |
| F | FILTERED | Message filtered out |
| T | TRANSFORMED | Message transformed |
| S | SENT | Message sent successfully |
| Q | QUEUED | Message queued for retry |
| E | ERROR | Processing error |
| P | PENDING | Awaiting processing |

## Development

### Project Structure

```
src/
├── index.ts              # Entry point
├── server/               # Express server
├── api/                  # REST API (servlets, middleware)
├── controllers/          # Business logic
├── donkey/               # Message engine
│   ├── channel/          # Channel processing
│   ├── message/          # Message models
│   └── queue/            # Message queuing
├── connectors/           # Protocol implementations
│   ├── http/             # HTTP/REST
│   ├── tcp/              # TCP/MLLP
│   ├── jdbc/             # Database
│   ├── file/             # File/SFTP/S3
│   ├── vm/               # Inter-channel routing (VmReceiver, VmDispatcher)
│   ├── smtp/             # Email (SmtpDispatcher via nodemailer)
│   ├── jms/              # JMS messaging (STOMP protocol)
│   ├── ws/               # WebService/SOAP (receiver + dispatcher)
│   └── dicom/            # DICOM/DIMSE (C-STORE, C-ECHO)
├── datatypes/            # Data type handlers
│   ├── hl7v2/            # HL7 v2.x
│   ├── xml/              # XML
│   ├── json/             # JSON
│   ├── raw/              # Pass-through
│   ├── delimited/        # CSV, TSV, pipe-delimited
│   ├── edi/              # EDI/X12 healthcare transactions
│   ├── hl7v3/            # HL7 v3/CDA XML
│   ├── ncpdp/            # NCPDP pharmacy claims (D.0, 5.1)
│   └── dicom/            # DICOM medical imaging
├── javascript/           # JS runtime
│   ├── e4x/              # E4X transpiler
│   ├── runtime/          # Script execution
│   └── userutil/         # 28 Mirth utility classes
│       ├── VMRouter.ts           # Inter-channel routing
│       ├── DatabaseConnection.ts # SQL from scripts
│       ├── AttachmentUtil.ts     # Message attachments
│       ├── ChannelUtil.ts        # Channel operations
│       ├── AlertSender.ts        # Send alerts
│       ├── Future.ts             # Async wrapper
│       ├── FileUtil.ts           # File I/O
│       ├── UUIDGenerator.ts      # Crypto-based UUIDs
│       ├── NCPDPUtil.ts          # Pharmacy overpunch
│       ├── ContextFactory.ts     # JavaScript context info
│       ├── DICOMUtil.ts          # DICOM operations
│       └── ...                   # HTTPUtil, SMTPConnection, etc.
├── cli/                  # CLI tool
│   ├── commands/         # Command implementations
│   ├── lib/              # Utilities (ApiClient, ConfigManager)
│   ├── ui/               # Ink dashboard components
│   └── types/            # CLI-specific types
├── db/                   # Database access
├── model/                # Domain models
├── util/                 # Core utilities
│   ├── ValueReplacer.ts  # ${variable} template replacement
│   ├── ACKGenerator.ts   # HL7 ACK message generation
│   ├── JsonXmlUtil.ts    # JSON ↔ XML conversion
│   ├── ErrorMessageBuilder.ts
│   └── SerializerFactory.ts
└── plugins/              # Plugin implementations
    ├── javascriptrule/   # Filter rules (UI filters)
    ├── javascriptstep/   # Transformer steps (UI transformers)
    ├── xsltstep/         # XSLT transformations
    ├── mapper/           # Variable mapping
    ├── messagebuilder/   # Message segment building
    ├── serverlog/        # Real-time log streaming (WebSocket)
    ├── dashboardstatus/  # Real-time channel status (WebSocket)
    └── datapruner/       # Message pruning/archival
```

### Scripts

```bash
npm run build         # Compile TypeScript
npm run dev           # Development server with ts-node
npm start             # Production server
npm test              # Run test suite
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Generate coverage report
npm run lint          # Check code style
npm run lint:fix      # Fix linting issues
npm run format        # Format with Prettier
npm run typecheck     # Type check without compiling
npm run cli           # Run CLI with ts-node
```

#### CLI Scripts

```bash
npm run cli -- channels           # Run CLI command directly
npm run cli -- login -u admin     # Login via CLI
npm link                          # Install mirth-cli globally
```

### Code Quality

```bash
npm run tech-debt        # Run lint + check outdated packages
npm run tech-debt:dupes  # Find duplicate code
npm run tech-debt:unused # Find unused exports
```

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/javascript/e4x/E4XTranspiler.test.ts

# Run with coverage
npm run test:coverage
```

### Test Structure

```
tests/
├── unit/           # Unit tests
│   ├── connectors/
│   ├── datatypes/
│   ├── donkey/
│   └── javascript/
├── integration/    # Database and E2E tests
├── api/            # API endpoint tests
└── fixtures/       # Test data
    ├── messages/   # Sample HL7, XML, JSON
    └── example-channels/
```

## Validation Suite

The `validation/` directory contains a comprehensive side-by-side comparison suite that validates Node.js behavior against the Java Mirth engine.

### Running Validation

```bash
# Start Java Mirth (Docker)
cd validation
docker-compose up -d

# Start Node.js Mirth (separate terminal)
PORT=8081 npm run dev

# Run validation suite
cd validation
npm run validate

# Run specific priority level
npm run validate -- --priority 1

# Run specific scenario
npm run validate -- --scenario 1.1
```

### Port Configuration

| Service | Java Mirth | Node.js Mirth |
|---------|------------|---------------|
| REST API | https://localhost:8443 | http://localhost:8081 |
| MLLP | localhost:6661 | localhost:6662 |
| HTTP | localhost:8082 | localhost:8083 |
| MySQL | localhost:3306 | localhost:3306 |

### Validation Status (as of 2026-02-04)

| Priority | Category | Status | Tests |
|----------|----------|--------|-------|
| 0 | Export Compatibility | ✅ Passing | Channel round-trip verified |
| 1 | MLLP Message Flow | ✅ Passing | 3/3 scenarios |
| 2 | JavaScript Runtime | ✅ Passing | E4X, userutil, XSLT verified |
| 3 | Connectors | ✅ Passing | HTTP, TCP, File, JDBC, SMTP, JMS, WebService, DICOM |
| 4 | Data Types | ✅ Passing | HL7v2, XML, JSON, Delimited, EDI, HL7v3, NCPDP, DICOM |
| 5 | Advanced | ✅ Passing | Response transformers, routing, multi-destination |
| 6 | Operational Modes | ✅ Passing | Takeover, standalone, auto-detect scenarios |

**Total Tests: 2,559 passing**

## Version Management

This project includes tooling to track and manage porting across Mirth Connect versions.

### Current Version

- **Node.js Port**: Targets Mirth Connect **3.9.1**
- **Tested Versions**: 3.9.0, 3.9.1
- **Planned Versions**: 3.10.x, 4.x

### Version Manager CLI

```bash
# Check current version status
npm run version-manager -- status

# Compare two Java Mirth versions
npm run version-manager -- diff 3.9.1 3.10.0

# Generate upgrade tasks
npm run version-manager -- upgrade tasks 3.10.0

# Create version branch
npm run version-manager -- branch create 3.10.0
```

### Upgrading to a New Version

```bash
# 1. See what changed
npm run version-manager -- diff 3.9.1 3.10.0 --impact

# 2. Generate upgrade tasks
npm run version-manager -- upgrade tasks 3.10.0 --parallel-agents

# 3. Create version branch
npm run version-manager -- branch create 3.10.0

# 4. Work through tasks in tasks/upgrade-3.10.0.md

# 5. Validate
npm run version-manager -- validate 3.10.0

# 6. Merge when ready
git checkout master && git merge feature/3.10.x
```

### Version Compatibility Matrix

| Node.js Port | Java Mirth | Status |
|--------------|------------|--------|
| master | 3.9.1 | ✅ Validated |
| feature/3.10.x | 3.10.0 | 📋 Planned |
| feature/4.0.x | 4.0.0 | 📋 Planned |
| feature/4.5.x | 4.5.2 | 📋 Planned |

## Database

This project uses the **existing Mirth MySQL schema** — no modifications required in takeover mode.

### Operational Mode Database Behavior

| Mode | Core Tables | Channel Tables | User Data |
|------|-------------|----------------|-----------|
| **Takeover** | Verifies existing schema | Uses existing tables | Preserves all users |
| **Standalone** | Creates with `IF NOT EXISTS` | Auto-creates on deploy | Seeds admin/admin |

### Core Tables (Created in Standalone Mode)

| Table | Purpose |
|-------|---------|
| `SCHEMA_INFO` | Version tracking (3.9.1) |
| `CHANNEL` | Channel definitions |
| `CONFIGURATION` | Server settings |
| `PERSON` / `PERSON_PASSWORD` | User accounts |
| `EVENT` | Audit log |
| `ALERT` | Alert definitions |
| `CODE_TEMPLATE` / `CODE_TEMPLATE_LIBRARY` | Templates |
| `CHANNEL_GROUP` | Channel groupings |
| `SCRIPT` | Global scripts |
| `D_CHANNELS` | Channel ID → local ID mapping |

### Per-Channel Tables (Auto-Created on Deploy)

Each channel creates dynamic tables when deployed:

| Table | Purpose |
|-------|---------|
| `D_M{id}` | Messages |
| `D_MM{id}` | Message metadata |
| `D_MC{id}` | Message content |
| `D_MA{id}` | Message attachments |
| `D_MS{id}` | Message statistics |
| `D_MSQ{id}` | Message sequence |
| `D_MCM{id}` | Custom metadata (user-defined fields) |

**Note**: In takeover mode, existing channel tables are reused. In standalone mode, tables are created automatically when a channel is deployed.

## Engine Behavior Differences from Java Mirth

The Node.js engine maintains 100% API compatibility with the Java Mirth Administrator, but includes a few behavioral differences and extensions. These are documented here for compatibility awareness.

### Additive Changes (Backward Compatible)

| Change | Behavior | Compatibility |
|--------|----------|---------------|
| **SourceMap Persistence** | Node.js persists `sourceMap` data to the `D_MC` table (as `CONTENT_TYPE=14`) after message processing. Java Mirth keeps sourceMap in memory only. | Additive — Java Mirth ignores the extra `D_MC` rows. Does not affect message processing. |
| **Trace API** | New endpoint `GET /api/messages/trace/:channelId/:messageId` for cross-channel message tracing. | Extension — does not exist in Java Mirth. Does not affect existing API endpoints. |
| **Error Surfacing** | CLI passes `?returnErrors=true` on deploy/undeploy/start/stop operations. | Same as Java Mirth Administrator GUI behavior. Java API default (no param) silently swallows errors. |

### Bug Fixes Applied

| Fix | Java Mirth Behavior | Node.js Behavior | Impact |
|-----|---------------------|-------------------|--------|
| **ContentType Enum** | `SOURCE_MAP = 14` in the engine (correct) | Fixed API layer to also use `SOURCE_MAP = 14` (was incorrectly `15` in the API models layer) | Ensures sourceMap content queries work correctly. The Java engine was not affected because its API layer uses a different code path. |

### Node.js-Only Extensions

These features exist only in the Node.js engine and have no Java Mirth equivalent:

| Feature | Description | API Endpoint |
|---------|-------------|-------------|
| Cross-Channel Trace | Reconstructs complete message journey across VM-connected channels | `GET /api/messages/trace/:channelId/:messageId` |
| Interactive Dashboard | Terminal-based real-time channel monitoring via Ink/React | CLI: `mirth-cli dashboard` |
| Message Trace CLI | CLI command to trace messages with tree visualization | CLI: `mirth-cli trace <channel> <messageId>` |

### How SourceMap Tracing Works

When messages flow through VM-connected channels (Channel Writer/Reader), the VM connector stores chain-tracking data in the sourceMap:
- `sourceChannelIds[]` — ordered list of channel IDs the message has traversed
- `sourceMessageIds[]` — corresponding message IDs at each hop

The Node.js engine persists this sourceMap to the `D_MC` table after message processing, enabling the trace API to reconstruct the full message journey by following these references backward (to find the root) and forward (to find all downstream destinations).

**Dependency graph**: The trace service builds a channel dependency graph by scanning all channel configurations for `transportName === 'Channel Writer'` destinations, scoping forward-trace queries to only relevant downstream channels.

**VM cross-channel routing** is fully operational: `ChannelBuilder` wires both `VmReceiver` (Channel Reader source) and `VmDispatcher` (Channel Writer destination), and the `EngineController` adapter is connected during deployment to enable runtime message dispatch between channels.

## Troubleshooting

### Common Issues

**E4X Transpilation Errors**
```
Error: Unexpected token in E4X expression
```
Ensure your scripts don't mix E4X with template literals. The transpiler handles standard E4X patterns.

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
