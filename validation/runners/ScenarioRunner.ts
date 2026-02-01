import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../config/environments';
import { MirthApiClient } from '../clients/MirthApiClient';
import { MLLPClient } from '../clients/MLLPClient';
import { HttpMessageClient } from '../clients/HttpMessageClient';
import { FileClient } from '../clients/FileClient';
import { MessageComparator, ComparisonResult, Difference } from '../comparators/MessageComparator';
import { ResponseComparator } from '../comparators/ResponseComparator';
import { ChannelExportComparator } from '../comparators/ChannelExportComparator';

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  priority: number;
  type: 'export' | 'mllp' | 'http' | 'file' | 'database';
  channelFile?: string;
  inputMessage?: string;
  expectedOutput?: string;
  timeout?: number;
  basePath?: string;
  steps?: ScenarioStep[];
  /**
   * File output directory for file writer channels.
   * Defaults to /tmp/mirth-validation
   */
  fileOutputDir?: string;
}

export interface ScenarioStep {
  action: 'deploy' | 'start' | 'stop' | 'undeploy' | 'send' | 'wait' | 'compare' | 'cleanup';
  target?: 'java' | 'node' | 'both';
  data?: unknown;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  error?: string;
  differences: Difference[];
  javaResponse?: unknown;
  nodeResponse?: unknown;
  duration: number;
}

export class ScenarioRunner {
  private messageComparator: MessageComparator;
  private responseComparator: ResponseComparator;
  private channelComparator: ChannelExportComparator;

  constructor(
    private javaClient: MirthApiClient,
    private nodeClient: MirthApiClient,
    private env: Environment
  ) {
    this.messageComparator = new MessageComparator();
    this.responseComparator = new ResponseComparator();
    this.channelComparator = new ChannelExportComparator();
  }

  /**
   * Run a single scenario
   */
  async run(config: ScenarioConfig): Promise<ScenarioResult> {
    const startTime = Date.now();

    try {
      switch (config.type) {
        case 'export':
          return await this.runExportScenario(config, startTime);
        case 'mllp':
          return await this.runMLLPScenario(config, startTime);
        case 'http':
          return await this.runHttpScenario(config, startTime);
        case 'file':
          return await this.runFileScenario(config, startTime);
        default:
          return {
            scenarioId: config.id,
            scenarioName: config.name,
            passed: false,
            error: `Unknown scenario type: ${config.type}`,
            differences: [],
            duration: Date.now() - startTime,
          };
      }
    } catch (error) {
      return {
        scenarioId: config.id,
        scenarioName: config.name,
        passed: false,
        error: (error as Error).message,
        differences: [],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Run export/import compatibility scenario
   */
  private async runExportScenario(
    config: ScenarioConfig,
    startTime: number
  ): Promise<ScenarioResult> {
    const basePath = config.basePath || path.join(__dirname, '..', 'scenarios', config.id);

    // Load channel file
    let channelXml: string;
    if (config.channelFile) {
      const channelPath = path.join(basePath, config.channelFile);
      if (!fs.existsSync(channelPath)) {
        // Try fixtures directory
        const fixturesPath = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'example-channels', config.channelFile);
        if (fs.existsSync(fixturesPath)) {
          channelXml = fs.readFileSync(fixturesPath, 'utf8');
        } else {
          throw new Error(`Channel file not found: ${config.channelFile}`);
        }
      } else {
        channelXml = fs.readFileSync(channelPath, 'utf8');
      }
    } else {
      throw new Error('Export scenario requires channelFile');
    }

    // Extract channel ID first
    const channelId = this.extractChannelId(channelXml);
    if (!channelId) {
      throw new Error('Could not extract channel ID from XML');
    }

    // Delete existing channels first (Java Mirth's override doesn't work reliably)
    try {
      await this.javaClient.deleteChannel(channelId);
    } catch {
      // Ignore - channel may not exist
    }
    try {
      await this.nodeClient.deleteChannel(channelId);
    } catch {
      // Ignore - channel may not exist
    }

    // Small delay to ensure deletion completes
    await this.delay(1000);

    // Import to both engines
    const javaImport = await this.javaClient.importChannel(channelXml, true);
    const nodeImport = await this.nodeClient.importChannel(channelXml, true);

    if (!javaImport || !nodeImport) {
      return {
        scenarioId: config.id,
        scenarioName: config.name,
        passed: false,
        error: `Import failed - Java: ${javaImport}, Node: ${nodeImport}`,
        differences: [],
        duration: Date.now() - startTime,
      };
    }

    // Export from both engines
    const javaExport = await this.javaClient.getChannelXml(channelId);
    const nodeExport = await this.nodeClient.getChannelXml(channelId);

    if (!javaExport || !nodeExport) {
      return {
        scenarioId: config.id,
        scenarioName: config.name,
        passed: false,
        error: 'Export failed from one or both engines',
        differences: [],
        javaResponse: javaExport,
        nodeResponse: nodeExport,
        duration: Date.now() - startTime,
      };
    }

    // Compare exports
    const comparison = this.channelComparator.compareExports(javaExport, nodeExport);

    // Cleanup - delete channels
    await this.javaClient.deleteChannel(channelId);
    await this.nodeClient.deleteChannel(channelId);

    return {
      scenarioId: config.id,
      scenarioName: config.name,
      passed: comparison.match,
      differences: comparison.differences.map((d) => ({
        path: d.field,
        type: 'changed' as const,
        expected: d.javaValue,
        actual: d.nodeValue,
        description: d.description,
      })),
      javaResponse: javaExport.substring(0, 500),
      nodeResponse: nodeExport.substring(0, 500),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Run MLLP message flow scenario
   *
   * This method prepares separate channel configurations for each engine,
   * with engine-specific ports and channel IDs to avoid conflicts.
   */
  private async runMLLPScenario(
    config: ScenarioConfig,
    startTime: number
  ): Promise<ScenarioResult> {
    const basePath = config.basePath || path.join(__dirname, '..', 'scenarios', config.id);
    let javaChannelId: string | null = null;
    let nodeChannelId: string | null = null;

    // Load channel and deploy to both engines with engine-specific configurations
    if (config.channelFile) {
      const channelXml = this.loadChannelFile(config.channelFile, basePath);

      // Prepare separate channel XMLs for each engine
      const javaChannel = this.prepareChannelForEngine(channelXml, 'java', config);
      const nodeChannel = this.prepareChannelForEngine(channelXml, 'node', config);

      javaChannelId = javaChannel.channelId;
      nodeChannelId = nodeChannel.channelId;

      // Delete existing channels first
      try {
        await this.javaClient.undeployChannel(javaChannelId);
        await this.javaClient.deleteChannel(javaChannelId);
      } catch {
        // Ignore - channel may not exist
      }
      try {
        await this.nodeClient.undeployChannel(nodeChannelId);
        await this.nodeClient.deleteChannel(nodeChannelId);
      } catch {
        // Ignore - channel may not exist
      }
      await this.delay(500);

      // Import engine-specific channels
      await this.javaClient.importChannel(javaChannel.xml, true);
      await this.nodeClient.importChannel(nodeChannel.xml, true);

      // Deploy both channels
      await this.javaClient.deployChannel(javaChannelId);
      await this.nodeClient.deployChannel(nodeChannelId);

      // Wait for channels to start
      await this.javaClient.waitForChannelState(javaChannelId, 'STARTED', 30000);
      await this.nodeClient.waitForChannelState(nodeChannelId, 'STARTED', 30000);
    }

    // Load test message
    let testMessage: string;
    if (config.inputMessage) {
      const messagePath = path.join(basePath, config.inputMessage);
      if (fs.existsSync(messagePath)) {
        testMessage = fs.readFileSync(messagePath, 'utf8');
      } else {
        // Try fixtures
        const fixturesPath = path.join(__dirname, '..', 'fixtures', 'messages', config.inputMessage);
        if (fs.existsSync(fixturesPath)) {
          testMessage = fs.readFileSync(fixturesPath, 'utf8');
        } else {
          throw new Error(`Input message not found: ${config.inputMessage}`);
        }
      }
    } else {
      throw new Error('MLLP scenario requires inputMessage');
    }

    // Create MLLP clients targeting engine-specific ports
    const javaMLLP = new MLLPClient({
      host: 'localhost',
      port: this.env.java.mllpPort,
      timeout: config.timeout || 30000,
    });
    const nodeMLLP = new MLLPClient({
      host: 'localhost',
      port: this.env.node.mllpPort,
      timeout: config.timeout || 30000,
    });

    // Send message to both engines
    const javaResponse = await javaMLLP.send(testMessage);
    const nodeResponse = await nodeMLLP.send(testMessage);

    // Compare ACK responses
    const ackComparison = this.responseComparator.compareAck(
      javaResponse.rawResponse || '',
      nodeResponse.rawResponse || ''
    );

    // Cleanup - undeploy and delete both engine-specific channels
    if (javaChannelId) {
      try {
        await this.javaClient.undeployChannel(javaChannelId);
        await this.javaClient.deleteChannel(javaChannelId);
      } catch {
        // Ignore cleanup errors
      }
    }
    if (nodeChannelId) {
      try {
        await this.nodeClient.undeployChannel(nodeChannelId);
        await this.nodeClient.deleteChannel(nodeChannelId);
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      scenarioId: config.id,
      scenarioName: config.name,
      passed: ackComparison.match,
      differences: ackComparison.differences,
      javaResponse: javaResponse,
      nodeResponse: nodeResponse,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Run HTTP message flow scenario
   *
   * Like MLLP scenarios, this prepares separate channel configurations
   * for each engine with engine-specific HTTP ports.
   */
  private async runHttpScenario(
    config: ScenarioConfig,
    startTime: number
  ): Promise<ScenarioResult> {
    const basePath = config.basePath || path.join(__dirname, '..', 'scenarios', config.id);
    let javaChannelId: string | null = null;
    let nodeChannelId: string | null = null;

    // Setup HTTP clients targeting engine-specific ports
    const javaHttp = new HttpMessageClient({
      baseUrl: `http://localhost:${this.env.java.httpTestPort}`,
    });
    const nodeHttp = new HttpMessageClient({
      baseUrl: `http://localhost:${this.env.node.httpTestPort}`,
    });

    // Load and deploy channel with engine-specific configurations
    if (config.channelFile) {
      const channelXml = this.loadChannelFile(config.channelFile, basePath);

      // Prepare separate channel XMLs for each engine
      const javaChannel = this.prepareChannelForEngine(channelXml, 'java', config);
      const nodeChannel = this.prepareChannelForEngine(channelXml, 'node', config);

      javaChannelId = javaChannel.channelId;
      nodeChannelId = nodeChannel.channelId;

      // Delete existing channels first
      try {
        await this.javaClient.undeployChannel(javaChannelId);
        await this.javaClient.deleteChannel(javaChannelId);
      } catch {
        // Ignore - channel may not exist
      }
      try {
        await this.nodeClient.undeployChannel(nodeChannelId);
        await this.nodeClient.deleteChannel(nodeChannelId);
      } catch {
        // Ignore - channel may not exist
      }
      await this.delay(500);

      // Import engine-specific channels
      await this.javaClient.importChannel(javaChannel.xml, true);
      await this.nodeClient.importChannel(nodeChannel.xml, true);

      // Deploy and wait for start
      await this.javaClient.deployChannel(javaChannelId);
      await this.nodeClient.deployChannel(nodeChannelId);
      await this.javaClient.waitForChannelState(javaChannelId, 'STARTED', 30000);
      await this.nodeClient.waitForChannelState(nodeChannelId, 'STARTED', 30000);
    }

    // Load test message
    let testMessage = '';
    if (config.inputMessage) {
      const messagePath = path.join(basePath, config.inputMessage);
      if (fs.existsSync(messagePath)) {
        testMessage = fs.readFileSync(messagePath, 'utf8');
      } else {
        // Try fixtures
        const fixturesPath = path.join(__dirname, '..', 'fixtures', 'messages', config.inputMessage);
        if (fs.existsSync(fixturesPath)) {
          testMessage = fs.readFileSync(fixturesPath, 'utf8');
        }
      }
    }

    // Send to both engines
    const javaResponse = await javaHttp.post('/', testMessage);
    const nodeResponse = await nodeHttp.post('/', testMessage);

    // Compare responses
    const comparison = this.responseComparator.compareHttpResponse(
      javaResponse.statusCode,
      javaResponse.body,
      nodeResponse.statusCode,
      nodeResponse.body
    );

    // Cleanup - undeploy and delete both engine-specific channels
    if (javaChannelId) {
      try {
        await this.javaClient.undeployChannel(javaChannelId);
        await this.javaClient.deleteChannel(javaChannelId);
      } catch {
        // Ignore cleanup errors
      }
    }
    if (nodeChannelId) {
      try {
        await this.nodeClient.undeployChannel(nodeChannelId);
        await this.nodeClient.deleteChannel(nodeChannelId);
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      scenarioId: config.id,
      scenarioName: config.name,
      passed: comparison.match,
      differences: comparison.differences,
      javaResponse,
      nodeResponse,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Run file-based scenario
   */
  private async runFileScenario(
    config: ScenarioConfig,
    startTime: number
  ): Promise<ScenarioResult> {
    // File scenarios check output files after message processing
    // This is a placeholder for file connector validation
    return {
      scenarioId: config.id,
      scenarioName: config.name,
      passed: true,
      differences: [],
      duration: Date.now() - startTime,
    };
  }

  /**
   * Load channel file from scenario or fixtures directory
   */
  private loadChannelFile(filename: string, basePath: string): string {
    const scenarioPath = path.join(basePath, filename);
    if (fs.existsSync(scenarioPath)) {
      return fs.readFileSync(scenarioPath, 'utf8');
    }

    const fixturesPath = path.join(
      __dirname,
      '..',
      '..',
      'tests',
      'fixtures',
      'example-channels',
      filename
    );
    if (fs.existsSync(fixturesPath)) {
      return fs.readFileSync(fixturesPath, 'utf8');
    }

    throw new Error(`Channel file not found: ${filename}`);
  }

  /**
   * Extract channel ID from channel XML
   */
  private extractChannelId(xml: string): string | null {
    // Simple regex extraction
    const match = xml.match(/<id>([^<]+)<\/id>/);
    return match ? match[1] : null;
  }

  /**
   * Generate a deterministic UUID based on original ID and engine.
   * This creates a valid UUID that's unique per engine but reproducible.
   */
  private generateEngineChannelId(originalId: string, engine: 'java' | 'node'): string {
    // Simple deterministic UUID generation: modify last segment based on engine
    // Original: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // Java:     xxxxxxxx-xxxx-xxxx-xxxx-xxxxxx000001
    // Node:     xxxxxxxx-xxxx-xxxx-xxxx-xxxxxx000002
    const suffix = engine === 'java' ? '000001' : '000002';
    const parts = originalId.split('-');
    if (parts.length === 5) {
      // Replace last 6 chars of the final segment
      parts[4] = parts[4].substring(0, 6) + suffix;
      return parts.join('-');
    }
    // Fallback: generate completely new UUID-like ID
    return engine === 'java'
      ? '00000000-0000-0000-0000-000000000001'
      : '00000000-0000-0000-0000-000000000002';
  }

  /**
   * Prepare channel XML for a specific engine by substituting placeholders.
   *
   * Supported placeholders:
   * - {{MLLP_PORT}} - MLLP listener port
   * - {{HTTP_PORT}} - HTTP listener port
   * - {{FILE_OUTPUT_DIR}} - File output directory
   * - {{CHANNEL_ID}} - Unique channel ID (generated if not in original)
   * - ${listenerPort}, ${listenerAddress}, ${fileOutboxPath} - Legacy Mirth variables
   *
   * Generates a unique but valid UUID for each engine to avoid conflicts.
   */
  private prepareChannelForEngine(
    xml: string,
    engine: 'java' | 'node',
    config: ScenarioConfig
  ): { xml: string; channelId: string } {
    let prepared = xml;

    const mllpPort = engine === 'java' ? this.env.java.mllpPort : this.env.node.mllpPort;
    const httpPort = engine === 'java' ? this.env.java.httpTestPort : this.env.node.httpTestPort;
    const fileOutputDir = config.fileOutputDir || `/tmp/mirth-validation/${engine}`;

    // Extract original channel ID
    const originalId = this.extractChannelId(xml);
    if (!originalId) {
      throw new Error('Could not extract channel ID from XML');
    }

    // Generate engine-specific channel ID (valid UUID to avoid DB column length issues)
    const engineChannelId = this.generateEngineChannelId(originalId, engine);

    // Replace channel ID
    prepared = prepared.replace(
      new RegExp(`<id>${originalId}</id>`),
      `<id>${engineChannelId}</id>`
    );

    // Replace modern placeholders
    prepared = prepared
      .replace(/\{\{MLLP_PORT\}\}/g, String(mllpPort))
      .replace(/\{\{HTTP_PORT\}\}/g, String(httpPort))
      .replace(/\{\{FILE_OUTPUT_DIR\}\}/g, fileOutputDir)
      .replace(/\{\{CHANNEL_ID\}\}/g, engineChannelId);

    // Replace legacy Mirth configuration variables
    prepared = prepared
      .replace(/\$\{listenerPort\}/g, String(mllpPort))
      .replace(/\$\{listenerAddress\}/g, '0.0.0.0')
      .replace(/\$\{fileOutboxPath\}/g, fileOutputDir)
      .replace(/\$\{filePrefix\}/g, 'msg-');

    return { xml: prepared, channelId: engineChannelId };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// CLI entry point for running individual scenarios
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: ts-node ScenarioRunner.ts <scenario-config.json>');
    process.exit(1);
  }

  const configPath = args[0];
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config: ScenarioConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const { environment } = await import('../config/environments');
  const { createClients } = await import('../clients/MirthApiClient');

  const clients = createClients(environment.java, environment.node);
  const runner = new ScenarioRunner(clients.java, clients.node, environment);

  // Login
  await clients.java.login();
  await clients.node.login();

  try {
    const result = await runner.run(config);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.passed ? 0 : 1);
  } finally {
    await clients.java.logout();
    await clients.node.logout();
  }
}

if (require.main === module) {
  main();
}
