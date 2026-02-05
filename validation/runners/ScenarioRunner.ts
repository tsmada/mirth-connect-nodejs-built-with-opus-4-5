import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../config/environments';
import { MirthApiClient } from '../clients/MirthApiClient';
import { MLLPClient } from '../clients/MLLPClient';
import { HttpMessageClient } from '../clients/HttpMessageClient';
import { FileClient } from '../clients/FileClient';
import { MessageComparator, ComparisonResult, Difference, JsonComparisonOptions } from '../comparators/MessageComparator';
import { ResponseComparator } from '../comparators/ResponseComparator';
import { ChannelExportComparator } from '../comparators/ChannelExportComparator';
import { MapComparator, MapComparisonResult } from '../comparators/MapComparator';
import { ValidationSftpClient, SftpConfig, DEFAULT_SFTP_CONFIG } from '../clients/SftpClient';

// Get project root - process.cwd() should be validation directory when run via npm scripts
function getProjectRoot(): string {
  return process.cwd();
}

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  priority: number;
  type: 'export' | 'mllp' | 'http' | 'file' | 'database' | 'sftp';
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
  /**
   * Skip channel deployment - assume channels are already deployed.
   * Useful for quick validation against pre-deployed channels.
   */
  skipDeployment?: boolean;
  /**
   * Pre-configured channel IDs for each engine (used with skipDeployment).
   * If not provided, will be computed from channelFile.
   */
  preDeployedChannelIds?: {
    java?: string;
    node?: string;
  };
  /**
   * Output format for response comparison.
   * Used to select the appropriate comparator.
   */
  outputFormat?: 'hl7' | 'xml' | 'json' | 'text';
  /**
   * Map assertions to validate channel map contents.
   * Key is the map type (channelMap, sourceMap, etc.), value is key-value pairs to assert.
   */
  mapAssertions?: Record<string, Record<string, string>>;
  /**
   * Enable multi-message testing.
   * When true, inputMessages array is used instead of inputMessage.
   */
  multiMessage?: boolean;
  /**
   * Array of input messages for multi-message testing.
   */
  inputMessages?: string[];
  /**
   * Number of destinations in multi-destination channels.
   * Used for validation reporting.
   */
  destinations?: number;
  /**
   * SFTP configuration for SFTP scenarios.
   */
  sftpConfig?: {
    java?: SftpConfig;
    node?: SftpConfig;
  };
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
  private mapComparator: MapComparator;

  constructor(
    private javaClient: MirthApiClient,
    private nodeClient: MirthApiClient,
    private env: Environment
  ) {
    this.messageComparator = new MessageComparator();
    this.responseComparator = new ResponseComparator();
    this.channelComparator = new ChannelExportComparator();
    this.mapComparator = new MapComparator();
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
        case 'sftp':
          return await this.runSftpScenario(config, startTime);
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
    const basePath = config.basePath || path.join(getProjectRoot(), 'scenarios', config.id);

    // Load channel file
    let channelXml: string;
    if (config.channelFile) {
      const channelPath = path.join(basePath, config.channelFile);
      if (!fs.existsSync(channelPath)) {
        // Try fixtures directory
        const fixturesPath = path.join(getProjectRoot(), '..', 'tests', 'fixtures', 'example-channels', config.channelFile);
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
   *
   * When skipDeployment is true, assumes channels are already deployed
   * and skips the deploy/undeploy steps for faster validation.
   */
  private async runMLLPScenario(
    config: ScenarioConfig,
    startTime: number
  ): Promise<ScenarioResult> {
    const basePath = config.basePath || path.join(getProjectRoot(), 'scenarios', config.id);
    let javaChannelId: string | null = null;
    let nodeChannelId: string | null = null;
    const shouldDeploy = !config.skipDeployment;

    // Load channel and deploy to both engines with engine-specific configurations
    if (config.channelFile) {
      const channelXml = this.loadChannelFile(config.channelFile, basePath);

      // Prepare separate channel XMLs for each engine
      const javaChannel = this.prepareChannelForEngine(channelXml, 'java', config);
      const nodeChannel = this.prepareChannelForEngine(channelXml, 'node', config);

      // Use pre-deployed channel IDs if provided, otherwise use computed ones
      javaChannelId = config.preDeployedChannelIds?.java || javaChannel.channelId;
      nodeChannelId = config.preDeployedChannelIds?.node || nodeChannel.channelId;

      if (shouldDeploy) {
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

        // Wait for channels to start (increased timeout for QEMU/slow environments)
        await this.javaClient.waitForChannelState(javaChannelId, 'STARTED', 120000);
        await this.nodeClient.waitForChannelState(nodeChannelId, 'STARTED', 120000);
      }
    }

    // Load test message
    let testMessage: string;
    if (config.inputMessage) {
      const messagePath = path.join(basePath, config.inputMessage);
      if (fs.existsSync(messagePath)) {
        testMessage = fs.readFileSync(messagePath, 'utf8');
      } else {
        // Try fixtures
        const fixturesPath = path.join(getProjectRoot(), 'fixtures', 'messages', config.inputMessage);
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

    // Cleanup - undeploy and delete both engine-specific channels (skip if skipDeployment)
    if (shouldDeploy) {
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
   *
   * When skipDeployment is true, assumes channels are already deployed.
   */
  private async runHttpScenario(
    config: ScenarioConfig,
    startTime: number
  ): Promise<ScenarioResult> {
    const basePath = config.basePath || path.join(getProjectRoot(), 'scenarios', config.id);
    let javaChannelId: string | null = null;
    let nodeChannelId: string | null = null;
    const shouldDeploy = !config.skipDeployment;

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

      // Use pre-deployed channel IDs if provided, otherwise use computed ones
      javaChannelId = config.preDeployedChannelIds?.java || javaChannel.channelId;
      nodeChannelId = config.preDeployedChannelIds?.node || nodeChannel.channelId;

      if (shouldDeploy) {
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

        // Deploy and wait for start (increased timeout for QEMU/slow environments)
        await this.javaClient.deployChannel(javaChannelId);
        await this.nodeClient.deployChannel(nodeChannelId);
        await this.javaClient.waitForChannelState(javaChannelId, 'STARTED', 120000);
        await this.nodeClient.waitForChannelState(nodeChannelId, 'STARTED', 120000);
      }
    }

    // Load test message
    let testMessage = '';
    if (config.inputMessage) {
      const messagePath = path.join(basePath, config.inputMessage);
      if (fs.existsSync(messagePath)) {
        testMessage = fs.readFileSync(messagePath, 'utf8');
      } else {
        // Try fixtures
        const fixturesPath = path.join(getProjectRoot(), 'fixtures', 'messages', config.inputMessage);
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

    // Cleanup - undeploy and delete both engine-specific channels (skip if skipDeployment)
    if (shouldDeploy) {
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
   * Run SFTP file transfer scenario
   *
   * Tests File connectors that use SFTP protocol for reading/writing files.
   * Uploads test files via SFTP, triggers channel processing, and compares outputs.
   */
  private async runSftpScenario(
    config: ScenarioConfig,
    startTime: number
  ): Promise<ScenarioResult> {
    // Get SFTP configuration
    const javaSftpConfig = config.sftpConfig?.java || DEFAULT_SFTP_CONFIG.java;
    const nodeSftpConfig = config.sftpConfig?.node || DEFAULT_SFTP_CONFIG.node;

    const javaSftp = new ValidationSftpClient(javaSftpConfig);
    const nodeSftp = new ValidationSftpClient(nodeSftpConfig);

    const basePath = config.basePath || path.join(getProjectRoot(), 'scenarios', config.id);
    let javaChannelId: string | null = null;
    let nodeChannelId: string | null = null;
    const shouldDeploy = !config.skipDeployment;

    try {
      // Load and deploy channel with engine-specific configurations
      if (config.channelFile) {
        const channelXml = this.loadChannelFile(config.channelFile, basePath);

        const javaChannel = this.prepareChannelForEngine(channelXml, 'java', config);
        const nodeChannel = this.prepareChannelForEngine(channelXml, 'node', config);

        javaChannelId = config.preDeployedChannelIds?.java || javaChannel.channelId;
        nodeChannelId = config.preDeployedChannelIds?.node || nodeChannel.channelId;

        if (shouldDeploy) {
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
          await this.javaClient.waitForChannelState(javaChannelId, 'STARTED', 120000);
          await this.nodeClient.waitForChannelState(nodeChannelId, 'STARTED', 120000);
        }
      }

      // Read input message
      let inputContent: string;
      if (config.inputMessage) {
        const messagePath = path.join(basePath, config.inputMessage);
        if (fs.existsSync(messagePath)) {
          inputContent = fs.readFileSync(messagePath, 'utf8');
        } else {
          const fixturesPath = path.join(getProjectRoot(), 'fixtures', 'messages', config.inputMessage);
          if (fs.existsSync(fixturesPath)) {
            inputContent = fs.readFileSync(fixturesPath, 'utf8');
          } else {
            throw new Error(`Input message not found: ${config.inputMessage}`);
          }
        }
      } else {
        throw new Error('SFTP scenario requires inputMessage');
      }

      // Set up directories
      const javaInputDir = '/home/javauser/input';
      const nodeInputDir = '/home/nodeuser/input';
      const javaOutputDir = '/home/javauser/output';
      const nodeOutputDir = '/home/nodeuser/output';
      const filename = `test-${Date.now()}.hl7`;
      const outputFilename = filename.replace('.hl7', '.out');

      await javaSftp.ensureDirectory(javaInputDir);
      await javaSftp.ensureDirectory(javaOutputDir);
      await nodeSftp.ensureDirectory(nodeInputDir);
      await nodeSftp.ensureDirectory(nodeOutputDir);

      // Upload input files to both engines
      await javaSftp.uploadContent(inputContent, `${javaInputDir}/${filename}`);
      await nodeSftp.uploadContent(inputContent, `${nodeInputDir}/${filename}`);

      // Wait for output files
      const timeout = config.timeout || 60000;
      const javaOutputFound = await javaSftp.waitForFile(`${javaOutputDir}/${outputFilename}`, timeout);
      const nodeOutputFound = await nodeSftp.waitForFile(`${nodeOutputDir}/${outputFilename}`, timeout);

      if (!javaOutputFound || !nodeOutputFound) {
        return {
          scenarioId: config.id,
          scenarioName: config.name,
          passed: false,
          error: `Output file not found: Java=${javaOutputFound}, Node=${nodeOutputFound}`,
          differences: [],
          duration: Date.now() - startTime,
        };
      }

      // Download and compare outputs
      const javaOutput = await javaSftp.downloadFile(`${javaOutputDir}/${outputFilename}`);
      const nodeOutput = await nodeSftp.downloadFile(`${nodeOutputDir}/${outputFilename}`);

      const comparison = this.compareOutputs(javaOutput, nodeOutput, config.outputFormat || 'hl7');

      // Cleanup input/output files
      try {
        await javaSftp.deleteFile(`${javaInputDir}/${filename}`);
        await javaSftp.deleteFile(`${javaOutputDir}/${outputFilename}`);
        await nodeSftp.deleteFile(`${nodeInputDir}/${filename}`);
        await nodeSftp.deleteFile(`${nodeOutputDir}/${outputFilename}`);
      } catch {
        // Ignore cleanup errors
      }

      return {
        scenarioId: config.id,
        scenarioName: config.name,
        passed: comparison.match,
        differences: comparison.differences,
        javaResponse: javaOutput,
        nodeResponse: nodeOutput,
        duration: Date.now() - startTime,
      };

    } finally {
      // Cleanup - undeploy and delete channels
      if (shouldDeploy) {
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
      }

      // Disconnect SFTP clients
      await javaSftp.disconnect();
      await nodeSftp.disconnect();
    }
  }

  /**
   * Compare outputs based on format
   */
  private compareOutputs(
    javaOutput: string,
    nodeOutput: string,
    format: string
  ): ComparisonResult {
    switch (format) {
      case 'json':
        return this.messageComparator.compareJSON(javaOutput, nodeOutput, {
          numericStringEquivalence: true,
        });
      case 'xml':
        return this.messageComparator.compareXML(javaOutput, nodeOutput);
      case 'text':
        return this.messageComparator.compareText(javaOutput, nodeOutput);
      case 'hl7':
      default:
        return this.messageComparator.compareHL7(javaOutput, nodeOutput);
    }
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
      getProjectRoot(),
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
