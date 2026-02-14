<!-- Completed: 2026-02-14 | Status: Implemented -->

# Kitchen Sink Integration Test

## Context

The Node.js Mirth port has 5,109 passing unit tests across 19 waves of development, but lacks a single end-to-end integration test that exercises **every** connector type, data type, script context, cross-channel routing, and map propagation together. Existing validation scenarios test individual features in isolation (P0-P7). This "kitchen sink" test creates a **network of interconnected channels** that proves the entire engine works as an integrated system — exercising all 11 connector types.

## Architecture: Channel Network

**13 channels** in 4 tiers, connected via VM connectors. 3 external entry points (MLLP, HTTP, File) feed through a central hub router to persistence, audit, and completion layers. Protocol loopback pairs (SOAP, DICOM, JMS) and an embedded mock SMTP server exercise every connector type without external dependencies.

```
  TIER 1: INGEST                    TIER 2: ROUTING              TIER 3: PROCESSING         TIER 4: OUTPUT
  ═══════════════                   ═══════════════              ══════════════════         ══════════════

  HL7 ADT ──► CH1: MLLP Rx ─────┐
               (HL7v2, 4 dests)  │                               CH5: DB Writer ──┐        CH7: Audit Logger
               filter: ADT only  │ VM                             (JDBC INSERT)    │ VM      (File append)
               SMTP Dest4 ──►mock│                                                 └──────►
                                 ├──► CH4: Hub Router ──────────► CH6: Response
  JSON ─────► CH2: HTTP GW ─────┤    (VM Rx, 6 dests)            Builder (VM Rx)           CH8: Completer
               (JSON, 2 dests)   │    filter: route by type                                  (HTTP Rx, $g)
                                 │    ├──► VM to CH5 (non-FILE)
  CSV ──────► CH3: File Proc ────┘    ├──► VM to CH6 (all)        CH9: SOAP Endpoint ◄────── CH4.D4 WS Disp
               (Delimited, 2 dests)   ├──► VM to CH7 (all)         (WebServiceRx :8092)
                                      ├──► WS Disp to CH9        CH10: DICOM SCP ◄────────── CH4.D5 DICOM Disp
  JS poll ──► CH12: JS Generator      ├──► DICOM Disp to CH10      (DicomRx :11112)
               (JavaScriptRx)         └──► JMS Disp to queue      CH11: JMS Consumer ◄────── CH4.D6 JMS Disp
               └──► VM to CH7                                      (JmsRx from "ks-q")
```

### Port Allocation

| Port | Channel | Protocol |
|------|---------|----------|
| 6670 | CH1 ADT Receiver | MLLP |
| 8090 | CH2 HTTP Gateway | HTTP |
| 8091 | CH8 Completer | HTTP |
| 8092 | CH9 SOAP Endpoint | HTTP/SOAP |
| 11112 | CH10 DICOM SCP | DICOM/DIMSE |
| 2525 | Mock SMTP Server | SMTP (in-process) |
| 61613 | RabbitMQ STOMP | STOMP (Docker, optional) |

File paths: `/tmp/mirth-ks/{input,output,audit}`

### Channel IDs (deterministic)

```
CH1:  ks000001-0001-0001-0001-000000000001  (ADT Receiver)
CH2:  ks000002-0002-0002-0002-000000000002  (HTTP Gateway)
CH3:  ks000003-0003-0003-0003-000000000003  (File Processor)
CH4:  ks000004-0004-0004-0004-000000000004  (Hub Router)
CH5:  ks000005-0005-0005-0005-000000000005  (DB Persistence)
CH6:  ks000006-0006-0006-0006-000000000006  (Response Builder)
CH7:  ks000007-0007-0007-0007-000000000007  (Audit Logger)
CH8:  ks000008-0008-0008-0008-000000000008  (Completion Handler)
CH9:  ks000009-0009-0009-0009-000000000009  (SOAP Endpoint)
CH10: ks000010-0010-0010-0010-000000000010  (DICOM SCP)
CH11: ks000011-0011-0011-0011-000000000011  (JMS Consumer)
CH12: ks000012-0012-0012-0012-000000000012  (JS Generator)
CH13: — (reserved, unused)
```

---

## Channel Specifications

### Tier 1: Ingest Layer

#### CH1: ADT Receiver (MLLP → HL7v2 → 4 destinations)

- **Source**: TCP Listener, MLLP framing, port 6670
- **Source Filter**: JavaScriptRule — accept only ADT: `msg['MSH']['MSH.9']['MSH.9.1'].toString() == 'ADT'`
- **Source Transformer Step 1**: JavaScriptStep — extract patient ID/name, call `normalizePatientName()`, set `$c('patientId')`, `$c('patientName')`, `$c('sourceType', 'MLLP')`, increment `$gc('totalReceived')`
- **Source Transformer Step 2**: Mapper — `patientGender` from `msg['PID']['PID.8'].toString()`
- **Dest1** (VM Writer → CH4): template `${message.encodedData}`
- **Dest2** (JDBC Writer): `INSERT INTO ks_messages (patient_id, source_type, data) VALUES (?, ?, ?)`
- **Dest2 Response Transformer**: `$c('dbInsertOk', 'true')`
- **Dest3** (VM Writer → CH7): audit entry
- **Dest4** (SMTP Sender): to mock SMTP on localhost:2525 — from `mirth@test.local`, to `audit@test.local`, subject `ADT: ${patientId}`, body `${message.encodedData}`
- **Deploy**: `$gc('totalReceived', 0);`
- **Undeploy**: `$g('ch1UndeployedAt', new Date().toISOString());`
- **Preprocessor**: `$c('preprocessorRan', 'true'); return message;`
- **Postprocessor**: `$c('postprocessorRan', 'true'); return new Response(SENT, 'processed');`
- **Data types**: HL7V2 in → HL7V2 out

#### CH2: HTTP API Gateway (HTTP → JSON → 2 destinations)

- **Source**: HTTP Listener, port 8090, path `/api/patient`, responseContentType `application/json`
- **Source Filter**: JavaScriptRule — `var body = JSON.parse(connectorMessage.getRawData()); return !!(body.name && body.name.family);`
- **Source Transformer**: JavaScriptStep — parse JSON, set `$c('patientId')`, `$c('patientName')`, `$c('sourceType', 'HTTP')`
- **Dest1** (VM Writer → CH4): template `${message.encodedData}`
- **Dest2** (HTTP Sender → CH8): POST to `http://localhost:8091/complete`
- **Data types**: Raw in → Raw out

#### CH3: File Batch Processor (File → Delimited → 2 destinations)

- **Source**: File Reader, path `/tmp/mirth-ks/input`, filter `*.csv`, poll 1000ms, after-process DELETE
- **Source Transformer**: JavaScriptStep — extract CSV columns, set `$c('patientId')`, `$c('sourceType', 'FILE')`
- **Dest1** (VM Writer → CH4): template `${message.encodedData}`
- **Dest2** (File Writer): path `/tmp/mirth-ks/output`, fileName `processed.xml`
- **Data types**: Delimited in (comma, first row headers) → Raw out

#### CH12: JavaScript Generator (JS Rx → VM → CH7)

- **Source**: JavaScript Reader, poll interval 60000ms (one-shot — generates 1 message at deploy, then idles)
- **Source Script**: `return '<jsGenerated><source>JAVASCRIPT</source><id>JS001</id><timestamp>' + new Date().toISOString() + '</timestamp></jsGenerated>';`
- **Source Transformer**: JavaScriptStep — `$c('patientId', 'JS001'); $c('sourceType', 'JAVASCRIPT');`
- **Dest1** (VM Writer → CH7): audit entry
- **Data types**: Raw in → Raw out

### Tier 2: Routing Layer

#### CH4: Hub Router (VM Rx → 6 destinations with filtering)

- **Source**: Channel Reader (VM Receiver)
- **Source Transformer**: JavaScriptStep — verify `$s('sourceChannelId')` exists, set `$c('routedFrom')`, increment `$gc('hubRouteCount')`
- **Dest1** (VM Writer → CH5): **dest filter** `$c('sourceType') != 'FILE'` — only MLLP/HTTP to DB
- **Dest2** (VM Writer → CH6): no filter — all messages
- **Dest3** (VM Writer → CH7): no filter — all to audit
- **Dest4** (WebService Dispatcher → CH9): SOAP POST to `http://localhost:8092/ws/patient`, SOAP 1.1 envelope wrapping `${message.encodedData}`
- **Dest5** (DICOM Dispatcher → CH10): C-STORE to `localhost:11112`, AE title `MIRTH_SCU`, template wraps message as minimal DICOM dataset
- **Dest6** (JMS Dispatcher → queue `ks-test`): STOMP to `localhost:61613`, template `${message.encodedData}` *(skipped if broker unavailable)*
- **Data types**: Raw in → Raw out

### Tier 3: Processing Layer

#### CH5: DB Persistence (VM Rx → JDBC)

- **Source**: Channel Reader
- **Dest1** (JDBC Writer): `INSERT INTO ks_audit_log (patient_id, source_type, routed_from) VALUES (?, ?, ?)`
- **Dest1 Response Transformer**: `$c('dbWriteOk', 'true');`
- **Data types**: Raw in → Raw out

#### CH6: Response Builder (VM Rx → XML summary)

- **Source**: Channel Reader
- **Source Transformer**: JavaScriptStep — build XML: `<result><patientId>...</patientId><sourceType>...</sourceType><status>COMPLETED</status></result>`
- **Dest1** (VM Writer → sink)
- **Data types**: Raw in → Raw out

#### CH9: SOAP Endpoint (WebServiceReceiver → VM → CH7)

- **Source**: Web Service Listener on port 8092, path `/ws/patient`, SOAP 1.1
- **Source Transformer**: JavaScriptStep — extract patient data from SOAP body, set `$c('soapReceived', 'true')`
- **Dest1** (VM Writer → CH7): audit with sourceType `SOAP`
- **Data types**: Raw in → Raw out

#### CH10: DICOM SCP (DicomReceiver → VM → CH7)

- **Source**: DICOM Listener on port 11112, AE title `MIRTH_SCP`, Implicit VR Little Endian
- **Source Transformer**: JavaScriptStep — `$c('dicomReceived', 'true'); $c('sourceType', 'DICOM');`
- **Dest1** (VM Writer → CH7): audit with sourceType `DICOM`
- **Data types**: Raw in → Raw out

#### CH11: JMS Consumer (JmsReceiver → VM → CH7) *(optional — requires STOMP broker)*

- **Source**: JMS Listener, STOMP on `localhost:61613`, queue `ks-test`
- **Source Transformer**: JavaScriptStep — `$c('jmsReceived', 'true'); $c('sourceType', 'JMS');`
- **Dest1** (VM Writer → CH7): audit with sourceType `JMS`
- **Data types**: Raw in → Raw out

### Tier 4: Output Layer

#### CH7: Audit Logger (VM Rx → File append)

- **Source**: Channel Reader
- **Source Transformer**: JavaScriptStep — format: `patientId|sourceType|timestamp`
- **Dest1** (File Writer): path `/tmp/mirth-ks/audit`, fileName `audit.log`, `outputAppend=true`
- **Data types**: Raw in → Raw out

#### CH8: Completion Handler (HTTP Rx → $g, response transformer)

- **Source**: HTTP Listener, port 8091, path `/complete`
- **Source Transformer**: JavaScriptStep — `$g('kitchenSinkComplete', 'true');`
- **Dest1** (VM Writer → sink)
- **Dest1 Response Transformer**: build JSON `{ status: 'ok', patient: $c('patientId') }`
- **Data types**: Raw in → Raw out

---

## Mock Infrastructure (embedded in runner)

### Mock SMTP Server (~30 lines in KitchenSinkRunner.ts)

Minimal TCP server that speaks SMTP protocol. Started before channels deploy, collects sent emails for assertion.

```typescript
class MockSmtpServer {
  private server: net.Server;
  public emails: { from: string; to: string; subject: string; body: string }[] = [];

  async start(port = 2525): Promise<void> {
    this.server = net.createServer((socket) => {
      socket.write('220 mock-smtp ready\r\n');
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
        const lines = data.split('\r\n');
        for (const line of lines) {
          if (line.startsWith('EHLO') || line.startsWith('HELO')) socket.write('250 OK\r\n');
          else if (line.startsWith('MAIL FROM')) { /* capture from */ socket.write('250 OK\r\n'); }
          else if (line.startsWith('RCPT TO')) { /* capture to */ socket.write('250 OK\r\n'); }
          else if (line === 'DATA') socket.write('354 Send data\r\n');
          else if (line === '.') { /* save email */ socket.write('250 OK\r\n'); }
          else if (line === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
        }
      });
    });
    await new Promise<void>(resolve => this.server.listen(port, resolve));
  }
  async stop(): Promise<void> { this.server?.close(); }
}
```

### JMS Broker Detection

Runner checks if STOMP broker is reachable on `localhost:61613` at startup. If not, CH4.D6 (JMS Dispatcher) and CH11 (JMS Consumer) are skipped with a warning. No Docker dependency required to run the core test.

```typescript
async function isStompBrokerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(61613, 'localhost');
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
```

---

## Code Template Library

**Library**: "Kitchen Sink Utilities" (`ks-utility-library.xml`)

3 templates, enabled for all channels:

```javascript
// Template 1: normalizePatientName
function normalizePatientName(firstName, lastName) {
  if (!firstName && !lastName) return 'UNKNOWN';
  return (lastName || '').trim().toUpperCase() + ', ' + (firstName || '').trim().toUpperCase();
}

// Template 2: buildAuditEntry
function buildAuditEntry(patientId, action, source) {
  return patientId + '|' + action + '|' + source + '|' + new Date().toISOString();
}

// Template 3: formatXmlResponse
function formatXmlResponse(data) {
  var xml = '<response>';
  for (var key in data) {
    if (data.hasOwnProperty(key)) xml += '<' + key + '>' + (data[key] || '') + '</' + key + '>';
  }
  return xml + '</response>';
}
```

---

## Test Phases (9 phases, ~60s total)

### Phase 0: Setup (~15s)
1. Start mock SMTP server on port 2525
2. Check STOMP broker availability on port 61613 (set `jmsAvailable` flag)
3. Create DB tables `ks_messages`, `ks_audit_log` via direct SQL
4. Create directories `/tmp/mirth-ks/{input,output,audit}`
5. Deploy code template library
6. Import + deploy all channels in dependency order:
   - Tier 4 first: CH7, CH8
   - Tier 3: CH5, CH6, CH9, CH10, CH11 (if JMS available)
   - Tier 2: CH4
   - Tier 1: CH1, CH2, CH3, CH12
7. Wait for all channels STARTED

### Phase 1: MLLP Test (~3s)
1. Send HL7 ADT^A01 via MLLP to port 6670
2. Assert: ACK received (AA)
3. Wait 2s for VM propagation through entire network
4. Assert: CH1 message count = 1 (SENT status)
5. Assert: CH4 received at least 1 message
6. Assert: `ks_messages` has row with patient_id from message
7. Assert: `ks_audit_log` has row with source_type = 'MLLP'
8. Assert: `/tmp/mirth-ks/audit/audit.log` contains patient ID
9. Assert: Mock SMTP server received 1 email with subject containing patient ID

### Phase 2: HTTP Test (~3s)
1. POST JSON patient to `http://localhost:8090/api/patient`
2. Assert: HTTP 200 response
3. Wait 2s for VM propagation
4. Assert: CH2 message count >= 1
5. Assert: `ks_audit_log` has row with source_type = 'HTTP'
6. Assert: audit.log contains HTTP patient ID

### Phase 3: File Test (~7s)
1. Write CSV to `/tmp/mirth-ks/input/test-batch.csv`
2. Wait 5s for file polling
3. Assert: input file deleted (after-process DELETE)
4. Assert: `/tmp/mirth-ks/output/processed.xml` exists
5. Assert: CH3 message count >= 1
6. Assert: audit.log contains FILE patient ID
7. Assert: NO `ks_audit_log` row with source_type = 'FILE' (filtered at CH4 Dest1)

### Phase 4: SOAP Loopback Verification (~2s)
1. Wait for CH4 to have routed messages to CH9 via WebServiceDispatcher
2. Assert: CH9 (SOAP Endpoint) received at least 1 message
3. Assert: CH9 message content has `$c('soapReceived') == 'true'`
4. Assert: audit.log contains entry with sourceType `SOAP`

### Phase 5: DICOM Loopback Verification (~2s)
1. Assert: CH10 (DICOM SCP) received at least 1 message via C-STORE from CH4
2. Assert: CH10 message content has `$c('dicomReceived') == 'true'`
3. Assert: audit.log contains entry with sourceType `DICOM`

### Phase 6: JMS Loopback Verification (~2s, skipped if no broker)
1. If `jmsAvailable`: Assert CH11 received messages from queue `ks-test`
2. Assert: CH11 message content has `$c('jmsReceived') == 'true'`
3. Assert: audit.log contains entry with sourceType `JMS`

### Phase 7: JavaScript Receiver + Cross-Channel Trace (~3s)
1. Assert: CH12 (JS Generator) produced at least 1 message
2. Assert: audit.log contains entry with sourceType `JAVASCRIPT`
3. Call `GET /api/messages/trace/{CH1_ID}/1`
4. Assert: trace depth >= 2 (CH1 → CH4 → CH5/CH6/CH7)
5. Assert: sourceChannelIds chain is present

### Phase 8: Maps + Filters + Statistics + Cleanup (~5s)
1. **Map verification** via CH1 message content API:
   - `channelMap.preprocessorRan` = 'true'
   - `channelMap.postprocessorRan` = 'true'
   - `channelMap.patientId` set, `channelMap.sourceType` = 'MLLP'
2. **Filter verification**:
   - Send ORU^R01 (non-ADT) to CH1 → assert FILTERED
   - POST JSON without `name.family` to CH2 → assert rejected
3. **Statistics**:
   - CH1 received >= 2, filtered >= 1
   - CH4 received >= 3 (one per ingest entry point)
   - CH7 received >= 5 (audit entries from all sources + loopback channels)
4. **Cleanup**:
   - Undeploy all channels
   - Verify `$g('ch1UndeployedAt')` set (undeploy script ran)
   - Delete all channels, drop DB tables, clean filesystem
   - Stop mock SMTP server

---

## Coverage Matrix

### Connector Types (11/11 — ALL)

| Connector | Source | Destination | Channels | Verified By |
|-----------|--------|-------------|----------|-------------|
| TCP/MLLP | CH1 | — | Ingest | ACK response + message count |
| HTTP | CH2, CH8 | CH2.D2 | Gateway + Completion | HTTP response body |
| File | CH3 | CH3.D2, CH7.D1 | Batch + Audit | File exists + content |
| JDBC | — | CH1.D2, CH5.D1 | Persistence | SQL SELECT on tables |
| VM | CH4-CH7,CH9-CH12 | Many | Cross-channel | Message count downstream |
| SMTP | — | CH1.D4 | Email alert | Mock SMTP captured email |
| WebService | CH9 | CH4.D4 | SOAP loopback | CH9 received + content |
| DICOM | CH10 | CH4.D5 | DICOM loopback | CH10 received + content |
| JMS | CH11 | CH4.D6 | Queue loopback | CH11 received (optional) |
| JavaScript | CH12 | — | Synthetic gen | CH12 message count |
| (Code Templates) | — | — | All channels | Functions callable in scripts |

### Data Types (4 exercised + Raw)

| Type | Where | Direction |
|------|-------|-----------|
| HL7v2 | CH1 source | Inbound + serialization |
| JSON | CH2 source, CH8 response | In + Out |
| Delimited | CH3 source | Inbound (CSV) |
| Raw | CH4-CH12 | Pass-through |

### Script Types (10/10)

| Script | Channel | Verified By |
|--------|---------|-------------|
| Deploy | CH1 | $gc counter initialized |
| Undeploy | CH1 | $g timestamp set after undeploy |
| Preprocessor | CH1 | $c('preprocessorRan') in message content |
| Postprocessor | CH1 | $c('postprocessorRan') in message content |
| Source Filter (accept) | CH1, CH2 | ADT accepted, ORU filtered |
| Source Transformer | CH1-CH4, CH9-CH12 | Patient data extracted, maps set |
| Mapper plugin | CH1 | patientGender mapped |
| Destination Filter | CH4.D1 | FILE messages excluded from DB |
| Destination Transformer | CH1.D1-D4 | Audit entries, routing metadata |
| Response Transformer | CH1.D2, CH5.D1 | DB response read, maps updated |

### Map Variables (6/6)

| Map | Set In | Verified In |
|-----|--------|-------------|
| $c | CH1 source xfm | CH1 message content API |
| $s | VM connector auto | CH4 sourceChannelId check |
| $g | CH1 undeploy, CH8 xfm | Phase 8 global map check |
| $gc | CH1 deploy + xfm | Counter increment verified |
| $r | CH1 postprocessor | Response from JDBC dest |
| $co | CH1.D2 | Isolation (not visible in D3) |

---

## Implementation Plan

### Files to Create

```
validation/scenarios/09-kitchen-sink/
  config.json                          # Scenario metadata
  channels/
    ch01-adt-receiver.xml              # ~600 lines (MLLP, 4 dests incl SMTP, all scripts)
    ch02-http-gateway.xml              # ~350 lines (HTTP Rx, 2 dests)
    ch03-file-processor.xml            # ~350 lines (File Rx/Writer, Delimited)
    ch04-hub-router.xml                # ~700 lines (VM Rx, 6 dests: VM×3, WS, DICOM, JMS)
    ch05-db-persistence.xml            # ~300 lines (VM Rx, JDBC dest)
    ch06-response-builder.xml          # ~250 lines (VM Rx)
    ch07-audit-logger.xml              # ~250 lines (VM Rx, File Writer append)
    ch08-completion-handler.xml        # ~300 lines (HTTP Rx, resp xfm)
    ch09-soap-endpoint.xml             # ~300 lines (WebServiceReceiver)
    ch10-dicom-scp.xml                 # ~300 lines (DicomReceiver)
    ch11-jms-consumer.xml              # ~250 lines (JmsReceiver)
    ch12-js-generator.xml              # ~200 lines (JavaScriptReceiver)
  code-templates/
    ks-utility-library.xml             # ~100 lines
  messages/
    adt-a01.hl7                        # ADT test message (patient PATIENT123)
    oru-r01.hl7                        # ORU message (for filter rejection)
    patient.json                       # JSON patient payload
    batch.csv                          # CSV file (id,firstName,lastName)
    patient-no-name.json               # Invalid JSON (missing name.family)
  sql/
    setup.sql                          # CREATE TABLE ks_messages, ks_audit_log
    teardown.sql                       # DROP TABLE IF EXISTS

validation/runners/KitchenSinkRunner.ts  # ~800 lines (9 phases + mock SMTP + broker detect)
```

**Estimated totals**: ~21 files, ~5,300 lines

### Step-by-Step Implementation (use parallel agents)

**Step 1: Runner + infrastructure** (~1 agent)
- `KitchenSinkRunner.ts` — standalone runner with mock SMTP, broker detection, 9 phases
- `config.json`, 5 message fixtures, 2 SQL files
- MirthApiClient extensions: `getMessages()`, `getChannelStatistics()`, `traceMessage()`
- Add `validate:kitchen-sink` npm script

**Step 2: Core network channel XMLs** (3 parallel agents)
- Agent A: CH1 (MLLP, 4 dests incl SMTP, all scripts) + CH2 (HTTP, 2 dests)
- Agent B: CH3 (File reader/writer) + CH4 (VM router, 6 dests incl WS/DICOM/JMS)
- Agent C: CH5 (JDBC) + CH6 (response) + CH7 (file audit) + CH8 (HTTP completion)

**Step 3: Protocol loopback channel XMLs** (2 parallel agents)
- Agent D: CH9 (SOAP endpoint) + CH10 (DICOM SCP)
- Agent E: CH11 (JMS consumer) + CH12 (JS generator) + code template library XML

Each agent follows XML patterns from:
- `validation/scenarios/07-deep-validation/7.7-channel-scripts/full-lifecycle-channel.xml`
- `validation/scenarios/07-deep-validation/7.5-cross-connector-maps/multi-destination-channel.xml`
- `validation/scenarios/07-deep-validation/7.6-code-templates/utility-library.xml`

### Key Files to Reuse

| File | Reuse Pattern |
|------|---------------|
| `validation/runners/ScenarioRunner.ts` | Placeholder substitution, deploy/wait lifecycle |
| `validation/scenarios/07-deep-validation/7.7-channel-scripts/full-lifecycle-channel.xml` | All 4 script types with $gc |
| `validation/scenarios/07-deep-validation/7.5-cross-connector-maps/multi-destination-channel.xml` | Multi-dest with $c propagation |
| `validation/scenarios/07-deep-validation/7.6-code-templates/utility-library.xml` | Code template library XML format |
| `validation/clients/MirthApiClient.ts` | Extend with message/stats/trace methods |
| `src/connectors/ws/WebServiceReceiverProperties.ts` | SOAP config (SoapBinding enum, defaults) |
| `src/connectors/dicom/DicomReceiverProperties.ts` | DICOM config (TransferSyntax, DicomTlsMode) |
| `src/connectors/smtp/SmtpDispatcherProperties.ts` | SMTP config (smtpHost, smtpPort defaults) |
| `src/connectors/jms/JmsConnectorProperties.ts` | JMS config (STOMP host/port, queue name) |
| `src/connectors/js/JavaScriptReceiver.ts` | JS Receiver poll script pattern |

### MirthApiClient Extensions Needed

```typescript
async getMessages(channelId: string, params?: { status?: string; limit?: number }): Promise<Message[]>
async getMessageContent(channelId: string, messageId: number): Promise<MessageContent>
async getChannelStatistics(channelId: string): Promise<ChannelStatistics>
async traceMessage(channelId: string, messageId: number): Promise<TraceResult>
```

---

## Verification

```bash
# Core test (no Docker needed — JMS skipped if no broker)
cd validation
npx ts-node runners/KitchenSinkRunner.ts

# With JMS (start RabbitMQ first)
docker run -d --name rabbitmq -p 61613:61613 rabbitmq:3-management
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_stomp
npx ts-node runners/KitchenSinkRunner.ts

# Verbose mode
npx ts-node runners/KitchenSinkRunner.ts --verbose
```

Expected output:
```
Kitchen Sink Integration Test
═════════════════════════════
Phase 0: Setup ...................... OK (15.2s)
Phase 1: MLLP Test ................. OK (2.8s)
Phase 2: HTTP Test ................. OK (2.5s)
Phase 3: File Test ................. OK (6.1s)
Phase 4: SOAP Loopback ............. OK (1.5s)
Phase 5: DICOM Loopback ............ OK (1.8s)
Phase 6: JMS Loopback .............. SKIP (no broker)
Phase 7: JS Rx + Trace ............. OK (2.3s)
Phase 8: Maps + Filters + Stats .... OK (4.1s)
═════════════════════════════
11/11 CONNECTOR TYPES TESTED (JMS: skipped)
ALL PHASES PASSED (36.3s)

Coverage: 10 connector types exercised, 4 data types, 10 script types, 6 map types
Channels: 12 deployed, 12 verified, 0 errors
Messages: 4 sent externally, 20+ processed across network
```
