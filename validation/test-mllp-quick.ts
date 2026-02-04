import { MLLPClient } from './clients/MLLPClient';

async function testMLLP() {
  const msg = 'MSH|^~\\&|TEST|FACILITY|DEST|FACILITY|20240115||ADT^A01|123456|P|2.5\rPID|1||PATIENT123||DOE^JOHN||19800101|M\r';

  console.log('Testing Java Mirth MLLP on port 6661...');
  try {
    const client = new MLLPClient({ host: 'localhost', port: 6661, timeout: 10000 });
    const response = await client.send(msg);
    console.log('ACK Code:', response.ackCode);
    console.log('Response:', response.rawResponse?.substring(0, 100).replace(/\r/g, '\\r'));
  } catch (e) {
    console.error('Java MLLP Error:', (e as Error).message);
  }

  console.log('\nTesting Node.js Mirth MLLP on port 6662...');
  try {
    const client = new MLLPClient({ host: 'localhost', port: 6662, timeout: 10000 });
    const response = await client.send(msg);
    console.log('ACK Code:', response.ackCode);
    console.log('Response:', response.rawResponse?.substring(0, 100).replace(/\r/g, '\\r'));
  } catch (e) {
    console.error('Node MLLP Error:', (e as Error).message);
  }
}

testMLLP();
