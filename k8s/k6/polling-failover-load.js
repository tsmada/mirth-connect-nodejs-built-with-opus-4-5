/**
 * k6 Load Test: Polling Coordination — Failover Under Load
 *
 * Seeds files via HTTP POST to PC03 (HTTP File Seeder channel on port 8120),
 * which writes them to SFTP. PC01/PC02 (SFTP pollers) pick them up.
 * Designed for failover testing: longer duration, lower VU count.
 * The orchestration script kills the lease-holder pod at T+60s externally.
 * Periodically checks lease API to verify single holder after failover.
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
//  Phase 1: Warmup          — 1 VU, establish connectivity
//  Phase 2: Steady          — 2 VUs, continuous seeding (pod kill at T+60s externally)
//  Phase 3: Post-failover   — 2 VUs, verify recovery + continued processing
//  Phase 4: Drain           — ramp down, verify no orphan leases
export const options = {
  stages: [
    { duration: '10s',  target: 1 },   // Phase 1: warmup
    { duration: '120s', target: 2 },   // Phase 2: steady — pod kill at T+60s externally
    { duration: '60s',  target: 2 },   // Phase 3: post-failover seeding
    { duration: '20s',  target: 0 },   // Phase 4: drain
  ],
  thresholds: {
    'poll_seed_errors': ['rate<0.10'],  // 10% tolerance during failover window
  },
};

// ── HL7 Message Generator ───────────────────────────────
function buildHL7(vuId, iter) {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const msgId = `FAILOVER-${vuId}-${iter}-${ts}`;
  const segments = [
    `MSH|^~\\&|FAILOVER_TEST|FAC|MIRTH|NODE|${ts}||ADT^A01|${msgId}|P|2.5.1`,
    `EVN|A01|${ts}`,
    `PID|||FAIL${vuId}${iter}^^^MRN||TEST^FAILOVER^${vuId}||19900101|M`,
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
  const fileName = `failover-${vuId}-${iter}-${Date.now()}.hl7`;
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

  // Every 5th iteration, check lease status (more frequent than coordination test
  // to catch transient duplicate leases during failover window)
  if (iter > 0 && iter % 5 === 0 && data.sessionId) {
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

  // Longer sleep between requests — failover test prioritizes duration over throughput
  sleep(1 + Math.random() * 1);
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
  lines.push('  POLLING FAILOVER LOAD TEST — RESULTS');
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
  lines.push('  Lease Exclusivity (failover):');
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
