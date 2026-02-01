# Mirth Connect Validation Suite

This validation suite compares the Node.js Mirth Connect implementation against the Java engine (v3.9) to ensure API and behavioral compatibility.

## Quick Start

### 1. Setup

```bash
# From the validation directory
./scripts/setup.sh
```

This will:
- Install dependencies
- Start Docker services (MySQL + Java Mirth)
- Wait for services to be ready
- Build the Node.js project

### 2. Start Node.js Mirth

In a separate terminal:
```bash
# From project root
PORT=8081 npm run dev
```

### 3. Run Validation

```bash
# From the validation directory
npm run validate
```

## Command Line Options

```bash
# Run all scenarios
npm run validate

# Run specific priority level (0-5)
npm run validate -- --priority 0

# Run specific scenario
npm run validate -- --scenario 1.1

# Verbose output
npm run validate -- --verbose

# Stop on first failure
npm run validate -- --stop-on-failure
```

## Directory Structure

```
validation/
├── config/
│   └── environments.ts      # Endpoint configuration
├── clients/
│   ├── MirthApiClient.ts    # REST API client
│   ├── MLLPClient.ts        # MLLP message sender
│   ├── HttpMessageClient.ts # HTTP message sender
│   └── FileClient.ts        # File operations
├── comparators/
│   ├── MessageComparator.ts     # Compare messages (HL7, XML, JSON)
│   ├── ResponseComparator.ts    # Compare ACK responses
│   └── ChannelExportComparator.ts # Compare channel exports
├── runners/
│   ├── ValidationRunner.ts  # Orchestrates test execution
│   └── ScenarioRunner.ts    # Runs individual scenarios
├── scenarios/
│   ├── 00-export-compatibility/  # Priority 0: Export/Import
│   ├── 01-basic/                 # Priority 1: Core flows
│   ├── 02-transformations/       # Priority 2: JS runtime
│   ├── 03-connectors/            # Priority 3: Connectors
│   ├── 04-datatypes/             # Priority 4: Data types
│   └── 05-advanced/              # Priority 5: Advanced
├── fixtures/
│   └── messages/
│       ├── hl7v2/           # HL7v2 test messages
│       ├── xml/             # XML test messages
│       └── json/            # JSON test messages
├── reports/                 # Generated validation reports
└── scripts/
    ├── setup.sh             # Environment setup
    └── run-validation.sh    # Run validation suite
```

## Test Priorities

| Priority | Category | Description |
|----------|----------|-------------|
| 0 | Export Compatibility | Channel export/import round-trip |
| 1 | Core Message Flow | MLLP, HTTP basic flows |
| 2 | JavaScript Runtime | Filters, transformers, E4X |
| 3 | Connectors | HTTP, TCP, File, Database |
| 4 | Data Types | HL7v2, XML, JSON parsing |
| 5 | Advanced | Response transformers, routing |

## Configuration

Edit `validation/.env` to configure:

```bash
# Java Mirth endpoint
JAVA_MIRTH_URL=http://localhost:8080
JAVA_MIRTH_USER=admin
JAVA_MIRTH_PASS=admin

# Node.js Mirth endpoint
NODE_MIRTH_URL=http://localhost:8081
NODE_MIRTH_USER=admin
NODE_MIRTH_PASS=admin

# Test ports
MLLP_TEST_PORT_JAVA=6661
MLLP_TEST_PORT_NODE=6662
```

## Adding New Scenarios

1. Create a directory under `scenarios/` with format `NN-name/`
2. Add a `config.json` with scenario definition
3. Add any required channel files or test messages
4. Optionally add a `README.md` for documentation

Example `config.json`:
```json
{
  "id": "1.2",
  "name": "MLLP to MLLP Passthrough",
  "description": "Forward HL7 message between MLLP endpoints",
  "priority": 1,
  "type": "mllp",
  "channelFile": "MLLP to MLLP.xml",
  "inputMessage": "hl7v2/simple-adt.hl7",
  "timeout": 30000
}
```

## Gap Tracking

Validation gaps are tracked in `manifest.json` under the `validationGaps` section:

```json
{
  "validationGaps": {
    "gap-001": {
      "scenarioId": "1.1",
      "severity": "critical",
      "description": "ACK code differs",
      "status": "open"
    }
  }
}
```

## Reports

After running validation, reports are saved to `reports/validation-TIMESTAMP.json`.

Each report contains:
- Summary statistics
- Individual scenario results
- Detailed differences
- Discovered gaps
