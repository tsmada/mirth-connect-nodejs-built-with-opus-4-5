import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.MIRTH_URL || 'http://node-mirth.mirth-shadow.svc.cluster.local:8080';

const shadowBlocked = new Rate('shadow_blocked');
const afterCutover = new Rate('after_cutover');

export const options = {
  duration: '3m',
  vus: 5,
};

export default function () {
  // Check health — should always succeed even in shadow mode
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health returns 200': (r) => r.status === 200,
  });

  // Try to get shadow status
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
      const shadowRes = http.get(`${BASE_URL}/api/system/shadow`, {
        headers: { 'X-Session-ID': sessionId },
      });

      check(shadowRes, {
        'shadow status accessible': (r) => r.status === 200,
      });

      // Try a write operation — should be blocked (409) in shadow mode
      const writeRes = http.post(`${BASE_URL}/api/channels`, '<channel/>', {
        headers: {
          'Content-Type': 'application/xml',
          'X-Session-ID': sessionId,
        },
      });

      if (writeRes.status === 409) {
        shadowBlocked.add(1);
      } else {
        afterCutover.add(1);
      }
    }
  }

  sleep(1);
}
