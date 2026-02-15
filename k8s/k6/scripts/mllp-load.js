import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const messagesProcessed = new Counter('messages_processed');

const BASE_URL = __ENV.MIRTH_URL || 'http://node-mirth.mirth-cluster.svc.cluster.local';

// Sample HL7 ADT A01 message
const HL7_MESSAGE = [
  'MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20260215120000||ADT^A01|MSG00001|P|2.3|',
  'EVN|A01|20260215120000||',
  'PID|||12345^^^MRN||DOE^JOHN^||19800101|M|||123 MAIN ST^^ANYTOWN^ST^12345||555-1234|||S|||999-99-9999',
  'PV1||I|ICU^0001^01||||1234^SMITH^JOHN^^^DR|||SUR||||ADM|A0|',
].join('\r');

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '60s', target: 10 },
    { duration: '30s', target: 20 },
    { duration: '60s', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<1000'],
    'errors': ['rate<0.05'],
  },
};

export default function () {
  // Send HL7 message to HTTP Gateway (port 8090)
  const res = http.post(`${BASE_URL}:8090`, HL7_MESSAGE, {
    headers: { 'Content-Type': 'text/plain' },
  });

  const success = check(res, {
    'message accepted': (r) => r.status === 200 || r.status === 201,
  });

  if (success) {
    messagesProcessed.add(1);
  }
  errorRate.add(!success);

  sleep(0.2);
}
