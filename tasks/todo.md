# Mirth Connect Node.js Engine - TODO Tracker

## Current Status
- **Tests**: 816 passing (44 test suites)
- **Phases 1-6**: Implemented
- **Phase 7 (Plugins)**: Pending

---

## Completed TODOs

### Server Lifecycle (`src/server/Mirth.ts`) ✅
- [x] **Line 71**: Load channels from database on startup
- [x] **Line 72**: Start enabled channels on startup
- [x] **Line 87**: Stop all running channels on shutdown

### Donkey Engine (`src/donkey/Donkey.ts`) ✅
- [x] **Line 25**: Initialize JavaScript runtime

### Destination Connectors (`src/donkey/channel/ChannelBuilder.ts`) ✅
- [x] **Lines 37-43**: Build destination connectors (TCP, HTTP, File, Database)

### Password Authentication (`src/api/middleware/auth.ts`) ✅
- [x] **Line 151**: Fixed password hashing to match Mirth's SHA256 algorithm
- [x] **Line 161**: Removed development bypass

### Database Receiver (`src/connectors/jdbc/DatabaseReceiver.ts`) ✅
- [x] **Line 291**: Implemented script mode execution

### JSON Data Type (`src/datatypes/json/JSONDataType.ts`) ✅
- [x] **Lines 81-84**: Implemented toXML() conversion
- [x] **Lines 88-91**: Implemented fromXML() conversion

---

## Remaining TODOs

### Data Pruner (`src/plugins/datapruner/DataPrunerController.ts`)
- [ ] **Line 91**: Load configuration from CONFIGURATION table
- [ ] **Line 98**: Save configuration to CONFIGURATION table

### Code Templates (`src/controllers/ChannelController.ts`)
- [ ] **Line 241**: Implement code template library retrieval

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

### Connectors (Not Implemented)
- [ ] SMTP connector
- [ ] JMS connector
- [ ] WebSocket connector
- [ ] VM (inter-channel) connector
- [ ] JavaScript connector
- [ ] DIMSE (DICOM) connector
- [ ] Document connector
- [ ] Channel Writer (inter-channel routing)

### Data Layer
- [ ] Statistics updater thread
- [ ] Source queue management
- [ ] Message recovery on restart

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

### Completed in This Session
1. Server lifecycle - channels now load/start on startup
2. Destination connectors - TCP, HTTP, File, Database supported
3. Password authentication - matches Mirth's SHA256 algorithm
4. Database Receiver script mode - JavaScript execution enabled
5. JSON/XML conversion - bidirectional conversion implemented

### Priority Order for Next Implementation
1. Messages API - enables monitoring/debugging
2. Channel Writer connector - enables inter-channel routing
3. Data Pruner persistence - configuration management
4. Code template library retrieval

### Java Reference Files
- `~/Projects/connect/server/src/` - Server components
- `~/Projects/connect/donkey/src/` - Donkey engine
- `~/Projects/connect/server/dbconf/mysql/mysql-database.sql` - Schema
