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
# Database
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
# Build and link globally
npm run build
npm link

# Or run directly with ts-node
npm run cli -- <command>
```

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

#### Interactive Dashboard
```bash
mirth-cli dashboard                 # Launch interactive dashboard
mirth-cli dashboard --refresh 5     # Set refresh interval (seconds)
```

The dashboard provides real-time channel status monitoring with keyboard navigation.

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
| **Connectors** | `src/connectors/` | 11 protocol implementations (HTTP, TCP, JDBC, File, VM, SMTP, JMS, WebService, DICOM) |
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

### Validation Status (as of 2026-02-03)

| Priority | Category | Status | Tests |
|----------|----------|--------|-------|
| 0 | Export Compatibility | ✅ Passing | Channel round-trip verified |
| 1 | MLLP Message Flow | ✅ Passing | 3/3 scenarios |
| 2 | JavaScript Runtime | ✅ Passing | E4X, userutil, XSLT verified |
| 3 | Connectors | ✅ Passing | HTTP, TCP, File, JDBC, SMTP, JMS, WebService, DICOM |
| 4 | Data Types | ✅ Passing | HL7v2, XML, JSON, Delimited, EDI, HL7v3, NCPDP, DICOM |
| 5 | Advanced | ✅ Passing | Response transformers, routing, multi-destination |

**Total Tests: 2,521 passing**

## Database

This project uses the **existing Mirth MySQL schema** — no modifications required.

### Per-Channel Tables

Each channel creates dynamic tables:

| Table | Purpose |
|-------|---------|
| `D_M{id}` | Messages |
| `D_MM{id}` | Message metadata |
| `D_MC{id}` | Message content |
| `D_MA{id}` | Message attachments |
| `D_MS{id}` | Message statistics |
| `D_MSQ{id}` | Message sequence |

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
