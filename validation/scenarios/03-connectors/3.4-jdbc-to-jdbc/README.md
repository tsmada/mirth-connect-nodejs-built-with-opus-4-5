# Scenario 3.4: Database Reader to Database Writer

## Purpose

Validates the JDBC connector implementation:
- Database Reader polls for new/unprocessed records
- Channel processes each record as a message
- Database Writer inserts results to destination table
- Tests SQL execution, result set handling, and transactions

## Flow Diagram

```
[Source Table] --> [DB Reader] --> [Channel] --> [DB Writer] --> [Dest Table]
      |                                               |
      v                                               v
[Mark Processed]                              [INSERT/UPDATE]
```

## Database Setup

```sql
CREATE DATABASE IF NOT EXISTS mirth_validation;
USE mirth_validation;

-- Source table: Records to be processed
CREATE TABLE validation_source (
  id INT PRIMARY KEY AUTO_INCREMENT,
  message_content TEXT NOT NULL,
  message_type VARCHAR(50),
  priority INT DEFAULT 0,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Destination table: Processed results
CREATE TABLE validation_dest (
  id INT PRIMARY KEY AUTO_INCREMENT,
  source_id INT NOT NULL,
  processed_content TEXT NOT NULL,
  processing_engine VARCHAR(10),  -- 'java' or 'node'
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES validation_source(id)
);

-- Insert test data
INSERT INTO validation_source (message_content, message_type, priority) VALUES
  ('{"patient": "John Doe", "mrn": "12345"}', 'ADT', 1),
  ('{"patient": "Jane Smith", "mrn": "67890"}', 'ADT', 2),
  ('{"test": "CBC", "result": "normal"}', 'ORU', 1),
  (NULL, 'TEST', 0),  -- NULL handling test
  ('Special chars: <>''\"&', 'TEST', 0);
```

## Test Cases

### 3.4.1 Basic Record Processing
- Insert record in source table
- Verify record appears in destination table
- Verify source marked as processed

### 3.4.2 Multiple Records
- Insert multiple records
- Verify all processed correctly
- Verify processing order (by ID or priority)

### 3.4.3 NULL Value Handling
- Insert record with NULL column
- Verify NULL preserved in destination

### 3.4.4 Special Characters
- Insert record with SQL special chars
- Verify no SQL injection
- Verify content preserved

### 3.4.5 Transaction Rollback
- Simulate destination write failure
- Verify source not marked as processed

## Input Files

- `inputs/setup.sql` - Database setup script
- `inputs/test-data.sql` - Test data insertion
- `inputs/cleanup.sql` - Cleanup after tests

## Channel Configuration

### Database Reader

```xml
<sourceConnectorProperties>
  <driver>mysql</driver>
  <url>jdbc:mysql://localhost:3306/mirth_validation</url>
  <username>mirth</username>
  <password>mirth</password>
  <select>
    SELECT id, message_content, message_type, priority
    FROM validation_source
    WHERE processed = FALSE
    ORDER BY priority DESC, id ASC
    LIMIT 10
  </select>
  <update>
    UPDATE validation_source
    SET processed = TRUE
    WHERE id = ${id}
  </update>
</sourceConnectorProperties>
```

### Database Writer

```xml
<destinationConnectorProperties>
  <driver>mysql</driver>
  <url>jdbc:mysql://localhost:3306/mirth_validation</url>
  <username>mirth</username>
  <password>mirth</password>
  <query>
    INSERT INTO validation_dest (source_id, processed_content, processing_engine)
    VALUES (${id}, ${processed_content}, 'java')  -- or 'node'
  </query>
</destinationConnectorProperties>
```

## Validation

Compare between Java and Node.js:
- Same records appear in destination table
- Column values match exactly
- Processing order matches
- NULL values handled identically
- Transaction boundaries (all-or-nothing on batch)
- Error records handled identically
