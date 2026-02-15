/**
 * KitchenSinkRunner — End-to-end integration test exercising all connector types,
 * data types, script types, and map types across 18 interconnected channels.
 *
 * Runs 14 sequential phases: setup, MLLP, HTTP, File, SOAP loopback, DICOM loopback,
 * JMS loopback, JS Rx + Trace, Maps/Filters/Stats, XML Pipeline, HL7 Transform,
 * JSON + Error Flow, Multi-Dest $r, and API Verify + Cleanup.
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
  CH13_XML_PIPELINE:    'ks000013-0013-0013-0013-000000000013',
  CH14_HL7_TRANSFORM:   'ks000014-0014-0014-0014-000000000014',
  CH15_JSON_INBOUND:    'ks000015-0015-0015-0015-000000000015',
  CH16_ERROR_GENERATOR: 'ks000016-0016-0016-0016-000000000016',
  CH17_MULTI_DEST:      'ks000017-0017-0017-0017-000000000017',
  CH18_API_VERIFY:      'ks000018-0018-0018-0018-000000000018',
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
  XML_PIPELINE: 8093,
  HL7_TRANSFORM: 8094,
  JSON_INBOUND: 8095,
  MULTI_DEST: 8096,
  API_VERIFY: 8097,
};

const FILE_PATHS = {
  INPUT:       '/tmp/mirth-ks/input',
  OUTPUT:      '/tmp/mirth-ks/output',
  AUDIT:       '/tmp/mirth-ks/audit',
  JSON_OUTPUT: '/tmp/mirth-ks/json-output',
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
      { name: 'Phase 0: Setup',                    fn: () => this.phase0Setup() },
      { name: 'Phase 1: MLLP Test',                fn: () => this.phase1Mllp() },
      { name: 'Phase 2: HTTP Test',                 fn: () => this.phase2Http() },
      { name: 'Phase 3: File Test',                 fn: () => this.phase3File() },
      { name: 'Phase 4: SOAP Loopback',             fn: () => this.phase4Soap() },
      { name: 'Phase 5: DICOM Loopback',            fn: () => this.phase5Dicom() },
      { name: 'Phase 6: JMS Loopback',              fn: () => this.phase6Jms() },
      { name: 'Phase 7: JS Rx + Trace',             fn: () => this.phase7JsTrace() },
      { name: 'Phase 8: Maps + Filters + Stats',    fn: () => this.phase8MapsFilters() },
      { name: 'Phase 9: XML Pipeline',              fn: () => this.phase9XmlPipeline() },
      { name: 'Phase 10: HL7 Transform',            fn: () => this.phase10Hl7Transform() },
      { name: 'Phase 11: JSON + Error Flow',        fn: () => this.phase11JsonError() },
      { name: 'Phase 12: Multi-Dest $r',            fn: () => this.phase12MultiDest() },
      { name: 'Phase 13: API Verify + Cleanup',     fn: () => this.phase13ApiCleanup() },
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
    // 0. Undeploy all existing channels to free ports
    if (this.verbose) log('INFO', 'Undeploying all existing channels to free ports...');
    try {
      const existingStatuses = await this.client.getChannelStatuses();
      for (const status of existingStatuses) {
        if (status.channelId && status.state !== 'UNDEPLOYED') {
          try {
            await this.client.undeployChannel(status.channelId);
            if (this.verbose) log('INFO', `Undeployed existing channel: ${status.name || status.channelId}`);
          } catch {
            // Best effort
          }
        }
      }
      if (existingStatuses.length > 0) {
        await this.delay(1000);
      }
    } catch (e: any) {
      if (this.verbose) log('WARN', `Could not undeploy existing channels: ${e.message}`);
    }

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

      // Drop per-channel tables from previous test runs to avoid duplicate key errors.
      // These tables persist across channel delete/recreate because deleteChannel()
      // only removes the CHANNEL row, not the per-channel message tables.
      for (const channelId of Object.values(CHANNEL_IDS)) {
        const suffix = channelId.replace(/-/g, '_');
        for (const prefix of ['D_M', 'D_MM', 'D_MC', 'D_MA', 'D_MS', 'D_MSQ', 'D_MCM']) {
          try {
            await conn.execute(`DROP TABLE IF EXISTS ${prefix}${suffix}`);
          } catch {
            // Ignore errors (table may not exist)
          }
        }
        // Also remove from D_CHANNELS registry
        try {
          await conn.execute(`DELETE FROM D_CHANNELS WHERE CHANNEL_ID = ?`, [channelId]);
        } catch {
          // Ignore
        }
      }
      if (this.verbose) log('INFO', 'Cleaned up per-channel tables from previous runs');

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
    // Tier 5 (new leaf channels - no dependencies)
    const tier5 = [
      'ch16-error-generator.xml',
      'ch17-multi-dest.xml',
      'ch18-api-verify.xml',
    ];
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
    // Tier 3b (new channels that depend on CH7 audit or CH16 error)
    const tier3b = [
      'ch13-xml-pipeline.xml',
      'ch14-hl7-transform.xml',
      'ch15-json-inbound.xml',
    ];
    // Tier 2 (hub - depends on tier 3 + 4)
    const tier2 = ['ch04-hub-router.xml'];
    // Tier 1 (entry points - depend on tier 2)
    const tier1 = [
      'ch01-adt-receiver.xml',
      'ch02-http-gateway.xml',
      'ch03-file-processor.xml',
      'ch12-js-generator.xml',
    ];

    const allTiers = [tier5, tier4, tier3, tier3b, tier2, tier1];
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
  // Phase 8: Maps + Filters + Statistics (no cleanup — moved to Phase 13)
  // =========================================================================

  private async phase8MapsFilters(): Promise<void> {
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
  }

  // =========================================================================
  // Phase 9: XML Pipeline + Multi-Step + $co + $cfg
  // =========================================================================

  private async phase9XmlPipeline(): Promise<void> {
    // 1. POST valid XML patient to CH13
    const xmlMsg = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/patient-xml.xml'),
      'utf8'
    );
    const resp = await axios.post(
      `http://localhost:${PORTS.XML_PIPELINE}/xml`,
      xmlMsg,
      {
        headers: { 'Content-Type': 'application/xml' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    this.assert(
      resp.status === 200,
      `CH13 XML POST accepted (status ${resp.status})`
    );

    // 2. Wait for VM propagation
    await this.delay(2000);

    // 3. Check CH13 stats
    const ch13Stats = await getChannelStats(this.client, CHANNEL_IDS.CH13_XML_PIPELINE);
    this.assert(ch13Stats !== null, 'CH13 statistics available');
    this.assert(ch13Stats!.received >= 1, `CH13 received >= 1 (got ${ch13Stats!.received})`);

    // 4. Check audit log for XML patient ID
    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('XML001') || auditLog.includes('XML_PIPELINE'),
      'Audit log contains XML pipeline entry'
    );

    // 5. POST invalid XML — should be filtered by multi-rule AND filter
    const invalidXml = '<empty/>';
    const filtResp = await axios.post(
      `http://localhost:${PORTS.XML_PIPELINE}/xml`,
      invalidXml,
      {
        headers: { 'Content-Type': 'application/xml' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    if (this.verbose) log('INFO', `Invalid XML POST status: ${filtResp.status}`);

    await this.delay(1000);

    // 6. Check CH13 filtered count increased
    const ch13StatsAfter = await getChannelStats(this.client, CHANNEL_IDS.CH13_XML_PIPELINE);
    this.assert(ch13StatsAfter !== null, 'CH13 stats available after filter test');
    this.assert(
      ch13StatsAfter!.filtered >= 1,
      `CH13 filtered >= 1 (got ${ch13StatsAfter!.filtered})`
    );
  }

  // =========================================================================
  // Phase 10: HL7v2 Transform + validate + createSegment + DestinationSet
  // =========================================================================

  private async phase10Hl7Transform(): Promise<void> {
    // 1. POST normal HL7v2 to CH14 (both D1 Audit + D2 DB should receive)
    const hl7Normal = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/hl7v2-via-http.hl7'),
      'utf8'
    );
    const resp1 = await axios.post(
      `http://localhost:${PORTS.HL7_TRANSFORM}/hl7`,
      hl7Normal,
      {
        headers: { 'Content-Type': 'text/plain' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    this.assert(
      resp1.status === 200,
      `CH14 normal HL7 POST accepted (status ${resp1.status})`
    );

    await this.delay(1000);

    // 2. POST filtered HL7v2 (DestinationSet removes D2 DB Writer)
    const hl7Filtered = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/hl7v2-filtered.hl7'),
      'utf8'
    );
    const resp2 = await axios.post(
      `http://localhost:${PORTS.HL7_TRANSFORM}/hl7`,
      hl7Filtered,
      {
        headers: { 'Content-Type': 'text/plain' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    this.assert(
      resp2.status === 200,
      `CH14 filtered HL7 POST accepted (status ${resp2.status})`
    );

    await this.delay(2000);

    // 3. Check CH14 received both messages
    const ch14Stats = await getChannelStats(this.client, CHANNEL_IDS.CH14_HL7_TRANSFORM);
    this.assert(ch14Stats !== null, 'CH14 statistics available');
    this.assert(ch14Stats!.received >= 2, `CH14 received >= 2 (got ${ch14Stats!.received})`);

    // 4. Check database: normal patient should have DB row, filtered should NOT
    if (this.dbAvailable && this.dbConnection) {
      const [normalRows] = await this.dbConnection.execute(
        'SELECT * FROM ks_batch_results WHERE patient_id = ?',
        ['HL7HTTP001']
      );
      this.assert(
        (normalRows as any[]).length >= 1,
        `DB ks_batch_results has row for HL7HTTP001 (found ${(normalRows as any[]).length})`
      );

      const [filteredRows] = await this.dbConnection.execute(
        'SELECT * FROM ks_batch_results WHERE patient_id = ?',
        ['FILTERED_PATIENT']
      );
      this.assert(
        (filteredRows as any[]).length === 0,
        `DB ks_batch_results has NO row for FILTERED_PATIENT (found ${(filteredRows as any[]).length})`
      );
    } else if (this.verbose) {
      log('SKIP', 'DB assertions skipped (database not available)');
    }

    // 5. Check audit log for both patient IDs
    const auditLog = this.readAuditLog();
    this.assert(
      auditLog.includes('HL7HTTP001') || auditLog.includes('HL7_HTTP'),
      'Audit log contains HL7 HTTP normal entry'
    );
  }

  // =========================================================================
  // Phase 11: JSON Inbound + Error Flow
  // =========================================================================

  private async phase11JsonError(): Promise<void> {
    // 1. POST JSON patient to CH15
    const jsonMsg = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/patient-json-inbound.json'),
      'utf8'
    );
    const resp = await axios.post(
      `http://localhost:${PORTS.JSON_INBOUND}/json`,
      jsonMsg,
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    this.assert(
      resp.status === 200,
      `CH15 JSON POST accepted (status ${resp.status})`
    );

    // 2. Wait for VM routing to CH16 (error generator)
    await this.delay(3000);

    // 3. Check CH15 received
    const ch15Stats = await getChannelStats(this.client, CHANNEL_IDS.CH15_JSON_INBOUND);
    this.assert(ch15Stats !== null, 'CH15 statistics available');
    this.assert(ch15Stats!.received >= 1, `CH15 received >= 1 (got ${ch15Stats!.received})`);

    // 4. Check CH16 received (VM routing worked)
    const ch16Stats = await getChannelStats(this.client, CHANNEL_IDS.CH16_ERROR_GENERATOR);
    this.assert(ch16Stats !== null, 'CH16 statistics available');
    this.assert(ch16Stats!.received >= 1, `CH16 received >= 1 (got ${ch16Stats!.received})`);

    // 5. Check CH16 has errors (intentional throw)
    this.assert(
      ch16Stats!.error >= 1,
      `CH16 error >= 1 (got ${ch16Stats!.error})`
    );

    // 6. Check file output from CH15 D2
    const outputFile = path.join(FILE_PATHS.JSON_OUTPUT, 'result.xml');
    this.assert(
      fs.existsSync(outputFile),
      'JSON output file result.xml exists'
    );

    // 7. Verify output contains patient ID
    const outputContent = fs.readFileSync(outputFile, 'utf8');
    this.assert(
      outputContent.includes('JSON001'),
      'JSON output contains patient ID JSON001'
    );
  }

  // =========================================================================
  // Phase 12: Multi-Destination $r + Postprocessor
  // =========================================================================

  private async phase12MultiDest(): Promise<void> {
    // 1. POST to CH17
    const jsonMsg = fs.readFileSync(
      path.join(this.scenarioDir, 'messages/response-test.json'),
      'utf8'
    );
    const resp = await axios.post(
      `http://localhost:${PORTS.MULTI_DEST}/multi`,
      jsonMsg,
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    this.assert(
      resp.status === 200,
      `CH17 multi-dest POST accepted (status ${resp.status})`
    );

    // 2. Wait for all 3 destinations to process
    await this.delay(2000);

    // 3. Check CH17 received
    const ch17Stats = await getChannelStats(this.client, CHANNEL_IDS.CH17_MULTI_DEST);
    this.assert(ch17Stats !== null, 'CH17 statistics available');
    this.assert(ch17Stats!.received >= 1, `CH17 received >= 1 (got ${ch17Stats!.received})`);

    // 4. Check all 3 destinations sent
    this.assert(
      ch17Stats!.sent >= 3,
      `CH17 sent >= 3 (got ${ch17Stats!.sent})`
    );

    // 5. No errors expected
    this.assert(
      ch17Stats!.error === 0,
      `CH17 error === 0 (got ${ch17Stats!.error})`
    );
  }

  // =========================================================================
  // Phase 13: API Verification + Full Cleanup
  // =========================================================================

  private async phase13ApiCleanup(): Promise<void> {
    // 1. POST to CH18 (API verify channel)
    const resp = await axios.post(
      `http://localhost:${PORTS.API_VERIFY}/api-test`,
      'API_VERIFICATION_PAYLOAD',
      {
        headers: { 'Content-Type': 'text/plain' },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    this.assert(
      resp.status === 200,
      `CH18 API test POST accepted (status ${resp.status})`
    );

    await this.delay(2000);

    // 2. Message count via channel stats
    const ch18Stats = await getChannelStats(this.client, CHANNEL_IDS.CH18_API_VERIFY);
    this.assert(ch18Stats !== null, 'CH18 statistics available');
    this.assert(ch18Stats!.received >= 1, `CH18 received >= 1 (got ${ch18Stats!.received})`);
    this.assert(ch18Stats!.sent >= 1, `CH18 sent >= 1 (got ${ch18Stats!.sent})`);
    this.assert(ch18Stats!.error === 0, `CH18 error === 0 (got ${ch18Stats!.error})`);

    // 3. Message search API — verify messages exist for CH18
    try {
      const msgResp = await this.client.rawGet(
        `/api/channels/${CHANNEL_IDS.CH18_API_VERIFY}/messages?limit=10`
      );
      if (msgResp.status === 200) {
        const msgData = typeof msgResp.data === 'string' ? msgResp.data : JSON.stringify(msgResp.data);
        this.assert(
          msgData.length > 10,
          `CH18 message API returned data (${msgData.length} chars)`
        );
      } else if (this.verbose) {
        log('WARN', `Message API returned status ${msgResp.status}`);
      }
    } catch (e: any) {
      if (this.verbose) log('WARN', `Message API error: ${e.message}`);
    }

    // 4. Channel export API
    try {
      const exportResp = await this.client.getChannelXml(CHANNEL_IDS.CH18_API_VERIFY);
      this.assert(
        exportResp !== null && exportResp.includes('KS CH18'),
        'Channel export API returns valid XML'
      );
    } catch (e: any) {
      if (this.verbose) log('WARN', `Channel export error: ${e.message}`);
    }

    // ===== FULL CLEANUP (moved from old phase8) =====

    // 5. Undeploy all channels (reverse of deployment order)
    // New channels first (entry points → leaves)
    const newChannelIds = [
      CHANNEL_IDS.CH13_XML_PIPELINE,
      CHANNEL_IDS.CH14_HL7_TRANSFORM,
      CHANNEL_IDS.CH15_JSON_INBOUND,
      CHANNEL_IDS.CH16_ERROR_GENERATOR,
      CHANNEL_IDS.CH17_MULTI_DEST,
      CHANNEL_IDS.CH18_API_VERIFY,
    ];
    for (const channelId of newChannelIds) {
      await this.undeployAndDelete(channelId);
    }
    if (this.verbose) log('INFO', 'New channels (CH13-CH18) undeployed and deleted');

    // Original channels
    const origChannelIds = [
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
      origChannelIds.splice(4, 0, CHANNEL_IDS.CH11_JMS_CONSUMER);
    }

    for (const channelId of origChannelIds) {
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
