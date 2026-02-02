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
| **Connectors** | HTTP Receiver/Dispatcher, TCP/MLLP, JDBC Database, File/SFTP/S3 |
| **Data Types** | HL7v2 (with ACK generation), XML, JSON, Raw |
| **JavaScript** | E4X transpilation, Mirth scope variables ($c, $s, $g, $r, etc.) |
| **API** | Full REST API compatible with Mirth Administrator |
| **Plugins** | Code Templates, Data Pruner, XSLT Transformer |

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
├─────────────────────────────────────────────────────────────────┤
│                      Database Layer                             │
│              (MySQL - Existing Mirth Schema)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Description |
|-----------|----------|-------------|
| **Donkey Engine** | `src/donkey/` | Message processing pipeline |
| **Connectors** | `src/connectors/` | Protocol implementations (HTTP, TCP, JDBC, File) |
| **JavaScript Runtime** | `src/javascript/` | E4X transpilation and script execution |
| **Data Types** | `src/datatypes/` | HL7v2, XML, JSON parsing and serialization |
| **REST API** | `src/api/` | Express-based API compatible with Mirth Administrator |
| **Plugins** | `src/plugins/` | Code Templates, Data Pruner, XSLT |

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
│   └── file/             # File/SFTP/S3
├── datatypes/            # Data type handlers
│   ├── hl7v2/            # HL7 v2.x
│   ├── xml/              # XML
│   └── json/             # JSON
├── javascript/           # JS runtime
│   ├── e4x/              # E4X transpiler
│   ├── runtime/          # Script execution
│   └── userutil/         # Mirth maps
├── db/                   # Database access
├── model/                # Domain models
└── plugins/              # Plugin implementations
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

### Validation Status

| Priority | Category | Status |
|----------|----------|--------|
| 0 | Export Compatibility | ✅ Passing |
| 1 | MLLP Message Flow | ✅ Passing |
| 2 | JavaScript Runtime | 🟡 In Progress |
| 3-5 | Connectors/Data Types/Advanced | ⏳ Pending |

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
