# Scenario 3.2: TCP Listener to TCP Sender

## Purpose

Validates raw TCP connector implementation without any protocol framing (unlike MLLP which adds start/end bytes):
- TCP Listener accepts socket connections
- Channel processes incoming data
- TCP Sender connects to downstream and sends data
- Tests socket lifecycle and data integrity

## Flow Diagram

```
[Client] --TCP--> [TCP Listener:6663/6664] --> [Channel] --> [TCP Sender] --TCP--> [Mock Server:6665]
   ^                                                                                       |
   |                                                                                       v
   <--Response---------------------------------------------------------<--Response---------
```

## Differences from MLLP (Priority 1)

| Aspect | MLLP | Raw TCP |
|--------|------|---------|
| Framing | 0x0B start, 0x1C 0x0D end | None |
| Message boundary | Frame delimiters | Stream-based |
| Typical use | HL7v2 messages | Generic data |

## Test Cases

### 3.2.1 Simple Text Message
- Send plain text over TCP
- Verify text arrives at mock destination unchanged
- Verify response is returned

### 3.2.2 Binary Data
- Send binary payload (non-UTF8)
- Verify byte-for-byte integrity

### 3.2.3 Large Message
- Send message larger than typical buffer size (>64KB)
- Verify complete message arrives

### 3.2.4 Connection Timeout
- Mock destination delays response
- Verify timeout behavior matches

## Input Files

- `inputs/raw-message.txt` - Simple text message
- `inputs/binary-data.bin` - Binary test data

## Channel Configuration

The channel should:
1. Listen on configurable TCP port (6663 for Java, 6664 for Node.js)
2. No frame mode (raw TCP)
3. Forward to `localhost:6665`
4. Return any response from downstream

## TCP Settings to Test

```xml
<transmissionModeProperties>
  <pluginPointName>Basic</pluginPointName>
  <startOfMessageBytes></startOfMessageBytes>
  <endOfMessageBytes></endOfMessageBytes>
</transmissionModeProperties>
```

## Validation

Compare between Java and Node.js:
- Exact bytes received at mock destination
- Connection establishment timing
- Socket close behavior
- Error response on connection failure
