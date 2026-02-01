import { MLLPClient } from './clients/MLLPClient';

async function test() {
  const client = new MLLPClient({
    host: 'localhost',
    port: 6665,
    timeout: 10000,
    retryCount: 1
  });
  
  const message = `MSH|^~\\&|TEST|FAC|RECV|FAC|20260201||ADT^A01|123|P|2.3\rPID|||12345||Doe^John`;

  console.log('Sending HL7 to Node.js MLLP on 6665...');
  const response = await client.send(message);
  console.log('Response:', JSON.stringify(response, null, 2));
}

test().catch(e => console.error('Error:', e));
