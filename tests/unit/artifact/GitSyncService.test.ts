/**
 * GitSyncService tests — uses real temporary git repositories.
 *
 * Tests the push (export-to-git) and pull (import-from-git) workflows
 * with a sample channel XML, plus metadata and directory operations.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitClient } from '../../../src/artifact/git/GitClient';
import { GitSyncService, RepoMetadata } from '../../../src/artifact/git/GitSyncService';

/**
 * Minimal Mirth channel XML with source + 1 destination + transformer.
 * This is the smallest valid channel that exercises all decompose paths.
 */
const SAMPLE_CHANNEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<channel version="3.9.1">
  <id>test-channel-001</id>
  <name>Test ADT Receiver</name>
  <description>Test channel for git sync</description>
  <enabled>true</enabled>
  <revision>5</revision>
  <nextMetaDataId>3</nextMetaDataId>
  <sourceConnector>
    <name>sourceConnector</name>
    <metaDataId>0</metaDataId>
    <transportName>TCP Listener</transportName>
    <mode>SOURCE</mode>
    <enabled>true</enabled>
    <properties class="com.mirth.connect.connectors.tcp.TcpReceiverProperties" version="3.9.1">
      <listenerConnectorProperties>
        <host>0.0.0.0</host>
        <port>6661</port>
      </listenerConnectorProperties>
      <dataTypeBinary>false</dataTypeBinary>
      <charsetEncoding>DEFAULT_ENCODING</charsetEncoding>
    </properties>
    <transformer version="3.9.1">
      <elements>
        <com.mirth.connect.plugins.javascriptstep.JavaScriptStep version="3.9.1">
          <name>Set PID</name>
          <sequenceNumber>0</sequenceNumber>
          <enabled>true</enabled>
          <script>var pid = msg['PID']['PID.3']['PID.3.1'].toString();\nchannelMap.put('patientId', pid);</script>
        </com.mirth.connect.plugins.javascriptstep.JavaScriptStep>
      </elements>
      <inboundDataType>HL7V2</inboundDataType>
      <outboundDataType>HL7V2</outboundDataType>
    </transformer>
    <filter version="3.9.1">
      <elements>
        <com.mirth.connect.plugins.rulebuilder.RuleBuilderRule version="3.9.1">
          <name>Accept ADT</name>
          <sequenceNumber>0</sequenceNumber>
          <enabled>true</enabled>
          <operator>AND</operator>
          <script>return msg['MSH']['MSH.9']['MSH.9.1'].toString() === 'ADT';</script>
        </com.mirth.connect.plugins.rulebuilder.RuleBuilderRule>
      </elements>
    </filter>
  </sourceConnector>
  <destinationConnectors>
    <connector>
      <name>Send to DB</name>
      <metaDataId>1</metaDataId>
      <transportName>Database Writer</transportName>
      <mode>DESTINATION</mode>
      <enabled>true</enabled>
      <waitForPrevious>true</waitForPrevious>
      <properties class="com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties" version="3.9.1">
        <url>jdbc:mysql://localhost:3306/adt</url>
        <username>admin</username>
        <password>secret123</password>
        <query>INSERT INTO patients (id, data) VALUES (\${patientId}, \${message.encodedData})</query>
      </properties>
      <transformer version="3.9.1">
        <elements/>
        <inboundDataType>HL7V2</inboundDataType>
        <outboundDataType>XML</outboundDataType>
      </transformer>
    </connector>
  </destinationConnectors>
  <deployScript>logger.info('Deploying Test ADT Receiver');</deployScript>
  <undeployScript>return;</undeployScript>
  <preprocessingScript>return message;</preprocessingScript>
  <postprocessingScript>return;</postprocessingScript>
</channel>`;

describe('GitSyncService', () => {
  let tmpDir: string;
  let gitClient: GitClient;
  let syncService: GitSyncService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-sync-test-'));
    gitClient = new GitClient(tmpDir);
    await gitClient.init();
    syncService = new GitSyncService(gitClient, tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('pushToGit', () => {
    it('should decompose and commit a channel', async () => {
      const channelXmls = new Map([['test-channel-001', SAMPLE_CHANNEL_XML]]);

      const result = await syncService.pushToGit(channelXmls, {
        message: 'test: export channel',
        maskSecrets: false,
      });

      expect(result.direction).toBe('push');
      expect(result.channelsAffected).toContain('Test ADT Receiver');
      expect(result.commitHash).toBeTruthy();
      expect(result.commitHash!.length).toBe(40);
      expect(result.errors).toEqual([]);
    });

    it('should create channel directory structure', async () => {
      const channelXmls = new Map([['test-channel-001', SAMPLE_CHANNEL_XML]]);
      await syncService.pushToGit(channelXmls, { maskSecrets: false });

      // Check that decomposed files were written
      const channelYaml = await fs.readFile(
        path.join(tmpDir, 'channels', 'test-adt-receiver', 'channel.yaml'),
        'utf-8'
      );
      expect(channelYaml).toContain('name: Test ADT Receiver');
      expect(channelYaml).toContain('id: test-channel-001');

      // Check source connector
      const sourceYaml = await fs.readFile(
        path.join(tmpDir, 'channels', 'test-adt-receiver', 'source', 'connector.yaml'),
        'utf-8'
      );
      expect(sourceYaml).toContain('transportName: TCP Listener');

      // Check transformer step script
      const stepFile = await fs.readFile(
        path.join(tmpDir, 'channels', 'test-adt-receiver', 'source', 'transformer', 'step-0-set-pid.js'),
        'utf-8'
      );
      expect(stepFile).toContain('patientId');

      // Check raw XML was stored
      const rawXml = await fs.readFile(
        path.join(tmpDir, 'channels', 'test-adt-receiver', '.raw.xml'),
        'utf-8'
      );
      expect(rawXml).toContain('<channel version="3.9.1">');
    });

    it('should filter by specific channel IDs', async () => {
      const channelXmls = new Map([
        ['test-channel-001', SAMPLE_CHANNEL_XML],
      ]);

      const result = await syncService.pushToGit(channelXmls, {
        channels: ['nonexistent-id'],
        maskSecrets: false,
      });

      // Should not export any channels since the filter doesn't match
      expect(result.channelsAffected).toEqual([]);
      expect(result.warnings).toContain('No changes to commit');
    });

    it('should mask secrets by default', async () => {
      const channelXmls = new Map([['test-channel-001', SAMPLE_CHANNEL_XML]]);
      await syncService.pushToGit(channelXmls);

      const destYaml = await fs.readFile(
        path.join(tmpDir, 'channels', 'test-adt-receiver', 'destinations', 'send-to-db', 'connector.yaml'),
        'utf-8'
      );
      // Password should be masked with ${PARAM_NAME} format
      expect(destYaml).not.toContain('secret123');
    });

    it('should report no changes when nothing changed', async () => {
      const channelXmls = new Map([['test-channel-001', SAMPLE_CHANNEL_XML]]);
      await syncService.pushToGit(channelXmls, { maskSecrets: false });

      // Push again with same content
      const result = await syncService.pushToGit(channelXmls, { maskSecrets: false });
      expect(result.warnings).toContain('No changes to commit');
    });
  });

  describe('pullFromGit', () => {
    beforeEach(async () => {
      // Push a channel first so there's something to pull
      const channelXmls = new Map([['test-channel-001', SAMPLE_CHANNEL_XML]]);
      await syncService.pushToGit(channelXmls, { maskSecrets: false });
    });

    it('should read channels from the repository', async () => {
      const { channels, warnings } = await syncService.pullFromGit();

      expect(channels.length).toBe(1);
      expect(channels[0]!.id).toBe('test-channel-001');
      expect(channels[0]!.name).toBe('Test ADT Receiver');
      expect(channels[0]!.xml).toContain('<channel');
      expect(warnings).toEqual([]);
    });

    it('should filter by channel directory names', async () => {
      const { channels } = await syncService.pullFromGit({
        channels: ['nonexistent'],
      });
      expect(channels.length).toBe(0);
    });

    it('should filter to matching channels', async () => {
      const { channels } = await syncService.pullFromGit({
        channels: ['test-adt-receiver'],
      });
      expect(channels.length).toBe(1);
    });
  });

  describe('writeRepoMetadata / readRepoMetadata', () => {
    it('should write and read .mirth-sync.yaml', async () => {
      const metadata: RepoMetadata = {
        engine: {
          type: 'nodejs',
          mirthVersion: '3.9.1',
          nodeVersion: '20.x',
          e4xSupport: true,
          schemaVersion: '3.9.1',
        },
        serverId: 'abc-123',
        lastSync: '2026-02-08T00:00:00Z',
        gitFlow: {
          model: 'environment-branches',
          branches: { dev: 'develop', prod: 'main' },
        },
      };

      await syncService.writeRepoMetadata(metadata);
      const read = await syncService.readRepoMetadata();

      expect(read).not.toBeNull();
      expect(read!.engine.type).toBe('nodejs');
      expect(read!.engine.mirthVersion).toBe('3.9.1');
      expect(read!.serverId).toBe('abc-123');
      expect(read!.gitFlow!.model).toBe('environment-branches');
    });

    it('should return null when no metadata file exists', async () => {
      const read = await syncService.readRepoMetadata();
      expect(read).toBeNull();
    });
  });

  describe('writeChannel / readChannel', () => {
    it('should round-trip file tree entries', async () => {
      const files = [
        { path: 'channel.yaml', content: 'name: test\n', type: 'yaml' as const },
        { path: 'source/connector.yaml', content: 'transport: TCP\n', type: 'yaml' as const },
        { path: 'source/transformer/step-0-test.js', content: '// test script\nvar x = 1;', type: 'js' as const },
      ];

      await syncService.writeChannel('my-channel', files);
      const readBack = await syncService.readChannel('my-channel');

      expect(readBack.length).toBe(3);

      const yamlFile = readBack.find(f => f.path === 'channel.yaml');
      expect(yamlFile).toBeDefined();
      expect(yamlFile!.content).toBe('name: test\n');
      expect(yamlFile!.type).toBe('yaml');

      const jsFile = readBack.find(f => f.path === 'source/transformer/step-0-test.js');
      expect(jsFile).toBeDefined();
      expect(jsFile!.type).toBe('js');
    });
  });

  describe('listChannels', () => {
    it('should list channel directories', async () => {
      const channelXmls = new Map([['test-channel-001', SAMPLE_CHANNEL_XML]]);
      await syncService.pushToGit(channelXmls, { maskSecrets: false });

      const channels = await syncService.listChannels();
      expect(channels).toContain('test-adt-receiver');
    });

    it('should return empty array when no channels dir exists', async () => {
      const channels = await syncService.listChannels();
      expect(channels).toEqual([]);
    });
  });

  describe('writeCodeTemplates', () => {
    it('should write code template libraries', async () => {
      await syncService.writeCodeTemplates([
        {
          libraryName: 'Utility Functions',
          libraryId: 'lib-001',
          enabledChannelIds: ['ch-1', 'ch-2'],
          templates: [
            { name: 'Format Date', id: 'tmpl-001', script: 'function formatDate(d) { return d.toISOString(); }' },
          ],
        },
      ]);

      const libYaml = await fs.readFile(
        path.join(tmpDir, 'code-templates', 'utility-functions', 'library.yaml'),
        'utf-8'
      );
      expect(libYaml).toContain('name: Utility Functions');
      expect(libYaml).toContain('id: lib-001');

      const script = await fs.readFile(
        path.join(tmpDir, 'code-templates', 'utility-functions', 'format-date.js'),
        'utf-8'
      );
      expect(script).toContain('formatDate');
      expect(script).toContain('// @id tmpl-001');
    });
  });

  describe('writeGroups', () => {
    it('should write channel groups', async () => {
      await syncService.writeGroups([
        { name: 'ADT Channels', id: 'grp-001', channelIds: ['ch-1'] },
        { name: 'Lab Channels', id: 'grp-002', channelIds: ['ch-2', 'ch-3'] },
      ]);

      const groupsYaml = await fs.readFile(
        path.join(tmpDir, 'groups', 'groups.yaml'),
        'utf-8'
      );
      expect(groupsYaml).toContain('ADT Channels');
      expect(groupsYaml).toContain('Lab Channels');
    });
  });

  describe('writeConfig', () => {
    it('should write server configuration', async () => {
      await syncService.writeConfig({
        dependencies: { 'ch-1': ['ch-2'] },
        tags: { production: ['ch-1'] },
        globalScripts: {
          'Deploy Script': 'logger.info("deployed");',
        },
      });

      const configYaml = await fs.readFile(
        path.join(tmpDir, 'config', 'config.yaml'),
        'utf-8'
      );
      expect(configYaml).toContain('dependencies');

      const deployScript = await fs.readFile(
        path.join(tmpDir, 'config', 'scripts', 'deploy-script.js'),
        'utf-8'
      );
      expect(deployScript).toContain('logger.info');
    });
  });

  describe('environment variable resolution on pull', () => {
    it('should resolve variables from environment config', async () => {
      // Push a channel with a parameterized value
      const xml = SAMPLE_CHANNEL_XML.replace(
        '<port>6661</port>',
        '<port>${MLLP_PORT:6661}</port>'
      );
      const channelXmls = new Map([['test-channel-001', xml]]);
      await syncService.pushToGit(channelXmls, { maskSecrets: false });

      // Create environment config
      const envDir = path.join(tmpDir, 'config', 'environments');
      await fs.mkdir(envDir, { recursive: true });
      await fs.writeFile(
        path.join(envDir, 'staging.yaml'),
        'MLLP_PORT: "7771"\n',
        'utf-8'
      );

      const { channels } = await syncService.pullFromGit({
        environment: 'staging',
      });

      expect(channels.length).toBe(1);
      expect(channels[0]!.xml).toContain('7771');
    });
  });
});
