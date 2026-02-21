# Beyond Mirth: Healthcare Integration Modernization Strategy

<!-- Archived: 2026-02-21 | Status: Not Implemented — Future Reference -->
<!-- Covers: TypeScript channel SDK, E4X removal, AWS cloud-native infrastructure, hybrid architecture -->
<!-- Research includes: AWS, Azure, GCP healthcare service comparison with pricing and HIPAA analysis -->

## Context

We have a production-ready Node.js Mirth Connect runtime (8,326 tests, 112K+ lines, full Java parity). The current architecture carries **~14K lines of E4X transpilation and VM sandboxing code** — a compatibility layer replicating Java Rhino's JavaScript runtime from 2004. This layer exists solely to run legacy Mirth channel scripts that use E4X XML syntax (`msg..PID`, `msg.@version`, `<tag/>`).

**The opportunity:** Rather than continuing to maintain backward compatibility with a 20-year-old JavaScript dialect, we can modernize in two parallel tracks:
1. **Engine modernization** — Replace E4X/VM sandbox with native TypeScript channel definitions (type-safe, testable, no transpilation)
2. **Cloud-native offloading** — Move infrastructure concerns (SFTP, queuing, file polling, scaling) to managed AWS services while keeping transformation logic in our engine

**Why now:** The Mirth Connect 4.6 commercial license change (2025) is driving the healthcare industry to evaluate alternatives. Our Node.js port is uniquely positioned — it already runs on Kubernetes with OTEL instrumentation, and we can offer a modernization path that no other integration engine provides.

---

## Strategic Options (Recommended: Option C — Hybrid)

### Option A: Pure Engine Modernization (TypeScript Channels)
Remove E4X, add TypeScript channel definitions, keep self-hosted.
- **Pros:** Full control, lowest cloud spend, works on-prem
- **Cons:** Still managing SFTP servers, message queues, scaling ourselves

### Option B: Pure Cloud-Native Replacement (AWS Services)
Replace Mirth entirely with composed AWS services (Lambda, EventBridge, Transfer Family, etc.).
- **Pros:** Zero infrastructure management, auto-scaling, pay-per-use
- **Cons:** No native MLLP/HL7v2 parsing in AWS, vendor lock-in, loss of channel abstraction, complex multi-service debugging, higher cost at steady-state volume

### Option C: Hybrid — Modernized Engine + Cloud-Native Infrastructure (RECOMMENDED)
Modernize the engine (TypeScript channels, remove E4X) AND offload infrastructure to AWS managed services. The engine handles what cloud can't (MLLP, HL7v2 parsing, transformation logic), AWS handles what it does best (SFTP, queuing, scaling, storage, monitoring).
- **Pros:** Best of both worlds, incremental migration, cloud-native scaling with healthcare-specific engine
- **Cons:** More architectural surface area (but each piece is simpler)

---

## High-Level Architecture (Option C — Hybrid)

### Current State
```
┌─────────────────────────────────────────────────────────┐
│                 Node.js Mirth Runtime                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ MLLP/TCP │  │   SFTP   │  │   HTTP   │  │  File   │ │
│  │ Receiver │  │ Receiver │  │ Receiver │  │ Poller  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │              │              │              │      │
│       ▼              ▼              ▼              ▼      │
│  ┌──────────────────────────────────────────────────┐    │
│  │     E4X Transpiler → VM Sandbox → Script Exec    │    │
│  │     (14K lines of Rhino compatibility layer)     │    │
│  └──────────────────────────────────────────────────┘    │
│       │              │              │              │      │
│       ▼              ▼              ▼              ▼      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │   MLLP   │  │   HTTP   │  │  JDBC    │  │  File   │ │
│  │ Dispatch │  │ Dispatch │  │ Dispatch │  │ Writer  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│                                                          │
│                    MySQL (message store)                  │
└─────────────────────────────────────────────────────────┘
```

### Target State (Hybrid)
```
┌─── AWS Managed Services ─────────────────────────────────────────┐
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  Transfer    │  │ API Gateway  │  │  S3 + EventBridge       │ │
│  │  Family      │  │ (FHIR/REST)  │  │  (file events)          │ │
│  │  (SFTP/AS2)  │  │              │  │                         │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬─────────────┘ │
│         │                  │                      │               │
│         ▼                  ▼                      ▼               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    SQS / EventBridge                        │  │
│  │              (message routing + fan-out)                    │  │
│  └───────────────────────┬────────────────────────────────────┘  │
│                          │                                        │
└──────────────────────────┼────────────────────────────────────────┘
                           │
                           ▼
┌─── Modernized Engine (ECS/Fargate or EKS) ───────────────────────┐
│                                                                   │
│  ┌────────────┐     ┌────────────────────────────────────────┐   │
│  │ MLLP/TCP   │     │  TypeScript Channel Runtime             │   │
│  │ Listener   │────▶│                                        │   │
│  │ (NLB)      │     │  • Native TS transformers (type-safe)  │   │
│  └────────────┘     │  • No E4X, no VM sandbox               │   │
│                     │  • HL7v2 parser (HAPI-like)             │   │
│  ┌────────────┐     │  • XMLProxy (optional, for migration)  │   │
│  │ SQS        │     │  • Hot-reload channel modules           │   │
│  │ Consumer   │────▶│  • OTEL instrumented                   │   │
│  └────────────┘     │                                        │   │
│                     └──────────────┬─────────────────────────┘   │
│                                    │                              │
│                     ┌──────────────┼──────────────┐              │
│                     ▼              ▼              ▼              │
│              ┌───────────┐  ┌──────────┐  ┌──────────────┐      │
│              │ HealthLake│  │   RDS    │  │  S3 (output) │      │
│              │ (FHIR R4) │  │ (MySQL)  │  │              │      │
│              └───────────┘  └──────────┘  └──────────────┘      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  CloudWatch + X-Ray + Prometheus (OTEL export)           │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## AWS Service Composition — Use Case Mapping

### Protocol/Source Mapping

| Mirth Use Case | Current Implementation | AWS Target | Notes |
|---|---|---|---|
| **SFTP file receive** | FileReceiver + SFTP poll | **Transfer Family** → S3 → EventBridge → SQS → Engine | Eliminates SFTP server management |
| **SFTP file send** | FileDispatcher + SFTP write | **Transfer Family SFTP Connector** (outbound) or S3 + Lambda | Managed outbound SFTP |
| **Local directory poll** | FileReceiver + fs.watch | **S3** + EventBridge (files uploaded by agents) | No local filesystem in containers |
| **S3 file read** | S3Client (custom) | **S3 Event Notification** → SQS → Engine | Native, already cloud-ready |
| **HTTP API receive** | HttpReceiver (Express) | **API Gateway** → SQS → Engine (or direct ALB) | API Gateway adds auth, throttling, caching |
| **HTTP API send** | HttpDispatcher (fetch) | Keep in-engine (fetch/undici) | No benefit to offloading |
| **MLLP/TCP receive** | TcpReceiver (net.Server) | **NLB** → Engine (ECS/Fargate) | NLB for TCP load balancing; MLLP stays in engine |
| **MLLP/TCP send** | TcpDispatcher (net.Socket) | Keep in-engine | Persistent TCP connections need process state |
| **JMS queue** | JmsReceiver/Dispatcher (STOMP) | **Amazon MQ** (managed ActiveMQ) | Drop STOMP dependency, use native JMS |
| **SMTP send** | SmtpDispatcher (nodemailer) | **Amazon SES** | Managed email with bounce/complaint handling |
| **Database read/write** | JdbcDispatcher (mysql2) | **RDS** (managed MySQL/Postgres) | Already using RDS in k8s overlay |
| **DICOM C-STORE** | DicomReceiver/Dispatcher | Keep in-engine (specialized protocol) | No cloud DICOM ingest service |
| **Channel-to-channel** | VMRouter (in-process) | **EventBridge** or **SQS** (for cross-service routing) | In-process for co-located, SQS for distributed |
| **EDI/X12 claims** | EDI data type + JS transform | **B2B Data Interchange** | AI-assisted mapping, managed X12 parsing |
| **Batch file splitting** | BatchAdaptors (HL7, XML, etc.) | **Step Functions** + Lambda or keep in-engine | Engine batch adaptors are already good |
| **Message queuing** | SourceQueue/DestinationQueue (MySQL) | **SQS FIFO** (per-channel queues) | Eliminates D_M table queue polling |
| **Message archival** | DataPruner + MessageArchiver | **S3 Glacier** + lifecycle policies | Cost-effective long-term storage |
| **FHIR data store** | Not implemented | **HealthLake** | Native FHIR R4 with NLP enrichment |

### Monitoring & Operations Mapping

| Concern | Current | AWS Target |
|---|---|---|
| Metrics | OTEL → Prometheus | **CloudWatch** (via OTEL OTLP exporter) |
| Traces | OTEL → Jaeger/local | **X-Ray** (via OTEL OTLP exporter) |
| Logs | Winston → stdout | **CloudWatch Logs** (via Fluent Bit sidecar) |
| Alerting | Manual | **CloudWatch Alarms** → SNS → PagerDuty/Slack |
| Scaling | HPA (CPU/memory) | **ECS Auto Scaling** or **EKS HPA** with custom metrics |
| Secrets | Env vars | **Secrets Manager** (auto-rotation) |
| Config | CLAUDE.md / env vars | **Systems Manager Parameter Store** |
| Health checks | /api/health/* | **ALB/NLB health checks** (already compatible) |

---

## Track 1: Engine Modernization — TypeScript Channel Definitions

### What Changes

**Remove (~7K lines):**
- `E4XTranspiler.ts` (956 lines) — No more E4X syntax
- `ScriptBuilder.ts` (816 lines) — No more code generation
- `StepCompiler.ts` (160 lines) — No more drag-and-drop compilation
- Most of `ScopeBuilder.ts` (699 lines) — Replace VM context injection with typed parameters
- VM sandbox in `JavaScriptExecutor.ts` (705 lines) — No more `vm.createContext()`
- Java interop shims (40 lines) — No more `java.util.ArrayList`
- ~3,500 lines of transpilation/code-generation tests

**Keep (as typed library):**
- `XMLProxy.ts` (1,011 lines) — Useful XML navigation API, but as a typed import, not VM-injected
- All userutil classes (6,500 lines) — FileUtil, HTTPUtil, DatabaseConnection, etc. become typed imports
- HL7v2/XML/JSON parsers — Unchanged, now called directly

**Add (~2K-3K lines):**
- `ChannelModule` interface and type definitions
- TypeScript channel loader with hot-reload
- Migration tool (XML+JS → TypeScript channel modules)
- New test harness for typed channels

### TypeScript Channel Definition Format

```typescript
// channels/adt-receiver.channel.ts
import { defineChannel, hl7v2, type Context } from '@mirth/sdk';

export default defineChannel({
  name: 'ADT Receiver',
  sourceConnector: {
    type: 'mllp',
    host: '0.0.0.0',
    port: 6661,
  },

  // Type-safe filter — no E4X, no VM sandbox
  sourceFilter(msg: hl7v2.Message, ctx: Context): boolean {
    const messageType = msg.get('MSH.9.1');
    return messageType === 'ADT';
  },

  // Type-safe transformer — native TypeScript
  sourceTransformer(msg: hl7v2.Message, ctx: Context): hl7v2.Message {
    const mrn = msg.get('PID.3.1');
    ctx.channelMap.set('mrn', mrn);

    // Type-safe — compiler catches msg.get('NONEXISTENT') patterns
    const patientName = msg.get('PID.5.1');
    ctx.logger.info(`Processing patient: ${patientName}`);

    return msg;
  },

  destinations: [
    {
      name: 'Database Writer',
      type: 'jdbc',
      url: '${DB_URL}',

      transformer(msg: hl7v2.Message, ctx: Context): Record<string, unknown> {
        return {
          mrn: ctx.channelMap.get('mrn'),
          name: msg.get('PID.5'),
          dob: msg.get('PID.7'),
          event: msg.get('EVN.1'),
        };
      },

      // SQL template with typed parameters
      template: `INSERT INTO patients (mrn, name, dob, event_type)
                 VALUES (:mrn, :name, :dob, :event)`,
    },
    {
      name: 'Forward to Lab',
      type: 'mllp',
      host: 'lab-system.internal',
      port: 6662,

      filter(msg: hl7v2.Message, ctx: Context): boolean {
        return msg.get('PV1.3.1') === 'LAB';
      },
    },
  ],

  // Lifecycle hooks
  onDeploy(ctx: Context) {
    ctx.globalMap.set('adt_deployed_at', new Date().toISOString());
  },

  postprocessor(msg: hl7v2.Message, ctx: Context): void {
    const destResponse = ctx.responseMap.get('Database Writer');
    if (destResponse?.status === 'ERROR') {
      ctx.logger.error('Database write failed', destResponse.error);
    }
  },
});
```

### SDK Type Definitions

```typescript
// @mirth/sdk types (new package)

export interface Context {
  channelId: string;
  channelName: string;
  messageId: number;
  channelMap: TypedMap;
  sourceMap: ReadonlyTypedMap;
  globalMap: TypedMap;
  globalChannelMap: TypedMap;
  configurationMap: ReadonlyTypedMap;
  responseMap: ReadonlyTypedMap;
  connectorMap: TypedMap;
  destinationSet: DestinationSet;
  logger: Logger;
  // Typed access to userutil
  db: typeof DatabaseConnectionFactory;
  http: typeof HTTPUtil;
  file: typeof FileUtil;
  smtp: typeof SMTPConnectionFactory;
  attachments: typeof AttachmentUtil;
  router: VMRouter;
}

export interface TypedMap {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  entries(): IterableIterator<[string, unknown]>;
}
```

### Migration Tool: XML Channels → TypeScript

A codemod that converts existing Mirth XML channel definitions to TypeScript modules:

```bash
# Convert a single channel
mirth-cli codemod convert-channel "ADT Receiver" --output channels/

# Convert all channels from a running instance
mirth-cli codemod convert-all --server http://localhost:8081 --output channels/

# Convert from exported XML file
mirth-cli codemod convert-file ./exports/adt-receiver.xml --output channels/

# Dry-run to preview without writing
mirth-cli codemod convert-channel "ADT Receiver" --dry-run
```

**Conversion steps:**
1. Parse channel XML (using existing ChannelDecomposer)
2. Extract filter/transformer JavaScript
3. De-transpile E4X patterns back to typed XMLProxy calls (or native HL7v2 API)
4. Convert `$c('key')` → `ctx.channelMap.get('key')`
5. Convert `msg['PID']['PID.5']` → `msg.get('PID.5')`
6. Wrap in `defineChannel()` with proper TypeScript types
7. Add type imports based on detected data type (hl7v2, xml, json, raw)
8. Output `.channel.ts` file

**What can't be auto-converted (requires manual review):**
- Complex E4X filter predicates with dynamic evaluation
- `eval()` usage (should not exist, but flag if found)
- Java interop patterns (`new java.util.ArrayList()`) → flag for manual conversion
- Dynamic property access on msg where paths are computed at runtime

### Backward Compatibility: Dual-Mode Runtime

During migration, the engine supports both channel types simultaneously:

```
Channel Registry
├── TypeScript Channels (.channel.ts) → Direct function invocation
│   • No transpilation
│   • No VM sandbox
│   • Type-checked at build time
│   • Hot-reload via fs.watch + dynamic import
│
└── Legacy XML Channels (database/API) → Current pipeline
    • E4X transpilation
    • VM sandbox execution
    • Full backward compatibility
    • Gradually deprecated
```

The `ChannelBuilder` detects channel type and routes to the appropriate execution path. Both types share the same `Context` object, connectors, and message pipeline.

---

## Track 2: AWS Cloud-Native Infrastructure

### Low-Level Architecture — SFTP Integration

**Current:** FileReceiver polls SFTP server every N seconds, downloads files, processes.

**Target:**
```
Partner SFTP Client
  │
  ▼
AWS Transfer Family (SFTP endpoint)
  │  • Managed SFTP with custom IdP (Secrets Manager or Lambda)
  │  • $0.30/hr + $0.04/GB
  │  • Files land in S3
  ▼
S3 Bucket (healthcare-inbound-{env})
  │  • SSE-KMS encryption
  │  • Lifecycle: 90 days → IA → 365 days → Glacier
  │  • Event notification on ObjectCreated
  ▼
EventBridge Rule
  │  • Match on prefix: sftp/{partner}/*.hl7
  │  • Route to partner-specific SQS queue
  ▼
SQS FIFO Queue (per-channel)
  │  • Message deduplication (S3 object key)
  │  • 14-day retention
  │  • DLQ after 3 failed processing attempts
  ▼
Engine (ECS/Fargate)
  │  • SQS consumer polls queue
  │  • Downloads file from S3 (pre-signed URL)
  │  • Runs TypeScript transformer
  │  • Acks message on success
  ▼
Destination (HealthLake, RDS, S3, MLLP, etc.)
```

**IAM Permissions:**
```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:DeleteObject"],
  "Resource": "arn:aws:s3:::healthcare-inbound-${env}/*",
  "Condition": { "StringEquals": { "s3:prefix": "sftp/${partner}/" } }
}
```

### Low-Level Architecture — MLLP/HL7v2 Ingestion

**Current:** TcpReceiver listens on port, parses MLLP frames, processes.

**Target (MLLP stays in engine — no AWS equivalent):**
```
On-Premises EHR
  │  (MLLP/TCP over VPN or Direct Connect)
  ▼
NLB (Network Load Balancer)
  │  • TCP passthrough on port 6661
  │  • Cross-AZ for HA
  │  • Health check: TCP connect
  ▼
ECS/Fargate Tasks (2+ for HA)
  │  • Engine handles MLLP framing
  │  • Engine parses HL7v2
  │  • Engine runs TypeScript transformer
  │  • Engine sends ACK/NAK
  ▼
Destination (HealthLake FHIR, RDS, SQS fan-out)
```

**Why MLLP stays in-engine:**
- AWS has no managed MLLP service
- MLLP requires persistent TCP connections (Lambda can't do this)
- HL7v2 ACK generation requires same-connection response
- Our existing TcpReceiver handles this perfectly

### Low-Level Architecture — HTTP/FHIR API

**Current:** HttpReceiver (Express) listens on port, processes.

**Target:**
```
External Client
  │
  ▼
API Gateway (HTTP API)
  │  • $1.00/million requests
  │  • Cognito/IAM auth
  │  • Request validation (JSON Schema)
  │  • Rate limiting (per-client throttle)
  │  • WAF integration (OWASP rules)
  ▼
SQS Queue (async) ──or──▶ ALB (sync)
  │                         │
  ▼                         ▼
Engine (ECS/Fargate)    Engine (ECS/Fargate)
  │                         │
  ▼                         ▼
HealthLake (FHIR R4)   Direct HTTP response
```

**Sync vs Async:** Use API Gateway → ALB for synchronous FHIR operations (read, search). Use API Gateway → SQS → Engine for async operations (create, update, bulk import).

### Low-Level Architecture — Message Queuing

**Current:** MySQL-backed D_M tables with FOR UPDATE row locking.

**Target:**
```
Source Connector (any)
  │
  ▼
SQS FIFO Queue (per-channel)
  │  • MessageGroupId = channelId (FIFO ordering)
  │  • MessageDeduplicationId = messageId
  │  • VisibilityTimeout = 5 × avg processing time
  │  • DLQ after N retries (configurable per-channel)
  ▼
Engine (SQS consumer)
  │  • Long-polling (20s)
  │  • Batch receive (up to 10 messages)
  │  • Process → Ack or → DLQ
  ▼
DLQ (Dead Letter Queue)
  │  • CloudWatch alarm on DLQ depth > 0
  │  • SNS notification to ops team
  │  • Manual reprocessing via CLI or Lambda
  ▼
S3 (message archive)
  │  • Original message + metadata
  │  • Lifecycle: Glacier after 365 days
```

**Why SQS over MySQL queuing:**
- No database contention (FOR UPDATE locks eliminated)
- Built-in retry with exponential backoff
- DLQ for poisoned messages
- CloudWatch metrics (queue depth, age of oldest message)
- Auto-scales consumers independently of database

### Low-Level Architecture — EDI/X12 Claims

**Current:** EDI data type + JavaScript transformer.

**Target:**
```
Payer/Clearinghouse
  │  (AS2 or SFTP)
  ▼
Transfer Family (AS2 endpoint)
  │
  ▼
S3 (raw-edi-{env})
  │
  ▼
EventBridge → Lambda (trigger)
  │
  ▼
B2B Data Interchange
  │  • X12 5010 parsing
  │  • AI-assisted mapping (Bedrock)
  │  • JSON output
  │
  ▼
SQS → Engine (business rules)
  │  • Eligibility verification
  │  • Claims adjudication logic
  │  • Enrichment from RDS
  │
  ▼
RDS / HealthLake / S3
```

### Low-Level Architecture — Monitoring Stack

```
Engine (ECS/Fargate)
  │
  ├──▶ OTEL Collector (sidecar)
  │      ├──▶ CloudWatch Metrics (custom namespace: Mirth/)
  │      ├──▶ X-Ray (distributed traces)
  │      └──▶ CloudWatch Logs (structured JSON)
  │
  ├──▶ CloudWatch Alarms
  │      ├── mirth.messages.errors > 10/min → SNS → PagerDuty
  │      ├── SQS ApproximateAgeOfOldestMessage > 300s → SNS
  │      ├── DLQ ApproximateNumberOfMessagesVisible > 0 → SNS
  │      └── ECS CPUUtilization > 80% → Auto Scaling
  │
  └──▶ CloudWatch Dashboard
         ├── Channel throughput (messages/min by channel)
         ├── Error rates (by channel + destination)
         ├── Queue depths (SQS per-channel)
         ├── Latency percentiles (p50, p95, p99)
         └── Infrastructure (CPU, memory, connections)
```

---

## Track 3: Transition Plan

### Phase 1: Foundation (Weeks 1-3)

**Goal:** TypeScript SDK + channel loader + first converted channel.

| Task | Files | Effort |
|---|---|---|
| Define `ChannelModule` interface + `Context` type | `src/sdk/types.ts` | S |
| Define `defineChannel()` factory function | `src/sdk/defineChannel.ts` | S |
| Build TypeScript channel loader (dynamic import + hot-reload) | `src/sdk/ChannelLoader.ts` | M |
| Add channel type detection in `ChannelBuilder.ts` | Modify existing | S |
| Wire TS channel loader into `EngineController.ts` | Modify existing | M |
| Convert 1 real channel to TypeScript (proof of concept) | `channels/example.channel.ts` | M |
| Unit + integration tests for TS channel execution | `tests/` | M |

**Key decision:** TS channels loaded from filesystem (`channels/` directory) vs. stored in database. **Recommendation:** Filesystem — aligns with git-backed artifact management, enables standard TypeScript tooling (IDE, compiler, linter).

### Phase 2: SDK + Codemod (Weeks 4-6)

**Goal:** Full SDK library + automated XML→TS converter.

| Task | Files | Effort |
|---|---|---|
| Build `@mirth/sdk` typed wrappers for all userutil classes | `src/sdk/` | L |
| HL7v2 typed message API (`msg.get('PID.5.1')` with autocomplete) | `src/sdk/hl7v2.ts` | L |
| XML typed message API (keep XMLProxy, add types) | `src/sdk/xml.ts` | M |
| JSON typed message API (native, minimal wrapper) | `src/sdk/json.ts` | S |
| Build codemod: XML channel → TypeScript channel | `tools/codemod/` | L |
| Build codemod: E4X script → typed SDK calls | `tools/codemod/` | L |
| Test codemod against 20+ real-world GitHub channels | `tests/` | M |

### Phase 3: AWS Infrastructure (Weeks 4-8, parallel with Phase 2)

**Goal:** AWS managed services replacing self-hosted infrastructure.

| Task | AWS Service | Effort |
|---|---|---|
| Transfer Family SFTP endpoint + S3 landing zone | Transfer Family, S3 | M |
| EventBridge rules for file routing | EventBridge | S |
| SQS FIFO queues (replace MySQL message queuing) | SQS | M |
| SQS consumer in engine (poll → process → ack) | Engine code | M |
| RDS MySQL (replace self-managed) | RDS | S (already compatible) |
| Secrets Manager integration | Secrets Manager | S |
| OTEL → CloudWatch/X-Ray exporter | OTEL Collector config | S |
| NLB for MLLP/TCP ingestion | NLB, ECS | M |
| API Gateway for HTTP channels | API Gateway | M |
| CloudWatch dashboards + alarms | CloudWatch | M |
| CDK/Terraform IaC for all resources | `infra/` | L |

### Phase 4: Migration + Deprecation (Weeks 8-12)

**Goal:** Migrate production channels, deprecate legacy pipeline.

| Task | Effort |
|---|---|
| Convert all production channels using codemod | M |
| Manual review + fix codemod edge cases | M |
| Run dual-mode (TS + legacy) in staging for 2 weeks | — |
| Performance benchmarks: TS channels vs legacy VM sandbox | M |
| Deprecation warnings on legacy XML channel import | S |
| Documentation: migration guide, SDK reference | M |

### Phase 5: Cleanup (Weeks 12-16)

**Goal:** Remove legacy code, ship v2.0.

| Task | Lines Removed | Effort |
|---|---|---|
| Remove E4XTranspiler.ts | 956 | S |
| Remove ScriptBuilder.ts code generation | 816 | S |
| Remove StepCompiler.ts | 160 | S |
| Simplify ScopeBuilder.ts (typed params instead of VM injection) | 699 → ~200 | M |
| Remove VM sandbox from JavaScriptExecutor.ts | 705 → ~200 | M |
| Remove Java interop shims | 40 | S |
| Remove ~3,500 lines of transpilation tests | 3,500 | S |
| Update CLAUDE.md documentation | — | M |
| **Total removed** | **~6,800 lines** | |

---

## Cost Comparison (Estimated Monthly — Medium-Volume Healthcare Org)

**Assumptions:** 500K messages/month, 10 SFTP partners, 5 MLLP connections, 100GB storage.

| Component | Self-Hosted (Current) | AWS Hybrid (Target) |
|---|---|---|
| Compute (ECS Fargate, 2 tasks) | EC2 ~$150 | ~$120 |
| Database (RDS MySQL, db.t3.medium) | Self-managed MySQL | ~$65 |
| SFTP (Transfer Family, 2 endpoints) | Self-managed SFTP | ~$432 |
| Message queuing (SQS) | Included in MySQL | ~$5 |
| API Gateway | N/A | ~$5 |
| S3 (100GB + lifecycle) | Local disk | ~$5 |
| EventBridge | N/A | ~$1 |
| CloudWatch + X-Ray | Self-managed | ~$30 |
| Secrets Manager | N/A | ~$5 |
| NLB (MLLP) | N/A (direct) | ~$20 |
| HealthLake (optional) | N/A | ~$200 |
| **Total** | **~$150** | **~$690 (without HealthLake) / ~$890 (with)** |

**Key insight:** AWS Hybrid is more expensive at steady-state but provides: managed HA, auto-scaling, zero SFTP server management, built-in monitoring, DLQ-based error handling, and 99.99% SLA. Transfer Family is the largest cost — evaluate whether managed SFTP justifies $432/month vs self-hosted.

**Cost optimization levers:**
- Use Fargate Spot for non-MLLP workloads (60-70% savings)
- Use S3 Intelligent-Tiering (auto lifecycle)
- Use reserved RDS pricing (40% savings on 1-year)
- Transfer Family: evaluate if all partners actually need SFTP vs S3 direct upload

---

## Cloud Provider Comparison Summary

| Capability | AWS | Azure | GCP | Our Engine |
|---|---|---|---|---|
| HL7v2 native store | No | No | **Yes** | Yes (MySQL) |
| MLLP protocol | No | Preview (hybrid only) | **OSS adapter** | **Yes (native)** |
| HL7v2 parsing | No (Lambda + lib) | $convert-data | **API-level** | **Yes (native)** |
| FHIR store | HealthLake | AHDS FHIR | Cloud Healthcare | No (offload) |
| EDI/X12 | **B2B DI (best)** | Logic Apps | No | Basic |
| Managed SFTP | **Transfer Family** | No | No | Self-hosted |
| Workflow | Step Functions | **Logic Apps (best)** | Workflows | Channel pipeline |
| Analytics | Athena/QuickSight | Synapse/Fabric | **BigQuery (best)** | No (offload) |

**Recommendation:** Stay on AWS for infrastructure (strongest SFTP, EDI, and serverless story for your primary focus), keep our engine for MLLP/HL7v2 (no cloud provider matches), and consider GCP's Cloud Healthcare API only if you need a native HL7v2 data store (unlikely given our MySQL-backed message tables).

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Codemod fails on complex E4X patterns | Medium | Medium | Manual review + fallback to legacy mode |
| Transfer Family cost too high | High | Low | Evaluate per-partner; keep self-hosted SFTP for high-volume |
| SQS message size limit (256KB) | Low | Medium | Use S3 extended client for large messages (CDA, DICOM) |
| Cold start latency (if using Lambda) | Medium | Medium | Use Fargate instead of Lambda for latency-sensitive paths |
| Dual-mode runtime complexity | Medium | Medium | Time-box dual-mode to 4 weeks; hard deprecation after |
| MLLP over VPN reliability | Low | High | NLB multi-AZ + health checks + Direct Connect backup |

---

## Verification Plan

1. **TypeScript channel parity:** Convert 5 production channels, run identical messages through both legacy and TS paths, diff outputs
2. **AWS integration test:** Deploy Transfer Family → S3 → SQS → Engine pipeline, send 1000 test files, verify 100% processing
3. **MLLP over NLB:** Send 10,000 HL7v2 messages through NLB → Engine, verify ACK rates and latency
4. **Failover test:** Kill ECS task during processing, verify SQS message redelivery and zero data loss
5. **Cost validation:** Run for 1 week with production-like volume, compare actual vs estimated costs
6. **Performance benchmark:** TS channels vs legacy VM sandbox — expect 2-5x throughput improvement (no transpilation, no VM context creation overhead)

---

## Key Files to Modify

| File | Change |
|---|---|
| `src/sdk/` (NEW) | TypeScript SDK: types, defineChannel, hl7v2, xml, json |
| `src/sdk/ChannelLoader.ts` (NEW) | Dynamic import + hot-reload for .channel.ts files |
| `src/donkey/channel/ChannelBuilder.ts` | Detect TS vs XML channels, route accordingly |
| `src/controllers/EngineController.ts` | Wire TS channel loader alongside XML loader |
| `src/donkey/channel/Channel.ts` | Support direct function invocation (no VM) |
| `src/donkey/channel/FilterTransformerExecutor.ts` | Bypass VM for TS channels |
| `tools/codemod/` (NEW) | XML→TS channel converter |
| `infra/` (NEW) | CDK/Terraform for AWS resources |
| `src/connectors/sqs/` (NEW) | SQS source connector |
| `src/connectors/s3/` (EXTEND) | S3 event-driven source (vs polling) |
