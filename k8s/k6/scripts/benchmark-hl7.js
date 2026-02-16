import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const hl7Latency    = new Trend('hl7_latency',    true);
const hl7Throughput = new Counter('hl7_processed', true);
const errorRate     = new Rate('hl7_error_rate');

const JAVA_MSG_URL   = __ENV.JAVA_MSG_URL   || 'http://java-mirth.mirth-infra.svc.cluster.local';
const NODEJS_MSG_URL = __ENV.NODEJS_MSG_URL || 'http://node-mirth.mirth-benchmark.svc.cluster.local';

// Sample HL7 ADT A01 message
const HL7_MESSAGE = [
  'MSH|^~\\&|BENCHMARK|FACILITY|RECEIVING|FACILITY|20260215120000||ADT^A01|MSG${__VU}${__ITER}|P|2.3|',
  'EVN|A01|20260215120000||',
  'PID|||12345^^^MRN||DOE^JOHN^||19800101|M|||123 MAIN ST^^ANYTOWN^ST^12345||555-1234|||S|||999-99-9999',
  'PV1||I|ICU^0001^01||||1234^SMITH^JOHN^^^DR|||SUR||||ADM|A0|',
].join('\r');

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    java_hl7: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 3 },   // warmup
        { duration: '60s', target: 10 },  // load
        { duration: '10s', target: 0 },   // ramp down
      ],
      startTime: '0s',
      tags: { engine: 'java' },
      env: { TARGET_URL: `${JAVA_MSG_URL}:7092`, ENGINE: 'java' },
    },
    nodejs_hl7: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 3 },
        { duration: '60s', target: 10 },
        { duration: '10s', target: 0 },
      ],
      startTime: '100s',  // 90s for java + 10s gap
      tags: { engine: 'nodejs' },
      env: { TARGET_URL: `${NODEJS_MSG_URL}:7082`, ENGINE: 'nodejs' },
    },
  },
  thresholds: {
    'hl7_latency{engine:nodejs}':  ['p(95)<500'],
    'hl7_latency{engine:java}':    ['p(95)<1000'],
    'hl7_processed{engine:nodejs}': ['count>=0'],
    'hl7_processed{engine:java}':   ['count>=0'],
    'hl7_error_rate{engine:nodejs}': ['rate<0.1'],
    'hl7_error_rate{engine:java}':   ['rate<0.1'],
    'hl7_error_rate':              ['rate<0.1'],
  },
};

export default function () {
  const targetUrl = __ENV.TARGET_URL;
  const engine    = __ENV.ENGINE;
  const tags      = { engine };

  // Generate unique message ID per iteration
  const msgId = `MSG${__VU}-${__ITER}-${Date.now()}`;
  const message = HL7_MESSAGE.replace('MSG${__VU}${__ITER}', msgId);

  const res = http.post(`${targetUrl}/bench-hl7/`, message, {
    headers: { 'Content-Type': 'text/plain' },
    tags,
  });

  const ok = check(res, {
    'hl7 accepted': (r) => r.status === 200 || r.status === 201,
  });

  hl7Latency.add(res.timings.duration, tags);
  if (ok) {
    hl7Throughput.add(1, tags);
  }
  errorRate.add(!ok, tags);

  sleep(0.1);
}

// Helper: safely format a metric value
function fmt(val, decimals) {
  if (val === undefined || val === null) return 'N/A';
  return typeof val === 'number' ? val.toFixed(decimals || 0) : String(val);
}

export function handleSummary(data) {
  const lines = [];
  lines.push('');
  lines.push('========================================');
  lines.push('  BENCHMARK: HL7 MESSAGE PROCESSING');
  lines.push('========================================');
  lines.push('');
  lines.push('  Both engines running natively on ARM64.');
  lines.push('  Java: Temurin JDK 11 | Node.js: v20 Alpine');
  lines.push('');

  lines.push('  hl7_latency:');
  for (const eng of ['java', 'nodejs']) {
    const key = `hl7_latency{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      const v = vals.values;
      lines.push(`    engine=${eng}:   p50=${fmt(v.med)}ms  p95=${fmt(v['p(95)'])}ms  p99=${fmt(v['p(99)'])}ms  avg=${fmt(v.avg)}ms`);
    } else {
      lines.push(`    engine=${eng}:   (no data)`);
    }
  }

  lines.push('');
  for (const eng of ['java', 'nodejs']) {
    const key = `hl7_processed{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      lines.push(`  total_messages (${eng}): ${vals.values.count}`);
    }
  }

  lines.push('');
  for (const eng of ['java', 'nodejs']) {
    const key = `hl7_error_rate{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      lines.push(`  error_rate (${eng}): ${fmt(vals.values.rate * 100, 2)}%`);
    }
  }

  lines.push('');
  lines.push('========================================');
  return { stdout: lines.join('\n') + '\n' };
}
