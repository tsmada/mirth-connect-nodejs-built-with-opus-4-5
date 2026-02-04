# Scenario 5.1: Response Transformers

## Purpose

Validates the response transformer functionality that allows modification of destination responses before they are returned to the source connector or used for response selection.

Response transformers are critical for:
- Adding custom fields to ACK messages
- Modifying response status based on destination results
- Enriching responses with data from the channel context
- Error handling and recovery in the response phase

## Flow Diagram

```
                                    Response Transformer
                                           |
                                           v
[Source] --> [Filter] --> [Transformer] --> [Destination] --> [Response] --> [Modified Response]
                                                |                                    |
                                                v                                    v
                                           [Send]                              [Return to Source]
```

## Test Cases

### 5.1.1 Response Map Variable Setting

**Objective**: Verify that variables set in responseMap ($r) are accessible and match between engines.

**Setup**:
```javascript
// Response transformer script
$r('processedAt', new Date().toISOString());
$r('destinationStatus', responseStatus);
$r('customData', { processed: true, version: '1.0' });
```

**Validation**:
- Compare $r('processedAt') format (allow timestamp variance)
- Compare $r('destinationStatus') exact match
- Compare $r('customData') structure and values

### 5.1.2 Response Status Modification

**Objective**: Verify that response transformers can modify the message status.

**Setup**:
```javascript
// Change FILTERED to SENT if certain condition met
if (responseStatus == FILTERED && $c('forceSuccess') == 'true') {
  responseStatus = SENT;
}
```

**Validation**:
- Message with forceSuccess=true should have SENT status
- Message without forceSuccess should retain FILTERED status
- Status changes match between engines

### 5.1.3 Response Content Transformation

**Objective**: Verify that response content can be modified in the response transformer.

**Setup**:
```javascript
// Add custom segment to ACK response
if (msg['MSH']['MSH.9']['MSH.9.1'].toString() == 'ACK') {
  msg['ZRT'] = <ZRT/>;
  msg['ZRT']['ZRT.1'] = 'Response Transformer Processed';
  msg['ZRT']['ZRT.2'] = channelId;
}
```

**Validation**:
- ACK contains ZRT segment
- ZRT.1 content matches
- ZRT.2 contains correct channel ID

### 5.1.4 Error Handling in Response Transformers

**Objective**: Verify error handling when response transformer throws an exception.

**Setup**:
```javascript
// Throw error on specific trigger
if (msg['MSH']['MSH.10'].toString() == 'TRIGGER_ERROR') {
  throw new Error('Intentional response transformer error');
}
```

**Validation**:
- Message status becomes ERROR
- Error message is captured
- Other messages process normally

## Input Files

### inputs/sample-adt.hl7
Standard ADT A01 message for normal processing tests.

### inputs/force-success.hl7
Message with forceSuccess flag for status modification test.

### inputs/trigger-error.hl7
Message with control ID that triggers error condition.

## Channel Configuration

The channel should include:

1. **Source Connector**: MLLP listener on configured port
2. **Source Transformer**: Set $c('forceSuccess') based on input
3. **Destination 1**: MLLP sender to mock destination
4. **Response Transformer**: Implements all test scenarios

```xml
<responseTransformer>
  <steps>
    <step>
      <type>JavaScript</type>
      <script><![CDATA[
        // Set response map variables
        $r('processedAt', new Date().toISOString());
        $r('destinationStatus', responseStatus.toString());

        // Modify status if needed
        if (responseStatus == FILTERED && $c('forceSuccess') == 'true') {
          responseStatus = SENT;
        }

        // Add custom segment to ACK
        // ... (E4X transformation)

        // Error handling test
        if (msg['MSH']['MSH.10'].toString() == 'TRIGGER_ERROR') {
          throw new Error('Intentional response transformer error');
        }
      ]]></script>
    </step>
  </steps>
</responseTransformer>
```

## Validation Process

1. Deploy channel to both Java and Node.js Mirth
2. Start mock MLLP server on port 6672
3. For each test case:
   a. Send appropriate input message
   b. Capture response from both engines
   c. Query message status from both engines
   d. Compare results

## Expected Differences

| Aspect | Java Mirth | Node.js Mirth | Handling |
|--------|------------|---------------|----------|
| Timestamp precision | Milliseconds | Milliseconds | Allow 100ms variance |
| Error stack traces | Java format | Node.js format | Compare message only |
| Thread context | Java thread | Async context | Ignore |
