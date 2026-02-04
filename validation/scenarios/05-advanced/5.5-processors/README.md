# Scenario 5.5: Preprocessor and Postprocessor

## Purpose

Validates the preprocessor, postprocessor, deploy script, and undeploy script functionality. These scripts run at specific points in the channel lifecycle and message processing flow, enabling advanced customization.

## Execution Order

```
CHANNEL DEPLOY:
  1. Deploy Script (once per deploy)

MESSAGE PROCESSING:
  2. Preprocessor (before each message)
  3. Source Filter
  4. Source Transformer
  5. Destination Processing
  6. Response Handling
  7. Postprocessor (after each message)

CHANNEL UNDEPLOY:
  8. Undeploy Script (once per undeploy)
```

## Test Cases

### 5.5.1 Preprocessor Message Modification

**Objective**: Verify preprocessor can modify raw message before processing.

**Setup**:
```javascript
// Preprocessor script
// Adds ZPP segment with preprocessing timestamp
var timestamp = DateUtil.getCurrentDate('yyyyMMddHHmmss');
message = message + '\r' + 'ZPP|' + timestamp + '|PREPROCESSED|1.0';
return message;
```

**Validation**:
- Message in channel contains ZPP segment
- ZPP.2 = 'PREPROCESSED'
- Timestamp is present in ZPP.1
- Original message content preserved

### 5.5.2 Postprocessor Logging/Cleanup

**Objective**: Verify postprocessor executes after message processing.

**Setup**:
```javascript
// Postprocessor script
var messageId = $('messageId');
var status = $('status');
var destinations = $('destinationStatuses');

// Log processing completion
logger.info('Message ' + messageId + ' completed with status: ' + status);

// Set postprocessor marker in globalChannelMap
$gc('lastProcessedMessage', {
  messageId: messageId,
  status: status,
  processedAt: new Date().toISOString()
});
```

**Validation**:
- Postprocessor executes after destinations complete
- globalChannelMap contains lastProcessedMessage
- Logged message appears in channel log
- Runs even if message errored (if configured)

### 5.5.3 Deploy Script Execution

**Objective**: Verify deploy script runs when channel is deployed/started.

**Setup**:
```javascript
// Deploy script
$g('channelDeployed_' + channelId, true);
$g('deployTime_' + channelId, new Date().toISOString());
$gc('connectionPool', {
  status: 'initialized',
  connections: 5
});

// Initialize channel-specific resources
logger.info('Channel ' + channelName + ' deployed at ' + new Date());
```

**Validation**:
- globalMap contains channelDeployed flag
- deployTime is set correctly
- connectionPool is initialized
- Deploy log message appears

### 5.5.4 Undeploy Script Execution

**Objective**: Verify undeploy script runs when channel is stopped/undeployed.

**Setup**:
```javascript
// Undeploy script
$g('channelDeployed_' + channelId, false);
$g('undeployTime_' + channelId, new Date().toISOString());

// Clean up resources
var pool = $gc('connectionPool');
if (pool) {
  pool.status = 'closed';
  logger.info('Connection pool closed for channel ' + channelName);
}
```

**Validation**:
- channelDeployed flag becomes false after undeploy
- undeployTime is set
- connectionPool status changes to 'closed'
- Cleanup log message appears

## Input Files

### inputs/processor-test-message.hl7
Standard ADT message for preprocessor/postprocessor testing.

### inputs/multi-message-batch.hl7
Multiple messages to test postprocessor runs for each.

## Channel Configuration

```xml
<channel>
  <deployScript><![CDATA[
    $g('channelDeployed_' + channelId, true);
    $g('deployTime_' + channelId, new Date().toISOString());
    logger.info('Channel deployed: ' + channelName);
  ]]></deployScript>

  <undeployScript><![CDATA[
    $g('channelDeployed_' + channelId, false);
    $g('undeployTime_' + channelId, new Date().toISOString());
    logger.info('Channel undeployed: ' + channelName);
  ]]></undeployScript>

  <preprocessor><![CDATA[
    var timestamp = DateUtil.getCurrentDate('yyyyMMddHHmmss');
    message = message + '\r' + 'ZPP|' + timestamp + '|PREPROCESSED|1.0';
    return message;
  ]]></preprocessor>

  <postprocessor><![CDATA[
    $gc('lastProcessedMessage', {
      messageId: $('messageId'),
      status: $('status'),
      processedAt: new Date().toISOString()
    });
  ]]></postprocessor>

  <sourceConnector>
    <type>MLLP Listener</type>
    <port>6687</port>
  </sourceConnector>

  <destinationConnector>
    <type>Channel Writer</type>
    <!-- Write to file for verification -->
  </destinationConnector>
</channel>
```

## Validation Process

### Deploy Script Test
1. Query globalMap for channel deployed flag (should be false or absent)
2. Deploy channel
3. Query globalMap again - flag should be true
4. Verify deployTime is set

### Preprocessor Test
1. Send test message via MLLP
2. Query raw message in channel
3. Verify ZPP segment is present
4. Compare between engines

### Postprocessor Test
1. Send test message
2. Wait for processing to complete
3. Query globalChannelMap for lastProcessedMessage
4. Verify values match expected
5. Compare between engines

### Undeploy Script Test
1. Send message to ensure channel is used
2. Undeploy channel
3. Query globalMap - deployed flag should be false
4. Verify undeployTime is set

## Script Context Variables

### Preprocessor Context
| Variable | Description |
|----------|-------------|
| `message` | Raw message string |
| `channelId` | Current channel ID |
| `sourceMap` | Source map (read-only at this stage) |

### Postprocessor Context
| Variable | Description |
|----------|-------------|
| `message` | Processed message object |
| `messageId` | Database message ID |
| `status` | Final message status |
| `response` | Response content |
| `responseStatus` | Response status code |
| `destinationStatuses` | Map of destination statuses |

### Deploy/Undeploy Context
| Variable | Description |
|----------|-------------|
| `channelId` | Channel being deployed/undeployed |
| `channelName` | Channel name |
| `logger` | Channel logger |
| `globalMap` | Global map access |
| `globalChannelMap` | Channel-specific global map |

## Expected Differences

| Aspect | Java Mirth | Node.js Mirth | Handling |
|--------|------------|---------------|----------|
| Timestamps | Java Date | JS Date | Allow 100ms variance |
| Logger output | Log4j format | Winston format | Compare message content |
| Script errors | Java exception | JS Error | Compare error message |
