/**
 * Quick JavaScript Runtime Test
 *
 * Tests that the Node.js Mirth JavaScript runtime can handle E4X patterns
 * without needing to deploy a full channel.
 */

// Import the E4X transpiler and JavaScript executor from the main project
import * as path from 'path';
import * as fs from 'fs';

// Load HL7 message
const hl7Message = `MSH|^~\\&|SENDING_APP|SENDING_FACILITY|RECEIVING_APP|RECEIVING_FACILITY|20240115120000||ADT^A01|MSG00001|P|2.5.1
EVN|A01|20240115120000
PID|1||12345678^^^HOSPITAL^MR||DOE^JOHN^Q||19800101|M|||123 MAIN ST^^ANYTOWN^ST^12345^USA||555-123-4567||S||12345678^^^HOSPITAL^AN`;

console.log('='.repeat(60));
console.log('JavaScript Runtime Test');
console.log('='.repeat(60));

// Test 1: Can we import the E4X transpiler?
console.log('\n[Test 1] E4X Transpiler Import...');
try {
  const transpilerPath = path.join(process.cwd(), '..', 'dist', 'javascript', 'e4x', 'E4XTranspiler.js');
  if (fs.existsSync(transpilerPath)) {
    const { E4XTranspiler } = require(transpilerPath);
    const transpiler = new E4XTranspiler();

    // Test transpiling an E4X expression
    const e4xCode = `msg['MSH']['MSH.9']['MSH.9.1'].toString()`;
    const transpiled = transpiler.transpile(e4xCode);
    console.log(`  Input:  ${e4xCode}`);
    console.log(`  Output: ${transpiled}`);
    console.log('  PASS');
  } else {
    console.log('  SKIP: Transpiler not built. Run npm run build in main project.');
  }
} catch (e) {
  console.log(`  FAIL: ${(e as Error).message}`);
}

// Test 2: Can we create an XMLProxy for HL7?
console.log('\n[Test 2] XMLProxy for HL7 Message...');
try {
  const xmlProxyPath = path.join(process.cwd(), '..', 'dist', 'javascript', 'e4x', 'XMLProxy.js');
  if (fs.existsSync(xmlProxyPath)) {
    const { XMLProxy } = require(xmlProxyPath);

    // Create HL7 as XML (simplified structure)
    const hl7Xml = `<HL7Message>
      <MSH>
        <MSH.1>|</MSH.1>
        <MSH.9>
          <MSH.9.1>ADT</MSH.9.1>
          <MSH.9.2>A01</MSH.9.2>
        </MSH.9>
      </MSH>
      <PID>
        <PID.5>
          <PID.5.1>DOE</PID.5.1>
          <PID.5.2>JOHN</PID.5.2>
        </PID.5>
      </PID>
    </HL7Message>`;

    const msg = XMLProxy.create(hl7Xml);
    const msgType = msg.get('MSH').get('MSH.9').get('MSH.9.1').toString();
    console.log(`  Message Type: ${msgType}`);
    console.log(`  Expected: ADT`);
    console.log(msgType === 'ADT' ? '  PASS' : '  FAIL');
  } else {
    console.log('  SKIP: XMLProxy not built. Run npm run build in main project.');
  }
} catch (e) {
  console.log(`  FAIL: ${(e as Error).message}`);
}

// Test 3: Filter script execution
console.log('\n[Test 3] Filter Script Execution...');
try {
  const runtimePath = path.join(process.cwd(), '..', 'dist', 'javascript', 'runtime');
  const executorPath = path.join(runtimePath, 'JavaScriptExecutor.js');

  if (fs.existsSync(executorPath)) {
    const { JavaScriptExecutor } = require(executorPath);
    const executor = new JavaScriptExecutor();

    // Create mock context with msg
    const filterScript = `return msg['MSH']['MSH.9']['MSH.9.1'].toString() == 'ADT';`;

    console.log(`  Script: ${filterScript}`);
    console.log('  (Note: Full execution requires channel context)');
    console.log('  SKIP: Requires deployed channel');
  } else {
    console.log('  SKIP: JavaScriptExecutor not built.');
  }
} catch (e) {
  console.log(`  FAIL: ${(e as Error).message}`);
}

console.log('\n' + '='.repeat(60));
console.log('Test Complete');
console.log('='.repeat(60));
