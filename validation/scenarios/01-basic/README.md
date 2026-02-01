# Basic Message Flow Scenarios (Priority 1)

These scenarios validate core message processing functionality.

## Test 1.1: MLLP to File

**Channel**: Simple Channel - MLLP to File.xml

**Flow**:
1. Receive HL7 message via MLLP
2. Generate ACK
3. Write message to file

**Validation Points**:
- ACK code matches (AA)
- ACK message structure matches
- File output content matches

## Test 1.2: MLLP to MLLP

**Channel**: MLLP to MLLP.xml

**Flow**:
1. Receive HL7 message via MLLP
2. Forward to destination MLLP
3. Return ACK

**Validation Points**:
- Source ACK matches
- Message forwarded correctly

## Test 1.3: HTTP Basic

**Flow**:
1. Receive message via HTTP POST
2. Process message
3. Return HTTP response

**Validation Points**:
- HTTP status code matches
- Response body matches
