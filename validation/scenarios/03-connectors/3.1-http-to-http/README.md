# Scenario 3.1: HTTP Listener to HTTP Sender

## Purpose

Validates the HTTP connector implementation by testing end-to-end HTTP message flow:
- HTTP Listener receives incoming POST requests
- Channel processes the message
- HTTP Sender forwards to downstream service
- Response is returned to original caller

## Flow Diagram

```
[Client] --POST--> [HTTP Listener:8082/8083] --> [Channel] --> [HTTP Sender] --POST--> [Mock Server:8084]
   ^                                                                                         |
   |                                                                                         v
   <--Response-----------------------------------------------------------<--Response---------
```

## Test Cases

### 3.1.1 JSON Payload
- Send JSON body via POST
- Verify JSON is received at mock destination
- Verify response JSON matches

### 3.1.2 XML Payload
- Send XML body via POST
- Verify Content-Type is preserved
- Verify response matches

### 3.1.3 Custom Headers
- Send request with custom X-* headers
- Verify headers are forwarded correctly

### 3.1.4 Error Response
- Mock destination returns 500 error
- Verify error handling matches between engines

## Input Files

- `inputs/json-payload.json` - Simple JSON test payload
- `inputs/xml-payload.xml` - Simple XML test payload

## Channel Configuration

The channel should:
1. Listen on configurable port (8082 for Java, 8083 for Node.js)
2. Accept POST requests on path `/api/message`
3. Forward to `http://localhost:8084/receive`
4. Return downstream response to caller

## Validation

Compare between Java and Node.js:
- HTTP response status code
- HTTP response body (normalize timestamps)
- HTTP response headers (excluding Date, Server)
