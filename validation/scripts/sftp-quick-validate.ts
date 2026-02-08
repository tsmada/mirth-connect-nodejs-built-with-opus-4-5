/**
 * SFTP Quick Validation Script
 *
 * Validates the SFTP ORM→ORU scenario (7.8) by directly uploading a test
 * message via SFTP and checking the output, bypassing the full validation
 * framework. Useful for fast iteration during development.
 *
 * Prerequisites:
 *   npm run sftp:up          (from project root — starts SFTP Docker)
 *   PORT=8081 npm run dev    (from project root — starts Node.js Mirth)
 *
 * Usage:
 *   cd validation
 *   npm run validate:sftp:quick
 */

import * as fs from 'fs';
import * as path from 'path';
import { ValidationSftpClient, DEFAULT_SFTP_CONFIG } from '../clients/SftpClient';

const SCENARIO_DIR = path.join(process.cwd(), 'scenarios', '07-deep-validation', '7.8-sftp-orm-to-oru');
const INPUT_FILE = path.join(SCENARIO_DIR, 'orm-lab-order.hl7');
const TIMEOUT = 30000;
const POLL_INTERVAL = 500;

interface CheckResult {
  label: string;
  passed: boolean;
  detail?: string;
}

async function main(): Promise<void> {
  console.log('======================================');
  console.log('SFTP ORM→ORU Quick Validation');
  console.log('======================================\n');

  // Load test message
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`ERROR: Test message not found: ${INPUT_FILE}`);
    process.exit(1);
  }
  const inputContent = fs.readFileSync(INPUT_FILE, 'utf8');

  // Create SFTP client for nodeuser
  const sftp = new ValidationSftpClient(DEFAULT_SFTP_CONFIG.node);

  try {
    // Step 1: Connect and set up directories
    console.log('Step 1: Connecting to SFTP server...');
    await sftp.ensureDirectory('/home/nodeuser/input');
    await sftp.ensureDirectory('/home/nodeuser/output');
    console.log('  Connected and directories ready\n');

    // Step 2: Clean any stale output files
    console.log('Step 2: Cleaning stale output files...');
    try {
      const existingFiles = await sftp.listFileNames('/home/nodeuser/output');
      for (const f of existingFiles) {
        if (f.endsWith('.hl7')) {
          await sftp.deleteFile(`/home/nodeuser/output/${f}`);
          console.log(`  Removed stale: ${f}`);
        }
      }
    } catch {
      // Output dir may be empty
    }
    console.log('');

    // Step 3: Upload test message
    const filename = `test-${Date.now()}.hl7`;
    console.log(`Step 3: Uploading test message: ${filename}`);
    await sftp.uploadContent(inputContent, `/home/nodeuser/input/${filename}`);
    console.log('  Uploaded to /home/nodeuser/input/\n');

    // Step 4: Wait for output
    console.log(`Step 4: Waiting for output (timeout: ${TIMEOUT / 1000}s)...`);
    const startTime = Date.now();
    let outputFile: string | null = null;

    while (Date.now() - startTime < TIMEOUT) {
      try {
        const files = await sftp.listFiles('/home/nodeuser/output');
        const match = files.find(f => f.type === '-' && f.name.endsWith('.hl7'));
        if (match) {
          outputFile = `/home/nodeuser/output/${match.name}`;
          break;
        }
      } catch {
        // Directory listing may fail
      }
      await delay(POLL_INTERVAL);

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed > 0 && elapsed % 5 === 0) {
        console.log(`  Waiting... (${elapsed}s)`);
      }
    }

    if (!outputFile) {
      console.error(`\nTIMEOUT: No output file found after ${TIMEOUT / 1000}s`);
      console.error('');
      console.error('Debugging:');
      try {
        const inputFiles = await sftp.listFileNames('/home/nodeuser/input');
        console.error(`  Input dir files: ${inputFiles.join(', ') || '(empty)'}`);
      } catch { /* ignore */ }
      try {
        const outputFiles = await sftp.listFileNames('/home/nodeuser/output');
        console.error(`  Output dir files: ${outputFiles.join(', ') || '(empty)'}`);
      } catch { /* ignore */ }
      console.error('');
      console.error('Possible causes:');
      console.error('  1. Channel not deployed — deploy the SFTP channel first');
      console.error('  2. SFTP connector config mismatch');
      console.error('  3. Transformer error — check Node.js Mirth logs');
      process.exit(1);
    }

    const elapsed = Date.now() - startTime;
    console.log(`  Output found: ${outputFile} (${elapsed}ms)\n`);

    // Step 5: Download and validate
    console.log('Step 5: Validating ORU output...\n');
    const output = await sftp.downloadFile(outputFile);

    const checks: CheckResult[] = [
      check('MSH message type is ORU^R01', output, 'ORU^R01^ORU_R01'),
      check('MSH sender is LAB_SYS|LAB_A', output, 'LAB_SYS|LAB_A'),
      check('MSH receiver is ORDER_SYS|CLINIC_A', output, 'ORDER_SYS|CLINIC_A'),
      check('PID patient DOE^JANE preserved', output, 'DOE^JANE'),
      check('PV1 segment preserved', output, 'PV1|'),
      check('ORC order control changed to RE', output, '|RE|'),
      check('OBR result status F', output, '|F'),
      check('OBX Glucose = 95 mg/dL', output, '2345-7^Glucose||95'),
      check('OBX BUN = 15 mg/dL', output, '3094-0^BUN||15'),
      check('OBX Creatinine = 1.0 mg/dL', output, '2160-0^Creatinine||1.0'),
      check('OBX WBC = 7.5', output, '6690-2^WBC||7.5'),
      check('OBX RBC = 4.8', output, '789-8^RBC||4.8'),
      check('OBX Hemoglobin = 14.2 g/dL', output, '718-7^Hemoglobin||14.2'),
    ];

    console.log('--- ORU Message Checks ---');
    let passed = 0;
    let failed = 0;
    for (const c of checks) {
      if (c.passed) {
        console.log(`  PASS: ${c.label}`);
        passed++;
      } else {
        console.log(`  FAIL: ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
        failed++;
      }
    }

    console.log('');
    console.log('--- Raw Output Preview ---');
    const lines = output.split(/[\r\n]+/).filter(l => l.length > 0);
    for (const line of lines.slice(0, 20)) {
      console.log(`  ${line}`);
    }

    // Step 6: Cleanup
    console.log('\nStep 6: Cleanup...');
    try {
      await sftp.deleteFile(`/home/nodeuser/input/${filename}`);
    } catch { /* input may already be consumed */ }
    try {
      await sftp.deleteFile(outputFile);
    } catch { /* ignore */ }
    console.log('  Done\n');

    // Summary
    console.log('======================================');
    console.log(`Results: ${passed} passed, ${failed} failed (of ${checks.length} checks)`);
    console.log('======================================');

    process.exit(failed > 0 ? 1 : 0);

  } finally {
    await sftp.disconnect();
  }
}

function check(label: string, content: string, pattern: string): CheckResult {
  if (content.includes(pattern)) {
    return { label, passed: true };
  }
  return { label, passed: false, detail: `expected "${pattern}"` };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
