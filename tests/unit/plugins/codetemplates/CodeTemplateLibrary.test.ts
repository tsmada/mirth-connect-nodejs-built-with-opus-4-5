import {
  CodeTemplateLibrary,
  CodeTemplateLibrarySaveResult,
  createCodeTemplateLibrary,
  isLibraryEnabledForChannel,
  getTemplatesForChannel,
} from '../../../../src/plugins/codetemplates/models/CodeTemplateLibrary';
import { createCodeTemplate } from '../../../../src/plugins/codetemplates/models/CodeTemplate';

describe('CodeTemplateLibrary', () => {
  describe('createCodeTemplateLibrary', () => {
    it('should create library with default values', () => {
      const library = createCodeTemplateLibrary('Test Library');

      expect(library.id).toBeDefined();
      expect(library.id.length).toBe(36); // UUID format
      expect(library.name).toBe('Test Library');
      expect(library.revision).toBe(1);
      // Default is false - libraries must explicitly enable channels
      expect(library.includeNewChannels).toBe(false);
      expect(library.enabledChannelIds).toEqual([]);
      expect(library.disabledChannelIds).toEqual([]);
      expect(library.codeTemplates).toEqual([]);
    });

    it('should generate unique IDs', () => {
      const lib1 = createCodeTemplateLibrary('Library 1');
      const lib2 = createCodeTemplateLibrary('Library 2');

      expect(lib1.id).not.toBe(lib2.id);
    });
  });

  describe('isLibraryEnabledForChannel', () => {
    it('should return true when includeNewChannels is true and channel not disabled', () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Test Library',
        includeNewChannels: true,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      expect(isLibraryEnabledForChannel(library, 'channel-1')).toBe(true);
      expect(isLibraryEnabledForChannel(library, 'channel-2')).toBe(true);
    });

    it('should return false when includeNewChannels is true but channel is disabled', () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Test Library',
        includeNewChannels: true,
        enabledChannelIds: [],
        disabledChannelIds: ['channel-1'],
        codeTemplates: [],
      };

      expect(isLibraryEnabledForChannel(library, 'channel-1')).toBe(false);
      expect(isLibraryEnabledForChannel(library, 'channel-2')).toBe(true);
    });

    it('should return false when includeNewChannels is false and channel not enabled', () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Test Library',
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      expect(isLibraryEnabledForChannel(library, 'channel-1')).toBe(false);
    });

    it('should return true when includeNewChannels is false but channel is enabled', () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Test Library',
        includeNewChannels: false,
        enabledChannelIds: ['channel-1', 'channel-2'],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      expect(isLibraryEnabledForChannel(library, 'channel-1')).toBe(true);
      expect(isLibraryEnabledForChannel(library, 'channel-2')).toBe(true);
      expect(isLibraryEnabledForChannel(library, 'channel-3')).toBe(false);
    });
  });

  describe('getTemplatesForChannel', () => {
    it('should return empty array when library is disabled for channel', () => {
      const template = createCodeTemplate('Test Template');
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Test Library',
        includeNewChannels: false,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [template],
      };

      const templates = getTemplatesForChannel(library, 'channel-1');
      expect(templates).toEqual([]);
    });

    it('should return all templates when library is enabled for channel', () => {
      const template1 = createCodeTemplate('Template 1');
      const template2 = createCodeTemplate('Template 2');
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Test Library',
        includeNewChannels: true,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [template1, template2],
      };

      const templates = getTemplatesForChannel(library, 'channel-1');
      expect(templates.length).toBe(2);
      expect(templates).toContain(template1);
      expect(templates).toContain(template2);
    });

    it('should return empty array when library has no templates', () => {
      const library: CodeTemplateLibrary = {
        id: 'lib-1',
        name: 'Test Library',
        includeNewChannels: true,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      const templates = getTemplatesForChannel(library, 'channel-1');
      expect(templates).toEqual([]);
    });
  });
});

describe('CodeTemplateLibrarySaveResult', () => {
  it('should have correct structure for successful save', () => {
    const result: CodeTemplateLibrarySaveResult = {
      librariesSuccess: true,
      codeTemplatesSuccess: true,
      overrideNeeded: false,
      updatedLibraries: [],
      updatedCodeTemplates: [],
    };

    expect(result.librariesSuccess).toBe(true);
    expect(result.codeTemplatesSuccess).toBe(true);
    expect(result.overrideNeeded).toBe(false);
  });

  it('should indicate override needed when conflict detected', () => {
    const result: CodeTemplateLibrarySaveResult = {
      librariesSuccess: false,
      codeTemplatesSuccess: false,
      overrideNeeded: true,
      updatedLibraries: [],
      updatedCodeTemplates: [],
    };

    expect(result.overrideNeeded).toBe(true);
    expect(result.librariesSuccess).toBe(false);
  });

  it('should include updated items', () => {
    const library = createCodeTemplateLibrary('Updated Library');
    const template = createCodeTemplate('Updated Template');

    const result: CodeTemplateLibrarySaveResult = {
      librariesSuccess: true,
      codeTemplatesSuccess: true,
      overrideNeeded: false,
      updatedLibraries: [library],
      updatedCodeTemplates: [template],
    };

    expect(result.updatedLibraries.length).toBe(1);
    expect(result.updatedCodeTemplates.length).toBe(1);
  });
});
