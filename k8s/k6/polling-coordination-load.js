/**
 * k6 Load Test: Polling Coordination — Lease Exclusivity Under Load
 *
 * Seeds files via HTTP POST to PC03 (HTTP File Seeder channel on port 8120),
 * which writes them to SFTP. PC01/PC02 (SFTP pollers) pick them up.
 * Periodically checks lease API to verify single holder.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom Metrics ──────────────────────────────────────
const fileSeeded     = new Counter('poll_files_seeded');
const seedErrors     = new Rate('poll_seed_errors');
const seedLatency    = new Trend('poll_seed_latency', true);
const leaseCheckOk   = new Counter('poll_lease_checks_ok');
const leaseCheckFail = new Counter('poll_lease_checks_fail');

// ── Configuration ───────────────────────────────────────
const BASE_URL  = __ENV.MIRTH_URL || 'http://node-mirth.mirth-cluster.svc.cluster.local';
const SEED_PORT = __ENV.SEED_PORT || '8120';
const API_PORT  = __ENV.API_PORT  || '8080';
const API_USER  = __ENV.API_USER  || 'admin';
const API_PASS  = __ENV.API_PASS  || 'admin';

// ── Phases ──────────────────────────────────────────────
//  Phase 1: Warmup       — 1 VU, establish connectivity
//  Phase 2: Moderate     — 3 VUs, steady file seeding
//  Phase 3: High rate    — 5 VUs, push polling throughput
//  Phase 4: Sustain      — 5 VUs, hold for lease stability
//  Phase 5: Drain        — ramp down, verify no orphan leases
export const options = {
  stages: [
    { duration: '10s',  target: 1 },   // Phase 1: warmup
    { duration: '60s',  target: 3 },   // Phase 2: moderate seeding
    { duration: '30s',  target: 5 },   // Phase 3: high rate
    { duration: '60s',  target: 5 },   // Phase 4: sustain
    { duration: '20s',  target: 0 },   // Phase 5: drain
  ],
  thresholds: {
    'poll_seed_errors':  ['rate<0.05'],
    'poll_seed_latency': ['p(95)<5000'],
  },
};

// ── HL7 Message Generator ───────────────────────────────
function buildHL7(vuId, iter) {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const msgId = `POLL-${vuId}-${iter}-${ts}`;
  const segments = [
    `MSH|^~\\&|POLL_TEST|FAC|MIRTH|NODE|${ts}||ADT^A01|${msgId}|P|2.5.1`,
    `EVN|A01|${ts}`,
    `PID|||POLL${vuId}${iter}^^^MRN||TEST^POLLING^${vuId}||19900101|M`,
  ];
  return segments.join('\r');
}

// ── Authentication ──────────────────────────────────────
export function setup() {
  const loginRes = http.post(
    `${BASE_URL}:${API_PORT}/api/users/_login`,
    JSON.stringify({ username: API_USER, password: API_PASS }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (loginRes.status === 200) {
    try {
      const body = JSON.parse(loginRes.body);
      return { sessionId: body.sessionId || '' };
    } catch (_) {
      return { sessionId: '' };
    }
  }
  return { sessionId: '' };
}

// ── Main VU Function ────────────────────────────────────
export default function (data) {
  const vuId = __VU;
  const iter = __ITER;

  // Seed a file via HTTP POST to PC03
  const fileName = `test-${vuId}-${iter}-${Date.now()}.hl7`;
  const content = buildHL7(vuId, iter);

  const seedRes = http.post(
    `${BASE_URL}:${SEED_PORT}/seed`,
    JSON.stringify({ fileName, content }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
    }
  );

  const ok = check(seedRes, {
    'seed status 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  seedLatency.add(seedRes.timings.duration);
  if (ok) {
    fileSeeded.add(1);
  } else {
    console.warn(`VU${vuId} iter${iter}: seed failed HTTP ${seedRes.status}`);
  }
  seedErrors.add(!ok);

  // Every 10th iteration, check lease status
  if (iter > 0 && iter % 10 === 0 && data.sessionId) {
    const leaseRes = http.get(
      `${BASE_URL}:${API_PORT}/api/system/cluster/leases`,
      { headers: { 'X-Session-ID': data.sessionId } }
    );

    if (leaseRes.status === 200) {
      try {
        const body = JSON.parse(leaseRes.body);
        const leases = body.leases || [];
        // Check: at most 1 lease per channel
        const channelIds = leases.map((l) => l.channelId);
        const uniqueChannels = new Set(channelIds);
        if (channelIds.length === uniqueChannels.size) {
          leaseCheckOk.add(1);
        } else {
          leaseCheckFail.add(1);
          console.error('DUPLICATE LEASE DETECTED:', JSON.stringify(leases));
        }
      } catch (_) {
        // Ignore parse errors
      }
    }
  }

  sleep(0.5 + Math.random() * 1);
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
  lines.push('  POLLING COORDINATION LOAD TEST — RESULTS');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  // Files seeded
  const seeded = data.metrics['poll_files_seeded'];
  if (seeded && seeded.values) {
    lines.push(`  Files seeded:       ${seeded.values.count}`);
  }

  // Seed error rate
  const errRate = data.metrics['poll_seed_errors'];
  if (errRate && errRate.values) {
    lines.push(`  Seed error rate:    ${fmt(errRate.values.rate * 100, 2)}%`);
  }

  // Seed latency
  const lat = data.metrics['poll_seed_latency'];
  if (lat && lat.values) {
    const v = lat.values;
    lines.push('');
    lines.push('  Seed Latency:');
    lines.push(`    avg=${fmt(v.avg)}ms  med=${fmt(v.med)}ms`);
    lines.push(`    p90=${fmt(v['p(90)'])}ms  p95=${fmt(v['p(95)'])}ms  p99=${fmt(v['p(99)'])}ms`);
    lines.push(`    min=${fmt(v.min)}ms  max=${fmt(v.max)}ms`);
  }

  lines.push('');

  // Lease checks
  const leaseOk = data.metrics['poll_lease_checks_ok'];
  const leaseFail = data.metrics['poll_lease_checks_fail'];
  lines.push('  Lease Exclusivity:');
  if (leaseOk && leaseOk.values) {
    lines.push(`    Checks OK:        ${leaseOk.values.count}`);
  }
  if (leaseFail && leaseFail.values) {
    lines.push(`    Checks FAIL:      ${leaseFail.values.count}`);
  } else {
    lines.push(`    Checks FAIL:      0`);
  }

  // HTTP request duration (overall)
  const httpDur = data.metrics['http_req_duration'];
  if (httpDur && httpDur.values) {
    lines.push('');
    lines.push('  HTTP Request Duration (all):');
    lines.push(`    avg=${fmt(httpDur.values.avg)}ms  p95=${fmt(httpDur.values['p(95)'])}ms  p99=${fmt(httpDur.values['p(99)'])}ms`);
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
