# Priority 4: Data Type Parsing Validation

This directory contains validation scenarios for testing data type parsing and serialization across different message formats.

## Overview

Priority 4 scenarios focus on validating that both Java Mirth and Node.js Mirth parse and serialize various healthcare data formats identically.

## Scenarios

| ID | Name | Description |
|----|------|-------------|
| 4.1 | HL7v2 Parsing | HL7v2 message parsing, segment access, field extraction, escape handling |
| 4.2 | XML Parsing | XML parsing with namespaces, XPath queries, attribute access, CDATA |
| 4.3 | JSON Parsing | JSON object/array access, nested structures, type handling |
| 4.4 | Delimited Data | CSV, pipe-delimited, tab-delimited parsing with quote handling |
| 4.5 | EDI/X12 | Healthcare EDI transactions (270/271, 837, 835) |

## Running Tests

```bash
# Run all Priority 4 tests
npm run validate -- --priority 4

# Run specific scenario
npm run validate -- --scenario 4.1
npm run validate -- --scenario 4.2

# Verbose output
npm run validate -- --priority 4 --verbose
```

## Test Structure

Each scenario follows this structure:

```
4.X-name/
├── config.json      # Test configuration and assertions
├── README.md        # Scenario documentation
└── inputs/          # Sample input files
    ├── file1.ext
    └── file2.ext
```

## Config.json Format

```json
{
  "id": "4.X",
  "name": "Scenario Name",
  "priority": 4,
  "type": "datatype",
  "dataType": "HL7V2|XML|JSON|DELIMITED|EDI/X12",
  "description": "What this scenario tests",
  "inputs": ["file1.ext", "file2.ext"],
  "tests": [
    {
      "name": "Test Name",
      "input": "file1.ext",
      "script": "msg['field'].toString()",
      "expected": "expected value"
    }
  ]
}
```

## Test Types

### Script-Based Tests
Execute JavaScript code against parsed message and compare output:
- `script`: JavaScript code to execute (msg variable is the parsed message)
- `expected`: Expected string result

### Config-Based Tests
Some tests may include data type configuration:
- `dataTypeConfig`: Configuration for the data type parser

## Data Type Comparison Points

| Data Type | Comparison Points |
|-----------|-------------------|
| HL7v2 | Segment access, field/component extraction, escaping |
| XML | Element access, attribute access, namespace handling, CDATA |
| JSON | Property access, array access, type handling |
| Delimited | Row/column access, quote handling, delimiters |
| EDI/X12 | Segment access, element access, loop navigation |

## Common Validation Patterns

### HL7v2
```javascript
msg['MSH']['MSH.9']['MSH.9.1'].toString()  // Message type
msg['PID']['PID.5']['PID.5.1'].toString()  // Patient name
msg['OBX'].length()                         // Segment count
```

### XML (E4X)
```javascript
msg.element.toString()        // Element text
msg.element.@attr.toString()  // Attribute value
msg.*::ns_element             // Namespaced element
```

### JSON
```javascript
msg.property              // Direct access
msg.array[0]              // Array access
msg.nested.deep.value     // Nested access
```

### Delimited
```javascript
msg.row[0].column1.toString()  // By index
msg.row[0].ColumnName          // By configured name
```

### EDI/X12
```javascript
msg['ISA']['ISA06'].toString()   // Element access
msg['NM1'][0]['NM103']           // Repeating segment
msg['SV1']['SV101-1']            // Component access
```

## Expected Results

Both engines should produce identical results for all test scripts. Any differences indicate a parsing or serialization gap that should be documented in `manifest.json` under `validationGaps`.
