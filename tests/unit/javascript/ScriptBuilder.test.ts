import {
  ScriptBuilder,
  SerializationType,
  FilterRule,
  TransformerStep,
  createScriptBuilder,
  scriptBuilder,
} from '../../../src/javascript/runtime/ScriptBuilder';

describe('ScriptBuilder', () => {
  let builder: ScriptBuilder;

  beforeEach(() => {
    builder = new ScriptBuilder();
  });

  describe('generateGlobalSealedScript', () => {
    it('should include String.prototype.trim polyfill', () => {
      const script = builder.generateGlobalSealedScript();
      expect(script).toContain('String.prototype.trim');
    });

    it('should set up XML alias', () => {
      const script = builder.generateGlobalSealedScript();
      expect(script).toContain('const XML = XMLProxy');
    });
  });

  describe('generateScript', () => {
    it('should wrap user script in doScript function', () => {
      const userScript = 'logger.info("Hello");';
      const script = builder.generateScript(userScript);

      expect(script).toContain('function doScript()');
      expect(script).toContain('doScript();');
      expect(script).toContain('logger.info("Hello")');
    });

    it('should include map functions', () => {
      const script = builder.generateScript('// test');

      expect(script).toContain('function $c(key, value)');
      expect(script).toContain('function $s(key, value)');
      expect(script).toContain('function $g(key, value)');
      expect(script).toContain('function $gc(key, value)');
      expect(script).toContain('function $co(key, value)');
      expect(script).toContain('function $r(key, value)');
      expect(script).toContain('function $cfg(key, value)');
    });

    it('should include validate function', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function validate(');
    });

    it('should include $ shortcut function', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function $(string)');
    });

    it('should transpile E4X syntax', () => {
      const userScript = 'for each (var seg in msg.children()) { }';
      const script = builder.generateScript(userScript);

      expect(script).toContain('for (const seg of msg.children())');
      expect(script).not.toContain('for each');
    });

    it('should include code templates if provided', () => {
      const builderWithTemplates = new ScriptBuilder({
        codeTemplates: ['function helper() { return 42; }'],
      });

      const script = builderWithTemplates.generateScript('helper();');
      expect(script).toContain('function helper()');
    });
  });

  describe('generateFilterTransformerScript', () => {
    const filterRules: FilterRule[] = [
      { name: 'Rule 1', script: 'return msg.MSH != null;', operator: 'AND', enabled: true },
    ];

    const transformerSteps: TransformerStep[] = [
      { name: 'Step 1', script: 'tmp.PID = msg.PID;', enabled: true },
    ];

    it('should initialize msg for XML type', () => {
      const script = builder.generateFilterTransformerScript(
        filterRules,
        transformerSteps,
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      expect(script).toContain('XMLProxy.create(connectorMessage.getTransformedData())');
    });

    it('should initialize msg for JSON type', () => {
      const script = builder.generateFilterTransformerScript(
        filterRules,
        transformerSteps,
        SerializationType.JSON,
        SerializationType.JSON,
        true
      );

      expect(script).toContain('JSON.parse(connectorMessage.getTransformedData())');
    });

    it('should initialize msg for RAW type', () => {
      const script = builder.generateFilterTransformerScript(
        filterRules,
        transformerSteps,
        SerializationType.RAW,
        SerializationType.RAW,
        false
      );

      expect(script).toContain('connectorMessage.getProcessedRawData()');
    });

    it('should generate doFilter function', () => {
      const script = builder.generateFilterTransformerScript(
        filterRules,
        transformerSteps,
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      expect(script).toContain('function doFilter()');
      expect(script).toContain('function filterRule1()');
    });

    it('should generate doTransform function', () => {
      const script = builder.generateFilterTransformerScript(
        filterRules,
        transformerSteps,
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      expect(script).toContain('function doTransform()');
      expect(script).toContain('function transformStep1()');
    });

    it('should execute filter then transform', () => {
      const script = builder.generateFilterTransformerScript(
        filterRules,
        transformerSteps,
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      expect(script).toContain('if (doFilter() == true)');
      expect(script).toContain('doTransform();');
      expect(script).toContain('return true;');
      expect(script).toContain('return false;');
    });

    it('should accept all when no filter rules', () => {
      const script = builder.generateFilterTransformerScript(
        [],
        transformerSteps,
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      expect(script).toContain('function doFilter() { phase[0] = "filter"; return true; }');
    });

    it('should combine multiple filter rules with operators', () => {
      const multipleRules: FilterRule[] = [
        { name: 'Rule 1', script: 'return true;', operator: 'AND', enabled: true },
        { name: 'Rule 2', script: 'return true;', operator: 'AND', enabled: true },
        { name: 'Rule 3', script: 'return true;', operator: 'OR', enabled: true },
      ];

      const script = builder.generateFilterTransformerScript(
        multipleRules,
        [],
        SerializationType.XML,
        SerializationType.XML,
        false
      );

      expect(script).toContain('filterRule1()');
      expect(script).toContain('&& filterRule2()');
      expect(script).toContain('|| filterRule3()');
    });

    it('should skip disabled rules and steps', () => {
      const rules: FilterRule[] = [
        { name: 'Rule 1', script: 'return true;', operator: 'AND', enabled: true },
        { name: 'Rule 2', script: 'return false;', operator: 'AND', enabled: false },
      ];

      const steps: TransformerStep[] = [
        { name: 'Step 1', script: 'tmp = msg;', enabled: true },
        { name: 'Step 2', script: 'tmp = null;', enabled: false },
      ];

      const script = builder.generateFilterTransformerScript(
        rules,
        steps,
        SerializationType.XML,
        SerializationType.XML,
        true
      );

      expect(script).toContain('filterRule1()');
      expect(script).not.toContain('filterRule2()');
      expect(script).toContain('transformStep1()');
      expect(script).not.toContain('transformStep2()');
    });
  });

  describe('generatePreprocessorScript', () => {
    it('should wrap script in doPreprocess function', () => {
      const script = builder.generatePreprocessorScript('return message.replace("a", "b");');

      expect(script).toContain('function doPreprocess()');
      expect(script).toContain('message = doPreprocess() || message;');
    });

    it('should transpile E4X syntax', () => {
      const script = builder.generatePreprocessorScript('for each (var x in list) {}');
      expect(script).toContain('for (const x of list)');
    });
  });

  describe('generatePostprocessorScript', () => {
    it('should wrap script in doPostprocess function', () => {
      const script = builder.generatePostprocessorScript('logger.info("Done");');

      expect(script).toContain('function doPostprocess()');
      expect(script).toContain('doPostprocess();');
    });
  });

  describe('generateDeployScript', () => {
    it('should wrap script in doDeploy function', () => {
      const script = builder.generateDeployScript('globalMap.put("deployed", true);');

      expect(script).toContain('function doDeploy()');
      expect(script).toContain('doDeploy();');
    });

    it('should include limited map functions', () => {
      const script = builder.generateDeployScript('// deploy');

      expect(script).toContain('function $g(');
      expect(script).toContain('function $gc(');
      expect(script).toContain('function $cfg(');
      expect(script).not.toContain('function $c(');
      expect(script).not.toContain('function $s(');
    });
  });

  describe('generateUndeployScript', () => {
    it('should wrap script in doUndeploy function', () => {
      const script = builder.generateUndeployScript('globalMap.remove("deployed");');

      expect(script).toContain('function doUndeploy()');
      expect(script).toContain('doUndeploy();');
    });
  });

  describe('E4X transpilation option', () => {
    it('should transpile when enabled (default)', () => {
      const builderEnabled = new ScriptBuilder({ transpileE4X: true });
      const script = builderEnabled.generateScript('msg..OBX');
      expect(script).toContain("msg.descendants('OBX')");
    });

    it('should not transpile when disabled', () => {
      const builderDisabled = new ScriptBuilder({ transpileE4X: false });
      const script = builderDisabled.generateScript('msg..OBX');
      expect(script).toContain('msg..OBX');
    });
  });

  describe('createScriptBuilder', () => {
    it('should create a ScriptBuilder with options', () => {
      const builder = createScriptBuilder({ transpileE4X: false });
      expect(builder).toBeInstanceOf(ScriptBuilder);

      const script = builder.generateScript('msg..OBX');
      expect(script).toContain('msg..OBX');
    });
  });

  describe('scriptBuilder singleton', () => {
    it('should be a ScriptBuilder instance', () => {
      expect(scriptBuilder).toBeInstanceOf(ScriptBuilder);
    });

    it('should generate scripts', () => {
      const script = scriptBuilder.generateScript('return true;');
      expect(script).toContain('doScript()');
    });
  });

  describe('helper functions', () => {
    it('should include createSegment helper', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function createSegment(');
    });

    it('should include logger shortcuts', () => {
      const script = builder.generateScript('// test');
      expect(script).toContain('function debug(message)');
      expect(script).toContain('function info(message)');
      expect(script).toContain('function warn(message)');
      expect(script).toContain('function error(message)');
    });
  });
});
