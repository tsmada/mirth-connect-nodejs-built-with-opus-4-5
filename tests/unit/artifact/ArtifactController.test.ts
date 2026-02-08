/**
 * ArtifactController tests
 *
 * Tests the central orchestrator for git-backed artifact management.
 * Mocks out the git client and sync service to test controller logic in isolation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We need to test the real controller, so we import it directly
// but will use a temp directory so git operations work against real filesystem
import { ArtifactController } from '../../../src/artifact/ArtifactController.js';

describe('ArtifactController', () => {
  let tempDir: string;

  beforeEach(async () => {
    ArtifactController._reset();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-test-'));
  });

  afterEach(async () => {
    ArtifactController._reset();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  describe('isInitialized()', () => {
    it('returns false before initialization', () => {
      expect(ArtifactController.isInitialized()).toBe(false);
    });

    it('returns true after initialization', async () => {
      await ArtifactController.initialize(tempDir);
      expect(ArtifactController.isInitialized()).toBe(true);
    });
  });

  describe('initialize()', () => {
    it('creates a git repo if one does not exist', async () => {
      await ArtifactController.initialize(tempDir);
      expect(fs.existsSync(path.join(tempDir, '.git'))).toBe(true);
    });

    it('does not re-init an existing repo', async () => {
      // First init
      await ArtifactController.initialize(tempDir);
      const gitDir = path.join(tempDir, '.git');

      // Reset and re-init
      ArtifactController._reset();
      await ArtifactController.initialize(tempDir);

      // .git directory should still exist (not recreated)
      expect(fs.existsSync(gitDir)).toBe(true);
    });
  });

  // ─── Uninitialized Guard ───────────────────────────────────────────────

  describe('uninitialized guard', () => {
    it('throws on getGitStatus() when not initialized', async () => {
      await expect(ArtifactController.getGitStatus()).rejects.toThrow(
        /not initialized/i
      );
    });

    it('throws on exportAll() when not initialized', async () => {
      await expect(ArtifactController.exportAll(new Map())).rejects.toThrow(
        /not initialized/i
      );
    });

    it('throws on importChannel() when not initialized', async () => {
      await expect(ArtifactController.importChannel('test')).rejects.toThrow(
        /not initialized/i
      );
    });

    it('throws on diffChannel() when not initialized', async () => {
      await expect(ArtifactController.diffChannel('id', '<channel/>')).rejects.toThrow(
        /not initialized/i
      );
    });

    it('throws on pushToGit() when not initialized', async () => {
      await expect(ArtifactController.pushToGit()).rejects.toThrow(
        /not initialized/i
      );
    });

    it('throws on pullFromGit() when not initialized', async () => {
      await expect(ArtifactController.pullFromGit()).rejects.toThrow(
        /not initialized/i
      );
    });

    it('throws on detectDelta() when not initialized', async () => {
      await expect(ArtifactController.detectDelta()).rejects.toThrow(
        /not initialized/i
      );
    });

    it('throws on promote() when not initialized', async () => {
      await expect(
        ArtifactController.promote({ sourceEnv: 'dev', targetEnv: 'staging' })
      ).rejects.toThrow(/not initialized/i);
    });
  });

  // ─── Export ────────────────────────────────────────────────────────────

  describe('exportChannel()', () => {
    const SIMPLE_CHANNEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<channel version="3.9.0">
  <id>test-123</id>
  <name>Test Channel</name>
  <revision>1</revision>
  <sourceConnector version="3.9.0">
    <metaDataId>0</metaDataId>
    <name>Source</name>
    <transportName>HTTP Listener</transportName>
    <mode>SOURCE</mode>
    <enabled>true</enabled>
    <properties class="com.mirth.connect.connectors.http.HttpReceiverProperties" version="3.9.0">
      <listenerConnectorProperties version="3.9.0">
        <host>0.0.0.0</host>
        <port>8083</port>
      </listenerConnectorProperties>
    </properties>
    <transformer version="3.9.0">
      <elements/>
    </transformer>
    <filter version="3.9.0">
      <elements/>
    </filter>
  </sourceConnector>
  <destinationConnectors/>
  <preprocessingScript>return message;</preprocessingScript>
  <postprocessingScript>return;</postprocessingScript>
  <deployScript>return;</deployScript>
  <undeployScript>return;</undeployScript>
</channel>`;

    it('produces a non-empty file tree', async () => {
      const files = await ArtifactController.exportChannel('test-123', SIMPLE_CHANNEL_XML);
      expect(files.length).toBeGreaterThan(0);
    });

    it('includes channel.yaml in the file tree', async () => {
      const files = await ArtifactController.exportChannel('test-123', SIMPLE_CHANNEL_XML);
      const yamlFile = files.find(f => f.path.endsWith('channel.yaml'));
      expect(yamlFile).toBeDefined();
    });
  });

  // ─── detectSecrets ─────────────────────────────────────────────────────

  describe('detectSecrets()', () => {
    it('returns empty array for channel without secrets', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<channel version="3.9.0">
  <id>test-123</id>
  <name>Safe Channel</name>
  <sourceConnector version="3.9.0">
    <metaDataId>0</metaDataId>
    <name>Source</name>
    <transportName>Channel Reader</transportName>
    <mode>SOURCE</mode>
    <enabled>true</enabled>
    <properties class="com.mirth.connect.connectors.vm.VmReceiverProperties" version="3.9.0"/>
    <transformer version="3.9.0"><elements/></transformer>
    <filter version="3.9.0"><elements/></filter>
  </sourceConnector>
  <destinationConnectors/>
</channel>`;

      const secrets = await ArtifactController.detectSecrets(xml);
      expect(secrets).toEqual([]);
    });
  });

  // ─── getDependencyGraph ────────────────────────────────────────────────

  describe('getDependencyGraph()', () => {
    it('returns empty graph when no channels provided', async () => {
      const graph = await ArtifactController.getDependencyGraph();
      expect(graph.nodes).toEqual([]);
      expect(graph.edges.size).toBe(0);
    });

    it('extracts Channel Writer dependencies from XML', async () => {
      const channels = [
        {
          id: 'ch-1',
          xml: '<channel><destinationConnectors><connector><properties><channelId>ch-2</channelId></properties></connector></destinationConnectors></channel>',
        },
        {
          id: 'ch-2',
          xml: '<channel><destinationConnectors/></channel>',
        },
      ];

      const graph = await ArtifactController.getDependencyGraph(channels);
      expect(graph.nodes).toContain('ch-1');
      expect(graph.nodes).toContain('ch-2');
      expect(graph.edges.get('ch-1')).toEqual(['ch-2']);
    });
  });

  // ─── Git Operations ────────────────────────────────────────────────────

  describe('getGitStatus()', () => {
    it('returns clean status for freshly initialized repo', async () => {
      await ArtifactController.initialize(tempDir);
      const status = await ArtifactController.getGitStatus();
      expect(status.clean).toBe(true);
    });
  });

  describe('pushToGit()', () => {
    it('returns sync result with no commit when nothing to push', async () => {
      await ArtifactController.initialize(tempDir);
      const result = await ArtifactController.pushToGit({ message: 'test' });
      expect(result.direction).toBe('push');
    });
  });

  // ─── Promotion ─────────────────────────────────────────────────────────

  describe('getPromotionStatus()', () => {
    it('returns empty arrays initially', async () => {
      const status = await ArtifactController.getPromotionStatus();
      expect(status.pending).toEqual([]);
      expect(status.history).toEqual([]);
    });
  });

  // ─── Watcher ───────────────────────────────────────────────────────────

  describe('startWatcher() / stopWatcher()', () => {
    it('starts and stops without error', async () => {
      await ArtifactController.initialize(tempDir);
      await ArtifactController.startWatcher();
      await ArtifactController.stopWatcher();
    });

    it('stopWatcher() is safe when not started', async () => {
      await ArtifactController.stopWatcher();
    });
  });

  // ─── _reset ────────────────────────────────────────────────────────────

  describe('_reset()', () => {
    it('resets controller to uninitialized state', async () => {
      await ArtifactController.initialize(tempDir);
      expect(ArtifactController.isInitialized()).toBe(true);
      ArtifactController._reset();
      expect(ArtifactController.isInitialized()).toBe(false);
    });
  });
});
