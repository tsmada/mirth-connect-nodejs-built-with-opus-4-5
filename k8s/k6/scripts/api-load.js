import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const healthLatency = new Trend('health_latency');

// Target the Node.js Mirth service in the cluster namespace
const BASE_URL = __ENV.MIRTH_URL || 'http://node-mirth.mirth-cluster.svc.cluster.local:8080';

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp to 10 VUs
    { duration: '60s', target: 10 },   // Hold at 10
    { duration: '30s', target: 50 },   // Ramp to 50 VUs
    { duration: '60s', target: 50 },   // Hold at 50
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],
    'errors': ['rate<0.01'],
  },
};

export default function () {
  // Health check (most lightweight)
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health status 200': (r) => r.status === 200,
    'health has serverId': (r) => JSON.parse(r.body).serverId !== undefined,
  });
  healthLatency.add(healthRes.timings.duration);
  errorRate.add(healthRes.status !== 200);

  sleep(0.1);

  // Login and get session
  const loginRes = http.post(
    `${BASE_URL}/api/users/_login?username=admin`,
    'admin',
    {
      headers: {
        'Content-Type': 'text/plain',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }
  );

  if (loginRes.status === 200) {
    const sessionId = loginRes.headers['X-Session-Id'] || loginRes.headers['x-session-id'];

    if (sessionId) {
      // Get channels
      const channelsRes = http.get(`${BASE_URL}/api/channels`, {
        headers: { 'X-Session-ID': sessionId },
      });
      check(channelsRes, {
        'channels status 200': (r) => r.status === 200,
      });
      errorRate.add(channelsRes.status !== 200);
    }
  }

  sleep(0.5);
}
