# Connector Validation Scenarios (Priority 3)

These scenarios validate connector implementations by comparing behavior between Java Mirth and Node.js Mirth.

## Overview

| ID | Scenario | Source Connector | Destination Connector |
|----|----------|-----------------|----------------------|
| 3.1 | HTTP to HTTP | HTTP Listener | HTTP Sender |
| 3.2 | TCP to TCP | TCP Listener | TCP Sender |
| 3.3 | File to File | File Reader | File Writer |
| 3.4 | JDBC to JDBC | Database Reader | Database Writer |

## Test Strategy

Each scenario tests:
1. **Connection establishment** - Connector starts and listens/connects correctly
2. **Message reception** - Source connector receives input properly
3. **Message transmission** - Destination connector sends output correctly
4. **Response handling** - Any responses are handled appropriately
5. **Error scenarios** - Timeouts, disconnects, and failures behave consistently

## Port Allocation

To avoid conflicts between Java and Node.js engines:

| Connector | Java Mirth | Node.js Mirth | Mock Destination |
|-----------|------------|---------------|------------------|
| HTTP | 8082 | 8083 | 8084 |
| TCP | 6663 | 6664 | 6665 |
| MLLP | 6661 | 6662 | (N/A - tested in P1) |

## Prerequisites

### For HTTP Tests
- Mock HTTP server running on port 8084 to receive forwarded requests

### For TCP Tests
- Mock TCP server running on port 6665 to receive forwarded messages

### For File Tests
- Input/output directories created with appropriate permissions:
  ```bash
  mkdir -p /tmp/mirth-{java,node}-{in,out}
  chmod 777 /tmp/mirth-*
  ```

### For Database Tests
- MySQL database `mirth_validation` with source and destination tables:
  ```sql
  CREATE DATABASE IF NOT EXISTS mirth_validation;
  USE mirth_validation;

  CREATE TABLE validation_source (
    id INT PRIMARY KEY AUTO_INCREMENT,
    message_content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE validation_dest (
    id INT PRIMARY KEY AUTO_INCREMENT,
    source_id INT,
    processed_content TEXT,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

## Running Tests

```bash
cd validation
npm run validate -- --priority 3
npm run validate -- --scenario 3.1  # Run specific scenario
npm run validate -- --scenario 3.1 --verbose  # With debug output
```

## Validation Points

### HTTP (3.1)
- HTTP status codes match
- Response headers match (excluding timestamps)
- Response body content matches
- Content-Type handling is consistent

### TCP (3.2)
- Data received matches exactly
- Socket lifecycle events occur in same order
- Timeout behavior is consistent
- Binary data handling matches

### File (3.3)
- Output file content matches
- File naming pattern matches
- Processing order matches (when multiple files)
- Error file handling matches

### Database (3.4)
- Records written to destination match
- Column values match
- Transaction boundaries match
- NULL handling is consistent
