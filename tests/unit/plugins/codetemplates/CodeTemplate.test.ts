import {
  CodeTemplate,
  CodeTemplateSummary,
  createCodeTemplate,
  getCode,
  shouldAddToScripts,
  appliesToContext,
  DEFAULT_CODE_TEMPLATE,
} from '../../../../src/plugins/codetemplates/models/CodeTemplate';
import { CodeTemplateType } from '../../../../src/plugins/codetemplates/models/CodeTemplateProperties';
import { ContextType } from '../../../../src/plugins/codetemplates/models/ContextType';

describe('CodeTemplate', () => {
  describe('createCodeTemplate', () => {
    it('should create template with default values', () => {
      const template = createCodeTemplate('Test Template');

      expect(template.id).toBeDefined();
      expect(template.id.length).toBe(36); // UUID format
      expect(template.name).toBe('Test Template');
      expect(template.revision).toBe(1);
      // Default context set is connector contexts (5 contexts)
      expect(template.contextSet.length).toBe(5);
      expect(template.contextSet).toContain(ContextType.SOURCE_FILTER_TRANSFORMER);
      expect(template.properties.type).toBe(CodeTemplateType.FUNCTION);
      // Default code is not empty
      expect(template.properties.code).toBe(DEFAULT_CODE_TEMPLATE);
    });

    it('should generate unique IDs', () => {
      const template1 = createCodeTemplate('Template 1');
      const template2 = createCodeTemplate('Template 2');

      expect(template1.id).not.toBe(template2.id);
    });
  });

  describe('getCode', () => {
    it('should return code from properties', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: 'function test() { return 42; }',
        },
      };

      expect(getCode(template)).toBe('function test() { return 42; }');
    });

    it('should return empty string for undefined code', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: '',
        },
      };

      expect(getCode(template)).toBe('');
    });
  });

  describe('shouldAddToScripts', () => {
    it('should return true for FUNCTION type', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: 'function test() {}',
        },
      };

      expect(shouldAddToScripts(template)).toBe(true);
    });

    it('should return true for COMPILED_CODE type', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.COMPILED_CODE,
          code: 'var x = 1;',
        },
      };

      expect(shouldAddToScripts(template)).toBe(true);
    });

    it('should return false for DRAG_AND_DROP_CODE type', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.DRAG_AND_DROP_CODE,
          code: 'msg.field = "value";',
        },
      };

      expect(shouldAddToScripts(template)).toBe(false);
    });

    it('should return true for FUNCTION type even with empty code', () => {
      // The implementation only checks the type, not the code content
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: '',
        },
      };

      expect(shouldAddToScripts(template)).toBe(true);
    });

    it('should return true for FUNCTION type even with whitespace-only code', () => {
      // The implementation only checks the type, not the code content
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: '   \n\t  ',
        },
      };

      expect(shouldAddToScripts(template)).toBe(true);
    });
  });

  describe('appliesToContext', () => {
    it('should return true when context is in contextSet', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [
          ContextType.SOURCE_FILTER_TRANSFORMER,
          ContextType.DESTINATION_FILTER_TRANSFORMER,
        ],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: 'function test() {}',
        },
      };

      expect(appliesToContext(template, ContextType.SOURCE_FILTER_TRANSFORMER)).toBe(true);
      expect(appliesToContext(template, ContextType.DESTINATION_FILTER_TRANSFORMER)).toBe(true);
    });

    it('should return false when context is not in contextSet', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [ContextType.SOURCE_FILTER_TRANSFORMER],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: 'function test() {}',
        },
      };

      expect(appliesToContext(template, ContextType.GLOBAL_DEPLOY)).toBe(false);
      expect(appliesToContext(template, ContextType.CHANNEL_PREPROCESSOR)).toBe(false);
    });

    it('should return false when contextSet is empty', () => {
      const template: CodeTemplate = {
        id: 'test-id',
        name: 'Test',
        contextSet: [],
        properties: {
          type: CodeTemplateType.FUNCTION,
          code: 'function test() {}',
        },
      };

      expect(appliesToContext(template, ContextType.SOURCE_FILTER_TRANSFORMER)).toBe(false);
      expect(appliesToContext(template, ContextType.GLOBAL_DEPLOY)).toBe(false);
    });
  });
});

describe('CodeTemplateSummary', () => {
  it('should have required properties', () => {
    const summary: CodeTemplateSummary = {
      id: 'test-id',
      name: 'Test Template',
      revision: 5,
      lastModified: new Date(),
    };

    expect(summary.id).toBe('test-id');
    expect(summary.name).toBe('Test Template');
    expect(summary.revision).toBe(5);
    expect(summary.lastModified).toBeDefined();
    expect(summary.deleted).toBeUndefined();
    expect(summary.codeTemplate).toBeUndefined();
  });

  it('should support deleted flag', () => {
    const summary: CodeTemplateSummary = {
      id: 'test-id',
      name: '',
      deleted: true,
    };

    expect(summary.deleted).toBe(true);
  });

  it('should support optional codeTemplate', () => {
    const template = createCodeTemplate('Test');
    const summary: CodeTemplateSummary = {
      id: template.id,
      name: template.name,
      revision: template.revision,
      codeTemplate: template,
    };

    expect(summary.codeTemplate).toBe(template);
  });
});
