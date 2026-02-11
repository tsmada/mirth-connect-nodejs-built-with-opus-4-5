/**
 * Wave 12 parity tests for ScriptBuilder — filter rule == true, attachment functions,
 * code templates in all script generators.
 */
import {
  ScriptBuilder,
  SerializationType,
} from '../../../src/javascript/runtime/ScriptBuilder';

describe('ScriptBuilder Wave 12 Parity Fixes', () => {
  describe('JRC-SBD-009 — Filter rule == true wrapping', () => {
    it('should wrap filter rules with == true', () => {
      const builder = new ScriptBuilder();
      const script = builder.generateFilterTransformerScript(
        [{ name: 'Rule 1', script: 'return true;', operator: 'AND', enabled: true }],
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      // Java: builder.append(operator + "(filterRule" + iter.nextIndex() + "() == true)")
      expect(script).toContain('(filterRule1() == true)');
    });

    it('should wrap multiple filter rules with == true and operators', () => {
      const builder = new ScriptBuilder();
      const script = builder.generateFilterTransformerScript(
        [
          { name: 'Rule 1', script: 'return true;', operator: 'AND', enabled: true },
          { name: 'Rule 2', script: 'return false;', operator: 'AND', enabled: true },
          { name: 'Rule 3', script: 'return "yes";', operator: 'OR', enabled: true },
        ],
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      expect(script).toContain('(filterRule1() == true)');
      expect(script).toContain('&& (filterRule2() == true)');
      expect(script).toContain('|| (filterRule3() == true)');
    });

    it('should reject truthy non-boolean filter results via == true', () => {
      // "accept" == true evaluates to false in JavaScript (loose equality)
      // This matches Java where "accept".equals(Boolean.TRUE) is false
      expect('accept' == true as any).toBe(false);
      expect(1 == true as any).toBe(true);
      expect(0 == true as any).toBe(false);
    });
  });

  describe('JRC-SBD-010 — Attachment functions in filter/transformer scripts', () => {
    it('should include getAttachments in filter/transformer script', () => {
      const builder = new ScriptBuilder();
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('function addAttachment(');
      expect(script).toContain('function getAttachmentIds(');
      expect(script).toContain('function getAttachment()');
      expect(script).toContain('function updateAttachment()');
    });

    it('should include getAttachments in response transformer script', () => {
      const builder = new ScriptBuilder();
      const script = builder.generateResponseTransformerScript(
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      expect(script).toContain('function getAttachments(');
      expect(script).toContain('function addAttachment(');
      expect(script).toContain('function getAttachmentIds(');
    });

    it('should include getAttachments in preprocessor script', () => {
      const builder = new ScriptBuilder();
      const script = builder.generatePreprocessorScript('// test');
      expect(script).toContain('function getAttachments(');
    });

    it('should include getAttachments in postprocessor script', () => {
      const builder = new ScriptBuilder();
      const script = builder.generatePostprocessorScript('// test');
      expect(script).toContain('function getAttachments(');
    });

    it('should include getAttachments in deploy script', () => {
      const builder = new ScriptBuilder();
      const script = builder.generateDeployScript('// test');
      expect(script).toContain('function getAttachments(');
    });

    it('should include getAttachments in general script', () => {
      const builder = new ScriptBuilder();
      const script = builder.generateScript('// test');
      expect(script).toContain('function getAttachments(');
    });
  });

  describe('JRC-SBD-011 — Code templates in all script generators', () => {
    const codeTemplates = [
      'function myHelper() { return "helper"; }',
      'function anotherHelper() { return 42; }',
    ];

    it('should include code templates in filter/transformer script', () => {
      const builder = new ScriptBuilder({ codeTemplates });
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      expect(script).toContain('function myHelper()');
      expect(script).toContain('function anotherHelper()');
    });

    it('should include code templates in response transformer script', () => {
      const builder = new ScriptBuilder({ codeTemplates });
      const script = builder.generateResponseTransformerScript(
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      expect(script).toContain('function myHelper()');
      expect(script).toContain('function anotherHelper()');
    });

    it('should include code templates in preprocessor script', () => {
      const builder = new ScriptBuilder({ codeTemplates });
      const script = builder.generatePreprocessorScript('// test');
      expect(script).toContain('function myHelper()');
      expect(script).toContain('function anotherHelper()');
    });

    it('should include code templates in postprocessor script', () => {
      const builder = new ScriptBuilder({ codeTemplates });
      const script = builder.generatePostprocessorScript('// test');
      expect(script).toContain('function myHelper()');
      expect(script).toContain('function anotherHelper()');
    });

    it('should include code templates in deploy script', () => {
      const builder = new ScriptBuilder({ codeTemplates });
      const script = builder.generateDeployScript('// test');
      expect(script).toContain('function myHelper()');
    });

    it('should include code templates in undeploy script', () => {
      const builder = new ScriptBuilder({ codeTemplates });
      const script = builder.generateUndeployScript('// test');
      expect(script).toContain('function myHelper()');
    });

    it('should include code templates in general script', () => {
      const builder = new ScriptBuilder({ codeTemplates });
      const script = builder.generateScript('// test');
      expect(script).toContain('function myHelper()');
    });

    it('should not include code templates when none provided', () => {
      const builder = new ScriptBuilder();
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      expect(script).not.toContain('myHelper');
    });

    it('should transpile E4X in code templates', () => {
      const builder = new ScriptBuilder({
        codeTemplates: ['var x = <root><child/></root>;'],
      });
      const script = builder.generateFilterTransformerScript(
        [],
        [],
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );
      // E4X should be transpiled to XMLProxy.create()
      expect(script).toContain('XMLProxy.create');
      expect(script).not.toContain('var x = <root>');
    });
  });
});
