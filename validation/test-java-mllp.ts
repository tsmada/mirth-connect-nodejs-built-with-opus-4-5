import { MLLPClient } from './clients/MLLPClient';

async function test() {
  // Java Mirth's MLLP is on port 6661 (Docker mapped)
  // But the channel listens on 6665 inside container
  // Need to check what port Java channel is on
  
  const client = new MLLPClient({
    host: 'localhost',
    port: 6661, // Docker-mapped Java Mirth MLLP
    timeout: 30000, // Longer timeout for ARM emulation
    retryCount: 1
  });
  
  const message = `MSH|^~\\&|TEST|FAC|RECV|FAC|20260201||ADT^A01|123|P|2.3\rPID|||12345||Doe^John`;

  console.log('Sending HL7 to Java Mirth MLLP on 6661...');
  const response = await client.send(message);
  console.log('Response:', JSON.stringify(response, null, 2));
}

test().catch(e => console.error('Error:', e));
