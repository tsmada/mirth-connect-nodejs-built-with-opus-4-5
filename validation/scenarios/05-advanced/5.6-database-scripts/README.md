# Scenario 5.6: Database Interactions

## Purpose

Validates database operations from user scripts using the DatabaseConnection and DatabaseConnectionFactory classes. Database access from transformers is essential for message enrichment, validation, and audit logging.

## Prerequisites

### Database Setup

```sql
-- Create validation database
CREATE DATABASE IF NOT EXISTS mirth_validation;
USE mirth_validation;

-- Patient lookup table
CREATE TABLE patient_lookup (
  patient_id VARCHAR(50) PRIMARY KEY,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  dob DATE,
  mrn VARCHAR(50),
  ssn VARCHAR(11),
  insurance_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test data
INSERT INTO patient_lookup VALUES
  ('12345', 'John', 'Doe', '1980-01-15', 'MRN001', '123-45-6789', 'INS001', NOW()),
  ('67890', 'Jane', 'Smith', '1975-06-20', 'MRN002', '987-65-4321', 'INS002', NOW()),
  ('11111', 'Bob', 'Johnson', '1990-03-10', 'MRN003', '555-55-5555', 'INS003', NOW());

-- Message audit table
CREATE TABLE message_audit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(100),
  channel_id VARCHAR(100),
  patient_id VARCHAR(50),
  message_type VARCHAR(20),
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20)
);

-- Grant access
GRANT ALL PRIVILEGES ON mirth_validation.* TO 'mirth'@'localhost';
```

## Test Cases

### 5.6.1 DatabaseConnection Usage

**Objective**: Verify basic database query in transformer.

**Setup**:
```javascript
// Transformer script
var patientId = msg['PID']['PID.3']['PID.3.1'].toString();

var dbConn = DatabaseConnectionFactory.createDatabaseConnection(
  'com.mysql.cj.jdbc.Driver',
  'jdbc:mysql://localhost:3306/mirth_validation',
  'mirth',
  'password'
);

try {
  var result = dbConn.executeCachedQuery(
    'SELECT * FROM patient_lookup WHERE patient_id = ?',
    [patientId]
  );

  if (result.next()) {
    msg['PID']['PID.5']['PID.5.1'] = result.getString('last_name');
    msg['PID']['PID.5']['PID.5.2'] = result.getString('first_name');
    msg['PID']['PID.7'] = result.getString('dob');
  }
} finally {
  dbConn.close();
}
```

**Validation**:
- Query executes successfully
- Patient data is retrieved
- Message is enriched with database values
- Results match between engines

### 5.6.2 Query Result Handling

**Objective**: Verify result set iteration and column access.

**Setup**:
```javascript
// Query returning multiple rows
var results = dbConn.executeCachedQuery('SELECT * FROM patient_lookup');
var patients = [];

while (results.next()) {
  patients.push({
    id: results.getString('patient_id'),
    name: results.getString('first_name') + ' ' + results.getString('last_name'),
    dob: results.getDate('dob'),
    mrn: results.getString('mrn')
  });
}

$c('patientList', JSON.stringify(patients));
```

**Validation**:
- All rows are retrieved
- Column types are handled correctly (String, Date)
- Data matches database content
- Results match between engines

### 5.6.3 Insert and Update Operations

**Objective**: Verify write operations to database.

**Setup**:
```javascript
// Insert audit record
var messageId = $('messageId');
var channelId = $('channelId');
var patientId = msg['PID']['PID.3']['PID.3.1'].toString();
var messageType = msg['MSH']['MSH.9']['MSH.9.1'].toString();

var dbConn = DatabaseConnectionFactory.createDatabaseConnection(/* ... */);

try {
  dbConn.executeUpdate(
    'INSERT INTO message_audit (message_id, channel_id, patient_id, message_type, status) VALUES (?, ?, ?, ?, ?)',
    [messageId, channelId, patientId, messageType, 'PROCESSED']
  );
} finally {
  dbConn.close();
}
```

**Validation**:
- Record is inserted in database
- All columns have correct values
- Timestamp is set automatically
- Insert works identically on both engines

### 5.6.4 Connection Pooling

**Objective**: Verify connection reuse via pooling.

**Setup**:
- Create connection pool in deploy script
- Use pool in transformer
- Release connections properly

```javascript
// Deploy script
$gc('dbPool', DatabaseConnectionFactory.createConnectionPool({
  driver: 'com.mysql.cj.jdbc.Driver',
  url: 'jdbc:mysql://localhost:3306/mirth_validation',
  username: 'mirth',
  password: 'password',
  maxConnections: 10,
  minConnections: 2
}));

// Transformer
var pool = $gc('dbPool');
var conn = pool.getConnection();
try {
  // Use connection
} finally {
  pool.releaseConnection(conn);
}
```

**Validation**:
- Connections are reused
- Pool size stays within limits
- No connection leaks
- Pool metrics match between engines

## Input Files

### inputs/db-lookup-message.hl7
Message with patient ID that exists in lookup table.

### inputs/unknown-patient-message.hl7
Message with patient ID not in database.

### inputs/batch-messages.hl7
Multiple messages for connection pooling test.

## Channel Configuration

```xml
<channel>
  <deployScript><![CDATA[
    // Initialize connection pool
    $gc('dbPool', DatabaseConnectionFactory.createConnectionPool({
      driver: 'com.mysql.cj.jdbc.Driver',
      url: 'jdbc:mysql://localhost:3306/mirth_validation',
      username: 'mirth',
      password: 'mirth_password',
      maxConnections: 10
    }));
  ]]></deployScript>

  <undeployScript><![CDATA[
    // Close connection pool
    var pool = $gc('dbPool');
    if (pool) {
      pool.close();
    }
  ]]></undeployScript>

  <sourceConnector>
    <type>MLLP Listener</type>
    <port>6689</port>
  </sourceConnector>

  <sourceTransformer>
    <script><![CDATA[
      // Patient lookup and enrichment
      var patientId = msg['PID']['PID.3']['PID.3.1'].toString();
      var pool = $gc('dbPool');
      var conn = pool.getConnection();

      try {
        var result = conn.executeCachedQuery(
          'SELECT * FROM patient_lookup WHERE patient_id = ?',
          [patientId]
        );

        if (result.next()) {
          msg['PID']['PID.5']['PID.5.1'] = result.getString('last_name');
          msg['PID']['PID.5']['PID.5.2'] = result.getString('first_name');
          $c('patientFound', 'true');
        } else {
          $c('patientFound', 'false');
        }
      } finally {
        pool.releaseConnection(conn);
      }
    ]]></script>
  </sourceTransformer>

  <destinationConnector>
    <type>Channel Writer</type>
  </destinationConnector>
</channel>
```

## Database Driver Configuration

Both Java and Node.js Mirth need MySQL driver configured:

### Java Mirth
- Place `mysql-connector-java-X.X.X.jar` in custom-lib
- Driver class: `com.mysql.cj.jdbc.Driver`

### Node.js Mirth
- Uses `mysql2` npm package
- Connection string: `mysql://user:pass@host:port/database`

## Validation Process

1. Set up database with test data
2. Deploy channel to both engines
3. Send test messages
4. Compare:
   - Enriched message content
   - Database audit records
   - Connection pool metrics
5. Verify cleanup on undeploy

## Expected Differences

| Aspect | Java Mirth | Node.js Mirth | Handling |
|--------|------------|---------------|----------|
| Date format | Java Date | JS Date | Normalize to ISO |
| NULL handling | Java null | JS null/undefined | Treat as equivalent |
| Connection IDs | Integer | String | Ignore in comparison |
| Pool implementation | HikariCP | Generic pool | Compare behavior only |

## Troubleshooting

### Connection Refused
- Verify MySQL is running on port 3306
- Check credentials in channel config
- Verify database and tables exist

### Query Errors
- Check SQL syntax
- Verify parameter types match column types
- Check for proper escaping of special characters

### Connection Leaks
- Ensure connections are released in finally blocks
- Monitor pool size during tests
- Check undeploy script closes pool properly
