import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const jsonLatency    = new Trend('json_latency',    true);
const jsonThroughput = new Counter('json_processed', true);
const errorRate      = new Rate('json_error_rate');

const JAVA_MSG_URL   = __ENV.JAVA_MSG_URL   || 'http://java-mirth.mirth-infra.svc.cluster.local';
const NODEJS_MSG_URL = __ENV.NODEJS_MSG_URL || 'http://node-mirth.mirth-benchmark.svc.cluster.local';

// Sample Patient JSON payload
const PATIENT_JSON = JSON.stringify({
  id: 'P-12345',
  name: { given: 'John', family: 'Doe', middle: 'Q' },
  birthDate: '1980-01-15',
  gender: 'male',
  address: {
    line: ['123 Main St', 'Apt 4B'],
    city: 'Anytown',
    state: 'CA',
    postalCode: '90210',
    country: 'US',
  },
  telecom: [
    { system: 'phone', value: '555-0100' },
    { system: 'email', value: 'john.doe@example.com' },
  ],
  identifier: [
    { system: 'MRN', value: '12345' },
    { system: 'SSN', value: '999-99-9999' },
  ],
});

export const options = {
  scenarios: {
    java_json: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 3 },
        { duration: '60s', target: 10 },
        { duration: '10s', target: 0 },
      ],
      startTime: '0s',
      tags: { engine: 'java' },
      env: { TARGET_URL: `${JAVA_MSG_URL}:7091`, ENGINE: 'java' },
    },
    nodejs_json: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 3 },
        { duration: '60s', target: 10 },
        { duration: '10s', target: 0 },
      ],
      startTime: '100s',
      tags: { engine: 'nodejs' },
      env: { TARGET_URL: `${NODEJS_MSG_URL}:7081`, ENGINE: 'nodejs' },
    },
  },
  thresholds: {
    'json_latency{engine:nodejs}':  ['p(95)<500'],
    'json_latency{engine:java}':    ['p(95)<1000'],
    'json_error_rate':              ['rate<0.1'],
  },
};

export default function () {
  const targetUrl = __ENV.TARGET_URL;
  const engine    = __ENV.ENGINE;
  const tags      = { engine };

  const res = http.post(`${targetUrl}/bench-json`, PATIENT_JSON, {
    headers: { 'Content-Type': 'application/json' },
    tags,
  });

  const ok = check(res, {
    'json accepted': (r) => r.status === 200 || r.status === 201,
  });

  jsonLatency.add(res.timings.duration, tags);
  if (ok) {
    jsonThroughput.add(1, tags);
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
  lines.push('  BENCHMARK: JSON TRANSFORM THROUGHPUT');
  lines.push('========================================');
  lines.push('');
  lines.push('  Both engines running natively on ARM64.');
  lines.push('  Java: Temurin JDK 11 | Node.js: v20 Alpine');
  lines.push('');

  lines.push('  json_latency:');
  for (const eng of ['java', 'nodejs']) {
    const key = `json_latency{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      const v = vals.values;
      lines.push(`    engine=${eng}:   p50=${fmt(v['p(50)'])}ms  p95=${fmt(v['p(95)'])}ms  p99=${fmt(v['p(99)'])}ms  avg=${fmt(v.avg)}ms`);
    } else {
      lines.push(`    engine=${eng}:   (no data)`);
    }
  }

  lines.push('');
  lines.push('  json_processed:');
  for (const eng of ['java', 'nodejs']) {
    const key = `json_processed{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      lines.push(`    engine=${eng}:   total=${vals.values.count}`);
    }
  }

  lines.push('');
  for (const eng of ['java', 'nodejs']) {
    const key = `json_error_rate{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      lines.push(`  error_rate (${eng}): ${fmt(vals.values.rate * 100, 2)}%`);
    }
  }

  lines.push('');
  lines.push('========================================');
  return { stdout: lines.join('\n') + '\n' };
}
