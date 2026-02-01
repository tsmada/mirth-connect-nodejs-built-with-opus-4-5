# Mirth Connect Node.js Engine - TODO Tracker

## Current Status
- **Tests**: 811 passing (44 test suites)
- **Phases 1-6**: Implemented
- **Phase 7 (Plugins)**: Pending

---

## Critical TODOs (Blocks Core Functionality)

### Server Lifecycle (`src/server/Mirth.ts`)
- [ ] **Line 71**: Load channels from database on startup
- [ ] **Line 72**: Start enabled channels on startup
- [ ] **Line 87**: Stop all running channels on shutdown

### Donkey Engine (`src/donkey/Donkey.ts`)
- [ ] **Line 25**: Initialize message persistence
- [ ] **Line 26**: Load channel configurations
- [ ] **Line 27**: Initialize JavaScript runtime

### Destination Connectors (`src/donkey/channel/ChannelBuilder.ts`)
- [ ] **Lines 37-43**: Build destination connectors (code commented out)

---

## High Priority TODOs

### Database Receiver (`src/connectors/jdbc/DatabaseReceiver.ts`)
- [ ] **Line 291**: Implement script mode execution (throws error)

### Code Templates (`src/controllers/ChannelController.ts`)
- [ ] **Line 241**: Implement code template library retrieval

### Data Pruner (`src/plugins/datapruner/DataPrunerController.ts`)
- [ ] **Line 91**: Load configuration from CONFIGURATION table
- [ ] **Line 98**: Save configuration to CONFIGURATION table

### Password Authentication (`src/api/middleware/auth.ts`)
- [ ] **Line 151**: Replicate exact Digester algorithm from mirth-commons
- [ ] **Line 161**: Remove development bypass (accepts "admin" password)

---

## Medium Priority TODOs

### JSON Data Type (`src/datatypes/json/JSONDataType.ts`)
- [ ] **Lines 81-84**: Implement JSON-to-XML conversion (returns null)
- [ ] **Lines 88-91**: Implement XML-to-JSON conversion (returns null)

### Message Processing (`src/donkey/channel/Channel.ts`)
- [ ] **Line 247**: Get dataType from source connector config (hardcoded to 'RAW')

---

## Pending Components (from manifest.json)

### API
- [ ] **Messages API**: Message search and retrieval API
  - Java source: `MessageServletInterface.java`

### Plugins
- [ ] **Code Templates**: Code templates library plugin
- [ ] **Data Pruner**: Message pruning plugin
- [ ] **XSLT**: XSLT transformer plugin

---

## Missing Java Features to Port

### From Java Codebase Analysis

#### JavaScript Runtime
- [ ] Global sealed script generation (`JavaScriptBuilder.generateGlobalSealedScript()`)
- [ ] Compiled script caching strategy
- [ ] Thread pool executor for script execution
- [ ] Context factory management

#### Message Pipeline
- [ ] Response transformer execution
- [ ] Response selection/aggregation across destinations
- [ ] Batch processing support (BatchAdaptor)
- [ ] Attachment extraction scripts

#### Connectors (Not Implemented)
- [ ] SMTP connector
- [ ] JMS connector
- [ ] WebSocket connector
- [ ] VM (inter-channel) connector
- [ ] JavaScript connector
- [ ] DIMSE (DICOM) connector
- [ ] Document connector

#### Data Layer
- [ ] Statistics updater thread
- [ ] Source queue management
- [ ] Message recovery on restart

---

## Validation Gaps

None discovered yet (validation suite infrastructure ready).

---

## Test Coverage Gaps

### API Tests Needed
- [ ] UserServlet tests
- [ ] ChannelServlet tests
- [ ] ChannelStatusServlet tests
- [ ] EngineServlet tests
- [ ] ConfigurationServlet tests

### Integration Tests Needed
- [ ] End-to-end message flow test
- [ ] MLLP integration test
- [ ] HTTP connector integration test
- [ ] File connector integration test

---

## Notes

### Priority Order for Implementation
1. Server lifecycle (load/start channels) - enables basic operation
2. Destination connector building - enables message routing
3. Password authentication fix - security requirement
4. Messages API - enables monitoring/debugging
5. JSON/XML conversion - common data transformation

### Java Reference Files
- `~/Projects/connect/server/src/` - Server components
- `~/Projects/connect/donkey/src/` - Donkey engine
- `~/Projects/connect/server/dbconf/mysql/mysql-database.sql` - Schema
