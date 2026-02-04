# Scenario 5.2: Channel Routing

## Purpose

Validates VMRouter functionality for inter-channel message routing. This is essential for complex integration patterns where messages need to flow between multiple channels based on content or metadata.

Key components tested:
- **VMRouter**: Routes messages between channels programmatically
- **DestinationSet**: Controls which destinations receive a message
- **Channel chaining**: Multi-hop message flows

## Architecture

```
                        ┌─────────────────────────────────────────┐
                        │             VMRouter                     │
                        │  (Inter-channel message routing)         │
                        └─────────────────────────────────────────┘
                                          │
               ┌──────────────────────────┼──────────────────────────┐
               │                          │                          │
               ▼                          ▼                          ▼
    ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
    │  Source Channel │       │   Channel A     │       │   Channel B     │
    │   (Router)      │──────▶│  (VM Receiver)  │──────▶│  (VM Receiver)  │
    └─────────────────┘       └─────────────────┘       └─────────────────┘
```

## Test Cases

### 5.2.1 VMRouter.routeMessage() Basic Call

**Objective**: Verify basic message routing from one channel to another.

**Setup**:
```javascript
// In source channel transformer
var router = new VMRouter();
var result = router.routeMessage('dest-channel-a-id', msg);
```

**Validation**:
- Destination channel receives the message
- Message content matches original
- Routing status matches between engines

### 5.2.2 Channel Chaining

**Objective**: Verify multi-hop routing where each channel processes and forwards.

**Setup**:
- Source channel routes to Channel A
- Channel A transforms and routes to Channel B
- Channel B performs final processing

```javascript
// Channel A transformer
msg['ZCH'] = <ZCH/>;
msg['ZCH']['ZCH.1'] = 'Processed by Channel A';

// Route to Channel B
var router = new VMRouter();
router.routeMessage('dest-channel-b-id', msg);
```

**Validation**:
- Message arrives at Channel B
- Contains transformations from both channels
- Routing history matches

### 5.2.3 Destination Routing Filters

**Objective**: Verify destination filters work correctly.

**Setup**:
```javascript
// Source filter on destination
if (msg['MSH']['MSH.9']['MSH.9.2'].toString() == 'A01') {
  return true; // Route to this destination
}
return false;
```

**Validation**:
- A01 messages route to correct destination
- Other message types are filtered
- Filter decisions match between engines

### 5.2.4 DestinationSet Usage

**Objective**: Verify programmatic destination control.

**Setup**:
```javascript
// In source transformer
var destSet = $('destinationSet');
destSet.removeAll(); // Clear default destinations

// Add destinations based on message content
if (msg['PID']['PID.3']['PID.3.1'].toString().startsWith('A')) {
  destSet.add('Destination A');
}
if (msg['PID']['PID.3']['PID.3.1'].toString().startsWith('B')) {
  destSet.add('Destination B');
}
```

**Validation**:
- Messages route to correct destinations based on PID.3
- DestinationSet modifications take effect
- Behavior matches between engines

## Input Files

### inputs/routable-message.hl7
Base message for routing tests with configurable routing indicators.

### inputs/route-to-a.hl7
Message configured to route specifically to Channel A.

### inputs/route-to-b.hl7
Message configured to route specifically to Channel B.

### inputs/chain-message.hl7
Message for multi-hop chain routing test.

## Channel Configurations

### Source Channel (router-source-channel.xml)
- MLLP Listener on port 6673/6674
- Source Transformer with VMRouter logic
- VM Dispatcher destinations for Channel A and B

### Destination Channel A (router-dest-channel-a.xml)
- VM Receiver (no port, receives via VMRouter)
- Transformer adds ZCH.1 marker
- Optionally routes to Channel B

### Destination Channel B (router-dest-channel-b.xml)
- VM Receiver (no port, receives via VMRouter)
- Transformer adds ZCH.2 marker
- Final destination (no further routing)

## Deployment Order

1. Deploy destination channels first (they must exist for routing)
2. Deploy source channel last
3. Verify all channels are started

## Validation Process

1. Deploy all three channels to both engines
2. Send routing test messages to source channel
3. Query message history from destination channels
4. Compare:
   - Message arrived at correct destination
   - Message content matches
   - Routing metadata matches

## Known Challenges

### Channel ID Synchronization
The source channel references destination channels by ID. These IDs must match between Java and Node.js configurations.

**Solution**: Use consistent channel IDs or channel name lookup.

### Timing Dependencies
Destination channels must be deployed and started before routing messages.

**Solution**: Add deployment verification step before tests.

### Message ID Tracking
Tracking a message across multiple channels requires consistent ID handling.

**Solution**: Use a custom tracking ID in the message header.
