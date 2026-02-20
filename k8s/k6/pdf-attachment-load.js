/**
 * k6 Load Test: High-Volume Base64 PDF Attachment Messages
 *
 * Generates ~10MB of base64-encoded synthetic PDF data per message and sends it
 * through the Node.js Mirth HTTP connector to stress:
 *   - V8 heap (large string allocations per request)
 *   - GC pressure (major GC from large buffer churn)
 *   - MySQL I/O (13MB+ LONGTEXT writes to D_MC content tables)
 *   - Network throughput (container-to-container TCP)
 *   - HPA scaling triggers (CPU + memory pressure)
 *
 * The test ramps VUs slowly because each request is ~13MB — even 5 concurrent VUs
 * means ~65MB/s of payload throughput, which is substantial for a single-pod setup.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import encoding from 'k6/encoding';

// ── Custom Metrics ──────────────────────────────────────
const errorRate        = new Rate('pdf_errors');
const msgLatency       = new Trend('pdf_msg_latency', true);
const msgProcessed     = new Counter('pdf_msgs_processed');
const msgFailed        = new Counter('pdf_msgs_failed');
const payloadSizeMB    = new Gauge('pdf_payload_size_mb');

// ── Configuration ───────────────────────────────────────
const BASE_URL       = __ENV.MIRTH_URL || 'http://node-mirth.mirth-cluster.svc.cluster.local';
const HTTP_PORT      = __ENV.HTTP_PORT || '8095';  // http-json channel
const PDF_SIZE_MB    = parseInt(__ENV.PDF_SIZE_MB || '10', 10);
const RAMP_DURATION  = __ENV.RAMP_DURATION || '30s';
const HOLD_DURATION  = __ENV.HOLD_DURATION || '120s';
const PEAK_DURATION  = __ENV.PEAK_DURATION || '120s';

// ── Phases ──────────────────────────────────────────────
//  Phase 1: Warmup      — 1-3 VUs, establish baseline latency
//  Phase 2: Steady       — 5 VUs, sustained large-payload throughput
//  Phase 3: Peak         — 10 VUs, trigger HPA scale-up
//  Phase 4: Spike        — 15 VUs, push past comfortable limits
//  Phase 5: Recovery     — ramp down, verify pods stay healthy
export const options = {
  stages: [
    { duration: RAMP_DURATION,  target: 3  },   // Phase 1: warmup
    { duration: HOLD_DURATION,  target: 5  },   // Phase 2: steady state
    { duration: '30s',          target: 10 },   // Phase 3: ramp to peak
    { duration: PEAK_DURATION,  target: 10 },   // Phase 3: hold peak
    { duration: '30s',          target: 15 },   // Phase 4: spike
    { duration: '60s',          target: 15 },   // Phase 4: hold spike
    { duration: '30s',          target: 0  },   // Phase 5: recovery
  ],
  thresholds: {
    'pdf_msg_latency':   ['p(95)<10000', 'p(99)<20000'],  // 10s p95, 20s p99 (large payloads!)
    'pdf_errors':        ['rate<0.10'],                     // <10% error rate
    'http_req_duration': ['p(95)<15000'],                   // overall p95
  },
  // Generous timeouts for large payloads
  httpTimeout: '60s',
};

// ── PDF Data Generation ─────────────────────────────────
// Generate a synthetic PDF-like binary blob. Real PDF headers make it
// recognizable in hex dumps / attachment viewers. The bulk is random bytes
// to defeat any compression and ensure we stress raw I/O.
function generatePDFBlob(sizeMB) {
  const sizeBytes = sizeMB * 1024 * 1024;
  // PDF header (valid enough to pass magic-byte sniffing)
  const pdfHeader = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';
  const pdfFooter = '\n%%EOF';
  const headerBytes = pdfHeader.length;
  const footerBytes = pdfFooter.length;
  const fillSize = sizeBytes - headerBytes - footerBytes;

  // Build fill content — use repeating pattern (k6 doesn't have crypto.getRandomValues)
  // We use a mix of printable chars to create diverse byte patterns
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunkSize = 4096;
  let chunk = '';
  for (let i = 0; i < chunkSize; i++) {
    chunk += chars[i % chars.length];
  }

  // Repeat chunk to fill target size
  const repeats = Math.ceil(fillSize / chunkSize);
  let fill = '';
  for (let i = 0; i < repeats; i++) {
    fill += chunk;
  }
  fill = fill.substring(0, fillSize);

  return pdfHeader + fill + pdfFooter;
}

// Pre-generate the PDF blob once during init (runs outside VU context)
const pdfBlob = generatePDFBlob(PDF_SIZE_MB);
const pdfBase64 = encoding.b64encode(pdfBlob);
const payloadSizeActualMB = (pdfBase64.length / (1024 * 1024)).toFixed(2);

// Report payload size
console.log(`PDF blob size: ${PDF_SIZE_MB}MB raw → ${payloadSizeActualMB}MB base64`);

// ── Message Templates ───────────────────────────────────
function buildHL7WithAttachment(vuId, iter) {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const msgId = `PDF-${vuId}-${iter}-${timestamp}`;

  // HL7 ADT A01 with OBX segment containing base64 PDF
  // OBX-5 carries the base64 payload as Encapsulated Data (ED type)
  const segments = [
    `MSH|^~\\&|PDF_LOAD_TEST|FACILITY|MIRTH|CLUSTER|${timestamp}||ADT^A01|${msgId}|P|2.3|`,
    `EVN|A01|${timestamp}||`,
    `PID|||PDF${vuId}${iter}^^^MRN||STRESS^TEST^${vuId}||19900101|M|||456 LOAD ST^^TESTCITY^TS^99999||555-9999|||S|||888-88-8888`,
    `PV1||I|ICU^0001^01||||5678^JONES^SARAH^^^DR|||RAD||||ADM|A0|`,
    `OBX|1|ED|PDF^Diagnostic Report^LN||^application^pdf^Base64^${pdfBase64}||||||F`,
  ];
  return segments.join('\r');
}

function buildJSONWithAttachment(vuId, iter) {
  const timestamp = new Date().toISOString();
  const msgId = `PDF-${vuId}-${iter}`;

  return JSON.stringify({
    messageId: msgId,
    timestamp: timestamp,
    patient: {
      mrn: `PDF${vuId}${iter}`,
      name: { family: 'STRESS', given: `TEST_VU${vuId}` },
      birthDate: '1990-01-01',
      gender: 'male',
    },
    document: {
      type: 'Diagnostic Report',
      contentType: 'application/pdf',
      encoding: 'base64',
      size: pdfBlob.length,
      data: pdfBase64,
    },
    metadata: {
      source: 'k6-pdf-load-test',
      vuId: vuId,
      iteration: iter,
    },
  });
}

// ── Main VU Function ────────────────────────────────────
export default function () {
  const vuId = __VU;
  const iter = __ITER;

  // Alternate between HL7 and JSON formats to stress both code paths
  const useHL7 = iter % 2 === 0;

  let payload, contentType, targetUrl;
  if (useHL7) {
    payload = buildHL7WithAttachment(vuId, iter);
    contentType = 'text/plain';
    // Send to HTTP gateway (port 8090) — Kitchen Sink CH02 contextPath: /api/patient
    targetUrl = `${BASE_URL}:8090/api/patient`;
  } else {
    payload = buildJSONWithAttachment(vuId, iter);
    contentType = 'application/json';
    // Send JSON to HTTP Gateway too (port 8090) — CH02 accepts any content type
    targetUrl = `${BASE_URL}:8090/api/patient`;
  }

  payloadSizeMB.add(payload.length / (1024 * 1024));

  const res = http.post(targetUrl, payload, {
    headers: {
      'Content-Type': contentType,
      'X-Load-Test': 'pdf-attachment',
      'X-VU-Id': String(vuId),
      'X-Iteration': String(iter),
    },
    timeout: '60s',
  });

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  msgLatency.add(res.timings.duration);
  if (ok) {
    msgProcessed.add(1);
  } else {
    msgFailed.add(1);
    if (res.status !== 0) {
      console.warn(`VU${vuId} iter${iter}: HTTP ${res.status} — ${(res.body || '').substring(0, 200)}`);
    } else {
      console.warn(`VU${vuId} iter${iter}: Connection error (timeout or refused)`);
    }
  }
  errorRate.add(!ok);

  // Longer sleep between requests — each payload is enormous.
  // At 10MB per message, even 1 req/s per VU = 10MB/s per VU.
  sleep(2 + Math.random() * 2);  // 2-4 seconds between requests
}

// ── Summary Reporter ────────────────────────────────────
function fmt(val, decimals) {
  if (val === undefined || val === null) return 'N/A';
  return typeof val === 'number' ? val.toFixed(decimals || 0) : String(val);
}

export function handleSummary(data) {
  const lines = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('  PDF ATTACHMENT LOAD TEST — RESULTS');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`  Payload: ${PDF_SIZE_MB}MB PDF → ${payloadSizeActualMB}MB base64`);
  lines.push('');

  // Latency
  const lat = data.metrics['pdf_msg_latency'];
  if (lat && lat.values) {
    const v = lat.values;
    lines.push('  Latency:');
    lines.push(`    avg=${fmt(v.avg)}ms  med=${fmt(v.med)}ms`);
    lines.push(`    p90=${fmt(v['p(90)'])}ms  p95=${fmt(v['p(95)'])}ms  p99=${fmt(v['p(99)'])}ms`);
    lines.push(`    min=${fmt(v.min)}ms  max=${fmt(v.max)}ms`);
  }

  lines.push('');

  // Throughput
  const processed = data.metrics['pdf_msgs_processed'];
  const failed = data.metrics['pdf_msgs_failed'];
  if (processed && processed.values) {
    lines.push(`  Messages processed: ${processed.values.count}`);
  }
  if (failed && failed.values) {
    lines.push(`  Messages failed:    ${failed.values.count}`);
  }

  // Error rate
  const errRate = data.metrics['pdf_errors'];
  if (errRate && errRate.values) {
    lines.push(`  Error rate:         ${fmt(errRate.values.rate * 100, 2)}%`);
  }

  // Payload size
  const pSize = data.metrics['pdf_payload_size_mb'];
  if (pSize && pSize.values) {
    lines.push(`  Avg payload:        ${fmt(pSize.values.value, 2)}MB`);
  }

  // HTTP request duration (overall)
  const httpDur = data.metrics['http_req_duration'];
  if (httpDur && httpDur.values) {
    lines.push('');
    lines.push('  HTTP Request Duration (all):');
    lines.push(`    avg=${fmt(httpDur.values.avg)}ms  p95=${fmt(httpDur.values['p(95)'])}ms  p99=${fmt(httpDur.values['p(99)'])}ms`);
  }

  // Data transfer
  const dataSent = data.metrics['data_sent'];
  const dataRecv = data.metrics['data_received'];
  if (dataSent && dataSent.values) {
    const sentGB = dataSent.values.count / (1024 * 1024 * 1024);
    lines.push('');
    lines.push(`  Data sent:     ${fmt(sentGB, 3)} GB`);
  }
  if (dataRecv && dataRecv.values) {
    const recvMB = dataRecv.values.count / (1024 * 1024);
    lines.push(`  Data received: ${fmt(recvMB, 1)} MB`);
  }

  // Iterations
  const iters = data.metrics['iterations'];
  if (iters && iters.values) {
    lines.push('');
    lines.push(`  Total iterations: ${iters.values.count}`);
    lines.push(`  Iterations/s:     ${fmt(iters.values.rate, 2)}`);
  }

  // VU stats
  const vus = data.metrics['vus_max'];
  if (vus && vus.values) {
    lines.push(`  Peak VUs:         ${vus.values.value}`);
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');

  return {
    stdout: lines.join('\n') + '\n',
  };
}
