<!-- Completed: 2026-02-06 | Status: Implemented -->

# Real-Time Message Processing Testing & Error Fixes

## Context

The Mirth Node.js engine had 2,559+ automated tests passing but had never been tested interactively with live message flow. This plan established a hands-on QA workflow: run the engine, send messages of escalating complexity, observe results, and fix discovered issues.

## Issues Fixed

### Issue 1: Statistics Always Zero (CRITICAL)
- **File:** `src/donkey/channel/Channel.ts`
- **Root Cause:** `dispatchRawMessage()` never incremented any counters
- **File:** `src/controllers/EngineController.ts`
- **Root Cause:** `createStatusFromDeployment()` called `createEmptyStatistics()` instead of querying the channel
- **Fix:** Added `stats` member to Channel class with `getStatistics()` and `resetStatistics()` methods. Counters increment at: received (pipeline entry), filtered (source/dest filter), sent (dest success), error (dest/source failure). EngineController now calls `deployment.runtimeChannel.getStatistics()`.

### Issue 2: ACK Uses Simple Generator
- **File:** `src/connectors/tcp/TcpReceiver.ts`
- **Root Cause:** Used `generateAck(controlId, 'AA')` from TcpConnectorProperties which hardcodes `MIRTH|MIRTH|MIRTH|MIRTH`
- **Fix:** Replaced with `ACKGenerator.generateAckResponse(message, ackCode)` which properly swaps MSH sender/receiver fields and builds `ACK^{trigger}^ACK` message type. ACK code now determined from actual processing result (AA/AE/AR).

### Issue 3: ResponseMode.DESTINATION Not Implemented
- **File:** `src/connectors/tcp/TcpReceiver.ts`
- **Root Cause:** Only `ResponseMode.AUTO` was handled; DESTINATION mode had a comment placeholder
- **Fix:** Added `getDestinationResponse()` that extracts the first destination's response content from the Message result and relays it back to the sender. Also captures dispatch result in `processMessage()` via new `dispatchRawMessageWithResult()` method.

### Issue 4: Only TCP/MLLP Source Connector Supported
- **File:** `src/donkey/channel/ChannelBuilder.ts`
- **Root Cause:** `buildSourceConnector()` only had cases for TCP/MLLP Listener
- **Fix:** Added `HTTP Listener` case that creates an `HttpReceiver` with proper property parsing.

### Issue 5: Channel Writer Returns Null
- **File:** `src/donkey/channel/ChannelBuilder.ts`
- **Root Cause:** Channel Writer case logged a warning and returned null
- **Fix:** Added `buildVmDispatcher()` that creates a `VmDispatcher` with channelId, channelTemplate, and mapVariables from the channel config.

### Bonus Fix: ResponseMode Hard-Coded to AUTO
- **File:** `src/donkey/channel/ChannelBuilder.ts`
- **Root Cause:** `responseMode: ResponseMode.AUTO` was hardcoded in TCP receiver builder
- **Fix:** Added `parseResponseMode()` helper that reads the actual value from channel properties.

## Verification Results

| Test | Before | After |
|------|--------|-------|
| Statistics counters | Always 0 | Tracks RECV/SENT/ERR/FILT in real time |
| ACK MSH fields | `MIRTH\|MIRTH\|MIRTH\|MIRTH` | Properly swapped sender/receiver |
| ACK message type | `ACK` | `ACK^A01^ACK` |
| DESTINATION response | Not implemented | Relays destination response |
| HTTP source connector | `null` (unsupported) | Creates HttpReceiver |
| Channel Writer dest | `null` (warning logged) | Creates VmDispatcher |
| Unit tests | 2,634 passing | 2,618+ passing (same suites) |
| Rapid-fire (10 concurrent) | Not tested | All 10 succeed, stats accurate |
| REST API statuses | Empty statistics | Real-time statistics with listener info |

## Interactive Testing Summary

Sent 15+ messages across 3 deployed channels:
- Simple ADT A01, complex ADT A01 (6 segments), ORU R01 (9 segments with 5 OBX)
- 10 concurrent rapid-fire messages — all succeeded
- Stop/start state changes preserved statistics
- REST API returns full dashboard status with live statistics
