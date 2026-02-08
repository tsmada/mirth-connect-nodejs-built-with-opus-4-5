import { DeltaDetector } from '../../../src/artifact/git/DeltaDetector.js';

describe('DeltaDetector', () => {

  // ─── mapFileToArtifact ───────────────────────────────────────

  describe('mapFileToArtifact', () => {

    it('maps channel source files', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/source/transformer.js');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'source' });
    });

    it('maps channel source connector.yaml', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/source/connector.yaml');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'source' });
    });

    it('maps channel source filter', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/source/filter.js');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'source' });
    });

    it('maps channel destination files', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/destinations/dest-1/connector.yaml');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'destinations/dest-1' });
    });

    it('maps channel destination transformer', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/destinations/dest-1/transformer.js');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'destinations/dest-1' });
    });

    it('maps channel destination response-transformer', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/destinations/dest-1/response-transformer.js');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'destinations/dest-1' });
    });

    it('maps channel script files', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/scripts/deploy.js');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'scripts' });
    });

    it('maps channel.yaml as config section', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/channel.yaml');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'config' });
    });

    it('maps _skeleton.xml as config section', () => {
      const result = DeltaDetector.mapFileToArtifact('channels/adt-receiver/_skeleton.xml');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'config' });
    });

    it('maps code template library.yaml', () => {
      const result = DeltaDetector.mapFileToArtifact('code-templates/util-lib/library.yaml');
      expect(result).toEqual({ type: 'code_template', name: 'util-lib' });
    });

    it('maps code template JS file with template name', () => {
      const result = DeltaDetector.mapFileToArtifact('code-templates/util-lib/format-date.js');
      expect(result).toEqual({ type: 'code_template', name: 'util-lib', section: 'format-date' });
    });

    it('maps group files', () => {
      const result = DeltaDetector.mapFileToArtifact('groups/hl7-processing.yaml');
      expect(result).toEqual({ type: 'group', name: 'hl7-processing' });
    });

    it('maps config files', () => {
      const result = DeltaDetector.mapFileToArtifact('config/dependencies.yaml');
      expect(result).toEqual({ type: 'config', name: 'config/dependencies.yaml' });
    });

    it('maps environment files', () => {
      const result = DeltaDetector.mapFileToArtifact('environments/prod.yaml');
      expect(result).toEqual({ type: 'environment', name: 'environments/prod.yaml' });
    });

    it('maps .mirth-sync.yaml as unknown', () => {
      const result = DeltaDetector.mapFileToArtifact('.mirth-sync.yaml');
      expect(result).toEqual({ type: 'unknown' });
    });

    it('maps README.md as unknown', () => {
      const result = DeltaDetector.mapFileToArtifact('README.md');
      expect(result).toEqual({ type: 'unknown' });
    });

    it('strips leading ./ prefix', () => {
      const result = DeltaDetector.mapFileToArtifact('./channels/adt-receiver/source/transformer.js');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'source' });
    });

    it('strips repo root prefix (e.g. mirth-config/)', () => {
      const result = DeltaDetector.mapFileToArtifact('mirth-config/channels/adt-receiver/channel.yaml');
      expect(result).toEqual({ type: 'channel', name: 'adt-receiver', section: 'config' });
    });
  });

  // ─── detect ──────────────────────────────────────────────────

  describe('detect', () => {

    it('returns empty result for empty file list', () => {
      const result = DeltaDetector.detect([]);
      expect(result.changedChannels).toEqual([]);
      expect(result.changedCodeTemplates).toEqual([]);
      expect(result.changedConfig).toEqual([]);
      expect(result.cascadedChannels).toEqual([]);
      expect(result.totalAffected).toBe(0);
      expect(result.summary).toBe('No changes');
    });

    it('groups multiple files in same channel into one change', () => {
      const result = DeltaDetector.detect([
        'channels/adt-receiver/source/transformer.js',
        'channels/adt-receiver/source/filter.js',
        'channels/adt-receiver/destinations/dest-1/connector.yaml',
      ]);

      expect(result.changedChannels).toHaveLength(1);
      const ch = result.changedChannels[0]!;
      expect(ch.channelName).toBe('adt-receiver');
      expect(ch.changedFiles).toHaveLength(3);
      expect(ch.sections).toEqual(['destinations/dest-1', 'source']);
    });

    it('detects multiple channel changes', () => {
      const result = DeltaDetector.detect([
        'channels/adt-receiver/source/transformer.js',
        'channels/orm-router/channel.yaml',
        'channels/oru-sender/destinations/dest-1/connector.yaml',
      ]);

      expect(result.changedChannels).toHaveLength(3);
      expect(result.changedChannels.map(c => c.channelName)).toEqual([
        'adt-receiver', 'orm-router', 'oru-sender',
      ]);
    });

    it('detects code template changes', () => {
      const result = DeltaDetector.detect([
        'code-templates/util-lib/format-date.js',
        'code-templates/util-lib/library.yaml',
      ]);

      expect(result.changedCodeTemplates).toHaveLength(2);
      // library.yaml has no templateName, format-date.js does
      const withTemplate = result.changedCodeTemplates.find(t => t.templateName === 'format-date');
      const withoutTemplate = result.changedCodeTemplates.find(t => !t.templateName);
      expect(withTemplate).toBeDefined();
      expect(withoutTemplate).toBeDefined();
      expect(withoutTemplate!.libraryName).toBe('util-lib');
    });

    it('detects config changes', () => {
      const result = DeltaDetector.detect([
        'config/dependencies.yaml',
        'config/tags.yaml',
      ]);

      expect(result.changedConfig).toHaveLength(2);
      expect(result.changedConfig.map(c => c.file)).toEqual([
        'config/dependencies.yaml',
        'config/tags.yaml',
      ]);
    });

    it('ignores unknown files', () => {
      const result = DeltaDetector.detect([
        'README.md',
        '.mirth-sync.yaml',
        'package.json',
      ]);

      expect(result.changedChannels).toEqual([]);
      expect(result.changedCodeTemplates).toEqual([]);
      expect(result.changedConfig).toEqual([]);
      expect(result.totalAffected).toBe(0);
    });

    it('handles mixed changes across artifact types', () => {
      const result = DeltaDetector.detect([
        'channels/adt-receiver/source/transformer.js',
        'code-templates/util-lib/format-date.js',
        'config/dependencies.yaml',
        'environments/prod.yaml',
        'groups/hl7-group.yaml',
        'README.md',
      ]);

      expect(result.changedChannels).toHaveLength(1);
      expect(result.changedCodeTemplates).toHaveLength(1);
      // config + environment file
      expect(result.changedConfig).toHaveLength(2);
    });

    it('detects multiple sections changed in one channel', () => {
      const result = DeltaDetector.detect([
        'channels/adt-receiver/source/transformer.js',
        'channels/adt-receiver/scripts/deploy.js',
        'channels/adt-receiver/channel.yaml',
        'channels/adt-receiver/destinations/dest-1/connector.yaml',
        'channels/adt-receiver/destinations/dest-2/transformer.js',
      ]);

      expect(result.changedChannels).toHaveLength(1);
      const ch = result.changedChannels[0]!;
      expect(ch.sections).toEqual([
        'config',
        'destinations/dest-1',
        'destinations/dest-2',
        'scripts',
        'source',
      ]);
      expect(ch.changedFiles).toHaveLength(5);
    });

    it('computes totalAffected from direct + cascaded', () => {
      const result = DeltaDetector.detect(
        [
          'channels/adt-receiver/source/transformer.js',
          'code-templates/util-lib/format-date.js',
        ],
        {
          codeTemplateLibraries: [{
            name: 'util-lib',
            enabledChannelIds: ['ch-orm', 'ch-oru'],
          }],
          channelIdToName: new Map([
            ['ch-orm', 'orm-router'],
            ['ch-oru', 'oru-sender'],
          ]),
        },
      );

      // 1 direct + 2 cascaded = 3
      expect(result.totalAffected).toBe(3);
    });

    it('builds a human-readable summary', () => {
      const result = DeltaDetector.detect([
        'channels/adt-receiver/source/transformer.js',
        'channels/orm-router/channel.yaml',
        'config/dependencies.yaml',
      ]);

      expect(result.summary).toBe('2 channels, 1 config file');
    });
  });

  // ─── Dependency Cascades ─────────────────────────────────────

  describe('dependency cascades', () => {

    it('cascades code template changes to enabled channels', () => {
      const result = DeltaDetector.detect(
        ['code-templates/util-lib/format-date.js'],
        {
          codeTemplateLibraries: [{
            name: 'util-lib',
            enabledChannelIds: ['ch-001', 'ch-002'],
          }],
          channelIdToName: new Map([
            ['ch-001', 'orm-router'],
            ['ch-002', 'oru-sender'],
          ]),
        },
      );

      expect(result.cascadedChannels).toHaveLength(2);
      expect(result.cascadedChannels[0]!.channelName).toBe('orm-router');
      expect(result.cascadedChannels[0]!.reason).toBe("Uses modified code template library 'util-lib'");
      expect(result.cascadedChannels[1]!.channelName).toBe('oru-sender');
    });

    it('does not cascade when includeCascades is false', () => {
      const result = DeltaDetector.detect(
        ['code-templates/util-lib/format-date.js'],
        {
          includeCascades: false,
          codeTemplateLibraries: [{
            name: 'util-lib',
            enabledChannelIds: ['ch-001'],
          }],
        },
      );

      expect(result.cascadedChannels).toHaveLength(0);
    });

    it('does not cascade if no library info provided', () => {
      const result = DeltaDetector.detect(
        ['code-templates/util-lib/format-date.js'],
      );

      expect(result.cascadedChannels).toHaveLength(0);
    });

    it('deduplicates cascaded channels across libraries', () => {
      const result = DeltaDetector.detect(
        [
          'code-templates/lib-a/func.js',
          'code-templates/lib-b/util.js',
        ],
        {
          codeTemplateLibraries: [
            { name: 'lib-a', enabledChannelIds: ['ch-001', 'ch-002'] },
            { name: 'lib-b', enabledChannelIds: ['ch-002', 'ch-003'] },
          ],
          channelIdToName: new Map([
            ['ch-001', 'channel-a'],
            ['ch-002', 'channel-b'],
            ['ch-003', 'channel-c'],
          ]),
        },
      );

      // ch-002 appears in both libraries but should only cascade once
      expect(result.cascadedChannels).toHaveLength(3);
      const names = result.cascadedChannels.map(c => c.channelName);
      expect(names).toEqual(['channel-a', 'channel-b', 'channel-c']);
    });

    it('excludes directly changed channels from cascaded list', () => {
      const result = DeltaDetector.detect(
        [
          'channels/orm-router/source/transformer.js',
          'code-templates/util-lib/format-date.js',
        ],
        {
          codeTemplateLibraries: [{
            name: 'util-lib',
            enabledChannelIds: ['ch-001'],
          }],
          channelIdToName: new Map([
            ['ch-001', 'orm-router'],
          ]),
        },
      );

      // orm-router is directly changed, should not appear in cascaded
      expect(result.cascadedChannels).toHaveLength(0);
      expect(result.changedChannels).toHaveLength(1);
    });

    it('uses channel ID as name when channelIdToName not provided', () => {
      const result = DeltaDetector.detect(
        ['code-templates/util-lib/func.js'],
        {
          codeTemplateLibraries: [{
            name: 'util-lib',
            enabledChannelIds: ['abc-123-def'],
          }],
        },
      );

      expect(result.cascadedChannels).toHaveLength(1);
      expect(result.cascadedChannels[0]!.channelName).toBe('abc-123-def');
      expect(result.cascadedChannels[0]!.channelId).toBe('abc-123-def');
    });

    it('cascades environment changes to all channels', () => {
      const result = DeltaDetector.detect(
        ['environments/prod.yaml'],
        {
          allChannelNames: ['adt-receiver', 'orm-router', 'oru-sender'],
        },
      );

      expect(result.cascadedChannels).toHaveLength(3);
      for (const ch of result.cascadedChannels) {
        expect(ch.reason).toBe('Environment config changed');
      }
    });

    it('environment cascade excludes directly changed channels', () => {
      const result = DeltaDetector.detect(
        [
          'channels/adt-receiver/source/transformer.js',
          'environments/prod.yaml',
        ],
        {
          allChannelNames: ['adt-receiver', 'orm-router'],
        },
      );

      // adt-receiver is directly changed, only orm-router cascaded
      expect(result.cascadedChannels).toHaveLength(1);
      expect(result.cascadedChannels[0]!.channelName).toBe('orm-router');
    });
  });

  // ─── findCascades ────────────────────────────────────────────

  describe('findCascades', () => {

    it('returns empty array when no libraries match', () => {
      const result = DeltaDetector.findCascades(
        [{ libraryName: 'util-lib', changeType: 'modified' }],
        [{ name: 'other-lib', enabledChannelIds: ['ch-1'] }],
      );
      expect(result).toEqual([]);
    });

    it('handles empty libraries array', () => {
      const result = DeltaDetector.findCascades(
        [{ libraryName: 'util-lib', changeType: 'modified' }],
        [],
      );
      expect(result).toEqual([]);
    });

    it('handles empty changed templates', () => {
      const result = DeltaDetector.findCascades(
        [],
        [{ name: 'util-lib', enabledChannelIds: ['ch-1'] }],
      );
      expect(result).toEqual([]);
    });
  });

  // ─── formatForCli ────────────────────────────────────────────

  describe('formatForCli', () => {

    it('formats empty result', () => {
      const result = DeltaDetector.detect([]);
      const output = DeltaDetector.formatForCli(result);
      expect(output).toBe('Delta: No changes detected');
    });

    it('formats changed channels with sections', () => {
      const result = DeltaDetector.detect([
        'channels/adt-receiver/source/transformer.js',
        'channels/adt-receiver/destinations/dest-1/connector.yaml',
      ]);

      const output = DeltaDetector.formatForCli(result);
      expect(output).toContain('Delta: 1 channel changed');
      expect(output).toContain('Changed:');
      expect(output).toContain('~ channels/adt-receiver/');
      expect(output).toContain('destinations/dest-1');
      expect(output).toContain('source');
    });

    it('formats cascaded channels', () => {
      const result = DeltaDetector.detect(
        ['code-templates/util-lib/func.js'],
        {
          codeTemplateLibraries: [{
            name: 'util-lib',
            enabledChannelIds: ['ch-1'],
          }],
          channelIdToName: new Map([['ch-1', 'orm-router']]),
        },
      );

      const output = DeltaDetector.formatForCli(result);
      expect(output).toContain('Cascaded:');
      expect(output).toContain('-> channels/orm-router/');
      expect(output).toContain("Uses modified code template library 'util-lib'");
    });

    it('formats config changes', () => {
      const result = DeltaDetector.detect([
        'config/dependencies.yaml',
      ]);

      const output = DeltaDetector.formatForCli(result);
      expect(output).toContain('Config:');
      expect(output).toContain('~ config/dependencies.yaml');
    });

    it('does not show environment files under Config section', () => {
      const result = DeltaDetector.detect([
        'environments/prod.yaml',
      ]);

      const output = DeltaDetector.formatForCli(result);
      // Environment files should not appear in the Config section
      expect(output).not.toContain('Config:');
    });

    it('formats mixed changes', () => {
      const result = DeltaDetector.detect(
        [
          'channels/adt-receiver/source/transformer.js',
          'code-templates/util-lib/func.js',
          'config/dependencies.yaml',
        ],
        {
          codeTemplateLibraries: [{
            name: 'util-lib',
            enabledChannelIds: ['ch-1'],
          }],
          channelIdToName: new Map([['ch-1', 'orm-router']]),
        },
      );

      const output = DeltaDetector.formatForCli(result);
      expect(output).toContain('Delta:');
      expect(output).toContain('Changed:');
      expect(output).toContain('Cascaded:');
      expect(output).toContain('Config:');
    });
  });
});
