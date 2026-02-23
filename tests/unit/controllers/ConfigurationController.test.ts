/**
 * ConfigurationController Behavioral Tests
 *
 * Ported from: ~/Projects/connect/server/test/.../ServerConfigurationRestorerTest.java
 *
 * Contract 7: Configuration Restore — verifies that server configuration
 * operations (settings, global scripts, config map, metadata, tags,
 * dependencies) persist correctly via MirthDao and round-trip faithfully.
 *
 * Contract 24: Code Template Library Cascading — verifies the config map
 * overwrite semantics and idempotent save behavior.
 *
 * The Node.js ConfigurationController is a simplified static class that
 * delegates to MirthDao.getConfiguration/setConfiguration with JSON
 * serialization. Java's ServerConfigurationRestorer has a multi-phase
 * restore pipeline with error accumulation (MultiException); the Node.js
 * equivalent tests verify the same behavioral contracts through the
 * simpler API surface.
 *
 * IMPORTANT: ConfigurationController uses module-level state for
 * serverSettings and serverIdCache. We use jest.resetModules() + dynamic
 * import in beforeEach to get a fresh module instance per test.
 */

// Mock MirthDao BEFORE importing the controller
const mockGetConfiguration = jest.fn<Promise<string | null>, [string, string]>();
const mockSetConfiguration = jest.fn<Promise<void>, [string, string, string]>();

jest.mock('../../../src/db/MirthDao.js', () => ({
  getConfiguration: mockGetConfiguration,
  setConfiguration: mockSetConfiguration,
}));

jest.mock('../../../src/logging/index.js', () => ({
  registerComponent: jest.fn(),
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn(() => false),
  })),
}));

import {
  getDefaultServerSettings,
  type ServerSettings,
  type ConfigurationProperty,
  type ChannelDependency,
  type ChannelTag,
} from '../../../src/api/models/ServerSettings.js';
import type { ChannelMetadata } from '../../../src/api/models/Channel.js';

// Helper to get a fresh ConfigurationController module per test
// This resets the module-level serverSettings and serverIdCache
async function getFreshController() {
  jest.resetModules();
  // Re-register mocks after resetModules
  jest.doMock('../../../src/db/MirthDao.js', () => ({
    getConfiguration: mockGetConfiguration,
    setConfiguration: mockSetConfiguration,
  }));
  jest.doMock('../../../src/logging/index.js', () => ({
    registerComponent: jest.fn(),
    getLogger: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      isDebugEnabled: jest.fn(() => false),
    })),
  }));
  const mod = await import('../../../src/controllers/ConfigurationController.js');
  return mod.ConfigurationController;
}

describe('ConfigurationController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfiguration.mockResolvedValue(null);
    mockSetConfiguration.mockResolvedValue(undefined);
  });

  // ─── Contract 7: Configuration Restore ─────────────────────────────

  describe('Contract 7: Server Settings', () => {
    it('1. getServerSettings/setServerSettings round-trip — JSON persist + retrieve matches', async () => {
      const CC = await getFreshController();

      const settings: ServerSettings = {
        environmentName: 'Production',
        serverName: 'mirth-prod-01',
        clearGlobalMap: false,
        queueBufferSize: 2000,
        smtpHost: 'mail.example.com',
        smtpPort: '587',
        smtpTimeout: 10000,
        smtpFrom: 'mirth@example.com',
        smtpSecure: 'tls',
        smtpAuth: true,
        smtpUsername: 'admin',
        smtpPassword: 'secret',
      };

      await CC.setServerSettings(settings);

      expect(mockSetConfiguration).toHaveBeenCalledWith(
        'core',
        'server.settings',
        expect.any(String)
      );

      const savedJson = mockSetConfiguration.mock.calls[0]![2];

      // Simulate retrieval from DB
      mockGetConfiguration.mockResolvedValueOnce(savedJson);
      const retrieved = await CC.getServerSettings();

      expect(retrieved.environmentName).toBe('Production');
      expect(retrieved.serverName).toBe('mirth-prod-01');
      expect(retrieved.clearGlobalMap).toBe(false);
      expect(retrieved.queueBufferSize).toBe(2000);
      expect(retrieved.smtpHost).toBe('mail.example.com');
      expect(retrieved.smtpPort).toBe('587');
      expect(retrieved.smtpSecure).toBe('tls');
      expect(retrieved.smtpAuth).toBe(true);
    });

    it('2. getServerSettings returns defaults when database is empty', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const settings = await CC.getServerSettings();
      const defaults = getDefaultServerSettings();

      expect(settings.clearGlobalMap).toBe(defaults.clearGlobalMap);
      expect(settings.queueBufferSize).toBe(defaults.queueBufferSize);
      expect(settings.smtpPort).toBe(defaults.smtpPort);
      expect(settings.smtpTimeout).toBe(defaults.smtpTimeout);
      expect(settings.smtpSecure).toBe(defaults.smtpSecure);
      expect(settings.smtpAuth).toBe(defaults.smtpAuth);
    });

    it('3. getServerSettings handles corrupt JSON gracefully', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce('not-valid-json{{{');

      // Should not throw — falls back to in-memory defaults
      const settings = await CC.getServerSettings();
      expect(settings).toBeDefined();
      // After corrupt JSON, falls back to the existing in-memory settings
      const defaults = getDefaultServerSettings();
      expect(settings.clearGlobalMap).toBe(defaults.clearGlobalMap);
    });

    it('4. setServerSettings merges with existing in-memory settings', async () => {
      const CC = await getFreshController();

      // First set some settings
      const initial: ServerSettings = {
        serverName: 'original',
        smtpHost: 'mail.example.com',
      };
      await CC.setServerSettings(initial);

      // Now update only smtpHost
      const update: ServerSettings = { smtpHost: 'new-mail.example.com' };
      await CC.setServerSettings(update);

      // The saved JSON should contain the merged result
      expect(mockSetConfiguration).toHaveBeenCalledTimes(2);
      const secondCallJson = mockSetConfiguration.mock.calls[1]![2];
      const parsed = JSON.parse(secondCallJson);
      // smtpHost was updated
      expect(parsed.smtpHost).toBe('new-mail.example.com');
      // serverName was preserved from first call
      expect(parsed.serverName).toBe('original');
    });
  });

  describe('Contract 7: Global Scripts', () => {
    it('5. getGlobalScripts/setGlobalScripts — 4 script types stored/retrieved correctly', async () => {
      const CC = await getFreshController();

      const scripts = {
        Deploy: 'logger.info("deploying");',
        Undeploy: 'logger.info("undeploying");',
        Preprocessor: 'return message;',
        Postprocessor: 'return;',
      };

      await CC.setGlobalScripts(scripts);

      expect(mockSetConfiguration).toHaveBeenCalledWith(
        'core',
        'global.scripts',
        JSON.stringify(scripts)
      );

      // Simulate retrieval
      mockGetConfiguration.mockResolvedValueOnce(JSON.stringify(scripts));
      const retrieved = await CC.getGlobalScripts();

      expect(retrieved.Deploy).toBe('logger.info("deploying");');
      expect(retrieved.Undeploy).toBe('logger.info("undeploying");');
      expect(retrieved.Preprocessor).toBe('return message;');
      expect(retrieved.Postprocessor).toBe('return;');
    });

    it('6. getGlobalScripts returns empty defaults when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const scripts = await CC.getGlobalScripts();

      expect(scripts).toEqual({
        Deploy: '',
        Undeploy: '',
        Preprocessor: '',
        Postprocessor: '',
      });
    });
  });

  describe('Contract 7: Configuration Map', () => {
    it('7. getConfigurationMap/setConfigurationMap — key-value CRUD: add, update, delete entries', async () => {
      const CC = await getFreshController();

      // Add entries
      const configMap: Record<string, ConfigurationProperty> = {
        'db.host': { value: 'localhost', comment: 'Database host' },
        'db.port': { value: '3306' },
        'api.key': { value: 'abc-123', comment: 'API key for external service' },
      };

      await CC.setConfigurationMap(configMap);

      expect(mockSetConfiguration).toHaveBeenCalledWith(
        'core',
        'configuration.map',
        JSON.stringify(configMap)
      );

      // Simulate retrieve
      mockGetConfiguration.mockResolvedValueOnce(JSON.stringify(configMap));
      const retrieved = await CC.getConfigurationMap();

      expect(retrieved['db.host']!.value).toBe('localhost');
      expect(retrieved['db.host']!.comment).toBe('Database host');
      expect(retrieved['db.port']!.value).toBe('3306');
      expect(retrieved['api.key']!.value).toBe('abc-123');

      // Update an entry
      const updated: Record<string, ConfigurationProperty> = {
        ...configMap,
        'db.host': { value: '10.0.0.1', comment: 'Production DB' },
      };
      await CC.setConfigurationMap(updated);

      mockGetConfiguration.mockResolvedValueOnce(JSON.stringify(updated));
      const retrieved2 = await CC.getConfigurationMap();
      expect(retrieved2['db.host']!.value).toBe('10.0.0.1');

      // Delete an entry
      const remaining: Record<string, ConfigurationProperty> = {
        'db.host': updated['db.host']!,
        'db.port': updated['db.port']!,
      };
      await CC.setConfigurationMap(remaining);

      mockGetConfiguration.mockResolvedValueOnce(JSON.stringify(remaining));
      const retrieved3 = await CC.getConfigurationMap();
      expect(retrieved3['api.key']).toBeUndefined();
      expect(Object.keys(retrieved3)).toHaveLength(2);
    });

    it('8. setConfigurationMap replaces entire map (Java: overwriteConfigMap=true behavior)', async () => {
      const CC = await getFreshController();

      // Java's restoreConfigurationMap(config, overwriteConfigMap=true, multiException)
      // calls setConfigurationProperties(map, true) which replaces the entire map.
      // Node.js setConfigurationMap always does full replacement via setConfiguration.
      const original: Record<string, ConfigurationProperty> = {
        'key.a': { value: 'original-a' },
        'key.b': { value: 'original-b' },
      };
      await CC.setConfigurationMap(original);

      // Full replacement — different keys
      const replacement: Record<string, ConfigurationProperty> = {
        'key.c': { value: 'new-c' },
      };
      await CC.setConfigurationMap(replacement);

      // Verify the second call persisted only the replacement
      const secondCallJson = mockSetConfiguration.mock.calls[1]![2];
      const parsed = JSON.parse(secondCallJson);
      expect(parsed['key.a']).toBeUndefined();
      expect(parsed['key.b']).toBeUndefined();
      expect(parsed['key.c'].value).toBe('new-c');
    });

    it('9. getConfigurationMap returns empty object when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const configMap = await CC.getConfigurationMap();
      expect(configMap).toEqual({});
    });
  });

  describe('Contract 7: Channel Metadata', () => {
    it('10. getChannelMetadata pruningSettings shape — DataPruner expects specific structure', async () => {
      const CC = await getFreshController();

      const metadata: Record<string, ChannelMetadata> = {
        'channel-001': {
          enabled: true,
          pruningSettings: {
            pruneMetaDataDays: 30,
            pruneContentDays: 7,
            archiveEnabled: false,
          },
          lastModified: new Date('2026-01-15').toISOString() as any,
        } as any,
        'channel-002': {
          enabled: false,
          pruningSettings: {
            pruneMetaDataDays: 90,
            pruneContentDays: 90,
            archiveEnabled: true,
          },
        } as any,
      };

      await CC.setChannelMetadata(metadata);

      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[0]![2]
      );
      const retrieved = await CC.getChannelMetadata();

      // DataPruner reads pruningSettings directly
      const ch1 = retrieved['channel-001'] as any;
      expect(ch1.pruningSettings.pruneMetaDataDays).toBe(30);
      expect(ch1.pruningSettings.pruneContentDays).toBe(7);
      expect(ch1.pruningSettings.archiveEnabled).toBe(false);

      const ch2 = retrieved['channel-002'] as any;
      expect(ch2.pruningSettings.archiveEnabled).toBe(true);
    });

    it('11. getChannelMetadata returns empty when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const metadata = await CC.getChannelMetadata();
      expect(metadata).toEqual({});
    });
  });

  describe('Contract 7: Channel Tags', () => {
    it('12. getChannelTags/setChannelTags CRUD — tag create, association, deletion', async () => {
      const CC = await getFreshController();

      const tags: ChannelTag[] = [
        {
          id: 'tag-1',
          name: 'Production',
          channelIds: ['ch-001', 'ch-002'],
          backgroundColor: '#4CAF50',
        },
        {
          id: 'tag-2',
          name: 'Development',
          channelIds: ['ch-003'],
          backgroundColor: '#2196F3',
        },
      ];

      await CC.setChannelTags(tags);

      expect(mockSetConfiguration).toHaveBeenCalledWith(
        'core',
        'channel.tags',
        JSON.stringify(tags)
      );

      // Retrieve
      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[0]![2]
      );
      const retrieved = await CC.getChannelTags();

      expect(retrieved).toHaveLength(2);
      expect(retrieved[0]!.name).toBe('Production');
      expect(retrieved[0]!.channelIds).toContain('ch-001');
      expect(retrieved[0]!.channelIds).toContain('ch-002');
      expect(retrieved[1]!.name).toBe('Development');

      // Update: add a channel to existing tag
      const updated = [...retrieved];
      updated[0] = { ...updated[0]!, channelIds: [...updated[0]!.channelIds, 'ch-004'] };
      await CC.setChannelTags(updated);

      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[1]![2]
      );
      const retrieved2 = await CC.getChannelTags();
      expect(retrieved2[0]!.channelIds).toHaveLength(3);

      // Delete: remove a tag
      await CC.setChannelTags([updated[1]!]);

      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[2]![2]
      );
      const retrieved3 = await CC.getChannelTags();
      expect(retrieved3).toHaveLength(1);
      expect(retrieved3[0]!.name).toBe('Development');
    });

    it('13. getChannelTags returns empty array when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const tags = await CC.getChannelTags();
      expect(tags).toEqual([]);
    });
  });

  describe('Contract 7: Channel Dependencies', () => {
    it('14. getChannelDependencies/setChannelDependencies — dependency graph', async () => {
      const CC = await getFreshController();

      const deps: ChannelDependency[] = [
        { dependentId: 'ch-002', dependencyId: 'ch-001' },
        { dependentId: 'ch-003', dependencyId: 'ch-001' },
        { dependentId: 'ch-003', dependencyId: 'ch-002' },
      ];

      await CC.setChannelDependencies(deps);

      expect(mockSetConfiguration).toHaveBeenCalledWith(
        'core',
        'channel.dependencies',
        JSON.stringify(deps)
      );

      // Retrieve and verify graph structure
      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[0]![2]
      );
      const retrieved = await CC.getChannelDependencies();

      expect(retrieved).toHaveLength(3);

      // ch-001 has no dependencies (root)
      const ch001Deps = retrieved.filter(d => d.dependentId === 'ch-001');
      expect(ch001Deps).toHaveLength(0);

      // ch-003 depends on both ch-001 and ch-002
      const ch003Deps = retrieved.filter(d => d.dependentId === 'ch-003');
      expect(ch003Deps).toHaveLength(2);
      expect(ch003Deps.map(d => d.dependencyId)).toContain('ch-001');
      expect(ch003Deps.map(d => d.dependencyId)).toContain('ch-002');
    });

    it('15. getChannelDependencies returns empty array when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const deps = await CC.getChannelDependencies();
      expect(deps).toEqual([]);
    });
  });

  describe('Contract 7: Server ID', () => {
    it('16. getServerId generates and persists new ID when not in database', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const id = await CC.getServerId();

      // Should be a UUID
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Should have persisted it
      expect(mockSetConfiguration).toHaveBeenCalledWith('core', 'server.id', id);
    });

    it('17. getServerId returns cached ID on subsequent calls', async () => {
      const CC = await getFreshController();

      // First call: not in DB, generates new
      mockGetConfiguration.mockResolvedValueOnce(null);
      const id1 = await CC.getServerId();

      // Second call: should use cache, not hit DB again
      const id2 = await CC.getServerId();

      expect(id1).toBe(id2);
      // getConfiguration called only once (first call)
      expect(mockGetConfiguration).toHaveBeenCalledTimes(1);
    });

    it('18. getServerId returns existing ID from database', async () => {
      const CC = await getFreshController();
      const existingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      mockGetConfiguration.mockResolvedValueOnce(existingId);

      const id = await CC.getServerId();

      expect(id).toBe(existingId);
      // Should NOT have called setConfiguration (no new ID generated)
      expect(mockSetConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('Contract 7: Encryption Settings', () => {
    it('19. getEncryptionSettings returns defaults when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const encryption = await CC.getEncryptionSettings();

      expect(encryption.encryptExport).toBe(false);
      expect(encryption.encryptProperties).toBe(false);
      expect(encryption.digestAlgorithm).toBe('SHA-256');
      expect(encryption.encryptionAlgorithm).toBe('AES');
      expect(encryption.encryptionKeyLength).toBe(256);
    });
  });

  // ─── Contract 24: Code Template Library Cascading ──────────────────

  describe('Contract 24: DAO Interaction Pattern', () => {
    it('20. All getters use getConfiguration with correct category and name', async () => {
      const getterCalls: Array<{ method: string; expectedName: string }> = [
        { method: 'getServerSettings', expectedName: 'server.settings' },
        { method: 'getGlobalScripts', expectedName: 'global.scripts' },
        { method: 'getConfigurationMap', expectedName: 'configuration.map' },
        { method: 'getChannelMetadata', expectedName: 'channel.metadata' },
        { method: 'getChannelTags', expectedName: 'channel.tags' },
        { method: 'getChannelDependencies', expectedName: 'channel.dependencies' },
        { method: 'getDatabaseDrivers', expectedName: 'database.drivers' },
        { method: 'getPasswordRequirements', expectedName: 'password.requirements' },
        { method: 'getUpdateSettings', expectedName: 'update.settings' },
        { method: 'getResources', expectedName: 'resources' },
        { method: 'getEncryptionSettings', expectedName: 'encryption.settings' },
      ];

      for (const { method, expectedName } of getterCalls) {
        const CC = await getFreshController();
        jest.clearAllMocks();
        mockGetConfiguration.mockResolvedValueOnce(null);

        await (CC as any)[method]();

        expect(mockGetConfiguration).toHaveBeenCalledWith('core', expectedName);
      }
    });

    it('21. All setters use setConfiguration with correct category and name', async () => {
      const setterCalls: Array<{ method: string; expectedName: string; arg: any }> = [
        { method: 'setGlobalScripts', expectedName: 'global.scripts', arg: {} },
        { method: 'setConfigurationMap', expectedName: 'configuration.map', arg: {} },
        { method: 'setChannelMetadata', expectedName: 'channel.metadata', arg: {} },
        { method: 'setChannelTags', expectedName: 'channel.tags', arg: [] },
        { method: 'setChannelDependencies', expectedName: 'channel.dependencies', arg: [] },
        { method: 'setDatabaseDrivers', expectedName: 'database.drivers', arg: [] },
        { method: 'setUpdateSettings', expectedName: 'update.settings', arg: {} },
        { method: 'setResources', expectedName: 'resources', arg: [] },
      ];

      for (const { method, expectedName, arg } of setterCalls) {
        const CC = await getFreshController();
        jest.clearAllMocks();

        await (CC as any)[method](arg);

        expect(mockSetConfiguration).toHaveBeenCalledWith(
          'core',
          expectedName,
          expect.any(String)
        );
      }
    });

    it('22. Idempotent: same config saved twice produces no errors', async () => {
      const CC = await getFreshController();

      const configMap: Record<string, ConfigurationProperty> = {
        'key1': { value: 'val1' },
        'key2': { value: 'val2', comment: 'test' },
      };

      // Save twice
      await CC.setConfigurationMap(configMap);
      await CC.setConfigurationMap(configMap);

      // Both calls succeed with identical JSON
      expect(mockSetConfiguration).toHaveBeenCalledTimes(2);
      expect(mockSetConfiguration.mock.calls[0]![2]).toBe(
        mockSetConfiguration.mock.calls[1]![2]
      );
    });

    it('23. Corrupt JSON in any getter falls back to default without throwing', async () => {
      const corruptJson = '{broken json!!!';

      const gettersWithDefaults: Array<{
        method: string;
        expectedDefault: any;
      }> = [
        { method: 'getGlobalScripts', expectedDefault: { Deploy: '', Undeploy: '', Preprocessor: '', Postprocessor: '' } },
        { method: 'getConfigurationMap', expectedDefault: {} },
        { method: 'getChannelMetadata', expectedDefault: {} },
        { method: 'getChannelTags', expectedDefault: [] },
        { method: 'getChannelDependencies', expectedDefault: [] },
      ];

      for (const { method, expectedDefault } of gettersWithDefaults) {
        const CC = await getFreshController();
        jest.clearAllMocks();
        mockGetConfiguration.mockResolvedValueOnce(corruptJson);

        const result = await (CC as any)[method]();
        expect(result).toEqual(expectedDefault);
      }
    });
  });

  describe('Contract 24: Database Drivers', () => {
    it('24. getDatabaseDrivers returns 4 default drivers', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const drivers = await CC.getDatabaseDrivers();

      expect(drivers).toHaveLength(4);
      expect(drivers.map(d => d.name)).toEqual([
        'MySQL',
        'PostgreSQL',
        'Oracle',
        'SQL Server',
      ]);
      // Verify MySQL details
      expect(drivers[0]!.className).toBe('com.mysql.cj.jdbc.Driver');
      expect(drivers[0]!.template).toBe('jdbc:mysql://host:port/database');
      expect(drivers[0]!.selectLimit).toBe('LIMIT');
    });

    it('25. setDatabaseDrivers/getDatabaseDrivers round-trip with custom drivers', async () => {
      const CC = await getFreshController();

      const customDrivers = [
        {
          name: 'SQLite',
          className: 'org.sqlite.JDBC',
          template: 'jdbc:sqlite:path',
          selectLimit: 'LIMIT',
        },
      ];

      await CC.setDatabaseDrivers(customDrivers);

      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[0]![2]
      );
      const retrieved = await CC.getDatabaseDrivers();

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]!.name).toBe('SQLite');
    });
  });

  describe('Contract 24: Password Requirements', () => {
    it('26. getPasswordRequirements returns complete defaults', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const requirements = await CC.getPasswordRequirements();

      expect(requirements.minLength).toBe(8);
      expect(requirements.minUpper).toBe(0);
      expect(requirements.minLower).toBe(0);
      expect(requirements.minNumeric).toBe(0);
      expect(requirements.minSpecial).toBe(0);
      expect(requirements.retryLimit).toBe(3);
      expect(requirements.lockoutPeriod).toBe(0);
      expect(requirements.expiration).toBe(0);
      expect(requirements.gracePeriod).toBe(0);
      expect(requirements.reusePeriod).toBe(0);
      expect(requirements.reuseLimit).toBe(0);
    });
  });

  describe('Contract 24: Resources', () => {
    it('27. getResources returns Default Resource when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const resources = await CC.getResources();

      expect(resources).toHaveLength(1);
      expect(resources[0]!.id).toBe('Default Resource');
      expect(resources[0]!.name).toBe('Default Resource');
      expect(resources[0]!.type).toBe('Directory');
      expect(resources[0]!.includeWithGlobalScripts).toBe(true);
    });

    it('28. setResources/getResources round-trip with multiple resources', async () => {
      const CC = await getFreshController();

      const resources = [
        {
          id: 'res-1',
          name: 'Custom Lib',
          type: 'Directory',
          description: 'Custom libraries',
          includeWithGlobalScripts: false,
        },
        {
          id: 'res-2',
          name: 'Shared Lib',
          type: 'Directory',
          description: 'Shared across channels',
          includeWithGlobalScripts: true,
        },
      ];

      await CC.setResources(resources);

      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[0]![2]
      );
      const retrieved = await CC.getResources();

      expect(retrieved).toHaveLength(2);
      expect(retrieved[0]!.name).toBe('Custom Lib');
      expect(retrieved[1]!.includeWithGlobalScripts).toBe(true);
    });
  });

  describe('Contract 24: Update Settings', () => {
    it('29. getUpdateSettings returns defaults when not stored', async () => {
      const CC = await getFreshController();
      mockGetConfiguration.mockResolvedValueOnce(null);

      const settings = await CC.getUpdateSettings();

      expect(settings.statsEnabled).toBe(false);
      expect(settings.updateEnabled).toBe(true);
    });

    it('30. setUpdateSettings/getUpdateSettings round-trip', async () => {
      const CC = await getFreshController();

      const settings = {
        statsEnabled: true,
        updateEnabled: false,
        updateUrl: 'https://updates.example.com',
      };

      await CC.setUpdateSettings(settings);

      mockGetConfiguration.mockResolvedValueOnce(
        mockSetConfiguration.mock.calls[0]![2]
      );
      const retrieved = await CC.getUpdateSettings();

      expect(retrieved.statsEnabled).toBe(true);
      expect(retrieved.updateEnabled).toBe(false);
    });
  });
});
