[← Back to README](../README.md)

# Development Guide

## Project Structure

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
├── artifact/             # Git-backed config management
│   ├── ChannelDecomposer.ts   # XML → decomposed file tree
│   ├── ChannelAssembler.ts    # File tree → XML
│   ├── VariableResolver.ts    # Deploy-time ${VAR} resolution
│   ├── ChannelDiff.ts         # Structural + script diffs
│   ├── DependencySort.ts      # Topological sort
│   ├── ArtifactController.ts  # Central orchestrator
│   ├── git/                   # GitClient, GitSyncService, DeltaDetector
│   └── promotion/             # PromotionPipeline, VersionCompatibility
├── logging/              # Centralized logging system
│   ├── config.ts              # Env var parsing (LOG_LEVEL, etc.)
│   ├── DebugModeRegistry.ts   # Per-component debug toggle
│   ├── transports.ts          # ConsoleTransport, FileTransport
│   ├── Logger.ts              # Dual-output logger (Winston + WebSocket)
│   ├── LoggerFactory.ts       # Named logger factory + Winston setup
│   └── index.ts               # Barrel exports
├── cli/                  # CLI tool
│   ├── commands/         # Command implementations
│   ├── lib/              # Utilities (ApiClient, ConfigManager)
│   ├── ui/               # Ink dashboard components
│   └── types/            # CLI-specific types
├── cluster/              # Horizontal scaling
│   ├── ClusterIdentity.ts      # SERVER_ID generation
│   ├── ClusterConfig.ts         # Cluster env var configuration
│   ├── ServerRegistry.ts        # D_SERVERS heartbeat + node tracking
│   ├── SequenceAllocator.ts     # Block-allocated message IDs
│   ├── HealthCheck.ts           # Orchestrator probe endpoints
│   ├── MapBackend.ts            # Pluggable map storage (InMemory/DB/Redis)
│   ├── ChannelRegistry.ts       # D_CHANNEL_DEPLOYMENTS tracking
│   ├── RemoteDispatcher.ts      # Inter-instance HTTP forwarding
│   └── EventBus.ts              # Pub/sub (Local/DB-polling/Redis)
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

## Scripts

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

### CLI Scripts

```bash
npm run cli -- channels           # Run CLI command directly
npm run cli -- login -u admin     # Login via CLI
npm link                          # Install mirth-cli globally
```

## Code Quality

```bash
npm run tech-debt        # Run lint + check outdated packages
npm run tech-debt:dupes  # Find duplicate code
npm run tech-debt:unused # Find unused exports
```

---

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
│   ├── artifact/       # Artifact module tests (417 tests)
│   ├── cluster/        # Cluster module tests (123 tests)
│   ├── logging/        # Logging module tests (112 tests)
│   ├── connectors/
│   ├── datatypes/
│   ├── db/             # DonkeyDao recovery tests
│   ├── donkey/
│   ├── javascript/
│   ├── api/servlets/   # API endpoint tests (ArtifactServlet, etc.)
│   └── cli/            # CLI command tests
├── integration/    # Database and E2E tests
├── api/            # API endpoint tests
└── fixtures/       # Test data
    ├── messages/   # Sample HL7, XML, JSON
    ├── artifact/   # Channel XML fixtures for decomposer tests
    └── example-channels/
```

---

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
| 0 | Export Compatibility | Passing | Channel round-trip verified |
| 1 | MLLP Message Flow | Passing | 3/3 scenarios |
| 2 | JavaScript Runtime | Passing | E4X, userutil, XSLT verified |
| 3 | Connectors | Passing | HTTP, TCP, File, JDBC, SMTP, JMS, WebService, DICOM |
| 4 | Data Types | Passing | HL7v2, XML, JSON, Delimited, EDI, HL7v3, NCPDP, DICOM |
| 5 | Advanced | Passing | Response transformers, routing, multi-destination |
| 6 | Operational Modes | Passing | Takeover, standalone, auto-detect scenarios |

**Total Tests: 2,976 passing** (2,559 core + 417 artifact)

---

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
| master | 3.9.1 | Validated |
| feature/3.10.x | 3.10.0 | Planned |
| feature/4.0.x | 4.0.0 | Planned |
| feature/4.5.x | 4.5.2 | Planned |
