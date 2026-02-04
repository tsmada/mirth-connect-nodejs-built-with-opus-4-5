# Scenario 5.3: Multi-Destination Flow

## Purpose

Validates channels with multiple destinations, testing parallel processing, destination filtering, response handling, and failure isolation. This is critical for fan-out integration patterns where a single source message must be delivered to multiple downstream systems.

## Architecture

```
                                ┌───────────────────┐
                                │   Mock Server 1   │
                                │   (Port 6681)     │
                                └───────────────────┘
                                        ▲
                                        │
┌─────────────┐     ┌─────────────┐     ├─────────────────────────┐
│   Client    │────▶│   Source    │─────┤                         │
│             │     │  (MLLP)     │     │                         ▼
└─────────────┘     └─────────────┘     │             ┌───────────────────┐
                                        │             │   Mock Server 2   │
                                        │             │   (Port 6682)     │
                                        │             └───────────────────┘
                                        │
                                        │
                                        │             ┌───────────────────┐
                                        └────────────▶│   Mock Server 3   │
                                                      │   (Port 6683)     │
                                                      └───────────────────┘
```

## Test Cases

### 5.3.1 Parallel Destination Processing

**Objective**: Verify all destinations receive messages when no filtering is applied.

**Setup**:
- Channel with 3 MLLP sender destinations
- No destination filters enabled
- Mock servers on ports 6681, 6682, 6683

**Validation**:
- All 3 mock servers receive the message
- Message content is identical at each destination
- Processing is concurrent (within timing tolerance)

### 5.3.2 Destination Filtering by Metadata

**Objective**: Verify destination filters route messages correctly.

**Setup**:
```javascript
// Destination 1 filter (Inpatients only)
return msg['PV1']['PV1.2'].toString() == 'I';

// Destination 2 filter (Outpatients only)
return msg['PV1']['PV1.2'].toString() == 'O';

// Destination 3 filter (Emergency only)
return msg['PV1']['PV1.2'].toString() == 'E';
```

**Test Messages**:
- `inpatient-message.hl7` with PV1.2 = 'I'
- `outpatient-message.hl7` with PV1.2 = 'O'
- `emergency-message.hl7` with PV1.2 = 'E'

**Validation**:
- Inpatient message only reaches Destination 1
- Outpatient message only reaches Destination 2
- Emergency message only reaches Destination 3

### 5.3.3 Response Aggregation

**Objective**: Verify response selection from multiple destinations.

**Setup**:
- Response selection mode: "First successful"
- All destinations configured to respond
- Mock servers return different ACK codes

**Validation**:
- Source receives response from first successful destination
- Response selection matches between engines
- All destination statuses are tracked correctly

### 5.3.4 One Destination Failure Isolation

**Objective**: Verify one destination failure doesn't affect others.

**Setup**:
- Mock server 2 configured to return NACK or timeout
- Mock servers 1 and 3 respond normally
- Channel configured with queue on error

**Validation**:
- Destinations 1 and 3 show SENT status
- Destination 2 shows ERROR or QUEUED status
- Overall message shows partial success
- Error is properly logged

## Input Files

### inputs/multi-dest-message.hl7
Standard ADT message for parallel processing tests.

### inputs/inpatient-message.hl7
ADT with PV1.2 = 'I' for inpatient filtering.

### inputs/outpatient-message.hl7
ADT with PV1.2 = 'O' for outpatient filtering.

### inputs/emergency-message.hl7
ADT with PV1.2 = 'E' for emergency filtering.

## Channel Configuration

```xml
<channel>
  <sourceConnector>
    <type>MLLP Listener</type>
    <port>6679</port> <!-- 6680 for Node.js -->
  </sourceConnector>

  <destinationConnectors>
    <connector>
      <name>Destination 1 - Inpatient System</name>
      <type>MLLP Sender</type>
      <host>localhost</host>
      <port>6681</port>
      <filter>
        <script>return msg['PV1']['PV1.2'].toString() == 'I' || $('sendToAll');</script>
      </filter>
    </connector>

    <connector>
      <name>Destination 2 - Outpatient System</name>
      <type>MLLP Sender</type>
      <host>localhost</host>
      <port>6682</port>
      <filter>
        <script>return msg['PV1']['PV1.2'].toString() == 'O' || $('sendToAll');</script>
      </filter>
    </connector>

    <connector>
      <name>Destination 3 - Emergency System</name>
      <type>MLLP Sender</type>
      <host>localhost</host>
      <port>6683</port>
      <filter>
        <script>return msg['PV1']['PV1.2'].toString() == 'E' || $('sendToAll');</script>
      </filter>
    </connector>
  </destinationConnectors>

  <responseSelection>FIRST_SUCCESSFUL</responseSelection>
</channel>
```

## Mock Server Setup

Three mock MLLP servers are required:

```javascript
// Mock server configuration
const servers = [
  { port: 6681, name: 'Inpatient', ackCode: 'AA' },
  { port: 6682, name: 'Outpatient', ackCode: 'AA' },  // Configure to fail for test 5.3.4
  { port: 6683, name: 'Emergency', ackCode: 'AA' }
];
```

## Validation Process

1. Start mock MLLP servers on ports 6681-6683
2. Deploy channel to both Java and Node.js
3. For each test:
   a. Configure mock servers as needed
   b. Send test message
   c. Collect received messages from mock servers
   d. Query message status from engines
   e. Compare results

## Response Selection Modes

| Mode | Description |
|------|-------------|
| FIRST_SUCCESSFUL | Return first destination response with SENT status |
| LAST_SUCCESSFUL | Return last destination response with SENT status |
| ALL | Aggregate all responses |
| SPECIFIC | Return from named destination |

## Known Considerations

### Timing of Parallel Execution
Parallel destinations may complete in different orders. Compare:
- Message arrival (should be within timing window)
- Final statuses (should all match)
- Do not compare exact ordering

### Failure Handling Modes
Different failure handling configurations affect behavior:
- **Queue on error**: Failed messages go to queue
- **Stop processing**: Stops subsequent destinations
- **Continue**: Marks as error, continues to other destinations
