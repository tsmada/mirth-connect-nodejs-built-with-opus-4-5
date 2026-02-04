/**
 * Quick Validation Script
 *
 * Tests MLLP message flow on already-deployed channels.
 * Assumes channels are already deployed on ports 6661 (Java) and 6662 (Node.js).
 */
import * as fs from 'fs';
import * as path from 'path';
import { MLLPClient } from './clients/MLLPClient';

interface TestMessage {
  name: string;
  file: string;
}

interface ValidationResult {
  message: string;
  javaAck: string | null;
  nodeAck: string | null;
  match: boolean;
  javaResponse?: string;
  nodeResponse?: string;
}

const TEST_MESSAGES: TestMessage[] = [
  { name: 'Simple ADT', file: 'fixtures/messages/hl7v2/simple-adt.hl7' },
  { name: 'ADT A01', file: 'fixtures/messages/hl7v2/adt-a01.hl7' },
  { name: 'ORU R01', file: 'fixtures/messages/hl7v2/oru-r01.hl7' },
];

async function quickValidate(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Quick MLLP Validation');
  console.log('='.repeat(60));
  console.log('Java MLLP: localhost:6661');
  console.log('Node MLLP: localhost:6662');
  console.log('='.repeat(60));

  const results: ValidationResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const testMsg of TEST_MESSAGES) {
    console.log(`\n[${testMsg.name}]`);

    // Load message
    const msgPath = path.join(process.cwd(), testMsg.file);
    if (!fs.existsSync(msgPath)) {
      console.log(`  SKIP: Message file not found: ${testMsg.file}`);
      continue;
    }
    const message = fs.readFileSync(msgPath, 'utf8');

    const result: ValidationResult = {
      message: testMsg.name,
      javaAck: null,
      nodeAck: null,
      match: false,
    };

    // Send to Java Mirth
    try {
      const javaClient = new MLLPClient({ host: 'localhost', port: 6661, timeout: 10000 });
      const javaResp = await javaClient.send(message);
      result.javaAck = javaResp.ackCode || 'unknown';
      result.javaResponse = javaResp.rawResponse?.substring(0, 150).replace(/\r/g, '\\r');
      console.log(`  Java ACK: ${result.javaAck}`);
    } catch (e) {
      console.log(`  Java Error: ${(e as Error).message}`);
    }

    // Send to Node.js Mirth
    try {
      const nodeClient = new MLLPClient({ host: 'localhost', port: 6662, timeout: 10000 });
      const nodeResp = await nodeClient.send(message);
      result.nodeAck = nodeResp.ackCode || 'unknown';
      result.nodeResponse = nodeResp.rawResponse?.substring(0, 150).replace(/\r/g, '\\r');
      console.log(`  Node ACK: ${result.nodeAck}`);
    } catch (e) {
      console.log(`  Node Error: ${(e as Error).message}`);
    }

    // Compare
    if (result.javaAck && result.nodeAck) {
      result.match = result.javaAck === result.nodeAck;
      if (result.match) {
        console.log(`  MATCH: Both returned ${result.javaAck}`);
        passed++;
      } else {
        console.log(`  MISMATCH: Java=${result.javaAck}, Node=${result.nodeAck}`);
        failed++;
      }
    } else {
      console.log(`  INCOMPLETE: Could not compare`);
      failed++;
    }

    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(60));

  // Show response differences
  console.log('\nResponse Details:');
  for (const r of results) {
    console.log(`\n${r.message}:`);
    if (r.javaResponse) {
      console.log(`  Java:  ${r.javaResponse}...`);
    }
    if (r.nodeResponse) {
      console.log(`  Node:  ${r.nodeResponse}...`);
    }
  }
}

quickValidate().catch(console.error);
