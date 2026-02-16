import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Metrics (engine-tagged) ──────────────────────────
const healthLatency   = new Trend('health_latency',   true);
const loginLatency    = new Trend('login_latency',    true);
const channelLatency  = new Trend('channel_latency',  true);
const statusLatency   = new Trend('status_latency',   true);
const errorRate       = new Rate('error_rate');
const requestCount    = new Counter('total_requests');

// ── Endpoints ────────────────────────────────────────
const JAVA_API   = __ENV.JAVA_API_URL   || 'https://java-mirth.mirth-infra.svc.cluster.local:8443';
const NODEJS_API = __ENV.NODEJS_API_URL || 'http://node-mirth.mirth-benchmark.svc.cluster.local:8080';

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    java_api: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },   // warmup
        { duration: '60s', target: 10 },  // steady
        { duration: '60s', target: 25 },  // peak
        { duration: '10s', target: 0 },   // ramp down
      ],
      startTime: '0s',
      tags: { engine: 'java' },
      env: { TARGET_URL: JAVA_API, ENGINE: 'java' },
    },
    nodejs_api: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '60s', target: 10 },
        { duration: '60s', target: 25 },
        { duration: '10s', target: 0 },
      ],
      startTime: '170s',  // 160s for java + 10s gap
      tags: { engine: 'nodejs' },
      env: { TARGET_URL: NODEJS_API, ENGINE: 'nodejs' },
    },
  },
  thresholds: {
    'health_latency{engine:nodejs}':  ['p(95)<200'],
    'health_latency{engine:java}':    ['p(95)<500'],
    'login_latency{engine:nodejs}':   ['p(95)<300'],
    'login_latency{engine:java}':     ['p(95)<800'],
    'channel_latency{engine:nodejs}': ['p(95)<300'],
    'channel_latency{engine:java}':   ['p(95)<800'],
    'error_rate':                     ['rate<0.05'],
  },
};

export default function () {
  const targetUrl = __ENV.TARGET_URL;
  const engine    = __ENV.ENGINE;
  const isJava    = engine === 'java';
  const tags      = { engine };
  const tlsOpts   = isJava ? { insecureSkipTLSVerify: true } : {};

  // ── Health Check ─────────────────────────────────
  group('health', function () {
    const healthPath = isJava ? '/api/server/version' : '/api/health';
    const res = http.get(`${targetUrl}${healthPath}`, Object.assign({ tags }, tlsOpts));
    check(res, { 'health 200': (r) => r.status === 200 });
    healthLatency.add(res.timings.duration, tags);
    errorRate.add(res.status !== 200, tags);
    requestCount.add(1, tags);
  });

  sleep(0.1);

  // ── Login ────────────────────────────────────────
  // Java Mirth: form-urlencoded + JSESSIONID cookie
  // Node.js Mirth: JSON body + X-Session-ID header
  let authHeaders = {};
  let loginOk = false;
  group('login', function () {
    let res;
    if (isJava) {
      res = http.post(
        `${targetUrl}/api/users/_login`,
        'username=admin&password=admin',
        Object.assign({
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
          },
          tags,
        }, tlsOpts)
      );
      // k6 automatically handles Set-Cookie → cookie jar for subsequent requests
      authHeaders = {};
    } else {
      res = http.post(
        `${targetUrl}/api/users/_login`,
        JSON.stringify({ username: 'admin', password: 'admin' }),
        Object.assign({
          headers: {
            'Content-Type': 'application/json',
          },
          tags,
        }, tlsOpts)
      );
      const sid = res.headers['X-Session-Id'] || res.headers['x-session-id'];
      if (sid) {
        authHeaders = { 'X-Session-ID': sid };
      }
    }
    check(res, { 'login 200': (r) => r.status === 200 });
    loginLatency.add(res.timings.duration, tags);
    errorRate.add(res.status !== 200, tags);
    requestCount.add(1, tags);
    loginOk = res.status === 200;
  });

  if (!loginOk) {
    sleep(0.5);
    return;
  }

  sleep(0.1);

  // ── Channel List ─────────────────────────────────
  group('channels', function () {
    const res = http.get(`${targetUrl}/api/channels`, Object.assign({
      headers: authHeaders,
      tags,
    }, tlsOpts));
    check(res, { 'channels 200': (r) => r.status === 200 });
    channelLatency.add(res.timings.duration, tags);
    errorRate.add(res.status !== 200, tags);
    requestCount.add(1, tags);
  });

  sleep(0.1);

  // ── Channel Statuses ─────────────────────────────
  group('statuses', function () {
    const res = http.get(`${targetUrl}/api/channels/statuses`, Object.assign({
      headers: authHeaders,
      tags,
    }, tlsOpts));
    check(res, { 'statuses 200': (r) => r.status === 200 || r.status === 204 });
    statusLatency.add(res.timings.duration, tags);
    errorRate.add(res.status !== 200 && res.status !== 204, tags);
    requestCount.add(1, tags);
  });

  sleep(0.3);
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
  lines.push('  BENCHMARK: REST API COMPARISON');
  lines.push('========================================');
  lines.push('');
  lines.push('  Both engines running natively on ARM64.');
  lines.push('  Java: Temurin JDK 11 | Node.js: v20 Alpine');
  lines.push('');

  const metrics = ['health_latency', 'login_latency', 'channel_latency', 'status_latency'];
  for (const m of metrics) {
    lines.push(`  ${m}:`);
    for (const eng of ['java', 'nodejs']) {
      const key = `${m}{engine:${eng}}`;
      const vals = data.metrics[key];
      if (vals && vals.values) {
        const v = vals.values;
        lines.push(`    engine=${eng}:   p50=${fmt(v['p(50)'])}ms  p95=${fmt(v['p(95)'])}ms  p99=${fmt(v['p(99)'])}ms`);
      } else {
        lines.push(`    engine=${eng}:   (no data)`);
      }
    }
    lines.push('');
  }

  // Total requests per engine
  for (const eng of ['java', 'nodejs']) {
    const key = `total_requests{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      lines.push(`  total_requests (${eng}): ${vals.values.count}`);
    }
  }

  // Error rates
  for (const eng of ['java', 'nodejs']) {
    const key = `error_rate{engine:${eng}}`;
    const vals = data.metrics[key];
    if (vals && vals.values) {
      lines.push(`  error_rate (${eng}): ${fmt(vals.values.rate * 100, 2)}%`);
    }
  }

  lines.push('');
  lines.push('========================================');
  const summary = lines.join('\n');
  return {
    stdout: summary + '\n',
  };
}
