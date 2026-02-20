/**
 * CodeTemplateController Unit Tests
 *
 * Tests for code template management business logic including:
 * - Cache initialization from database
 * - Code template CRUD operations
 * - Code template library CRUD operations
 * - Summary generation with revision checks
 * - Bulk update operations
 * - Code template script retrieval for channels
 * - Serialization/deserialization of code templates and libraries
 * - Default factory methods
 */

// Mock MirthDao BEFORE importing the controller
const mockMirthDao = {
  getCodeTemplates: jest.fn(),
  getCodeTemplateLibraries: jest.fn(),
  upsertCodeTemplate: jest.fn(),
  deleteCodeTemplate: jest.fn(),
  upsertCodeTemplateLibrary: jest.fn(),
  deleteCodeTemplateLibrary: jest.fn(),
};

jest.mock('../../../../src/db/MirthDao.js', () => mockMirthDao);

// Mock logging
jest.mock('../../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  registerComponent: jest.fn(),
}));

import {
  initializeCache,
  clearCache,
  getCodeTemplates,
  getCodeTemplate,
  getCodeTemplateSummary,
  updateCodeTemplate,
  removeCodeTemplate,
  getCodeTemplateLibraries,
  getCodeTemplateLibrary,
  updateCodeTemplateLibraries,
  updateLibrariesAndTemplates,
  getCodeTemplateScripts,
  getAllCodeTemplateScriptsForChannel,
  createDefaultLibrary,
  createDefaultCodeTemplate,
} from '../../../../src/plugins/codetemplates/CodeTemplateController.js';
import { CodeTemplate } from '../../../../src/plugins/codetemplates/models/CodeTemplate.js';
import { CodeTemplateLibrary } from '../../../../src/plugins/codetemplates/models/CodeTemplateLibrary.js';
import { ContextType } from '../../../../src/plugins/codetemplates/models/ContextType.js';
import { CodeTemplateType } from '../../../../src/plugins/codetemplates/models/CodeTemplateProperties.js';

// Helper: build valid code template XML
function buildTemplateXml(opts: {
  id: string;
  name: string;
  revision?: number;
  contextTypes?: string[];
  type?: string;
  code?: string;
}): string {
  const ctxTypes = opts.contextTypes ?? ['SOURCE_FILTER_TRANSFORMER'];
  const contextTypeXml = ctxTypes.map((t) => `<contextType>${t}</contextType>`).join('');
  return `<codeTemplate version="3.9.0">
    <id>${opts.id}</id>
    <name>${opts.name}</name>
    <revision>${opts.revision ?? 1}</revision>
    <lastModified>2026-01-01T00:00:00.000Z</lastModified>
    <contextSet>
      <delegate>
        ${contextTypeXml}
      </delegate>
    </contextSet>
    <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties">
      <type>${opts.type ?? 'FUNCTION'}</type>
      <code>${opts.code ?? 'function test() {}'}</code>
    </properties>
  </codeTemplate>`;
}

// Helper: build valid library XML
function buildLibraryXml(opts: {
  id: string;
  name: string;
  revision?: number;
  includeNewChannels?: boolean;
  enabledChannelIds?: string[];
  disabledChannelIds?: string[];
  templateIds?: string[];
}): string {
  const enabledIds = (opts.enabledChannelIds ?? []).map((id) => `<string>${id}</string>`).join('');
  const disabledIds = (opts.disabledChannelIds ?? []).map((id) => `<string>${id}</string>`).join('');
  const templates = (opts.templateIds ?? []).map((id) => `<codeTemplate><id>${id}</id></codeTemplate>`).join('');
  return `<codeTemplateLibrary version="3.9.0">
    <id>${opts.id}</id>
    <name>${opts.name}</name>
    <revision>${opts.revision ?? 1}</revision>
    <lastModified>2026-01-01T00:00:00.000Z</lastModified>
    <description>Test library</description>
    <includeNewChannels>${opts.includeNewChannels ?? false}</includeNewChannels>
    <enabledChannelIds>${enabledIds}</enabledChannelIds>
    <disabledChannelIds>${disabledIds}</disabledChannelIds>
    <codeTemplates>${templates}</codeTemplates>
  </codeTemplateLibrary>`;
}

describe('CodeTemplateController', () => {
  beforeEach(() => {
    // Reset all mocks and clear cache before each test
    jest.clearAllMocks();
    clearCache();

    // Default: return empty arrays from DAO
    mockMirthDao.getCodeTemplates.mockResolvedValue([]);
    mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);
    mockMirthDao.upsertCodeTemplate.mockResolvedValue(undefined);
    mockMirthDao.deleteCodeTemplate.mockResolvedValue(undefined);
    mockMirthDao.upsertCodeTemplateLibrary.mockResolvedValue(undefined);
    mockMirthDao.deleteCodeTemplateLibrary.mockResolvedValue(undefined);
  });

  // ===========================================
  // initializeCache
  // ===========================================
  describe('initializeCache', () => {
    it('should load templates and libraries from database', async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-1',
          NAME: 'Template 1',
          REVISION: 2,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-1', name: 'Template 1', revision: 2 }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-1',
          NAME: 'Library 1',
          REVISION: 1,
          LIBRARY: buildLibraryXml({ id: 'lib-1', name: 'Library 1', templateIds: ['tpl-1'] }),
        },
      ]);

      await initializeCache();

      const templates = await getCodeTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0]!.id).toBe('tpl-1');
      expect(templates[0]!.name).toBe('Template 1');
      expect(templates[0]!.revision).toBe(2);
    });

    it('should only initialize once (idempotent)', async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();
      await initializeCache(); // Second call should be a no-op

      expect(mockMirthDao.getCodeTemplates).toHaveBeenCalledTimes(1);
      expect(mockMirthDao.getCodeTemplateLibraries).toHaveBeenCalledTimes(1);
    });

    it('should handle template deserialization failure gracefully', async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'bad-1',
          NAME: 'Bad Template',
          REVISION: 1,
          CODE_TEMPLATE: '<invalid>not a valid template</invalid>',
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();

      const templates = await getCodeTemplates();
      // Bad template should be skipped (deserializeCodeTemplate returns null for missing root element)
      expect(templates).toHaveLength(0);
    });

    it('should handle library deserialization failure gracefully', async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'bad-lib',
          NAME: 'Bad Lib',
          REVISION: 1,
          LIBRARY: '<invalid>not a valid library</invalid>',
        },
      ]);

      await initializeCache();

      const libraries = await getCodeTemplateLibraries();
      expect(libraries).toHaveLength(0);
    });

    it('should rethrow database errors', async () => {
      mockMirthDao.getCodeTemplates.mockRejectedValue(new Error('DB connection failed'));

      await expect(initializeCache()).rejects.toThrow('DB connection failed');
    });

    it('should handle template XML with missing optional fields', async () => {
      const minimalXml = `<codeTemplate version="3.9.0">
        <id>tpl-min</id>
      </codeTemplate>`;

      mockMirthDao.getCodeTemplates.mockResolvedValue([
        { ID: 'tpl-min', NAME: 'Minimal', REVISION: 1, CODE_TEMPLATE: minimalXml },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();

      const tpl = await getCodeTemplate('tpl-min');
      expect(tpl).not.toBeNull();
      expect(tpl!.name).toBe('Minimal');
      expect(tpl!.revision).toBe(1);
      expect(tpl!.contextSet).toEqual([]);
      expect(tpl!.properties.type).toBe('FUNCTION');
      expect(tpl!.properties.code).toBe('');
    });

    it('should parse single context type (not array)', async () => {
      const xml = buildTemplateXml({
        id: 'tpl-single',
        name: 'Single Context',
        contextTypes: ['GLOBAL_DEPLOY'],
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([
        { ID: 'tpl-single', NAME: 'Single Context', REVISION: 1, CODE_TEMPLATE: xml },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();

      const tpl = await getCodeTemplate('tpl-single');
      expect(tpl!.contextSet).toEqual(['GLOBAL_DEPLOY']);
    });

    it('should parse multiple context types as array', async () => {
      const xml = buildTemplateXml({
        id: 'tpl-multi',
        name: 'Multi Context',
        contextTypes: ['GLOBAL_DEPLOY', 'CHANNEL_DEPLOY', 'SOURCE_FILTER_TRANSFORMER'],
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([
        { ID: 'tpl-multi', NAME: 'Multi Context', REVISION: 1, CODE_TEMPLATE: xml },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();

      const tpl = await getCodeTemplate('tpl-multi');
      expect(tpl!.contextSet).toHaveLength(3);
      expect(tpl!.contextSet).toContain('GLOBAL_DEPLOY');
      expect(tpl!.contextSet).toContain('CHANNEL_DEPLOY');
      expect(tpl!.contextSet).toContain('SOURCE_FILTER_TRANSFORMER');
    });

    it('should parse library with single enabledChannelId', async () => {
      const xml = buildLibraryXml({
        id: 'lib-single',
        name: 'Single Channel Lib',
        enabledChannelIds: ['ch-1'],
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-single', NAME: 'Single Channel Lib', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();

      const lib = await getCodeTemplateLibrary('lib-single');
      expect(lib!.enabledChannelIds).toEqual(['ch-1']);
    });

    it('should parse library with multiple enabledChannelIds', async () => {
      const xml = buildLibraryXml({
        id: 'lib-multi',
        name: 'Multi Channel Lib',
        enabledChannelIds: ['ch-1', 'ch-2', 'ch-3'],
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-multi', NAME: 'Multi Channel Lib', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();

      const lib = await getCodeTemplateLibrary('lib-multi');
      expect(lib!.enabledChannelIds).toEqual(['ch-1', 'ch-2', 'ch-3']);
    });

    it('should parse library with disabledChannelIds', async () => {
      const xml = buildLibraryXml({
        id: 'lib-disabled',
        name: 'Disabled Lib',
        disabledChannelIds: ['ch-X'],
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-disabled', NAME: 'Disabled Lib', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();

      const lib = await getCodeTemplateLibrary('lib-disabled');
      expect(lib!.disabledChannelIds).toEqual(['ch-X']);
    });

    it('should parse library includeNewChannels as true', async () => {
      const xml = buildLibraryXml({
        id: 'lib-inc',
        name: 'Include New',
        includeNewChannels: true,
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-inc', NAME: 'Include New', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();

      const lib = await getCodeTemplateLibrary('lib-inc');
      expect(lib!.includeNewChannels).toBe(true);
    });

    it('should parse library with template references', async () => {
      const xml = buildLibraryXml({
        id: 'lib-refs',
        name: 'With Refs',
        templateIds: ['tpl-A', 'tpl-B'],
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-refs', NAME: 'With Refs', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();

      const lib = await getCodeTemplateLibrary('lib-refs');
      expect(lib!.codeTemplates).toHaveLength(2);
      expect(lib!.codeTemplates[0]!.id).toBe('tpl-A');
      expect(lib!.codeTemplates[1]!.id).toBe('tpl-B');
    });

    it('should parse library with single template reference (not array)', async () => {
      const xml = buildLibraryXml({
        id: 'lib-one-ref',
        name: 'One Ref',
        templateIds: ['tpl-only'],
      });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-one-ref', NAME: 'One Ref', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();

      const lib = await getCodeTemplateLibrary('lib-one-ref');
      expect(lib!.codeTemplates).toHaveLength(1);
      expect(lib!.codeTemplates[0]!.id).toBe('tpl-only');
    });
  });

  // ===========================================
  // clearCache
  // ===========================================
  describe('clearCache', () => {
    it('should clear all cached data and allow re-initialization', async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-1',
          NAME: 'Template 1',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-1', name: 'Template 1' }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();
      let templates = await getCodeTemplates();
      expect(templates).toHaveLength(1);

      clearCache();

      // After clear, getCodeTemplates should re-initialize
      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      templates = await getCodeTemplates();
      expect(templates).toHaveLength(0);
      expect(mockMirthDao.getCodeTemplates).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================
  // getCodeTemplates
  // ===========================================
  describe('getCodeTemplates', () => {
    beforeEach(async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-1',
          NAME: 'Alpha',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-1', name: 'Alpha' }),
        },
        {
          ID: 'tpl-2',
          NAME: 'Beta',
          REVISION: 2,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-2', name: 'Beta', revision: 2 }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);
    });

    it('should return all templates when no IDs specified', async () => {
      const templates = await getCodeTemplates();
      expect(templates).toHaveLength(2);
    });

    it('should filter templates by IDs', async () => {
      const templates = await getCodeTemplates(new Set(['tpl-2']));
      expect(templates).toHaveLength(1);
      expect(templates[0]!.id).toBe('tpl-2');
    });

    it('should return empty array when IDs filter matches nothing', async () => {
      const templates = await getCodeTemplates(new Set(['nonexistent']));
      expect(templates).toHaveLength(0);
    });

    it('should return all templates when IDs set is empty', async () => {
      const templates = await getCodeTemplates(new Set());
      expect(templates).toHaveLength(2);
    });
  });

  // ===========================================
  // getCodeTemplate
  // ===========================================
  describe('getCodeTemplate', () => {
    beforeEach(async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-1',
          NAME: 'Template 1',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-1', name: 'Template 1' }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);
    });

    it('should return template by ID', async () => {
      const tpl = await getCodeTemplate('tpl-1');
      expect(tpl).not.toBeNull();
      expect(tpl!.id).toBe('tpl-1');
    });

    it('should return null for unknown ID', async () => {
      const tpl = await getCodeTemplate('nonexistent');
      expect(tpl).toBeNull();
    });
  });

  // ===========================================
  // getCodeTemplateSummary
  // ===========================================
  describe('getCodeTemplateSummary', () => {
    beforeEach(async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-1',
          NAME: 'Template 1',
          REVISION: 3,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-1', name: 'Template 1', revision: 3 }),
        },
        {
          ID: 'tpl-2',
          NAME: 'Template 2',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-2', name: 'Template 2', revision: 1 }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);
    });

    it('should return new templates (client has no revision)', async () => {
      const summaries = await getCodeTemplateSummary(new Map());
      expect(summaries).toHaveLength(2);
      // New templates include full codeTemplate
      expect(summaries[0]!.codeTemplate).toBeDefined();
      expect(summaries[1]!.codeTemplate).toBeDefined();
    });

    it('should return updated templates (revision mismatch)', async () => {
      const clientRevisions = new Map([
        ['tpl-1', 2], // server has 3, client has 2 -- updated
        ['tpl-2', 1], // same revision -- unchanged
      ]);

      const summaries = await getCodeTemplateSummary(clientRevisions);
      const tpl1Summary = summaries.find((s) => s.id === 'tpl-1');
      const tpl2Summary = summaries.find((s) => s.id === 'tpl-2');

      expect(tpl1Summary!.codeTemplate).toBeDefined(); // updated, includes template
      expect(tpl2Summary!.codeTemplate).toBeUndefined(); // unchanged, no template
    });

    it('should return unchanged templates (same revision)', async () => {
      const clientRevisions = new Map([
        ['tpl-1', 3],
        ['tpl-2', 1],
      ]);

      const summaries = await getCodeTemplateSummary(clientRevisions);
      expect(summaries).toHaveLength(2);
      // Both unchanged - no codeTemplate field
      for (const s of summaries) {
        expect(s.codeTemplate).toBeUndefined();
      }
    });

    it('should mark deleted templates (client has, server does not)', async () => {
      const clientRevisions = new Map([
        ['tpl-1', 3],
        ['tpl-2', 1],
        ['tpl-deleted', 5], // exists on client but not server
      ]);

      const summaries = await getCodeTemplateSummary(clientRevisions);
      const deletedSummary = summaries.find((s) => s.id === 'tpl-deleted');
      expect(deletedSummary).toBeDefined();
      expect(deletedSummary!.deleted).toBe(true);
      expect(deletedSummary!.name).toBe('');
    });
  });

  // ===========================================
  // updateCodeTemplate
  // ===========================================
  describe('updateCodeTemplate', () => {
    const template: CodeTemplate = {
      id: 'tpl-1',
      name: 'Updated Template',
      revision: 1,
      contextSet: [ContextType.SOURCE_FILTER_TRANSFORMER],
      properties: { type: CodeTemplateType.FUNCTION, code: 'function updated() {}' },
    };

    it('should create a new template when none exists', async () => {
      const result = await updateCodeTemplate('tpl-1', template, false);
      expect(result).toBe(true);
      expect(mockMirthDao.upsertCodeTemplate).toHaveBeenCalledWith(
        'tpl-1',
        'Updated Template',
        expect.any(String),
        1 // (0 + 1)
      );

      // Verify it's in the cache
      const cached = await getCodeTemplate('tpl-1');
      expect(cached).not.toBeNull();
      expect(cached!.name).toBe('Updated Template');
    });

    it('should update an existing template with matching revision', async () => {
      // First create
      await updateCodeTemplate('tpl-1', template, false);

      // Then update with matching revision
      const updatedTemplate: CodeTemplate = {
        ...template,
        name: 'Updated Again',
        revision: 1, // matches the stored revision
      };
      const result = await updateCodeTemplate('tpl-1', updatedTemplate, false);
      expect(result).toBe(true);
    });

    it('should reject update when revision conflicts and override=false', async () => {
      // First create at revision 1
      await updateCodeTemplate('tpl-1', template, false);

      // Try to update with wrong revision
      const conflictingTemplate: CodeTemplate = {
        ...template,
        name: 'Conflicting',
        revision: 99, // doesn't match stored revision 1
      };
      const result = await updateCodeTemplate('tpl-1', conflictingTemplate, false);
      expect(result).toBe(false);
    });

    it('should allow update when revision conflicts but override=true', async () => {
      // First create at revision 1
      await updateCodeTemplate('tpl-1', template, false);

      // Update with wrong revision but override=true
      const conflictingTemplate: CodeTemplate = {
        ...template,
        name: 'Overridden',
        revision: 99,
      };
      const result = await updateCodeTemplate('tpl-1', conflictingTemplate, true);
      expect(result).toBe(true);

      const cached = await getCodeTemplate('tpl-1');
      expect(cached!.name).toBe('Overridden');
    });

    it('should increment revision on update', async () => {
      await updateCodeTemplate('tpl-1', template, false);
      let cached = await getCodeTemplate('tpl-1');
      expect(cached!.revision).toBe(1); // 0 + 1

      const updatedTemplate: CodeTemplate = { ...template, revision: 1 };
      await updateCodeTemplate('tpl-1', updatedTemplate, false);
      cached = await getCodeTemplate('tpl-1');
      expect(cached!.revision).toBe(2); // 1 + 1
    });

    it('should set lastModified on update', async () => {
      const before = new Date();
      await updateCodeTemplate('tpl-1', template, false);
      const cached = await getCodeTemplate('tpl-1');
      expect(cached!.lastModified).toBeDefined();
      expect(cached!.lastModified!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // ===========================================
  // removeCodeTemplate
  // ===========================================
  describe('removeCodeTemplate', () => {
    it('should delete template from database and cache', async () => {
      const template: CodeTemplate = {
        id: 'tpl-del',
        name: 'To Delete',
        revision: 1,
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: '' },
      };
      await updateCodeTemplate('tpl-del', template, false);

      await removeCodeTemplate('tpl-del');

      expect(mockMirthDao.deleteCodeTemplate).toHaveBeenCalledWith('tpl-del');
      const cached = await getCodeTemplate('tpl-del');
      expect(cached).toBeNull();
    });

    it('should handle removing non-existent template gracefully', async () => {
      await removeCodeTemplate('nonexistent');
      expect(mockMirthDao.deleteCodeTemplate).toHaveBeenCalledWith('nonexistent');
    });
  });

  // ===========================================
  // getCodeTemplateLibraries
  // ===========================================
  describe('getCodeTemplateLibraries', () => {
    beforeEach(async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-A',
          NAME: 'Template A',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-A', name: 'Template A', code: 'function a() { return 1; }' }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-1',
          NAME: 'Library 1',
          REVISION: 1,
          LIBRARY: buildLibraryXml({ id: 'lib-1', name: 'Library 1', templateIds: ['tpl-A'] }),
        },
        {
          ID: 'lib-2',
          NAME: 'Library 2',
          REVISION: 2,
          LIBRARY: buildLibraryXml({ id: 'lib-2', name: 'Library 2' }),
        },
      ]);
    });

    it('should return all libraries when no IDs specified', async () => {
      const libraries = await getCodeTemplateLibraries();
      expect(libraries).toHaveLength(2);
    });

    it('should filter libraries by IDs', async () => {
      const libraries = await getCodeTemplateLibraries(new Set(['lib-2']));
      expect(libraries).toHaveLength(1);
      expect(libraries[0]!.id).toBe('lib-2');
    });

    it('should return all when IDs set is empty', async () => {
      const libraries = await getCodeTemplateLibraries(new Set());
      expect(libraries).toHaveLength(2);
    });

    it('should include full code templates when includeCodeTemplates=true', async () => {
      const libraries = await getCodeTemplateLibraries(undefined, true);
      const lib1 = libraries.find((l) => l.id === 'lib-1');
      expect(lib1).toBeDefined();
      // tpl-A should be resolved from the code template cache
      expect(lib1!.codeTemplates).toHaveLength(1);
      expect(lib1!.codeTemplates[0]!.name).toBe('Template A');
      expect(lib1!.codeTemplates[0]!.properties.code).toContain('function a()');
    });

    it('should fall back to reference when template not in cache (includeCodeTemplates)', async () => {
      // Library references tpl-A which exists, plus we add a reference to a non-existent tpl
      // Use a library with a template ID not in the code template cache
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-missing',
          NAME: 'Missing Ref',
          REVISION: 1,
          LIBRARY: buildLibraryXml({ id: 'lib-missing', name: 'Missing Ref', templateIds: ['tpl-nonexistent'] }),
        },
      ]);
      clearCache();

      const libraries = await getCodeTemplateLibraries(undefined, true);
      const lib = libraries.find((l) => l.id === 'lib-missing');
      expect(lib!.codeTemplates).toHaveLength(1);
      // Falls back to the skeleton reference from the library
      expect(lib!.codeTemplates[0]!.id).toBe('tpl-nonexistent');
    });

    it('should not include code templates by default', async () => {
      const libraries = await getCodeTemplateLibraries();
      const lib1 = libraries.find((l) => l.id === 'lib-1');
      // Template reference should be minimal (from library deserialization)
      expect(lib1!.codeTemplates[0]!.properties.code).toBe('');
    });
  });

  // ===========================================
  // getCodeTemplateLibrary
  // ===========================================
  describe('getCodeTemplateLibrary', () => {
    beforeEach(async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-A',
          NAME: 'Template A',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({ id: 'tpl-A', name: 'Template A', code: 'function a() {}' }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-1',
          NAME: 'Library 1',
          REVISION: 1,
          LIBRARY: buildLibraryXml({ id: 'lib-1', name: 'Library 1', templateIds: ['tpl-A'] }),
        },
      ]);
    });

    it('should return library by ID', async () => {
      const lib = await getCodeTemplateLibrary('lib-1');
      expect(lib).not.toBeNull();
      expect(lib!.id).toBe('lib-1');
    });

    it('should return null for unknown ID', async () => {
      const lib = await getCodeTemplateLibrary('nonexistent');
      expect(lib).toBeNull();
    });

    it('should include full code templates when requested', async () => {
      const lib = await getCodeTemplateLibrary('lib-1', true);
      expect(lib!.codeTemplates[0]!.name).toBe('Template A');
      expect(lib!.codeTemplates[0]!.properties.code).toContain('function a()');
    });

    it('should not include full code templates by default', async () => {
      const lib = await getCodeTemplateLibrary('lib-1', false);
      expect(lib!.codeTemplates[0]!.properties.code).toBe('');
    });

    it('should fall back to skeleton when template not in cache', async () => {
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-missing',
          NAME: 'Lib',
          REVISION: 1,
          LIBRARY: buildLibraryXml({ id: 'lib-missing', name: 'Lib', templateIds: ['tpl-missing'] }),
        },
      ]);
      clearCache();

      const lib = await getCodeTemplateLibrary('lib-missing', true);
      expect(lib!.codeTemplates[0]!.id).toBe('tpl-missing');
    });
  });

  // ===========================================
  // updateCodeTemplateLibraries
  // ===========================================
  describe('updateCodeTemplateLibraries', () => {
    it('should save new libraries', async () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-new',
        name: 'New Library',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      const result = await updateCodeTemplateLibraries([library], false);
      expect(result).toBe(true);
      expect(mockMirthDao.upsertCodeTemplateLibrary).toHaveBeenCalledWith(
        'lib-new',
        'New Library',
        expect.any(String),
        1
      );
    });

    it('should detect revision conflicts when override=false', async () => {
      // Create initial library
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Initial',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };
      await updateCodeTemplateLibraries([library], false);

      // Try to update with wrong revision
      const conflicting: CodeTemplateLibrary = {
        ...library,
        name: 'Conflicting',
        revision: 99, // doesn't match stored revision 1
      };
      const result = await updateCodeTemplateLibraries([conflicting], false);
      expect(result).toBe(false);
    });

    it('should allow revision conflicts when override=true', async () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Initial',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };
      await updateCodeTemplateLibraries([library], false);

      const conflicting: CodeTemplateLibrary = {
        ...library,
        name: 'Overridden',
        revision: 99,
      };
      const result = await updateCodeTemplateLibraries([conflicting], true);
      expect(result).toBe(true);
    });

    it('should delete removed libraries', async () => {
      // Create two libraries
      const lib1: CodeTemplateLibrary = {
        id: 'lib-1', name: 'Lib 1', revision: 0, includeNewChannels: false,
        enabledChannelIds: [], disabledChannelIds: [], codeTemplates: [],
      };
      const lib2: CodeTemplateLibrary = {
        id: 'lib-2', name: 'Lib 2', revision: 0, includeNewChannels: false,
        enabledChannelIds: [], disabledChannelIds: [], codeTemplates: [],
      };
      await updateCodeTemplateLibraries([lib1, lib2], false);

      // Update with only lib1 -- lib2 should be deleted
      const updatedLib1: CodeTemplateLibrary = { ...lib1, revision: 1 };
      await updateCodeTemplateLibraries([updatedLib1], false);

      expect(mockMirthDao.deleteCodeTemplateLibrary).toHaveBeenCalledWith('lib-2');
    });

    it('should persist embedded templates from libraries', async () => {
      const embeddedTemplate: CodeTemplate = {
        id: 'tpl-emb',
        name: 'Embedded',
        contextSet: [ContextType.SOURCE_FILTER_TRANSFORMER],
        properties: { type: CodeTemplateType.FUNCTION, code: 'function embedded() {}' },
      };

      const library: CodeTemplateLibrary = {
        id: 'lib-emb',
        name: 'With Embedded',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [embeddedTemplate],
      };

      await updateCodeTemplateLibraries([library], false);

      // Embedded template should be persisted individually
      expect(mockMirthDao.upsertCodeTemplate).toHaveBeenCalledWith(
        'tpl-emb',
        'Embedded',
        expect.any(String),
        1
      );

      // And be available in the cache
      const cached = await getCodeTemplate('tpl-emb');
      expect(cached).not.toBeNull();
      expect(cached!.name).toBe('Embedded');
    });

    it('should skip embedded templates without code', async () => {
      const skeletonTemplate: CodeTemplate = {
        id: 'tpl-skel',
        name: '',
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: '' },
      };

      const library: CodeTemplateLibrary = {
        id: 'lib-skel',
        name: 'Skeleton Only',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [skeletonTemplate],
      };

      await updateCodeTemplateLibraries([library], false);

      // Skeleton (no code) should NOT be individually persisted
      expect(mockMirthDao.upsertCodeTemplate).not.toHaveBeenCalled();
    });

    it('should set lastModified on each library', async () => {
      const before = new Date();
      const library: CodeTemplateLibrary = {
        id: 'lib-ts',
        name: 'Timestamped',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      await updateCodeTemplateLibraries([library], false);

      const cached = await getCodeTemplateLibrary('lib-ts');
      expect(cached!.lastModified).toBeDefined();
      expect(cached!.lastModified!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // ===========================================
  // updateLibrariesAndTemplates
  // ===========================================
  describe('updateLibrariesAndTemplates', () => {
    it('should perform bulk update with no conflicts', async () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-bulk',
        name: 'Bulk Lib',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      const template: CodeTemplate = {
        id: 'tpl-bulk',
        name: 'Bulk Template',
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: 'function bulk() {}' },
      };

      const result = await updateLibrariesAndTemplates(
        [library],
        new Set(),
        [template],
        new Set(),
        false
      );

      expect(result.librariesSuccess).toBe(true);
      expect(result.codeTemplatesSuccess).toBe(true);
      expect(result.overrideNeeded).toBe(false);
      expect(result.updatedLibraries).toHaveLength(1);
      expect(result.updatedCodeTemplates).toHaveLength(1);
    });

    it('should detect library revision conflicts', async () => {
      // Create a library first
      const library: CodeTemplateLibrary = {
        id: 'lib-conflict',
        name: 'Conflict',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };
      await updateCodeTemplateLibraries([library], false);

      // Now try bulk update with wrong revision
      const conflicting: CodeTemplateLibrary = {
        ...library,
        revision: 99,
      };

      const result = await updateLibrariesAndTemplates(
        [conflicting],
        new Set(),
        [],
        new Set(),
        false
      );

      expect(result.librariesSuccess).toBe(false);
      expect(result.overrideNeeded).toBe(true);
    });

    it('should detect template revision conflicts', async () => {
      // Create a template first
      const template: CodeTemplate = {
        id: 'tpl-conflict',
        name: 'Conflict',
        revision: 0,
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: 'function x() {}' },
      };
      await updateCodeTemplate('tpl-conflict', template, false);

      // Now try bulk update with wrong revision
      const conflicting: CodeTemplate = {
        ...template,
        revision: 99,
      };

      const result = await updateLibrariesAndTemplates(
        [],
        new Set(),
        [conflicting],
        new Set(),
        false
      );

      expect(result.codeTemplatesSuccess).toBe(false);
      expect(result.overrideNeeded).toBe(true);
    });

    it('should bypass conflict checks when override=true', async () => {
      // Create a template
      const template: CodeTemplate = {
        id: 'tpl-override',
        name: 'Override',
        revision: 0,
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: 'function x() {}' },
      };
      await updateCodeTemplate('tpl-override', template, false);

      // Bulk update with override
      const conflicting: CodeTemplate = {
        ...template,
        revision: 99,
      };

      const result = await updateLibrariesAndTemplates(
        [],
        new Set(),
        [conflicting],
        new Set(),
        true // override
      );

      expect(result.codeTemplatesSuccess).toBe(true);
      expect(result.overrideNeeded).toBe(false);
    });

    it('should remove deleted templates', async () => {
      const template: CodeTemplate = {
        id: 'tpl-to-delete',
        name: 'Delete Me',
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: '' },
      };
      await updateCodeTemplate('tpl-to-delete', template, false);

      const result = await updateLibrariesAndTemplates(
        [],
        new Set(),
        [],
        new Set(['tpl-to-delete']),
        false
      );

      expect(mockMirthDao.deleteCodeTemplate).toHaveBeenCalledWith('tpl-to-delete');
      expect(result.librariesSuccess).toBe(true);
    });

    it('should remove deleted libraries', async () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-to-delete',
        name: 'Delete Me',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };
      await updateCodeTemplateLibraries([library], false);

      const result = await updateLibrariesAndTemplates(
        [],
        new Set(['lib-to-delete']),
        [],
        new Set(),
        false
      );

      expect(mockMirthDao.deleteCodeTemplateLibrary).toHaveBeenCalledWith('lib-to-delete');
      expect(result.librariesSuccess).toBe(true);
    });

    it('should return updated templates in result', async () => {
      const template: CodeTemplate = {
        id: 'tpl-result',
        name: 'Result Template',
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: 'function result() {}' },
      };

      const result = await updateLibrariesAndTemplates(
        [],
        new Set(),
        [template],
        new Set(),
        false
      );

      expect(result.updatedCodeTemplates).toHaveLength(1);
      expect(result.updatedCodeTemplates[0]!.id).toBe('tpl-result');
      expect(result.updatedCodeTemplates[0]!.revision).toBe(1);
    });

    it('should return updated libraries in result', async () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-result',
        name: 'Result Lib',
        revision: 0,
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      const result = await updateLibrariesAndTemplates(
        [library],
        new Set(),
        [],
        new Set(),
        false
      );

      expect(result.updatedLibraries).toHaveLength(1);
      expect(result.updatedLibraries[0]!.id).toBe('lib-result');
      expect(result.updatedLibraries[0]!.revision).toBe(1);
    });
  });

  // ===========================================
  // getCodeTemplateScripts
  // ===========================================
  describe('getCodeTemplateScripts', () => {
    beforeEach(async () => {
      // Template with FUNCTION type and SOURCE_FILTER_TRANSFORMER context
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-func',
          NAME: 'Util Function',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({
            id: 'tpl-func',
            name: 'Util Function',
            contextTypes: ['SOURCE_FILTER_TRANSFORMER'],
            type: 'FUNCTION',
            code: 'function util() { return true; }',
          }),
        },
        {
          ID: 'tpl-drag',
          NAME: 'Drag Drop',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({
            id: 'tpl-drag',
            name: 'Drag Drop',
            contextTypes: ['SOURCE_FILTER_TRANSFORMER'],
            type: 'DRAG_AND_DROP_CODE',
            code: 'var x = 1;',
          }),
        },
        {
          ID: 'tpl-compiled',
          NAME: 'Compiled',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({
            id: 'tpl-compiled',
            name: 'Compiled',
            contextTypes: ['GLOBAL_DEPLOY'],
            type: 'COMPILED_CODE',
            code: 'function compiled() {}',
          }),
        },
      ]);
      // Library enabled for channel-1 with all three templates
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-1',
          NAME: 'Test Lib',
          REVISION: 1,
          LIBRARY: buildLibraryXml({
            id: 'lib-1',
            name: 'Test Lib',
            enabledChannelIds: ['channel-1'],
            templateIds: ['tpl-func', 'tpl-drag', 'tpl-compiled'],
          }),
        },
      ]);
    });

    it('should return scripts matching channel and context', async () => {
      const scripts = await getCodeTemplateScripts('channel-1', ContextType.SOURCE_FILTER_TRANSFORMER);
      // tpl-func (FUNCTION, correct context) should be included
      // tpl-drag (DRAG_AND_DROP_CODE) should NOT be included (isAddToScripts returns false)
      // tpl-compiled (COMPILED_CODE, wrong context) should NOT be included
      expect(scripts).toHaveLength(1);
      expect(scripts[0]).toContain('function util()');
    });

    it('should return empty for disabled channel', async () => {
      const scripts = await getCodeTemplateScripts('channel-99', ContextType.SOURCE_FILTER_TRANSFORMER);
      expect(scripts).toHaveLength(0);
    });

    it('should return compiled code with matching context', async () => {
      const scripts = await getCodeTemplateScripts('channel-1', ContextType.GLOBAL_DEPLOY);
      expect(scripts).toHaveLength(1);
      expect(scripts[0]).toContain('function compiled()');
    });
  });

  // ===========================================
  // getAllCodeTemplateScriptsForChannel
  // ===========================================
  describe('getAllCodeTemplateScriptsForChannel', () => {
    beforeEach(async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-1',
          NAME: 'Template 1',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({
            id: 'tpl-1',
            name: 'Template 1',
            contextTypes: ['SOURCE_FILTER_TRANSFORMER'],
            type: 'FUNCTION',
            code: 'function one() {}',
          }),
        },
        {
          ID: 'tpl-2',
          NAME: 'Template 2',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({
            id: 'tpl-2',
            name: 'Template 2',
            contextTypes: ['GLOBAL_DEPLOY'],
            type: 'COMPILED_CODE',
            code: 'function two() {}',
          }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-1',
          NAME: 'Lib 1',
          REVISION: 1,
          LIBRARY: buildLibraryXml({
            id: 'lib-1',
            name: 'Lib 1',
            enabledChannelIds: ['ch-1'],
            templateIds: ['tpl-1', 'tpl-2'],
          }),
        },
      ]);
    });

    it('should return all scripts regardless of context', async () => {
      const scripts = await getAllCodeTemplateScriptsForChannel('ch-1');
      // Both templates are addToScripts types and channel is enabled
      expect(scripts).toHaveLength(2);
    });

    it('should skip DRAG_AND_DROP_CODE type templates', async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        {
          ID: 'tpl-drag',
          NAME: 'Drag',
          REVISION: 1,
          CODE_TEMPLATE: buildTemplateXml({
            id: 'tpl-drag',
            name: 'Drag',
            type: 'DRAG_AND_DROP_CODE',
            code: 'var x = 1;',
          }),
        },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-d',
          NAME: 'Lib D',
          REVISION: 1,
          LIBRARY: buildLibraryXml({
            id: 'lib-d',
            name: 'Lib D',
            enabledChannelIds: ['ch-1'],
            templateIds: ['tpl-drag'],
          }),
        },
      ]);
      clearCache();

      const scripts = await getAllCodeTemplateScriptsForChannel('ch-1');
      expect(scripts).toHaveLength(0);
    });

    it('should deduplicate templates referenced from multiple libraries', async () => {
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-1',
          NAME: 'Lib 1',
          REVISION: 1,
          LIBRARY: buildLibraryXml({
            id: 'lib-1',
            name: 'Lib 1',
            enabledChannelIds: ['ch-1'],
            templateIds: ['tpl-1'],
          }),
        },
        {
          ID: 'lib-2',
          NAME: 'Lib 2',
          REVISION: 1,
          LIBRARY: buildLibraryXml({
            id: 'lib-2',
            name: 'Lib 2',
            enabledChannelIds: ['ch-1'],
            templateIds: ['tpl-1'], // Same template in both libraries
          }),
        },
      ]);
      clearCache();

      const scripts = await getAllCodeTemplateScriptsForChannel('ch-1');
      // Should only appear once even though referenced from two libraries
      expect(scripts).toHaveLength(1);
    });

    it('should return empty for channel with no libraries', async () => {
      const scripts = await getAllCodeTemplateScriptsForChannel('ch-unknown');
      expect(scripts).toHaveLength(0);
    });

    it('should use library-embedded template when not in code template cache', async () => {
      // Library with embedded template that has code, but template not individually stored
      mockMirthDao.getCodeTemplates.mockResolvedValue([]); // No individual templates
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        {
          ID: 'lib-emb',
          NAME: 'Embedded Lib',
          REVISION: 1,
          LIBRARY: buildLibraryXml({
            id: 'lib-emb',
            name: 'Embedded Lib',
            enabledChannelIds: ['ch-1'],
            templateIds: ['tpl-emb'],
          }),
        },
      ]);
      clearCache();

      // The templateRef from deserialized library has empty code (skeleton),
      // so shouldAddToScripts will check type which defaults to FUNCTION (addToScripts=true)
      // but getCode will return ''
      const scripts = await getAllCodeTemplateScriptsForChannel('ch-1');
      // Template ref has type=FUNCTION (addToScripts) but empty code
      expect(scripts).toHaveLength(1);
      expect(scripts[0]).toBe(''); // empty code from skeleton
    });
  });

  // ===========================================
  // createDefaultLibrary / createDefaultCodeTemplate
  // ===========================================
  describe('factory methods', () => {
    it('createDefaultLibrary should return a library with given name', () => {
      const lib = createDefaultLibrary('My Library');
      expect(lib.name).toBe('My Library');
      expect(lib.id).toBeTruthy();
      expect(lib.revision).toBe(1);
      expect(lib.includeNewChannels).toBe(false);
      expect(lib.enabledChannelIds).toEqual([]);
      expect(lib.disabledChannelIds).toEqual([]);
      expect(lib.codeTemplates).toEqual([]);
    });

    it('createDefaultCodeTemplate should return a template with given name', () => {
      const tpl = createDefaultCodeTemplate('My Template');
      expect(tpl.name).toBe('My Template');
      expect(tpl.id).toBeTruthy();
      expect(tpl.revision).toBe(1);
      expect(tpl.properties.type).toBe(CodeTemplateType.FUNCTION);
      expect(tpl.properties.code).toContain('function new_function1');
    });
  });

  // ===========================================
  // Serialization edge cases (exercised via round-trip)
  // ===========================================
  describe('serialization round-trip', () => {
    it('should round-trip a code template through update and retrieval', async () => {
      const template: CodeTemplate = {
        id: 'tpl-rt',
        name: 'Round Trip',
        revision: 0,
        lastModified: new Date('2026-01-15'),
        contextSet: [ContextType.GLOBAL_DEPLOY, ContextType.CHANNEL_DEPLOY],
        properties: {
          type: CodeTemplateType.COMPILED_CODE,
          code: 'function roundTrip(a, b) { return a + b; }',
        },
      };

      await updateCodeTemplate('tpl-rt', template, false);

      // The serialization is called in updateCodeTemplate; verify the DAO was called with XML
      expect(mockMirthDao.upsertCodeTemplate).toHaveBeenCalledWith(
        'tpl-rt',
        'Round Trip',
        expect.stringContaining('<id>tpl-rt</id>'),
        1
      );

      // Verify the XML contains expected elements
      const xmlArg = mockMirthDao.upsertCodeTemplate.mock.calls[0][2];
      expect(xmlArg).toContain('<id>tpl-rt</id>');
      expect(xmlArg).toContain('<name>Round Trip</name>');
      expect(xmlArg).toContain('COMPILED_CODE');
      expect(xmlArg).toContain('function roundTrip');
    });

    it('should round-trip a library through update and retrieval', async () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-rt',
        name: 'Round Trip Lib',
        revision: 0,
        description: 'Test description',
        includeNewChannels: true,
        enabledChannelIds: ['ch-1', 'ch-2'],
        disabledChannelIds: ['ch-3'],
        codeTemplates: [
          { id: 'tpl-ref', name: '', contextSet: [], properties: { type: CodeTemplateType.FUNCTION, code: '' } },
        ],
      };

      await updateCodeTemplateLibraries([library], false);

      const xmlArg = mockMirthDao.upsertCodeTemplateLibrary.mock.calls[0][2];
      expect(xmlArg).toContain('<id>lib-rt</id>');
      expect(xmlArg).toContain('<name>Round Trip Lib</name>');
      expect(xmlArg).toContain('true'); // includeNewChannels
    });

    it('should handle template without lastModified in serialization', async () => {
      const template: CodeTemplate = {
        id: 'tpl-no-date',
        name: 'No Date',
        revision: 0,
        // lastModified intentionally undefined
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: '' },
      };

      // updateCodeTemplate sets lastModified, so the serialization branch for
      // missing lastModified in the source object is tested via serialization
      await updateCodeTemplate('tpl-no-date', template, false);
      expect(mockMirthDao.upsertCodeTemplate).toHaveBeenCalled();
    });
  });

  // ===========================================
  // Deserialization edge cases
  // ===========================================
  describe('deserialization edge cases', () => {
    it('should handle XML that throws during parsing', async () => {
      // Unclosed tags can cause parse errors depending on the parser config
      // fast-xml-parser is lenient; test the catch block differently
      // A template where code template root is missing triggers null return
      mockMirthDao.getCodeTemplates.mockResolvedValue([
        { ID: 'bad', NAME: 'Bad', REVISION: 1, CODE_TEMPLATE: '<notCodeTemplate></notCodeTemplate>' },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();
      const tpl = await getCodeTemplate('bad');
      expect(tpl).toBeNull();
    });

    it('should handle library XML with missing root', async () => {
      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'bad-lib', NAME: 'Bad', REVISION: 1, LIBRARY: '<notLibrary></notLibrary>' },
      ]);

      await initializeCache();
      const lib = await getCodeTemplateLibrary('bad-lib');
      expect(lib).toBeNull();
    });

    it('should handle library with empty enabledChannelIds', async () => {
      const xml = `<codeTemplateLibrary version="3.9.0">
        <id>lib-empty</id>
        <name>Empty</name>
        <enabledChannelIds></enabledChannelIds>
        <disabledChannelIds></disabledChannelIds>
        <codeTemplates></codeTemplates>
        <includeNewChannels>false</includeNewChannels>
      </codeTemplateLibrary>`;

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-empty', NAME: 'Empty', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();
      const lib = await getCodeTemplateLibrary('lib-empty');
      expect(lib).not.toBeNull();
      expect(lib!.enabledChannelIds).toEqual([]);
      expect(lib!.disabledChannelIds).toEqual([]);
      expect(lib!.codeTemplates).toEqual([]);
    });

    it('should parse library revision from string', async () => {
      const xml = buildLibraryXml({ id: 'lib-rev', name: 'Revision Test', revision: 7 });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-rev', NAME: 'Revision Test', REVISION: 7, LIBRARY: xml },
      ]);

      await initializeCache();
      const lib = await getCodeTemplateLibrary('lib-rev');
      expect(lib!.revision).toBe(7);
    });

    it('should default library revision to 1 when missing', async () => {
      const xml = `<codeTemplateLibrary version="3.9.0">
        <id>lib-norev</id>
        <name>No Revision</name>
        <includeNewChannels>false</includeNewChannels>
        <enabledChannelIds></enabledChannelIds>
        <disabledChannelIds></disabledChannelIds>
        <codeTemplates></codeTemplates>
      </codeTemplateLibrary>`;

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-norev', NAME: 'No Revision', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();
      const lib = await getCodeTemplateLibrary('lib-norev');
      // Revision not present in XML, so parseInt returns NaN, fallback to 1
      // But the controller overrides with row.REVISION anyway
      expect(lib!.revision).toBe(1);
    });

    it('should handle template with no lastModified field', async () => {
      const xml = `<codeTemplate version="3.9.0">
        <id>tpl-nolm</id>
        <name>No LastMod</name>
        <revision>1</revision>
        <contextSet><delegate></delegate></contextSet>
        <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties">
          <type>FUNCTION</type>
          <code>function x() {}</code>
        </properties>
      </codeTemplate>`;

      mockMirthDao.getCodeTemplates.mockResolvedValue([
        { ID: 'tpl-nolm', NAME: 'No LastMod', REVISION: 1, CODE_TEMPLATE: xml },
      ]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([]);

      await initializeCache();
      const tpl = await getCodeTemplate('tpl-nolm');
      expect(tpl!.lastModified).toBeUndefined();
    });

    it('should handle library with lastModified field', async () => {
      const xml = buildLibraryXml({ id: 'lib-lm', name: 'With LM' });

      mockMirthDao.getCodeTemplates.mockResolvedValue([]);
      mockMirthDao.getCodeTemplateLibraries.mockResolvedValue([
        { ID: 'lib-lm', NAME: 'With LM', REVISION: 1, LIBRARY: xml },
      ]);

      await initializeCache();
      const lib = await getCodeTemplateLibrary('lib-lm');
      expect(lib!.lastModified).toBeDefined();
      expect(lib!.lastModified).toBeInstanceOf(Date);
    });
  });
});
