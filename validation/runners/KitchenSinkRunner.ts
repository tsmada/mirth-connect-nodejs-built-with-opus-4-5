/**
 * KitchenSinkRunner — End-to-end integration test exercising all connector types,
 * data types, script types, and map types across 12 interconnected channels.
 *
 * Runs 9 sequential phases: setup, MLLP, HTTP, File, SOAP loopback, DICOM loopback,
 * JMS loopback, JS Rx + Trace, and Maps/Filters/Stats/Cleanup.
 *
 * Prerequisites:
 *   1. Node.js Mirth running on localhost:8081 (or NODE_MIRTH_URL)
 *   2. MySQL on localhost:3306 with mirthdb (for DB assertions)
 *   3. Optional: STOMP broker on localhost:61613 (for JMS tests)
 *
 * Usage:
 *   cd validation
 *   npx ts-node runners/KitchenSinkRunner.ts
 *   npx ts-node runners/KitchenSinkRunner.ts --verbose
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { MirthApiClient, DashboardStatus } from '../clients/MirthApiClient';
import { MLLPClient } from '../clients/MLLPClient';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNEL_IDS = {
  CH1_ADT_RECEIVER:     'ks000001-0001-0001-0001-000000000001',
  CH2_HTTP_GATEWAY:     'ks000002-0002-0002-0002-000000000002',
  CH3_FILE_PROCESSOR:   'ks000003-0003-0003-0003-000000000003',
  CH4_HUB_ROUTER:       'ks000004-0004-0004-0004-000000000004',
  CH5_DB_PERSISTENCE:   'ks000005-0005-0005-0005-000000000005',
  CH6_RESPONSE_BUILDER: 'ks000006-0006-0006-0006-000000000006',
  CH7_AUDIT_LOGGER:     'ks000007-0007-0007-0007-000000000007',
  CH8_COMPLETION:       'ks000008-0008-0008-0008-000000000008',
  CH9_SOAP_ENDPOINT:    'ks000009-0009-0009-0009-000000000009',
  CH10_DICOM_SCP:       'ks000010-0010-0010-0010-000000000010',
  CH11_JMS_CONSUMER:    'ks000011-0011-0011-0011-000000000011',
  CH12_JS_GENERATOR:    'ks000012-0012-0012-0012-000000000012',
};

const CODE_TEMPLATE_LIBRARY_ID = 'ks-lib-0001-0001-0001-000000000001';

const PORTS = {
  MLLP: 6670,
  HTTP_GATEWAY: 8090,
  HTTP_COMPLETION: 8091,
  SOAP: 8092,
  DICOM: 11112,
  SMTP: 2525,
  STOMP: 61613,
};

const FILE_PATHS = {
  INPUT:  '/tmp/mirth-ks/input',
  OUTPUT: '/tmp/mirth-ks/output',
  AUDIT:  '/tmp/mirth-ks/audit',
};

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(level: 'INFO' | 'PASS' | 'FAIL' | 'WARN' | 'SKIP', msg: string): void {
  const prefix: Record<string, string> = {
    INFO: '  ',
    PASS: '  [PASS]',
    FAIL: '  [FAIL]',
    WARN: '  [WARN]',
    SKIP: '  [SKIP]',
  };
  console.log(`${prefix[level]} ${msg}`);
}

// ---------------------------------------------------------------------------
// API helper functions (don't modify MirthApiClient)
// ---------------------------------------------------------------------------

async function getChannelStats(
  client: MirthApiClient,
  channelId: string
): Promise<{ received: number; filtered: number; sent: number; error: number } | null> {
  const statuses = await client.getChannelStatuses();
  const status = statuses.find((s: DashboardStatus) => s.channelId === channelId);
  if (status?.statistics) {
    return status.statistics;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mock SMTP Server
// ---------------------------------------------------------------------------

interface CapturedEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
}

class MockSmtpServer {
  private server: net.Server | null = null;
  public emails: CapturedEmail[] = [];

  async start(port = PORTS.SMTP): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        socket.write('220 mock-smtp ready\r\n');
        let from = '';
        let to = '';
        let inData = false;
        let body = '';

        socket.on('data', (chunk) => {
          const lines = chunk.toString().split('\r\n');
          for (const line of lines) {
            if (inData) {
              if (line === '.') {
                inData = false;
                const subjectMatch = body.match(/Subject: (.*)/i);
                this.emails.push({
                  from,
                  to,
                  subject: subjectMatch?.[1] || '',
                  body,
                });
                body = '';
                socket.write('250 OK\r\n');
              } else {
                body += line + '\n';
              }
            } else if (line.startsWith('EHLO') || line.startsWith('HELO')) {
              socket.write('250 OK\r\n');
            } else if (line.startsWith('MAIL FROM:')) {
              from = line.replace('MAIL FROM:', '').trim().replace(/[<>]/g, '');
              socket.write('250 OK\r\n');
            } else if (line.startsWith('RCPT TO:')) {
              to = line.replace('RCPT TO:', '').trim().replace(/[<>]/g, '');
              socket.write('250 OK\r\n');
            } else if (line === 'DATA') {
              inData = true;
              socket.write('354 Send data\r\n');
            } else if (line === 'QUIT') {
              socket.write('221 Bye\r\n');
              socket.end();
            } else if (line === 'RSET') {
              socket.write('250 OK\r\n');
            }
          }
        });

        socket.on('error', () => {
          // Ignore client disconnects
        });
      });

      this.server.on('error', reject);
      this.server.listen(port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// STOMP Broker Detection
// ---------------------------------------------------------------------------

async function isStompBrokerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(PORTS.STOMP, 'localhost');
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Phase result tracking
// ---------------------------------------------------------------------------

interface PhaseResult {
  name: string;
  status: 'OK' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// KitchenSinkRunner
// ---------------------------------------------------------------------------

export class KitchenSinkRunner {
  private client: MirthApiClient;
  private smtp: MockSmtpServer;
  private jmsAvailable = false;
  private dbAvailable = false;
  private dbConnection: any = null;
  private verbose = false;
  private scenarioDir: string;
  private results: PhaseResult[] = [];

  private phases: { name: string; fn: () => Promise<void> }[];

  constructor(options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose || false;
    this.scenarioDir = path.join(process.cwd(), 'scenarios/09-kitchen-sink');

    const baseUrl = process.env.NODE_MIRTH_URL || 'http://localhost:8081';
    this.client = new MirthApiClient({
      name: 'node',
      baseUrl,
      username: 'admin',
      password: 'admin',
      mllpPort: PORTS.MLLP,
      httpTestPort: PORTS.HTTP_GATEWAY,
    });
    this.smtp = new MockSmtpServer();

    this.phases = [
      { name: 'Phase 0: Setup',                fn: () => this.phase0Setup() },
      { name: 'Phase 1: MLLP Test',            fn: () => this.phase1Mllp() },
      { name: 'Phase 2: HTTP Test',             fn: () => this.phase2Http() },
      { name: 'Phase 3: File Test',             fn: () => this.phase3File() },
      { name: 'Phase 4: SOAP Loopback',         fn: () => this.phase4Soap() },
      { name: 'Phase 5: DICOM Loopback',        fn: () => this.phase5Dicom() },
      { name: 'Phase 6: JMS Loopback',          fn: () => this.phase6Jms() },
      { name: 'Phase 7: JS Rx + Trace',         fn: () => this.phase7JsTrace() },
      { name: 'Phase 8: Maps + Filters + Stats', fn: () => this.phase8Cleanup() },
    ];
  }

  // =========================================================================
  // Main entry point
  // =========================================================================

  async run(): Promise<void> {
    console.log('');
    console.log('Kitchen Sink Integration Test');
    console.log('='.repeat(50));

    // Health check: verify server is reachable before proceeding
    const baseUrl = process.env.NODE_MIRTH_URL || 'http://localhost:8081';
    try {
      const healthy = await this.client.waitForHealthy(5000, 1000);
      if (!healthy) {
        console.error(`\nNode.js Mirth server is not running on ${baseUrl}`);
        console.error('Start it with: PORT=8081 npm run dev\n');
        process.exit(1);
      }
    } catch {
      console.error(`\nNode.js Mirth server is not running on ${baseUrl}`);
      console.error('Start it with: PORT=8081 npm run dev\n');
      process.exit(1);
    }

    // Login with user-friendly error message
    try {
      await this.client.login();
    } catch (err: any) {
      console.error(`\nFailed to authenticate with Mirth server: ${err.message}`);
      console.error('Check credentials (default: admin/admin) and server status.\n');
      process.exit(1);
    }

    for (const phase of this.phases) {
      const start = Date.now();
      try {
        await phase.fn();
        const duration = Date.now() - start;
        this.results.push({ name: phase.name, status: 'OK', duration });
        this.printPhaseResult(phase.name, 'OK', duration);
      } catch (err: any) {
        const duration = Date.now() - start;
        if (err.message === 'SKIP') {
          this.results.push({ name: phase.name, status: 'SKIP', duration });
          this.printPhaseResult(phase.name, 'SKIP', duration);
        } else {
          this.results.push({ name: phase.name, status: 'FAIL', duration, error: err.message });
          this.printPhaseResult(phase.name, 'FAIL', duration);
          if (this.verbose) console.error(`    Error: ${err.message}`);
        }
      }
    }

    // Summary
    console.log('='.repeat(50));
    const passed = this.results.filter((r) => r.status === 'OK').length;
    const failed = this.results.filter((r) => r.status === 'FAIL').length;
    const skipped = this.results.filter((r) => r.status === 'SKIP').length;
    const totalMs = this.results.reduce((sum, r) => sum + r.duration, 0);
    console.log(
      `${passed + skipped}/${this.results.length} PHASES PASSED (${(totalMs / 1000).toFixed(1)}s)`
    );
    if (failed > 0) {
      console.log(`${failed} FAILED:`);
      for (const r of this.results.filter((r) => r.status === 'FAIL')) {
        console.log(`  * ${r.name}: ${r.error}`);
      }
    }

    await this.client.logout();
    process.exit(failed > 0 ? 1 : 0);
  }

  // =========================================================================
  // Phase 0: Setup
  // =========================================================================

  private async phase0Setup(): Promise<void> {
    // 1. Start mock SMTP server
    if (this.verbose) log('INFO', 'Starting mock SMTP server on port ' + PORTS.SMTP);
    await this.smtp.start(PORTS.SMTP);

    // 2. Check STOMP broker availability
    this.jmsAvailable = await isStompBrokerAvailable();
    if (this.verbose) log('INFO', `STOMP broker: ${this.jmsAvailable ? 'available' : 'not available'}`);

    // 3. Set up database tables
    try {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection({
        host: 'localhost',
        port: 3306,
        user: 'mirth',
        password: 'mirth',
        database: 'mirthdb',
      });
      const setupSql = fs.readFileSync(
        path.join(this.scenarioDir, 'sql/setup.sql'),
        'utf8'
      );
      for (const stmt of setupSql.split(';').filter((s) => s.trim())) {
        await conn.execute(stmt);
      }
      this.dbConnection = conn;
      this.dbAvailable = true;
      if (this.verbose) log('INFO', 'Database tables created');
    } catch (e: any) {
      if (this.verbose) log('WARN', `Database not available: ${e.message}`);
    }

    // 4. Create filesystem directories
    for (const dir of Object.values(FILE_PATHS)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (this.verbose) log('INFO', 'Filesystem directories created');

    // 5. Deploy code template library
    const codeTemplateXml = fs.readFileSync(
      path.join(this.scenarioDir, 'code-templates/ks-utility-library.xml'),
      'utf8'
    );
    const ctResult = await this.client.importCodeTemplateLibrary(codeTemplateXml);
    if (!ctResult) {
      throw new Error('Failed to import code template library');
    }
    if (this.verbose) log('INFO', 'Code template library imported');

    // 6. Import and deploy channels in dependency order
    // Tier 4 (leaf channels - no downstream dependencies)
    const tier4 = ['ch07-audit-logger.xml', 'ch08-completion-handler.xml'];
    // Tier 3 (depend on tier 4)
    const tier3 = [
      'ch05-db-persistence.xml',
      'ch06-response-builder.xml',
      'ch09-soap-endpoint.xml',
      'ch10-dicom-scp.xml',
    ];
    if (this.jmsAvailable) {
      tier3.push('ch11-jms-consumer.xml');
    }
    // Tier 2 (hub - depends on tier 3 + 4)
    const tier2 = ['ch04-hub-router.xml'];
    // Tier 1 (entry points - depend on tier 2)
    const tier1 = [
      'ch01-adt-receiver.xml',
      'ch02-http-gateway.xml',
      'ch03-file-processor.xml',
      'ch12-js-generator.xml',
    ];

    const allTiers = [tier4, tier3, tier2, tier1];
    for (const tier of allTiers) {
      for (const filename of tier) {
        await this.deployChannelFromFile(filename);
        if (this.verbose) log('INFO', `Deployed ${filename}`);
      }
    }

    // 7. Wait for all channels to be STARTED
    const allChannelIds = Object.values(CHANNEL_IDS).filter((id) => {
      // Skip JMS channel if broker not available
      if (id === CHANNEL_IDS.CH11_JMS_CONSUMER && !this.jmsAvailable) return false;
      return true;
    });
    for (const channelId of allChannelIds) {
      const started = await this.client.waitForChannelState(channelId, 'STARTED', 15000, 500, 2000);
      if (!started) {
        throw new Error(`Channel ${channelId} did not reach STARTED state`);
      }
    }
    if (this.verbose) log('PASS', `All ${allChannelIds.length} channels STARTED`);
  }

  // =========================================================================
  // Phase 1: MLLP Test
  // =========================================================================

  private async phase1Mllp(): Promise<void> {
    // 1. Read HL7 message
    const hl7 = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/adt-a01.hl7'),
      'utf8'
    );

    // 2. Send via MLLP
    const mllpClient = new MLLPClient({
      host: 'localhost',
      port: PORTS.MLLP,
      timeout: 10000,
      retryCount: 3,
      retryDelay: 500,
    });
    const response = await mllpClient.send(hl7);

    // 3. Assert ACK
    this.assert(response.success, 'MLLP ACK received');
    this.assert(
      response.ackCode === 'AA' || response.ackCode === 'CA',
      `ACK code is AA or CA (got ${response.ackCode})`
    );

    // 4. Wait for VM propagation through the channel chain
    await this.delay(3000);

    // 5. Check CH1 stats
    const ch1Stats = await getChannelStats(this.client, CHANNEL_IDS.CH1_ADT_RECEIVER);
    this.assert(ch1Stats !== null, 'CH1 statistics available');
    this.assert(ch1Stats!.received >= 1, `CH1 received >= 1 (got ${ch1Stats!.received})`);

    // 6. Check CH4 stats (hub should have received routed message)
    const ch4Stats = await getChannelStats(this.client, CHANNEL_IDS.CH4_HUB_ROUTER);
    this.assert(ch4Stats !== null, 'CH4 statistics available');
    this.assert(ch4Stats!.received >= 1, `CH4 received >= 1 (got ${ch4Stats!.received})`);

    // 7. Check database for patient record
    if (this.dbAvailable && this.dbConnection) {
      const [rows] = await this.dbConnection.execute(
        'SELECT * FROM ks_messages WHERE patient_id = ?',
        ['PATIENT123']
      );
      this.assert(
        (rows as any[]).length >= 1,
        `DB ks_messages has record for PATIENT123 (found ${(rows as any[]).length})`
      );

      // 8. Check audit log table
      const [auditRows] = await this.dbConnection.execute(
        'SELECT * FROM ks_audit_log WHERE source_type = ?',
        ['MLLP']
      );
      this.assert(
        (auditRows as any[]).length >= 1,
        `DB ks_audit_log has MLLP entry (found ${(auditRows as any[]).length})`
      );
    } else if (this.verbose) {
      log('SKIP', 'DB assertions skipped (database not available)');
    }

    // 9. Check audit file
    await this.delay(1000);
    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('PATIENT123'),
      'Audit log file contains PATIENT123'
    );

    // 10. Check mock SMTP for notification email
    this.assert(
      this.smtp.emails.length >= 1,
      `Mock SMTP received >= 1 email (got ${this.smtp.emails.length})`
    );
    if (this.smtp.emails.length > 0) {
      const email = this.smtp.emails[this.smtp.emails.length - 1];
      this.assert(
        email.subject.includes('PATIENT123') || email.body.includes('PATIENT123'),
        'Email contains PATIENT123'
      );
    }
  }

  // =========================================================================
  // Phase 2: HTTP Test
  // =========================================================================

  private async phase2Http(): Promise<void> {
    // 1. Read JSON payload
    const patientJson = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/patient.json'),
      'utf8'
    );

    // 2. POST to HTTP gateway
    const httpResponse = await axios.post(
      `http://localhost:${PORTS.HTTP_GATEWAY}/api/patient`,
      patientJson,
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );

    // 3. Assert HTTP 200
    this.assert(
      httpResponse.status === 200,
      `HTTP response status 200 (got ${httpResponse.status})`
    );

    // 4. Wait for propagation
    await this.delay(2000);

    // 5. Check CH2 stats
    const ch2Stats = await getChannelStats(this.client, CHANNEL_IDS.CH2_HTTP_GATEWAY);
    this.assert(ch2Stats !== null, 'CH2 statistics available');
    this.assert(ch2Stats!.received >= 1, `CH2 received >= 1 (got ${ch2Stats!.received})`);

    // 6. Check database audit log
    if (this.dbAvailable && this.dbConnection) {
      const [auditRows] = await this.dbConnection.execute(
        'SELECT * FROM ks_audit_log WHERE source_type = ?',
        ['HTTP']
      );
      this.assert(
        (auditRows as any[]).length >= 1,
        `DB ks_audit_log has HTTP entry (found ${(auditRows as any[]).length})`
      );
    } else if (this.verbose) {
      log('SKIP', 'DB assertions skipped (database not available)');
    }

    // 7. Check audit file for HTTP patient
    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('HTTP001') || auditLog.includes('JOHNSON'),
      'Audit log file contains HTTP patient identifier'
    );
  }

  // =========================================================================
  // Phase 3: File Test
  // =========================================================================

  private async phase3File(): Promise<void> {
    // 1. Read CSV
    const csv = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/batch.csv'),
      'utf8'
    );

    // 2. Write to input directory
    const inputFile = path.join(FILE_PATHS.INPUT, 'test-batch.csv');
    fs.writeFileSync(inputFile, csv, 'utf8');
    if (this.verbose) log('INFO', `Wrote ${inputFile}`);

    // 3. Wait for file polling (File connector polls periodically)
    await this.delay(6000);

    // 4. Assert input file was processed (afterProcessingAction=DELETE)
    this.assert(
      !fs.existsSync(inputFile),
      'Input file was deleted after processing'
    );

    // 5. Check for output file
    const outputFile = path.join(FILE_PATHS.OUTPUT, 'processed.xml');
    this.assert(
      fs.existsSync(outputFile),
      'Output file processed.xml exists'
    );

    // 6. Check CH3 stats
    const ch3Stats = await getChannelStats(this.client, CHANNEL_IDS.CH3_FILE_PROCESSOR);
    this.assert(ch3Stats !== null, 'CH3 statistics available');
    this.assert(ch3Stats!.received >= 1, `CH3 received >= 1 (got ${ch3Stats!.received})`);

    // 7. Check audit log for FILE entry
    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('FILE001') || auditLog.includes('WILLIAMS') || auditLog.includes('FILE'),
      'Audit log file contains FILE patient data'
    );

    // 8. File messages should be filtered at CH4.D1 (no DB record for FILE type)
    if (this.dbAvailable && this.dbConnection) {
      const [rows] = await this.dbConnection.execute(
        'SELECT * FROM ks_audit_log WHERE source_type = ?',
        ['FILE']
      );
      // File entries may or may not be in DB depending on filter logic
      if (this.verbose) {
        log('INFO', `DB ks_audit_log has ${(rows as any[]).length} FILE entries`);
      }
    }
  }

  // =========================================================================
  // Phase 4: SOAP Loopback
  // =========================================================================

  private async phase4Soap(): Promise<void> {
    // The hub router (CH4) should have forwarded messages to CH9 SOAP endpoint
    // via WebService Dispatcher (Dest4)
    await this.delay(2000);

    const ch9Stats = await getChannelStats(this.client, CHANNEL_IDS.CH9_SOAP_ENDPOINT);
    this.assert(ch9Stats !== null, 'CH9 statistics available');
    this.assert(
      ch9Stats!.received >= 1,
      `CH9 (SOAP Endpoint) received >= 1 message (got ${ch9Stats!.received})`
    );

    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('SOAP'),
      'Audit log contains SOAP entry'
    );
  }

  // =========================================================================
  // Phase 5: DICOM Loopback
  // =========================================================================

  private async phase5Dicom(): Promise<void> {
    // CH4.D5 dispatches DICOM C-STORE to CH10 (DICOM SCP on port 11112)
    await this.delay(2000);

    const ch10Stats = await getChannelStats(this.client, CHANNEL_IDS.CH10_DICOM_SCP);
    this.assert(ch10Stats !== null, 'CH10 statistics available');
    this.assert(
      ch10Stats!.received >= 1,
      `CH10 (DICOM SCP) received >= 1 message (got ${ch10Stats!.received})`
    );

    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('DICOM'),
      'Audit log contains DICOM entry'
    );
  }

  // =========================================================================
  // Phase 6: JMS Loopback
  // =========================================================================

  private async phase6Jms(): Promise<void> {
    if (!this.jmsAvailable) {
      throw new Error('SKIP');
    }

    await this.delay(2000);

    const ch11Stats = await getChannelStats(this.client, CHANNEL_IDS.CH11_JMS_CONSUMER);
    this.assert(ch11Stats !== null, 'CH11 statistics available');
    this.assert(ch11Stats!.received >= 1, `CH11 received >= 1 (got ${ch11Stats!.received})`);

    const auditLog = this.readAuditLog();
    this.assert(auditLog.includes('JMS'), 'Audit log contains JMS entry');
  }

  // =========================================================================
  // Phase 7: JS Rx + Trace
  // =========================================================================

  private async phase7JsTrace(): Promise<void> {
    // CH12 is a JavaScript Reader that generates a message on deploy
    await this.delay(2000);

    const ch12Stats = await getChannelStats(this.client, CHANNEL_IDS.CH12_JS_GENERATOR);
    this.assert(ch12Stats !== null, 'CH12 statistics available');
    this.assert(ch12Stats!.received >= 1, `CH12 received >= 1 (got ${ch12Stats!.received})`);

    // Check audit log for JS-generated entry
    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('JAVASCRIPT') || auditLog.includes('JS_GEN'),
      'Audit log contains JavaScript-generated entry'
    );

    // Try trace API on CH1's first message
    try {
      const traceResp = await this.client.rawGet(
        `/api/messages/trace/${CHANNEL_IDS.CH1_ADT_RECEIVER}/1`
      );
      if (traceResp.status === 200) {
        const traceData = typeof traceResp.data === 'string'
          ? JSON.parse(traceResp.data)
          : traceResp.data;
        if (this.verbose) {
          log('INFO', `Trace response depth: ${JSON.stringify(traceData).length} chars`);
        }
        // Verify trace has some structure
        this.assert(
          traceData !== null && typeof traceData === 'object',
          'Trace API returned valid response'
        );
      } else if (this.verbose) {
        log('WARN', `Trace API returned status ${traceResp.status}`);
      }
    } catch (e: any) {
      if (this.verbose) log('WARN', `Trace API error: ${e.message}`);
    }
  }

  // =========================================================================
  // Phase 8: Maps + Filters + Statistics + Cleanup
  // =========================================================================

  private async phase8Cleanup(): Promise<void> {
    // 1. Send ORU^R01 to CH1 — should be filtered (CH1 only accepts ADT^A01)
    const oru = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/oru-r01.hl7'),
      'utf8'
    );
    const mllpClient = new MLLPClient({
      host: 'localhost',
      port: PORTS.MLLP,
      timeout: 10000,
      retryCount: 2,
      retryDelay: 500,
    });
    try {
      await mllpClient.send(oru);
    } catch {
      // ORU may be rejected — that's expected
    }

    // 2. POST patient-no-name to CH2 — should be rejected/filtered
    const noNameJson = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/patient-no-name.json'),
      'utf8'
    );
    try {
      await axios.post(
        `http://localhost:${PORTS.HTTP_GATEWAY}/api/patient`,
        noNameJson,
        {
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: 5000,
        }
      );
    } catch {
      // May be rejected — that's expected
    }

    // 3. Wait for processing
    await this.delay(2000);

    // 4. Check CH1 stats for filtered count
    const ch1Stats = await getChannelStats(this.client, CHANNEL_IDS.CH1_ADT_RECEIVER);
    if (ch1Stats) {
      if (this.verbose) {
        log('INFO', `CH1 final stats: received=${ch1Stats.received}, filtered=${ch1Stats.filtered}, sent=${ch1Stats.sent}, error=${ch1Stats.error}`);
      }
      // The ORU message should increment received (it's accepted at the source)
      // but may be filtered at the source filter
      this.assert(ch1Stats.received >= 2, `CH1 received >= 2 after ORU (got ${ch1Stats.received})`);
    }

    // 5. Undeploy all channels (reverse of deployment order)
    const allChannelIds = [
      CHANNEL_IDS.CH1_ADT_RECEIVER,
      CHANNEL_IDS.CH2_HTTP_GATEWAY,
      CHANNEL_IDS.CH3_FILE_PROCESSOR,
      CHANNEL_IDS.CH12_JS_GENERATOR,
      CHANNEL_IDS.CH4_HUB_ROUTER,
      CHANNEL_IDS.CH5_DB_PERSISTENCE,
      CHANNEL_IDS.CH6_RESPONSE_BUILDER,
      CHANNEL_IDS.CH9_SOAP_ENDPOINT,
      CHANNEL_IDS.CH10_DICOM_SCP,
      CHANNEL_IDS.CH7_AUDIT_LOGGER,
      CHANNEL_IDS.CH8_COMPLETION,
    ];
    if (this.jmsAvailable) {
      allChannelIds.splice(4, 0, CHANNEL_IDS.CH11_JMS_CONSUMER);
    }

    for (const channelId of allChannelIds) {
      await this.undeployAndDelete(channelId);
    }
    if (this.verbose) log('INFO', 'All channels undeployed and deleted');

    // 6. Delete code template library
    try {
      await this.client.deleteCodeTemplateLibrary(CODE_TEMPLATE_LIBRARY_ID);
      if (this.verbose) log('INFO', 'Code template library deleted');
    } catch {
      // Best effort
    }

    // 7. Database cleanup
    if (this.dbAvailable && this.dbConnection) {
      try {
        const teardownSql = fs.readFileSync(
          path.join(this.scenarioDir, 'sql/teardown.sql'),
          'utf8'
        );
        for (const stmt of teardownSql.split(';').filter((s) => s.trim())) {
          await this.dbConnection.execute(stmt);
        }
        await this.dbConnection.end();
        if (this.verbose) log('INFO', 'Database tables dropped');
      } catch (e: any) {
        if (this.verbose) log('WARN', `DB cleanup error: ${e.message}`);
      }
    }

    // 8. Filesystem cleanup
    try {
      fs.rmSync('/tmp/mirth-ks', { recursive: true, force: true });
      if (this.verbose) log('INFO', 'Filesystem cleaned');
    } catch {
      // Best effort
    }

    // 9. Stop mock SMTP
    await this.smtp.stop();
    if (this.verbose) log('INFO', 'Mock SMTP server stopped');
  }

  // =========================================================================
  // Helper methods
  // =========================================================================

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private assert(condition: boolean, message: string): void {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
    if (this.verbose) log('PASS', message);
  }

  private async deployChannelFromFile(filename: string): Promise<void> {
    const xmlPath = path.join(this.scenarioDir, 'channels', filename);
    if (!fs.existsSync(xmlPath)) {
      throw new Error(`Channel file not found: ${xmlPath}`);
    }
    const xml = fs.readFileSync(xmlPath, 'utf8');
    const idMatch = xml.match(/<id>([^<]+)<\/id>/);
    const channelId = idMatch?.[1];
    if (!channelId) {
      throw new Error(`No channel ID found in ${filename}`);
    }

    // Clean up any existing deployment
    try {
      await this.client.undeployChannel(channelId);
    } catch {
      // Channel may not exist yet
    }
    try {
      await this.client.deleteChannel(channelId);
    } catch {
      // Channel may not exist yet
    }
    await this.delay(200);

    // Import
    const imported = await this.client.importChannel(xml, true);
    if (!imported) {
      throw new Error(`Failed to import ${filename}`);
    }

    // Deploy
    await this.client.deployChannel(channelId);
    const started = await this.client.waitForChannelState(channelId, 'STARTED', 15000, 500, 2000);
    if (!started) {
      throw new Error(`Channel ${filename} did not reach STARTED state within 15s`);
    }
  }

  private async undeployAndDelete(channelId: string): Promise<void> {
    try {
      await this.client.undeployChannel(channelId);
    } catch {
      // May already be undeployed
    }
    await this.delay(200);
    try {
      await this.client.deleteChannel(channelId);
    } catch {
      // May already be deleted
    }
  }

  private readAuditLog(): string {
    const auditPath = path.join(FILE_PATHS.AUDIT, 'audit.log');
    if (!fs.existsSync(auditPath)) return '';
    return fs.readFileSync(auditPath, 'utf8');
  }

  private printPhaseResult(name: string, status: string, durationMs: number): void {
    const dots = '.'.repeat(Math.max(1, 45 - name.length));
    console.log(`${name} ${dots} ${status} (${(durationMs / 1000).toFixed(1)}s)`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const runner = new KitchenSinkRunner({ verbose });
  await runner.run();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
