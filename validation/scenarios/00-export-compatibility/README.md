# Export Compatibility Scenarios (Priority 0)

These scenarios validate that channel export/import works identically between Java and Node.js Mirth Connect implementations.

## Test 0.1: Simple Channel Round-Trip

**Purpose**: Verify basic export/import cycle preserves channel structure

**Steps**:
1. Load golden artifact (channel XML)
2. Import to Java Mirth
3. Import to Node.js Mirth
4. Export from both engines
5. Compare exported XML

**Expected Result**: Exported channels should be structurally identical

**Key Validations**:
- Channel ID preserved
- Name preserved
- Revision incremented correctly
- Source connector configuration preserved
- Destination connectors preserved
- Scripts preserved

## Test 0.2: ExportData Handling

**Purpose**: Verify exportData is cleared before database save and populated on GET

**Expected Behavior**:
- Database CHANNEL.CHANNEL column should NOT contain exportData
- API GET response SHOULD contain exportData with metadata

## Test 0.3: Revision Management

**Purpose**: Verify revision numbers are handled correctly

**Expected Behavior**:
- Import should increment revision by 1
- Conflict detection should work when override=false

## Test 0.4: Metadata Separation

**Purpose**: Verify metadata is stored separately from channel XML

**Expected Behavior**:
- CHANNEL_METADATA table should have corresponding record
- Enabled status should be stored in metadata table
