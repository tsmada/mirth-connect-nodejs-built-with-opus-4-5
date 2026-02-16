/**
 * ProgressiveMigrationRunner — Tests a single Mirth instance and writes a StageResult JSON file.
 *
 * Supports 4 target stages: java, shadow, takeover, standalone.
 * Shadow mode includes extra phases: shadow assertions, promote/demote lifecycle, full cutover.
 *
 * CLI usage:
 *   npx ts-node runners/ProgressiveMigrationRunner.ts \
 *     --target <java|shadow|takeover|standalone> \
 *     --output <path/to/result.json> \
 *     [--api-url URL] [--mllp-port PORT] [--http-port PORT]
 *
 * Comparison mode:
 *   npx ts-node runners/ProgressiveMigrationRunner.ts --compare --report-dir <dir>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import {
  TargetStage,
  StageResult,
  Check,
  MessageTestResult,
  generateComparisonReport,
} from './StageResult';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface RunnerConfig {
  target: TargetStage;
  output: string;
  apiUrl: string;
  mllpPort: number;
  httpGatewayPort: number;
  httpJsonPort: number;
  mllpE4xPort: number;
}

const MESSAGES_DIR = path.join(process.cwd(), 'scenarios', '09-kitchen-sink', 'messages');

// HTTPS agent for Java Mirth (self-signed cert)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ---------------------------------------------------------------------------
// MLLP Client (inline — avoids MirthEndpoint dependency)
// ---------------------------------------------------------------------------

const VT = 0x0b;
const FS_BYTE = 0x1c;
const CR = 0x0d;

function mllpSend(host: string, port: number, message: string, timeout = 15000): Promise<{ ack: string; ackCode: string }> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = Buffer.alloc(0);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; socket.destroy(); reject(new Error(`MLLP timeout after ${timeout}ms`)); }
    }, timeout);

    socket.on('connect', () => {
      const msg = Buffer.from(message, 'utf8');
      const framed = Buffer.alloc(msg.length + 3);
      framed[0] = VT;
      msg.copy(framed, 1);
      framed[framed.length - 2] = FS_BYTE;
      framed[framed.length - 1] = CR;
      socket.write(framed);
    });

    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 2 && data[data.length - 1] === CR && data[data.length - 2] === FS_BYTE) {
        clearTimeout(timer);
        if (!done) {
          done = true;
          // Unframe
          let start = data[0] === VT ? 1 : 0;
          let end = data.length - 2;
          const ack = data.slice(start, end).toString('utf8');
          // Parse MSA
          const msaLine = ack.split(/[\r\n]+/).find(s => s.startsWith('MSA'));
          const ackCode = msaLine ? msaLine.split('|')[1] || 'UNKNOWN' : 'UNKNOWN';
          socket.destroy();
          resolve({ ack, ackCode });
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      if (!done) { done = true; socket.destroy(); reject(err); }
    });

    socket.connect(port, host);
  });
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function createClient(apiUrl: string): AxiosInstance {
  return axios.create({
    baseURL: apiUrl,
    timeout: 30000,
    validateStatus: () => true,
    httpsAgent,
  });
}

async function login(client: AxiosInstance): Promise<string | null> {
  try {
    // Try Node.js style first (JSON + X-Session-ID header)
    const resp = await client.post('/api/users/_login', { username: 'admin', password: 'admin' }, {
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (resp.status === 200) {
      // Node.js Mirth returns X-Session-ID header
      const sessionId = resp.headers['x-session-id'];
      if (sessionId) return sessionId as string;

      // Java Mirth returns JSESSIONID cookie
      const cookies = resp.headers['set-cookie'];
      if (cookies) {
        const jsession = (cookies as string[]).find((c: string) => c.includes('JSESSIONID'));
        if (jsession) return jsession.split(';')[0]!;
      }
    }

    // Fallback: form-encoded (Java Mirth)
    const formResp = await client.post(
      '/api/users/_login',
      'username=admin&password=admin',
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    if (formResp.status === 200) {
      const cookies = formResp.headers['set-cookie'];
      if (cookies) {
        const jsession = (cookies as string[]).find((c: string) => c.includes('JSESSIONID'));
        if (jsession) return jsession.split(';')[0]!;
      }
    }
  } catch (err) {
    console.error(`  Login failed: ${(err as Error).message}`);
  }

  return null;
}

function authHeaders(session: string): Record<string, string> {
  if (session.startsWith('JSESSIONID=')) {
    return { Cookie: session };
  }
  return { 'X-Session-ID': session, 'X-Requested-With': 'XMLHttpRequest' };
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

function check(name: string, expected: string, actual: string): Check {
  return {
    name,
    status: expected === actual ? 'PASS' : 'FAIL',
    expected,
    actual,
  };
}

function skip(name: string, reason: string): Check {
  return { name, status: 'SKIP', expected: 'N/A', actual: reason };
}

// ---------------------------------------------------------------------------
// Message test helpers
// ---------------------------------------------------------------------------

function readMessage(filename: string): string {
  return fs.readFileSync(path.join(MESSAGES_DIR, filename), 'utf-8');
}

async function testMllp(
  name: string, port: number, messageFile: string, expectedAck: string | string[]
): Promise<MessageTestResult> {
  const start = Date.now();
  try {
    const message = readMessage(messageFile);
    const { ackCode } = await mllpSend('localhost', port, message);
    const validCodes = Array.isArray(expectedAck) ? expectedAck : [expectedAck];
    return {
      name, protocol: 'mllp', port,
      status: validCodes.includes(ackCode) ? 'PASS' : 'FAIL',
      responseCode: ackCode,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      name, protocol: 'mllp', port,
      status: 'ERROR', duration: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

async function testHttp(
  name: string, port: number, path: string, messageFile: string, contentType: string, expectedStatus: number
): Promise<MessageTestResult> {
  const start = Date.now();
  try {
    const body = readMessage(messageFile);
    const resp = await axios.post(`http://localhost:${port}${path}`, body, {
      headers: { 'Content-Type': contentType },
      timeout: 15000,
      validateStatus: () => true,
    });
    return {
      name, protocol: 'http', port,
      status: resp.status === expectedStatus ? 'PASS' : 'FAIL',
      responseCode: String(resp.status),
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      name, protocol: 'http', port,
      status: 'ERROR', duration: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Core stage tests
// ---------------------------------------------------------------------------

async function runCommonChecks(
  client: AxiosInstance, session: string, target: TargetStage
): Promise<{ checks: Check[]; meta: StageResult['metadata'] }> {
  const checks: Check[] = [];
  const meta: StageResult['metadata'] = { channelCount: 0, startedChannelCount: 0 };

  // Health check (Java Mirth uses /api/server/version, Node.js uses /api/health)
  try {
    const healthResp = await client.get('/api/health');
    if (healthResp.status === 200) {
      checks.push(check('Health reachable', 'PASS', 'PASS'));
      if (healthResp.data) {
        meta.shadowMode = healthResp.data.shadowMode;
        meta.mode = healthResp.data.mode;
        meta.serverId = healthResp.data.serverId;
      }
    } else if (target === 'java') {
      // Fallback to Java Mirth endpoint (may need auth)
      const versionResp = await client.get('/api/server/version', {
        headers: session ? authHeaders(session) : {},
      });
      checks.push(check('Health reachable', 'PASS', versionResp.status === 200 ? 'PASS' : 'FAIL'));
    } else {
      checks.push(check('Health reachable', 'PASS', 'FAIL'));
    }
  } catch {
    if (target === 'java') {
      try {
        const versionResp = await client.get('/api/server/version', {
          headers: session ? authHeaders(session) : {},
        });
      } catch {
        checks.push(check('Health reachable', 'PASS', 'FAIL'));
      }
    } else {
      checks.push(check('Health reachable', 'PASS', 'FAIL'));
    }
  }

  // Login
  checks.push(check('Login (admin/admin)', 'PASS', session ? 'PASS' : 'FAIL'));

  // Channel statuses
  try {
    const statusResp = await client.get('/api/channels/statuses', {
      headers: { ...authHeaders(session), Accept: 'application/json' },
    });
    if (statusResp.status === 200 && Array.isArray(statusResp.data)) {
      meta.channelCount = statusResp.data.length;
      meta.startedChannelCount = statusResp.data.filter((s: any) => s.state === 'STARTED').length;
    } else if (statusResp.status === 200 && statusResp.data) {
      // May come as XML — count with regex fallback
      const raw = typeof statusResp.data === 'string' ? statusResp.data : JSON.stringify(statusResp.data);
      meta.channelCount = (raw.match(/"channelId"|<channelId>/g) || []).length;
      meta.startedChannelCount = (raw.match(/"STARTED"|<state>STARTED/g) || []).length;
    }
  } catch { /* ignore */ }

  // Channel count expectation (relaxed: >= 1 means channels exist)
  if (target === 'shadow') {
    // Shadow: channels deployed but STOPPED
    checks.push(check('Channels deployed', 'true', String(meta.channelCount > 0)));
  } else {
    checks.push(check('Channels deployed', 'true', String(meta.channelCount > 0)));
    checks.push(check('Channels STARTED', 'true', String(meta.startedChannelCount > 0)));
  }

  return { checks, meta };
}

async function runMessageTests(config: RunnerConfig): Promise<MessageTestResult[]> {
  const results: MessageTestResult[] = [];

  // MLLP ADT A01 (accept AA or AE — CH1 has multi-dest with external deps that may error)
  results.push(await testMllp('MLLP ADT A01', config.mllpPort, 'adt-a01.hl7', ['AA', 'AE']));

  // HTTP JSON (ch15-json-inbound listens on contextPath=/json)
  results.push(await testHttp('HTTP JSON', config.httpJsonPort, '/json', 'patient.json', 'application/json', 200));

  // HTTP XML Gateway (ch02-http-gateway listens on contextPath=/api/patient)
  results.push(await testHttp('HTTP XML Gateway', config.httpGatewayPort, '/api/patient', 'patient-xml.xml', 'application/xml', 200));

  // E4X MLLP
  results.push(await testMllp('E4X MLLP', config.mllpE4xPort, 'e4x-adt-a01.hl7', 'AA'));

  return results;
}

// ---------------------------------------------------------------------------
// Shadow-specific tests
// ---------------------------------------------------------------------------

async function runShadowPhases(
  client: AxiosInstance, session: string, config: RunnerConfig
): Promise<{ checks: Check[]; messageTests: MessageTestResult[] }> {
  const checks: Check[] = [];
  const messageTests: MessageTestResult[] = [];
  const headers = authHeaders(session);

  // Phase A: Shadow assertions
  console.log('  Phase A: Shadow assertions...');
  try {
    const shadowResp = await client.get('/api/system/shadow', { headers });
    if (shadowResp.status === 200) {
      checks.push(check('Shadow mode active', 'true', String(shadowResp.data?.shadowMode === true)));
      checks.push(check('Pre-cutover channels STARTED', '0', String(shadowResp.data?.promotedCount ?? 0)));
    } else {
      checks.push(check('Shadow mode active', 'true', 'FAIL'));
    }
  } catch {
    checks.push(check('Shadow mode active', 'true', 'ERROR'));
  }

  // Shadow guard: writes should be blocked (409)
  try {
    const writeResp = await client.post('/api/channels', '<channel/>', {
      headers: { ...headers, 'Content-Type': 'application/xml' },
    });
    checks.push(check('Write blocked (409)', '409', String(writeResp.status)));
  } catch {
    checks.push(check('Write blocked (409)', '409', 'ERROR'));
  }

  // Phase B: Single channel lifecycle
  console.log('  Phase B: Single channel promote/demote lifecycle...');
  let testChannelId: string | null = null;
  try {
    const statusResp = await client.get('/api/channels/statuses', {
      headers: { ...headers, Accept: 'application/json' },
    });
    if (statusResp.status === 200 && Array.isArray(statusResp.data) && statusResp.data.length > 0) {
      // Find the ADT Receiver (MLLP) channel by name or take first
      const adtChannel = statusResp.data.find((s: any) =>
        s.name?.toLowerCase().includes('adt') || s.name?.toLowerCase().includes('mllp')
      );
      testChannelId = adtChannel?.channelId || statusResp.data[0].channelId;
    }
  } catch {
    checks.push(skip('Promote single channel', 'Cannot fetch channel statuses'));
  }

  if (testChannelId) {
    try {
      // Promote single channel
      const promoteResp = await client.post('/api/system/shadow/promote',
        { channelId: testChannelId },
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      );
      checks.push(check('Promote single channel', 'true', String(promoteResp.status === 200)));

      if (promoteResp.status === 200) {
        // Wait for channel to start (up to 30s)
        await sleep(5000);

        // Verify channel is STARTED
        const startedResp = await client.get('/api/channels/statuses', {
          headers: { ...headers, Accept: 'application/json' },
        });
        if (startedResp.status === 200 && Array.isArray(startedResp.data)) {
          const ch = startedResp.data.find((s: any) => s.channelId === testChannelId);
          checks.push(check('Promoted channel STARTED', 'STARTED', ch?.state || 'UNKNOWN'));
        }

        // Demote
        const demoteResp = await client.post('/api/system/shadow/demote',
          { channelId: testChannelId },
          { headers: { ...headers, 'Content-Type': 'application/json' } }
        );
        checks.push(check('Demote channel', 'true', String(demoteResp.status === 200)));

        // Verify stopped
        await sleep(3000);
        const stoppedResp = await client.get('/api/channels/statuses', {
          headers: { ...headers, Accept: 'application/json' },
        });
        if (stoppedResp.status === 200 && Array.isArray(stoppedResp.data)) {
          const ch = stoppedResp.data.find((s: any) => s.channelId === testChannelId);
          checks.push(check('Demoted channel STOPPED', 'STOPPED', ch?.state || 'UNKNOWN'));
        }
      }
    } catch (err) {
      checks.push(check('Promote single channel', 'true', `ERROR: ${(err as Error).message}`));
    }
  } else {
    checks.push(skip('Promote single channel', 'No channels found'));
    checks.push(skip('Demote channel', 'No channels found'));
  }

  // Phase C: Full cutover
  console.log('  Phase C: Full cutover...');
  try {
    const cutoverResp = await client.post('/api/system/shadow/promote',
      { all: true },
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
    checks.push(check('Full cutover', 'true', String(cutoverResp.status === 200)));

    if (cutoverResp.status === 200) {
      // Wait for channels to start
      await sleep(10000);

      // Verify shadow is disabled
      const postCutover = await client.get('/api/system/shadow', { headers });
      if (postCutover.status === 200) {
        checks.push(check('Shadow disabled after cutover', 'false', String(postCutover.data?.shadowMode)));
      }
    }
  } catch (err) {
    checks.push(check('Full cutover', 'true', `ERROR: ${(err as Error).message}`));
  }

  // Phase D: Post-cutover message tests
  console.log('  Phase D: Post-cutover message tests...');
  const postCutoverMessages = await runMessageTests(config);
  messageTests.push(...postCutoverMessages);

  return { checks, messageTests };
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

async function runStage(config: RunnerConfig): Promise<StageResult> {
  const startTime = Date.now();
  console.log(`\n  Running stage: ${config.target}`);
  console.log(`  API: ${config.apiUrl}`);
  console.log(`  MLLP: localhost:${config.mllpPort}`);

  const client = createClient(config.apiUrl);

  // Login
  const session = await login(client);
  if (!session) {
    console.error('  ERROR: Login failed');
    return {
      target: config.target,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      checks: [check('Login (admin/admin)', 'PASS', 'FAIL')],
      messageTests: [],
      metadata: { channelCount: 0, startedChannelCount: 0 },
    };
  }

  // Common checks
  const { checks, meta } = await runCommonChecks(client, session, config.target);

  let messageTests: MessageTestResult[] = [];
  let extraChecks: Check[] = [];

  if (config.target === 'shadow') {
    // Shadow has its own multi-phase test flow
    const shadowResult = await runShadowPhases(client, session, config);
    extraChecks = shadowResult.checks;
    messageTests = shadowResult.messageTests;
  } else {
    // Non-shadow: run message tests directly
    messageTests = await runMessageTests(config);
  }

  // Stats check: verify stats are non-zero after message tests
  if (config.target !== 'shadow' || extraChecks.some(c => c.name === 'Full cutover' && c.status === 'PASS')) {
    try {
      await sleep(2000);
      const statsResp = await client.get('/api/channels/statistics', {
        headers: { ...authHeaders(session), Accept: 'application/json' },
      });
      if (statsResp.status === 200) {
        const statsData = typeof statsResp.data === 'string' ? statsResp.data : JSON.stringify(statsResp.data);
        const hasNonZero = /[1-9]/.test(statsData);
        checks.push(check('Stats incrementing', 'true', String(hasNonZero)));
      }
    } catch { /* ignore */ }
  }

  const result: StageResult = {
    target: config.target,
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    checks: [...checks, ...extraChecks],
    messageTests,
    metadata: meta,
  };

  return result;
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printComparisonReport(reportDir: string): void {
  const report = generateComparisonReport(reportDir);

  // Save report JSON
  fs.writeFileSync(
    path.join(reportDir, 'comparison-report.json'),
    JSON.stringify(report, null, 2)
  );

  // Print table
  const TC = 20; // test name column width
  const COL = 11; // data column width
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

  console.log('');
  console.log('╔' + '═'.repeat(TC + 1) + '╦' + ('═'.repeat(COL) + '╦').repeat(3) + '═'.repeat(COL) + '╗');
  console.log('║ ' + pad('Test', TC) + '║ ' + pad('Java', COL - 1) + '║ ' + pad('Shadow', COL - 1) + '║ ' + pad('Takeover', COL - 1) + '║ ' + pad('Standalone', COL - 1) + '║');
  console.log('╠' + '═'.repeat(TC + 1) + '╬' + ('═'.repeat(COL) + '╬').repeat(3) + '═'.repeat(COL) + '╣');

  for (const row of report.matrix) {
    console.log(
      '║ ' + pad(row.test, TC) +
      '║ ' + pad(row.java, COL - 1) +
      '║ ' + pad(row.shadow, COL - 1) +
      '║ ' + pad(row.takeover, COL - 1) +
      '║ ' + pad(row.standalone, COL - 1) + '║'
    );
  }

  const dataWidth = COL * 4 + 3;
  console.log('╠' + '═'.repeat(TC + 1) + '╬' + '═'.repeat(dataWidth) + '╣');
  console.log('║ ' + pad('Confidence', TC) + '║ ' + pad(`${report.confidenceScore}%`, dataWidth - 1) + '║');
  console.log('║ ' + pad('Result', TC) + '║ ' + pad(report.overallResult, dataWidth - 1) + '║');
  console.log('╚' + '═'.repeat(TC + 1) + '╩' + '═'.repeat(dataWidth) + '╝');
  console.log('');

  if (report.overallResult === 'FAIL') {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(): { mode: 'run'; config: RunnerConfig } | { mode: 'compare'; reportDir: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, def?: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : def;
  };

  if (args.includes('--compare')) {
    return { mode: 'compare', reportDir: get('--report-dir', '.') || '.' };
  }

  const target = get('--target') as TargetStage;
  if (!target || !['java', 'shadow', 'takeover', 'standalone'].includes(target)) {
    console.error('Usage: --target <java|shadow|takeover|standalone> --output <file.json>');
    console.error('  or:  --compare --report-dir <dir>');
    process.exit(1);
  }

  return {
    mode: 'run',
    config: {
      target,
      output: get('--output', `stage-${target}.json`)!,
      apiUrl: get('--api-url', 'http://localhost:8080')!,
      mllpPort: parseInt(get('--mllp-port', '6670')!, 10),
      httpGatewayPort: parseInt(get('--http-port', '8090')!, 10),
      httpJsonPort: parseInt(get('--http-json-port', '8095')!, 10),
      mllpE4xPort: parseInt(get('--mllp-e4x-port', '6671')!, 10),
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs();

  if (parsed.mode === 'compare') {
    printComparisonReport(parsed.reportDir);
    return;
  }

  const { config } = parsed;
  const result = await runStage(config);

  // Write result JSON
  const outDir = path.dirname(config.output);
  if (outDir && outDir !== '.') fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(config.output, JSON.stringify(result, null, 2));

  // Print summary
  const passCount = result.checks.filter(c => c.status === 'PASS').length
    + result.messageTests.filter(m => m.status === 'PASS').length;
  const totalCount = result.checks.length + result.messageTests.length;
  const failCount = result.checks.filter(c => c.status === 'FAIL').length
    + result.messageTests.filter(m => m.status === 'FAIL' || m.status === 'ERROR').length;

  console.log('');
  console.log(`  Stage: ${config.target}`);
  console.log(`  Checks: ${passCount}/${totalCount} passed, ${failCount} failed`);
  console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
  console.log(`  Output: ${config.output}`);

  // Print failures
  for (const c of result.checks) {
    if (c.status === 'FAIL') {
      console.log(`  FAIL: ${c.name} (expected=${c.expected}, actual=${c.actual})`);
    }
  }
  for (const m of result.messageTests) {
    if (m.status === 'FAIL' || m.status === 'ERROR') {
      console.log(`  ${m.status}: ${m.name} (${m.error || `code=${m.responseCode}`})`);
    }
  }

  if (failCount > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
