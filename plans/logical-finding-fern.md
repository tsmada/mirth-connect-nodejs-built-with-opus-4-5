# Mirth Connect Node.js Runtime Implementation Plan

## Executive Summary

Build a Node.js/TypeScript runtime that completely replaces the Mirth Connect Java engine, maintaining 100% API compatibility with the existing Mirth Connect Administrator UI and using the existing MySQL database schema.

## Project Location

**Target Directory**: `/Users/adamstruthers/Projects/mirth-connect-opus-4.5`
**Mirth Reference**: `/Users/adamstruthers/Projects/connect` (Java source for reference)
**Target Mirth Version**: 3.9.x

## Requirements Summary

| Requirement | Decision |
|------------|----------|
| **Connectors** | HTTP/REST, Database (JDBC), File (local/FTP/SFTP/S3), TCP/MLLP |
| **Data Types** | HL7v2, XML, JSON |
| **E4X Support** | Heavy usage - transpile to modern DOM/XPath |
| **Database** | Use existing Mirth MySQL schema |
| **REST API** | 100% compatible with Mirth Connect Administrator |
| **Plugins** | Code Templates, Data Pruner |
| **Validation** | Integration tests, ported unit tests, API contract tests |

---

## Docker Compose for Testing

Create `docker/docker-compose.yml` for local Mirth Connect 3.9 instance:

```yaml
version: '3.8'
services:
  mirth-db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: mirthroot
      MYSQL_DATABASE: mirthdb
      MYSQL_USER: mirth
      MYSQL_PASSWORD: mirth
    ports:
      - "3306:3306"
    volumes:
      - mirth-db-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  mirth-connect:
    image: nextgenhealthcare/connect:3.9
    depends_on:
      mirth-db:
        condition: service_healthy
    ports:
      - "8080:8080"    # HTTP API
      - "8443:8443"    # HTTPS API
    environment:
      - DATABASE=mysql
      - DATABASE_URL=jdbc:mysql://mirth-db:3306/mirthdb
      - DATABASE_USERNAME=mirth
      - DATABASE_PASSWORD=mirth
    volumes:
      - mirth-appdata:/opt/connect/appdata

volumes:
  mirth-db-data:
  mirth-appdata:
```

This provides:
- MySQL 8.0 database for both Mirth Java and Node.js runtime to use
- Mirth Connect 3.9 for comparison testing
- Shared database allows direct output comparison

---

## Project Structure

```
mirth-connect-opus-4.5/
├── package.json
├── tsconfig.json
├── CLAUDE.md                        # AI development guidelines
├── manifest.json                    # Functionality completion registry
├── docker/
│   └── docker-compose.yml           # Mirth 3.9 + MySQL for testing
├── src/
│   ├── index.ts                     # Entry point
│   ├── server/
│   │   └── Mirth.ts                 # Main server lifecycle
│   ├── donkey/                      # Message engine
│   │   ├── Donkey.ts
│   │   ├── channel/
│   │   │   ├── Channel.ts
│   │   │   ├── SourceConnector.ts
│   │   │   ├── DestinationConnector.ts
│   │   │   └── FilterTransformerExecutor.ts
│   │   ├── message/
│   │   │   ├── Message.ts
│   │   │   ├── ConnectorMessage.ts
│   │   │   └── Status.ts
│   │   └── queue/
│   ├── connectors/
│   │   ├── http/
│   │   ├── jdbc/
│   │   ├── file/
│   │   └── tcp/
│   ├── controllers/                 # Business logic
│   ├── api/                         # REST API
│   │   └── servlets/
│   ├── db/                          # Database layer
│   ├── javascript/
│   │   ├── runtime/
│   │   │   ├── JavaScriptExecutor.ts
│   │   │   ├── ScopeBuilder.ts
│   │   │   └── ScriptBuilder.ts
│   │   ├── e4x/
│   │   │   ├── E4XParser.ts
│   │   │   ├── E4XTranspiler.ts
│   │   │   └── XMLProxy.ts
│   │   └── userutil/               # JavaScript utilities
│   ├── datatypes/
│   │   ├── hl7v2/
│   │   ├── xml/
│   │   └── json/
│   ├── plugins/
│   │   ├── codetemplates/
│   │   ├── datapruner/
│   └── model/                       # Domain models
└── tests/
    ├── unit/
    ├── integration/
    └── api/
```

---

## Phase 1: Foundation ✅ COMPLETED

### 1.1 Project Setup ✅
- [x] Initialize TypeScript project with strict mode
- [x] Configure ESLint, Prettier, Jest
- [x] Create Docker Compose for MySQL + Mirth 3.9
- [x] Create initial manifest.json registry
- [x] Create CLAUDE.md with porting guidelines
- [x] Create `.claude/skills/mirth-connect-java-porting.md` skill file
- [x] Clone example channels: `git clone https://github.com/koratech/mirthconnect_channels-examples.git tests/fixtures/example-channels`

**Validation**: ✅ Project builds, linting passes, Docker containers start

### 1.2 Database Layer ✅
- [x] Implement MySQL connection pool (mysql2)
- [x] Create MirthDao for core tables (CHANNEL, CONFIGURATION, PERSON, etc.)
- [x] Create DonkeyDao for dynamic message tables (D_M, D_MM, D_MC, D_MA, D_MS, D_MSQ)
- [x] Implement dynamic table creation per channel

**Critical Files to Reference**:
- `/Users/adamstruthers/Projects/connect/server/dbconf/mysql/mysql-database.sql`
- `/Users/adamstruthers/Projects/connect/donkey/donkeydbconf/mysql.xml`

**Validation**: ✅ Can read/write all table types, matches existing schema exactly

### 1.3 Core Models ✅
- [x] Message, ConnectorMessage, RawMessage
- [x] Channel, Connector (source/destination)
- [x] Filter, Transformer, Rule, Step
- [x] Status enum (R, F, T, S, Q, E, P)
- [x] ContentType enum

**Critical Files to Reference**:
- `/Users/adamstruthers/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/message/`
- `/Users/adamstruthers/Projects/connect/server/src/com/mirth/connect/model/Channel.java`

**Validation**: ✅ Models serialize/deserialize identically to Java XStream format

**Phase 1 Final Status**: 83 tests passing, build passing, lint passing

---

## Phase 2: JavaScript Runtime ✅ COMPLETED

### 2.1 E4X Transpiler ✅
- [x] Create E4X syntax parser (handle XML literals, property access, namespaces)
- [x] Implement transpilation to modern JS with XMLProxy calls
- [x] Handle `for each` → `for...of` loops
- [x] Handle `msg..OBX` → `msg.descendants('OBX')` descendant operator
- [x] Handle `node.@attr` → `node.attr('attr')` attribute access
- [x] Handle `default xml namespace = "ns"` → `setDefaultXmlNamespace("ns")`
- [x] Handle `new XML(data)` → `XMLProxy.create(data)`

**Validation**: ✅ 31 tests passing - E4X syntax correctly transpiled

### 2.2 XMLProxy Implementation ✅
- [x] Create XMLProxy class with E4X-compatible API using fast-xml-parser
- [x] Implement get/set for path-based access via Proxy
- [x] Implement namespace(), children(), attributes(), descendants()
- [x] Support XMLList-like behavior for multiple results
- [x] Support toString() serialization back to XML

**Validation**: ✅ 36 tests passing - All E4X patterns work correctly

### 2.3 Script Executor (JavaScriptExecutor) ✅
- [x] Implement VM sandbox using Node.js `vm` module
- [x] Create context with proper scope setup
- [x] Set configurable timeout (default 30s)
- [x] Capture and format script exceptions
- [x] Execute filter/transformer, preprocessor, postprocessor, deploy/undeploy scripts

**Validation**: ✅ 35 tests passing - Execute scripts with proper error handling

### 2.4 Scope Builder ✅
Implemented all scope variables from JavaScriptScopeUtil.java:

- [x] `msg`, `tmp`, `connectorMessage`, `template`, `phase`
- [x] Map accessors: `$c`, `$s`, `$g`, `$gc`, `$cfg`, `$r`, `$co`
- [x] `sourceMap`, `channelMap`, `responseMap`, `connectorMap`
- [x] `globalMap`, `globalChannelMap`, `configurationMap`
- [x] `logger`, `alerts`, `router`, `replacer`
- [x] Status constants: `RECEIVED`, `FILTERED`, `TRANSFORMED`, `SENT`, `QUEUED`, `ERROR`, `PENDING`
- [x] XMLProxy utilities: `XMLProxy`, `XML`, `createXML`, `setDefaultXmlNamespace`

**Validation**: ✅ 25 tests passing - All scope variables available

### 2.5 Script Builder ✅
Implemented script generation matching JavaScriptBuilder.java:

- [x] `generateGlobalSealedScript()` - String.prototype.trim, XML settings
- [x] `generateScript()` - General script with setup code
- [x] `generateFilterTransformerScript()` - msg/tmp initialization, doFilter/doTransform
- [x] `generatePreprocessorScript()`, `generatePostprocessorScript()`
- [x] `generateDeployScript()`, `generateUndeployScript()`
- [x] Helper functions: `validate`, `$`, `createSegment`, logger shortcuts
- [x] Map shortcut functions: `$c`, `$s`, `$g`, `$gc`, `$cfg`, `$r`, `$co`

**Validation**: ✅ 30 tests passing - Generated scripts execute correctly

### 2.6 MirthMap Classes ✅
- [x] MirthMap base class with Java-compatible API (get, put, containsKey, etc.)
- [x] SourceMap (read-only)
- [x] ChannelMap (with sourceMap fallback)
- [x] ResponseMap
- [x] GlobalMap (singleton)
- [x] GlobalChannelMapStore (per-channel global maps)
- [x] ConfigurationMap (singleton, read-only)

**Validation**: ✅ 108 tests passing for userutil maps

**Phase 2 Final Status**: 265 tests passing, build passing, lint passing

---

## Phase 3: Message Pipeline ✅ COMPLETED

### 3.1 Channel Runtime ✅
- [x] Implement Channel class with message dispatch
- [x] Implement SourceConnector base with dispatchRawMessage()
- [x] Implement DestinationConnector base with send()
- [ ] Implement DestinationChain for ordered/parallel execution (deferred to Phase 4)

**Critical File**: `/Users/adamstruthers/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Channel.java`

### 3.2 Filter/Transformer Executor ✅
- [x] Compile and cache filter/transformer scripts via JavaScriptExecutor
- [x] Execute with proper scope (connectorMessage, maps)
- [x] Return FilterTransformerResult (filtered, transformed data)
- [x] Support FilterRule[] and TransformerStep[] configuration

### 3.3 Pre/Post Processors ✅
- [x] Implement preprocessor execution (channel-level)
- [x] Implement postprocessor execution (channel-level)
- [x] Handle Response return from postprocessor
- [x] Deploy/undeploy script execution on channel start/stop

### 3.4 Message Flow Implementation ✅
```
RawMessage → Preprocessor → Filter → Transformer → Destinations → Response Transformer → Postprocessor → Storage
```

- [x] Status updates at each stage (R→T→S or R→F or R→E)
- [x] Store content at each ContentType stage
- [ ] Queue support for destinations (deferred to Phase 4)

**Validation**: ✅ 61 tests passing for donkey/channel components

**Phase 3 Final Status**: 326 tests passing, build passing, lint passing

---

## Phase 4: Connectors ✅ COMPLETED

### 4.1 HTTP Connector ✅
- [x] HttpReceiver - Express.js listener
- [x] HttpDispatcher - Fetch API client
- [x] Support GET, POST, PUT, DELETE, PATCH
- [x] Headers, query params, response handling
- [x] Binary content support with MIME type detection
- [x] GZIP compression/decompression

**Validation**: ✅ 56 tests passing

### 4.2 Database (JDBC) Connector ✅
- [x] DatabaseReceiver - Poll-based query execution with mysql2/promise
- [x] DatabaseDispatcher - INSERT/UPDATE execution
- [x] Support query mode (script mode deferred)
- [x] MySQL connection pooling
- [x] JDBC URL parsing
- [x] XML result serialization

**Validation**: ✅ 42 tests passing

### 4.3 File Connector ✅
- [x] FileReceiver - Poll-based file reading
- [x] FileDispatcher - File writing
- [x] Scheme: Local filesystem (FTP, SFTP, S3 deferred)
- [x] File filtering (glob and regex patterns)
- [x] After-processing actions (move, delete)
- [x] Sorting options (name, size, date)
- [x] Binary and text mode support

**Validation**: ✅ 70 tests passing

### 4.4 TCP/MLLP Connector ✅
- [x] TcpReceiver - TCP socket listener (server mode) and client mode
- [x] TcpDispatcher - TCP client with keep-alive support
- [x] MLLP framing - 0x0B/0x1C/0x0D for HL7
- [x] Custom frame mode support
- [x] Raw TCP mode support
- [x] Auto-ACK generation for HL7 messages
- [x] Control ID extraction from HL7 MSH segment

**Validation**: ✅ 69 tests passing

**Phase 4 Final Status**: 237 connector tests passing, 563 total tests passing, build passing, lint passing

---

## Phase 5: Data Types ✅ COMPLETED

### 5.1 HL7v2 ✅
- [x] HL7v2Parser - Parse pipe-delimited ER7 format to XML
- [x] HL7v2Serializer - Serialize XML back to ER7
- [x] XML representation matching Mirth's format (MSH.1, MSH.2, PID.3.1, etc.)
- [x] ACK generation (AA/AE/AR codes)
- [x] HL7v2Properties - Encoding characters extraction
- [x] HL7v2MetaData - Source, type, version extraction from MSH

**Validation**: ✅ 72 tests passing for HL7v2 components

### 5.2 XML ✅
- [x] XMLDataType with serialization
- [x] Namespace stripping support
- [x] Metadata extraction (version, encoding, root element)

**Validation**: ✅ 24 tests passing

### 5.3 JSON ✅
- [x] JSONDataType with serialization
- [x] Validation, minification, prettification
- [x] Metadata extraction (root type, top-level keys)

**Validation**: ✅ 38 tests passing

**Phase 5 Final Status**: 169 datatype tests passing, 732 total tests passing, build passing, lint passing

---

## Phase 6: REST API ✅ COMPLETED

### 6.1 API Server Setup ✅
- [x] Express server with XML/JSON content negotiation
- [x] Authentication matching Mirth (session-based with SHA-256 password hashing)
- [x] CORS configuration
- [x] Custom `res.sendData()` middleware for XML/JSON response serialization

### 6.2 Core Servlets ✅
Match interfaces in `/Users/adamstruthers/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/`:

- [x] UserServlet - User authentication, CRUD, password management, preferences
- [x] ChannelServlet - CRUD channels, summaries, enable/disable
- [x] ChannelStatusServlet - Start/stop/pause/resume/halt channels and connectors
- [x] EngineServlet - Deploy/undeploy channels
- [x] ConfigurationServlet - Server config, global scripts, resources, metadata
- [ ] MessageServlet - Message search, retrieval, reprocess (deferred)
- [ ] CodeTemplateServlet - Code templates (deferred to Phase 7)
- [ ] EventServlet - Event logs (deferred)
- [ ] AlertServlet - Alerts (deferred)
- [ ] ExtensionServlet - Plugins (deferred)

### 6.3 Controllers ✅
- [x] ChannelController - Channel XML parsing, CRUD, summaries
- [x] EngineController - In-memory channel state, deployment lifecycle
- [x] ConfigurationController - Server settings, global scripts, resources

**Validation**: ✅ 732 tests passing, build passing, lint passing

**Phase 6 Final Status**: Core API server and essential servlets implemented for Administrator compatibility

---

## Phase 7: Plugins ✅ COMPLETED

### 7.1 Code Templates Library ✅
- [x] Load code templates from database
- [x] Inject into script compilation via `getCodeTemplateScripts(channelId, context)`
- [x] Support library references with channel enablement
- [x] In-memory caching with XML serialization/deserialization
- [x] REST API: `/codeTemplateLibraries`, `/codeTemplates`, `/_getSummary`, `/_bulkUpdate`

**Files Created**:
- `src/plugins/codetemplates/models/` - ContextType, CodeTemplateContextSet, CodeTemplateProperties, CodeTemplate, CodeTemplateLibrary
- `src/plugins/codetemplates/CodeTemplateController.ts` - Business logic with caching
- `src/plugins/codetemplates/CodeTemplateServlet.ts` - REST API endpoints

### 7.2 Data Pruner ✅
- [x] Scheduled message pruning with configurable intervals
- [x] Configurable retention policies (message date threshold, content date threshold)
- [x] Batch processing with retry logic
- [x] AbortController support for graceful shutdown
- [x] REST API: `/extensions/datapruner/status`, `/config`, `/_start`, `/_stop`

**Files Created**:
- `src/plugins/datapruner/DataPrunerStatus.ts` - Status tracking interfaces
- `src/plugins/datapruner/DataPruner.ts` - Core pruning logic
- `src/plugins/datapruner/DataPrunerController.ts` - Lifecycle and scheduling
- `src/plugins/datapruner/DataPrunerServlet.ts` - REST API endpoints
- `src/db/DonkeyDao.ts` - Added pruning methods (getMessagesToPrune, pruneMessages, etc.)

**Validation**: ✅ 79 tests passing for plugin components

**Phase 7 Final Status**: 811 total tests passing, build passing, lint passing

---

## Manifest/Registry System

Create `manifest.json` to track functionality completion:

```json
{
  "version": "0.1.0",
  "mirthCompatibility": "4.5.0",
  "components": {
    "database": {
      "core_tables": { "status": "pending", "tests": [] },
      "message_tables": { "status": "pending", "tests": [] }
    },
    "javascript": {
      "e4x_transpiler": { "status": "pending", "tests": [] },
      "xml_proxy": { "status": "pending", "tests": [] },
      "scope_builder": { "status": "pending", "tests": [] },
      "script_builder": { "status": "pending", "tests": [] }
    },
    "connectors": {
      "http": { "status": "pending", "tests": [] },
      "jdbc": { "status": "pending", "tests": [] },
      "file": { "status": "pending", "tests": [] },
      "tcp_mllp": { "status": "pending", "tests": [] }
    },
    "datatypes": {
      "hl7v2": { "status": "pending", "tests": [] },
      "xml": { "status": "pending", "tests": [] },
      "json": { "status": "pending", "tests": [] }
    },
    "api": {
      "channels": { "status": "pending", "tests": [] },
      "messages": { "status": "pending", "tests": [] },
      "engine": { "status": "pending", "tests": [] },
      "configuration": { "status": "pending", "tests": [] }
    },
    "plugins": {
      "code_templates": { "status": "pending", "tests": [] },
      "data_pruner": { "status": "pending", "tests": [] }
    }
  }
}
```

**Status Values**: `pending` → `in-progress` → `implemented` → `tested` → `validated` → `production-ready`

---

## CLAUDE.md Template

Create in project root:

```markdown
# Mirth Connect Node.js Runtime

## Project Goal
Node.js/TypeScript replacement for Mirth Connect Java engine.
Must maintain 100% API compatibility with Mirth Connect Administrator.

## Architecture
- **Donkey Engine**: Message processing in `src/donkey/`
- **Connectors**: Protocol implementations in `src/connectors/`
- **JavaScript Runtime**: E4X transpilation in `src/javascript/`
- **REST API**: Express-based in `src/api/`

## Critical Patterns

### E4X Transpilation
ALL user scripts may contain E4X. Always transpile before execution:
```typescript
const transpiled = e4xTranspiler.transpile(userScript);
```

### Message Status Codes
R=RECEIVED, F=FILTERED, T=TRANSFORMED, S=SENT, Q=QUEUED, E=ERROR, P=PENDING

### Map Variables
$c=channelMap, $s=sourceMap, $g=globalMap, $gc=globalChannelMap,
$cfg=configurationMap, $r=responseMap, $co=connectorMap

## Database
Using existing Mirth MySQL schema - do NOT modify tables.
Per-channel tables: D_M{id}, D_MM{id}, D_MC{id}, D_MA{id}, D_MS{id}, D_MSQ{id}

## Validation Requirements
Before marking component complete:
1. Unit tests pass
2. Integration test with Java engine produces identical output
3. API contract tests pass (if API component)

## Reference Files (from ~/Projects/connect)
- JavaScriptBuilder.java - Script generation patterns
- JavaScriptScopeUtil.java - Scope variables
- Channel.java (donkey) - Message pipeline
- mysql-database.sql - Schema
- mysql.xml - Dynamic table queries

---

## Porting Untracked Mirth Features

When you discover a Mirth feature that isn't yet tracked in manifest.json, follow this process:

### Step 1: Identify the Feature
1. Note where you encountered the feature (channel XML, API call, error message)
2. Search the Java codebase for the implementation:
   ```bash
   # Search in ~/Projects/connect
   grep -r "FeatureName" ~/Projects/connect/server/src/
   grep -r "FeatureName" ~/Projects/connect/donkey/src/
   ```

### Step 2: Register in Manifest
Add to `manifest.json` under the appropriate category:
```json
{
  "components": {
    "category": {
      "new_feature": {
        "status": "pending",
        "javaSource": "/path/to/JavaFile.java",
        "description": "Brief description of what it does",
        "discoveredIn": "channel-name or api-endpoint",
        "tests": []
      }
    }
  }
}
```

### Step 3: Analyze Java Implementation
1. Read the Java source file completely
2. Document the key methods and their behavior
3. Identify dependencies on other Java classes
4. Note any Rhino/E4X specific code that needs transpilation

### Step 4: Create TypeScript Skeleton
```typescript
// src/path/to/NewFeature.ts

/**
 * Ported from: ~/Projects/connect/server/src/.../JavaFile.java
 *
 * Purpose: [description]
 *
 * Key behaviors to replicate:
 * - [behavior 1]
 * - [behavior 2]
 */
export class NewFeature {
  // TODO: Implement
}
```

### Step 5: Write Tests First (TDD)
1. Create test file: `tests/unit/path/to/NewFeature.test.ts`
2. Write tests based on expected Java behavior
3. Create integration test comparing with Java engine

### Step 6: Implement and Validate
1. Implement until unit tests pass
2. Run integration comparison test
3. Update manifest.json status to "validated"

### Common Porting Patterns

**Java → TypeScript Type Mapping:**
| Java | TypeScript |
|------|------------|
| `String` | `string` |
| `Integer/Long` | `number` |
| `List<T>` | `T[]` |
| `Map<K,V>` | `Map<K,V>` or `Record<K,V>` |
| `Calendar/Date` | `Date` |
| `Object` | `unknown` or generic `T` |

**Rhino JavaScript → Node.js:**
| Rhino Pattern | Node.js Equivalent |
|---------------|-------------------|
| `importPackage(...)` | `import { ... } from '...'` |
| `new XML(str)` | `XMLProxy.create(str)` |
| `msg.element.@attr` | `msg.get('element').attr('attr')` |
| `JavaAdapter` | Native class or wrapper |

**XStream Serialization:**
- Java uses XStream for XML serialization
- Use `fast-xml-parser` with custom mappers to match XStream output exactly
```

---

## Claude Skill: mirth-connect-java-porting

Create skill file at `.claude/skills/mirth-connect-java-porting.md`:

```markdown
# Mirth Connect Java Porting Skill

Use this skill when porting functionality from Java Mirth Connect to Node.js.

## Quick Start Commands

### /port-feature <java-class-path>
Analyze a Java class and create porting plan:
1. Read the Java source file
2. Identify all public methods and their signatures
3. Map dependencies to existing Node.js implementations or flag as missing
4. Create TypeScript skeleton with JSDoc from Java comments
5. Register in manifest.json

### /compare-output <channel-xml>
Compare channel output between Java and Node.js engines:
1. Load channel from XML
2. Send test message to both engines
3. Compare: transformed data, status, maps, errors
4. Report differences

### /find-java-impl <feature-name>
Search Java codebase for implementation:
- Search patterns: class names, method names, constants
- Report file locations and line numbers
- Show relevant code snippets

## Porting Checklist

For each feature, verify:
- [ ] All public methods ported
- [ ] Same exception types thrown
- [ ] Same return values
- [ ] Same side effects (database, maps, logs)
- [ ] Thread safety maintained
- [ ] E4X patterns transpiled correctly

## Key Java Files Reference

**Core Engine:**
- `~/Projects/connect/server/src/com/mirth/connect/server/Mirth.java`
- `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/Donkey.java`

**JavaScript Runtime:**
- `~/Projects/connect/server/src/com/mirth/connect/server/builders/JavaScriptBuilder.java`
- `~/Projects/connect/server/src/com/mirth/connect/server/util/javascript/JavaScriptScopeUtil.java`
- `~/Projects/connect/server/src/com/mirth/connect/server/util/javascript/JavaScriptUtil.java`
- `~/Projects/connect/server/src/org/mozilla/javascript/` (Rhino engine)

**Connectors:**
- `~/Projects/connect/server/src/com/mirth/connect/connectors/http/`
- `~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/`
- `~/Projects/connect/server/src/com/mirth/connect/connectors/file/`
- `~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/`

**Data Types:**
- `~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/`
- `~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/xml/`
- `~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/json/`

**REST API:**
- `~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/`

**Database:**
- `~/Projects/connect/server/dbconf/mysql/mysql-database.sql`
- `~/Projects/connect/donkey/donkeydbconf/mysql.xml`

## Porting Mindset

1. **Fidelity First**: Match Java behavior exactly before optimizing
2. **Test Driven**: Write comparison tests before implementing
3. **Incremental**: Port one method at a time, validate, commit
4. **Document Differences**: If Node.js requires different approach, document why
5. **E4X Awareness**: Always check for E4X patterns in scripts
```

---

## Validation Strategy

### Test Channel Examples

Use channels from https://github.com/koratech/mirthconnect_channels-examples (Mirth 3.8, compatible with 3.9):

**Alert & Filtering:**
- `Alerts - Log Alert Data` - Alert system testing
- `Alerts - Process Only ADTs` - HL7 ADT filtering
- `Iterator Filter - Rule Builder` - Complex filter rules
- `JavaScript Filters` - Custom JS filter logic

**Transformations:**
- `Transformers - Create Text Report` - HL7 to text
- `Transformers - Create XML` - HL7 to XML conversion
- `Iterator Transformer - Message Builder` - Iterative transforms
- `JavaScript Transformers` - Custom JS transforms
- `Response Transformer - Sender/Receiver` - Response handling

**Connectors:**
- `Database Reader` / `Database Writer` - JDBC connector tests
- `MLLP to MLLP` - TCP/MLLP pass-through
- `Simple Channel - MLLP to File` - MLLP receive, file write
- `Local Folder to FTP` - File connector schemes
- `PDF Writer` / `PDF Writer with Email` - Document generation

**Routing:**
- `Routing Channels` / `Routing - Channel Reader/Writer` - VM connector
- `Custom Response with Queuing` - Queue behavior

Clone for testing:
```bash
git clone https://github.com/koratech/mirthconnect_channels-examples.git tests/fixtures/example-channels
```

### Unit Tests
- Test each component in isolation
- Mock database and external dependencies

### Integration Tests (Comparison)
Run same test messages through both Java and Node.js engines:

```typescript
describe('Engine Comparison', () => {
  it('produces identical HL7 transform output', async () => {
    const javaResult = await javaEngine.process(testMessage);
    const nodeResult = await nodeEngine.process(testMessage);
    expect(nodeResult.transformedData).toEqual(javaResult.transformedData);
    expect(nodeResult.status).toEqual(javaResult.status);
  });
});
```

### API Contract Tests
Verify REST API responses match Mirth exactly:
- Response structure
- HTTP status codes
- XML/JSON serialization
- Error responses

---

## Critical Reference Files

| Component | Java Source Path |
|-----------|-----------------|
| Script Generation | `/server/src/com/mirth/connect/server/builders/JavaScriptBuilder.java` |
| Scope Variables | `/server/src/com/mirth/connect/server/util/javascript/JavaScriptScopeUtil.java` |
| Message Pipeline | `/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Channel.java` |
| REST API | `/server/src/com/mirth/connect/client/core/api/servlets/*Interface.java` |
| Core Schema | `/server/dbconf/mysql/mysql-database.sql` |
| Message Tables | `/donkey/donkeydbconf/mysql.xml` |
| HL7 Parsing | `/server/src/com/mirth/connect/plugins/datatypes/hl7v2/` |

---

## Implementation Order

1. **Foundation** (Database + Models) - Enables data layer
2. **JavaScript Runtime** (E4X + Executor) - Enables script execution
3. **HTTP Connector** - First working end-to-end flow
4. **Additional Connectors** - Expand protocol support
5. **Data Types** - HL7 parsing/serialization
6. **REST API** - Administrator compatibility
7. **Plugins** - Extended functionality

Each phase builds on the previous, with validation gates between phases.
