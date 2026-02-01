# Mirth Connect Node.js MVP Validation Plan

## Overview

Validate that the Node.js Mirth Connect implementation produces identical behavior to the Java engine (v3.9) by running both versions side-by-side, deploying sample channels, sending messages, and comparing outputs.

**Reference Implementation Plan**: `/Users/adamstruthers/.claude/plans/logical-finding-fern.md`

---

## Phase 1: Infrastructure Setup

### 1.1 Docker Compose Updates

**File**: `docker/docker-compose.yml`

Add configuration for side-by-side testing:

```yaml
version: '3.8'
services:
  mirth-db:
    image: mysql:8.0
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: mirthroot
      MYSQL_DATABASE: mirthdb
      MYSQL_USER: mirth
      MYSQL_PASSWORD: mirth
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - mirth-db-data:/var/lib/mysql

  mirth-java:
    image: nextgenhealthcare/connect:3.9
    depends_on:
      mirth-db:
        condition: service_healthy
    ports:
      - "8080:8080"    # Java Mirth API
      - "8443:8443"    # Java Mirth HTTPS
      - "6661:6661"    # MLLP port for testing
    environment:
      - DATABASE=mysql
      - DATABASE_URL=jdbc:mysql://mirth-db:3306/mirthdb
      - DATABASE_USERNAME=mirth
      - DATABASE_PASSWORD=mirth

volumes:
  mirth-db-data:
```

### 1.2 Node.js Server Configuration

Run Node.js on port **8081** to avoid conflict:

```bash
# Start Docker (Java Mirth + MySQL)
npm run docker:up

# Wait for Java Mirth to be healthy
# Then start Node.js on different port
PORT=8081 npm run dev
```

### 1.3 Environment Configuration

Create `validation/.env`:

```bash
# Java Mirth (Docker)
JAVA_MIRTH_URL=http://localhost:8080
JAVA_MIRTH_USER=admin
JAVA_MIRTH_PASS=admin

# Node.js Mirth
NODE_MIRTH_URL=http://localhost:8081
NODE_MIRTH_USER=admin
NODE_MIRTH_PASS=admin

# Test Ports
MLLP_TEST_PORT_JAVA=6661
MLLP_TEST_PORT_NODE=6662
HTTP_TEST_PORT_JAVA=8082
HTTP_TEST_PORT_NODE=8083

# Shared Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mirthdb
DB_USER=mirth
DB_PASSWORD=mirth
```

---

## Phase 2: Validation Tooling

### 2.1 Directory Structure

```
validation/
├── config/
│   └── environments.ts          # Endpoint configuration
├── clients/
│   ├── MirthApiClient.ts        # REST API client (both engines)
│   ├── MLLPClient.ts            # MLLP message sender
│   ├── HttpMessageClient.ts     # HTTP message sender
│   └── FileClient.ts            # File operations
├── comparators/
│   ├── MessageComparator.ts     # Compare processed messages
│   ├── ResponseComparator.ts    # Compare ACK/NAK responses
│   └── StatusComparator.ts      # Compare channel statuses
├── runners/
│   ├── ValidationRunner.ts      # Orchestrates test execution
│   └── ScenarioRunner.ts        # Runs individual scenarios
├── scenarios/
│   ├── 01-basic/
│   ├── 02-transformations/
│   ├── 03-connectors/
│   ├── 04-datatypes/
│   └── 05-advanced/
├── fixtures/
│   └── messages/
│       └── hl7v2/
│           ├── adt-a01.hl7
│           └── oru-r01.hl7
├── reports/
└── scripts/
    ├── setup.sh
    └── run-validation.sh
```

### 2.2 Key Files to Create

#### `validation/clients/MirthApiClient.ts`
Unified API client that can target either Java or Node.js:
- Login/logout with session management
- Channel CRUD operations
- Deploy/undeploy/start/stop channels
- Get channel statuses
- Search messages (when implemented)

#### `validation/clients/MLLPClient.ts`
TCP client with MLLP framing:
- Connect/disconnect
- Send HL7 message with 0x0B/0x1C/0x0D framing
- Receive and return ACK

#### `validation/comparators/MessageComparator.ts`
Deep comparison utilities:
- HL7v2 segment-by-segment comparison
- Ignore configurable fields (timestamps, IDs)
- Return detailed diff report

#### `validation/runners/ValidationRunner.ts`
Test orchestration:
- Deploy channel to both engines
- Send identical messages to both
- Capture responses from both
- Compare and report differences

---

## Phase 3: Golden Artifacts & Export Compatibility

### 3.1 Understanding Channel Representations

The Java Mirth Connect API has **three different representations** of a channel:

| Representation | Description | Contains ExportData |
|----------------|-------------|---------------------|
| **Database Format** | XML blob in CHANNEL.CHANNEL column | NO - Cleared before save |
| **API Response** | GET /api/channels returns | YES - Populated from metadata |
| **Export Format** | Same as API + optional code templates | YES |

**Key Behavior in Java** (from `DefaultChannelController.updateChannel()`):
1. Import receives Channel with ChannelExportData
2. ExportData is **extracted and cleared** before database save
3. ExportData components saved separately:
   - Metadata → `CHANNEL_METADATA` table
   - Tags → Configuration (channelTags)
   - Dependencies → Configuration (channelDependencies)
4. API response **re-populates** exportData from these sources

### 3.2 Golden Artifact Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    GOLDEN ARTIFACT CREATION                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Create channel via Java Mirth Administrator                  │
│         │                                                        │
│         ▼                                                        │
│  2. Export via Java API: GET /api/channels/{id}                  │
│         │                                                        │
│         ▼                                                        │
│  3. Save as "golden artifact" (includes exportData)              │
│         │                                                        │
│         ▼                                                        │
│  ┌──────┴──────┐                                                 │
│  ▼             ▼                                                 │
│ Import to    Import to                                           │
│ Java Mirth   Node.js Mirth                                       │
│  │             │                                                 │
│  ▼             ▼                                                 │
│ Export        Export                                             │
│ from Java    from Node.js                                        │
│  │             │                                                 │
│  └─────┬───────┘                                                 │
│        ▼                                                         │
│  4. Compare exports (should match golden artifact)               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 ChannelExportData Structure

Based on Java source (`/Users/adamstruthers/Projects/connect/server/src/com/mirth/connect/model/ChannelExportData.java`):

```typescript
interface ChannelExportData {
  metadata?: ChannelMetadata;           // enabled, lastModified, pruningSettings
  codeTemplateLibraries?: CodeTemplateLibrary[];
  channelTags?: ChannelTag[];           // id, name, backgroundColor
  dependencyIds?: Set<string>;          // channels this depends on
  dependentIds?: Set<string>;           // channels that depend on this
}

interface ChannelMetadata {
  enabled: boolean;
  lastModified?: Date;
  pruningSettings?: {
    archiveEnabled: boolean;
    pruneMetaDataDays?: number;
    pruneContentDays?: number;
  };
}
```

### 3.4 Export Compatibility Tests

#### Test 1: Round-Trip via Java
```
Golden Artifact → Import to Java → Export from Java → Compare
Expected: Identical (except revision increment)
```

#### Test 2: Cross-Engine Import
```
Golden Artifact → Import to Node.js → Export from Node.js → Compare to Java export
Expected: Identical structure, same exportData handling
```

#### Test 3: Database Parity
```
After import to both engines, query CHANNEL table directly:
- CHANNEL.CHANNEL column should NOT contain exportData
- Compare raw XML blobs between Java and Node.js inserts
```

#### Test 4: API Response Parity
```
GET /api/channels/{id} from both engines:
- Both should return channel WITH exportData
- Compare XML/JSON serialization format
```

### 3.5 Key Java Reference Files

| File | Purpose |
|------|---------|
| `ChannelServlet.java` | API implementation |
| `DefaultChannelController.java` | Export data extraction (line 341-342) |
| `Channel.java` | Model with clearExportData() |
| `ChannelExportData.java` | ExportData structure |
| `ObjectXMLSerializer.java` | XStream serialization config |
| `mysql-channel.xml` | Database SQL templates |

### 3.6 Validation Checklist for Export Compatibility

- [ ] Node.js clears exportData before database save (like Java)
- [ ] Node.js populates exportData on API response (like Java)
- [ ] XML serialization format matches XStream output
- [ ] Revision handling matches (currentRevision + 1)
- [ ] Override flag behavior matches
- [ ] Metadata stored separately from channel
- [ ] Tags association works correctly
- [ ] Dependencies tracked correctly
- [ ] Code template libraries optional inclusion works

### 3.7 Tools Needed

Add to `validation/clients/`:

```typescript
// ChannelExportValidator.ts
export class ChannelExportValidator {
  // Create golden artifact from Java
  async createGoldenArtifact(javaClient: MirthApiClient, channelId: string): Promise<Channel>;

  // Import to both engines
  async importToBoth(golden: Channel, javaClient: MirthApiClient, nodeClient: MirthApiClient): Promise<{java: boolean, node: boolean}>;

  // Export from both and compare
  async compareExports(channelId: string, javaClient: MirthApiClient, nodeClient: MirthApiClient): Promise<ExportComparisonResult>;

  // Direct database comparison
  async compareDatabaseRecords(channelId: string): Promise<DatabaseComparisonResult>;
}

interface ExportComparisonResult {
  match: boolean;
  differences: {
    field: string;
    javaValue: unknown;
    nodeValue: unknown;
  }[];
}
```

---

## Phase 4: Test Scenarios (Priority Order)

### Priority 0: Export/Import Compatibility (Must Pass First)

| ID | Scenario | Description |
|----|----------|-------------|
| 0.1 | Simple Channel Round-Trip | Export from Java, import to Node.js, export from Node.js, compare |
| 0.2 | Database Record Parity | Compare CHANNEL table records between engines |
| 0.3 | ExportData Handling | Verify exportData cleared on save, populated on GET |
| 0.4 | Revision Management | Verify revision increment and conflict detection |
| 0.5 | Metadata Separation | Verify metadata stored separately, retrieved correctly |

### Priority 1: Core Message Flow (Must Pass)

| ID | Scenario | Channel File | Description |
|----|----------|--------------|-------------|
| 1.1 | MLLP to File | `Simple Channel - MLLP to File.xml` | Basic HL7 receive, ACK, file write |
| 1.2 | MLLP to MLLP | `MLLP to MLLP.xml` | HL7 passthrough with ACK |
| 1.3 | HTTP Basic | Custom | HTTP POST receive, return response |

### Priority 2: JavaScript Runtime

| ID | Scenario | Channel File | Description |
|----|----------|--------------|-------------|
| 2.1 | JS Filter | `JavaScript Filters.xml` | Filter with `msg` variable |
| 2.2 | JS Transformer | `JavaScript Transformers.xml` | Transform with E4X syntax |
| 2.3 | E4X Iteration | `Iterator Transformer- Message Builder.xml` | `for each` loop over segments |
| 2.4 | Channel Maps | Custom | `$c()`, `$g()`, `$cfg()` usage |

### Priority 3: Data Types

| ID | Scenario | Channel File | Description |
|----|----------|--------------|-------------|
| 3.1 | HL7v2 Parsing | `JavaScript Transformers.xml` | Verify XML serialization |
| 3.2 | HL7v2 ACK | `MLLP to MLLP.xml` | ACK format AA/AE/AR |
| 3.3 | XML Transform | `Transformers - Create XML.xml` | Message to XML |
| 3.4 | Text Report | `Transformers - Create Text Report.xml` | HL7 to text |

### Priority 4: All Connectors

| ID | Scenario | Channel File | Description |
|----|----------|--------------|-------------|
| 4.1 | TCP/MLLP Receiver | `MLLP to MLLP.xml` | MLLP framing |
| 4.2 | TCP/MLLP Sender | `MLLP to MLLP.xml` | Send with response |
| 4.3 | File Reader | `Local Folder to FTP.xml` | Poll and read files |
| 4.4 | File Writer | `Simple Channel - MLLP to File.xml` | Write to filesystem |
| 4.5 | HTTP Receiver | Custom | POST/GET handling |
| 4.6 | HTTP Dispatcher | Custom | Outbound HTTP |
| 4.7 | Database Reader | `Database Reader.xml` | SELECT polling |
| 4.8 | Database Writer | `Database Writer.xml` | INSERT/UPDATE |

### Priority 5: Advanced Features

| ID | Scenario | Channel File | Description |
|----|----------|--------------|-------------|
| 5.1 | Response Transformer | `Response Transformers- Receiver.xml` | Transform response |
| 5.2 | Multiple Destinations | Custom | Fan-out routing |
| 5.3 | Channel Routing | `Routing Channels.xml` | Channel reader/writer |
| 5.4 | Iterator Filter | `Iterator Filter- Rule Builder.xml` | Repeating segment filter |

---

## Phase 5: Feedback Loop Process

### 4.1 Gap Discovery Workflow

```
1. Run Scenario
       │
       ▼
2. Compare Outputs
       │
       ├── Match? ───► Pass ───► Next Scenario
       │
       ▼
3. Discrepancy Found
       │
       ▼
4. Log to manifest.json
       │
       ▼
5. Trace to Java Source
       │
       ▼
6. Implement Fix
       │
       ▼
7. Re-run Scenario
       │
       └── Loop until Pass
```

### 4.2 Gap Tracking in manifest.json

Add `validationGaps` section:

```json
{
  "validationGaps": {
    "gap-001": {
      "discoveredDate": "2024-01-XX",
      "scenario": "1.1-mllp-to-file",
      "severity": "critical|major|minor",
      "status": "open|investigating|implementing|testing|resolved",
      "description": "Description of the difference",
      "javaOutput": "What Java produces",
      "nodeOutput": "What Node.js produces",
      "javaReference": "/path/to/Java/source.java",
      "affectedFiles": ["src/path/to/file.ts"],
      "resolution": {
        "status": "pending",
        "task": "Fix description",
        "completedDate": null
      }
    }
  }
}
```

### 4.3 Severity Levels

- **critical**: Breaks message processing or API compatibility
- **major**: Incorrect output affecting downstream systems
- **minor**: Cosmetic differences (whitespace, ordering)

---

## Phase 6: Implementation Steps

### Step 1: Create Validation Infrastructure
- [ ] Create `validation/` directory structure
- [ ] Create `validation/package.json` with dependencies
- [ ] Create environment configuration

### Step 2: Implement API Client
- [ ] `MirthApiClient.ts` - REST operations
- [ ] Login/logout with session
- [ ] Channel deploy/undeploy/start/stop
- [ ] Status retrieval

### Step 3: Implement Message Clients
- [ ] `MLLPClient.ts` - TCP with MLLP framing
- [ ] `HttpMessageClient.ts` - HTTP sender
- [ ] `FileClient.ts` - File read/write

### Step 4: Implement Comparators
- [ ] `MessageComparator.ts` - HL7, XML, JSON comparison
- [ ] `ResponseComparator.ts` - ACK comparison
- [ ] `StatusComparator.ts` - Channel status comparison
- [ ] `ChannelExportComparator.ts` - Channel XML export comparison

### Step 5: Implement Golden Artifact Tools
- [ ] `ChannelExportValidator.ts` - Export/import validation
- [ ] Create golden artifact from Java Mirth
- [ ] Import to Node.js and compare
- [ ] Direct database record comparison

### Step 6: Implement Runner
- [ ] `ValidationRunner.ts` - Orchestration
- [ ] Deploy to both engines
- [ ] Send messages in parallel
- [ ] Compare and report

### Step 7: Create Test Fixtures
- [ ] Sample HL7v2 messages (ADT, ORU)
- [ ] Sample XML documents
- [ ] Sample JSON payloads

### Step 8: Run Priority 0 - Export Compatibility
- [ ] Create golden artifacts from Java Mirth
- [ ] Test round-trip export/import
- [ ] Validate exportData handling
- [ ] Fix any serialization differences

### Step 9: Implement Priority 1 Scenarios
- [ ] MLLP to File scenario
- [ ] MLLP to MLLP scenario
- [ ] HTTP basic scenario

### Step 10: Run First Validation Cycle
- [ ] Start Docker (Java Mirth + MySQL)
- [ ] Start Node.js on port 8081
- [ ] Run Priority 0 (export compatibility)
- [ ] Run Priority 1 scenarios
- [ ] Document gaps in manifest.json

### Step 11: Fix Gaps and Iterate
- [ ] For each gap: trace to Java, implement fix
- [ ] Re-run scenario until pass
- [ ] Move to next priority

---

## Phase 7: Verification Checklist

### Pre-Validation
- [ ] Docker running with MySQL healthy
- [ ] Java Mirth responding at http://localhost:8080
- [ ] Node.js Mirth responding at http://localhost:8081
- [ ] Both connected to same MySQL database
- [ ] Test messages available

### Per-Scenario Validation
- [ ] Channel deploys on both engines
- [ ] Channel starts on both engines
- [ ] Message processed successfully
- [ ] Status matches (SENT, FILTERED, ERROR)
- [ ] Transformed content matches
- [ ] ACK/response matches
- [ ] Output matches (files, DB rows)

### Export Compatibility
- [ ] Channel round-trip export/import works
- [ ] ExportData cleared before database save
- [ ] ExportData populated on API GET
- [ ] Database records match between engines
- [ ] XML serialization format matches XStream

### Success Criteria
- [ ] All Priority 0 scenarios pass (export compatibility)
- [ ] All Priority 1 scenarios pass
- [ ] 90%+ Priority 2-4 scenarios pass
- [ ] All critical gaps resolved
- [ ] ACK responses wire-compatible
- [ ] API responses structurally compatible

---

## Critical Files

### Node.js Implementation

| Purpose | Path |
|---------|------|
| Sample Channels | `tests/fixtures/example-channels/` |
| Docker Config | `docker/docker-compose.yml` |
| Manifest | `manifest.json` |
| HL7v2 ACK Generator | `src/datatypes/hl7v2/HL7v2ACKGenerator.ts` |
| Channel Controller | `src/controllers/ChannelController.ts` |
| Engine Controller | `src/controllers/EngineController.ts` |
| API Server | `src/api/server.ts` |
| Channel Servlet | `src/api/servlets/ChannelServlet.ts` |

### Java Reference (for tracing gaps)

| Purpose | Path |
|---------|------|
| Channel Servlet | `~/Projects/connect/server/src/com/mirth/connect/server/api/servlets/ChannelServlet.java` |
| Channel Controller | `~/Projects/connect/server/src/com/mirth/connect/server/controllers/DefaultChannelController.java` |
| Channel Model | `~/Projects/connect/server/src/com/mirth/connect/model/Channel.java` |
| ExportData Model | `~/Projects/connect/server/src/com/mirth/connect/model/ChannelExportData.java` |
| XStream Serializer | `~/Projects/connect/server/src/com/mirth/connect/model/converters/ObjectXMLSerializer.java` |
| Database SQL | `~/Projects/connect/server/dbconf/mysql/mysql-channel.xml` |

---

## Commands Reference

```bash
# Start infrastructure
npm run docker:up                    # Start MySQL + Java Mirth
PORT=8081 npm run dev                # Start Node.js Mirth

# Run validation
cd validation
npm run validate                     # Run all scenarios
npm run validate:priority1           # Run Priority 1 only
npm run validate:scenario 1.1        # Run specific scenario

# View reports
npm run report                       # Generate HTML report
```
