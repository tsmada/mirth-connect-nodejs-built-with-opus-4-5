# Scenario 5.4: Error Handling Patterns

## Purpose

Validates error handling behavior across different stages of message processing. Correct error handling is critical for production reliability - errors must be captured, logged, and handled consistently between Java and Node.js implementations.

## Error Points in Message Flow

```
[Receive] → [Preprocess] → [Filter] → [Transform] → [Send] → [Response Transform]
    │            │            │            │           │              │
    ▼            ▼            ▼            ▼           ▼              ▼
  ERROR        ERROR       FILTERED      ERROR      ERROR/         ERROR
                                                    QUEUED
```

## Test Cases

### 5.4.1 Source Filter Rejection

**Objective**: Verify filter rejection behavior and status.

**Setup**:
```javascript
// Source filter script
if (msg['MSH']['MSH.9']['MSH.9.1'].toString() == 'BAD') {
  return false; // Reject message
}
return true;
```

**Test Messages**:
- `filter-reject.hl7` with MSH.9.1 = 'BAD'
- `filter-accept.hl7` with MSH.9.1 = 'ADT'

**Validation**:
- Rejected message has status FILTERED
- Accepted message processes normally
- NACK is returned for rejected (if configured)
- Behavior matches between engines

### 5.4.2 Transformer Errors

**Objective**: Verify error handling when transformer throws exception.

**Setup**:
```javascript
// Transformer script
if (msg['PID']['PID.3']['PID.3.1'].toString() == 'ERROR') {
  throw new Error('Invalid patient ID: ERROR is not allowed');
}

// Normal processing
var patientId = msg['PID']['PID.3']['PID.3.1'].toString();
```

**Test Messages**:
- `transformer-error.hl7` with PID.3.1 = 'ERROR'
- `transformer-success.hl7` with valid PID

**Validation**:
- Error message has status ERROR
- Error text contains "Invalid patient ID"
- Error is logged to events
- Stack trace format (Java vs Node.js) is acceptable difference

### 5.4.3 Destination Connection Failures

**Objective**: Verify handling of unreachable destinations.

**Setup**:
- Destination configured to connect to port 6686
- No server listening on port 6686
- Configure timeout to 5 seconds

**Validation**:
- Message shows connection error
- Status is ERROR or QUEUED (based on config)
- Error message indicates connection refused
- Retry behavior matches configuration

### 5.4.4 Queue Behavior on Error

**Objective**: Verify queuing mechanism for failed messages.

**Setup**:
- Destination to unreachable server
- Queue enabled: `queueOnError = true`
- Retry count: 3
- Retry interval: 5 seconds

**Validation**:
- Message enters queue after first failure
- Queue count increases
- Retry attempts are made
- After max retries, message becomes ERROR

## Input Files

### inputs/error-trigger-message.hl7
Base message for testing various error scenarios.

### inputs/filter-reject.hl7
Message with MSH.9.1 = 'BAD' to trigger filter rejection.

### inputs/transformer-error.hl7
Message with PID.3.1 = 'ERROR' to trigger transformer exception.

### inputs/valid-message.hl7
Normal message that should process successfully.

## Channel Configuration

```xml
<channel>
  <sourceConnector>
    <type>MLLP Listener</type>
    <port>6684</port>
    <processingSettings>
      <responseOnError>NACK</responseOnError>
    </processingSettings>
  </sourceConnector>

  <sourceFilter>
    <script><![CDATA[
      if (msg['MSH']['MSH.9']['MSH.9.1'].toString() == 'BAD') {
        return false;
      }
      return true;
    ]]></script>
  </sourceFilter>

  <sourceTransformer>
    <script><![CDATA[
      if (msg['PID']['PID.3']['PID.3.1'].toString() == 'ERROR') {
        throw new Error('Invalid patient ID: ERROR is not allowed');
      }
    ]]></script>
  </sourceTransformer>

  <destinationConnector>
    <type>MLLP Sender</type>
    <host>localhost</host>
    <port>6686</port>
    <queueEnabled>true</queueEnabled>
    <retryCount>3</retryCount>
    <retryInterval>5000</retryInterval>
    <queueOnError>true</queueOnError>
  </destinationConnector>
</channel>
```

## Error Status Codes

| Status | Meaning | When Applied |
|--------|---------|--------------|
| RECEIVED | Initial receipt | Before any processing |
| FILTERED | Rejected by filter | Source or destination filter returns false |
| ERROR | Processing failed | Exception in script or connection failure |
| QUEUED | Awaiting retry | Connection failed with queue enabled |
| PENDING | In queue | Message is queued for destination |

## Validation Process

1. Deploy error handling channel
2. For filter test:
   - Send reject message, verify FILTERED status
   - Send accept message, verify normal processing
3. For transformer test:
   - Send error-trigger message, verify ERROR status
   - Query event log for error details
4. For connection test:
   - Send message to unreachable destination
   - Verify queuing/error behavior
5. Compare all results between engines

## Expected Differences

| Aspect | Java Mirth | Node.js Mirth | Handling |
|--------|------------|---------------|----------|
| Stack traces | Java format | JS format | Compare error message only |
| Error timestamps | Java format | ISO format | Normalize before compare |
| Queue implementation | JMS-based | In-memory | Compare queue counts only |

## Error Event Logging

Both engines should log errors to the event system:

```javascript
// Expected event structure
{
  level: 'ERROR',
  channelId: 'xxx-xxx-xxx',
  messageId: 12345,
  errorMessage: 'Invalid patient ID: ERROR is not allowed',
  timestamp: '2024-01-15T14:30:00Z'
}
```

Compare:
- Error level matches
- Error message contains key text
- Channel and message IDs are correct
