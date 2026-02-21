import * as vm from 'vm';
import { ScriptBuilder, SerializationType } from '../../../../src/javascript/runtime/ScriptBuilder';

/**
 * Tests auto-serialization edge cases by generating scripts with ScriptBuilder
 * and executing them in a minimal VM context.
 *
 * We construct a minimal scope inline rather than using ScopeBuilder/ConnectorMessage
 * because the auto-serialization code operates on primitive scope variables (msg, tmp)
 * and does not depend on the full Mirth runtime.
 */
describe('Auto-serialization adversarial', () => {
  let scriptBuilder: ScriptBuilder;

  beforeEach(() => {
    scriptBuilder = new ScriptBuilder({ transpileE4X: false });
  });

  /**
   * Build a minimal scope and execute a transformer script, returning the result.
   * The generated filter/transformer script sets up msg from connectorMessage,
   * runs filter (accept all) + transformer steps, then auto-serializes.
   */
  function executeTransformer(userScript: string, rawContent: string = '<root/>') {
    // Generate a filter/transformer script with one user step
    const generated = scriptBuilder.generateFilterTransformerScript(
      [], // no filter rules — accepts all
      [{ name: 'step', script: userScript, enabled: true }],
      SerializationType.RAW,
      SerializationType.RAW,
      false // no template
    );

    // Build a minimal scope that satisfies the generated script's requirements
    const scope: Record<string, unknown> = {
      // Map-like objects for $c, $s, $g, etc.
      connectorMap: { get: () => undefined, put: () => undefined, containsKey: () => false },
      channelMap: { get: () => undefined, put: () => undefined, containsKey: () => false },
      sourceMap: { get: () => undefined, put: () => undefined, containsKey: () => false },
      globalChannelMap: { get: () => undefined, put: () => undefined, containsKey: () => false },
      globalMap: { get: () => undefined, put: () => undefined, containsKey: () => false },
      configurationMap: { get: () => undefined, put: () => undefined, containsKey: () => false },
      responseMap: { get: () => undefined, put: () => undefined, containsKey: () => false },
      secretsMap: { get: () => undefined },
      // ConnectorMessage mock
      connectorMessage: {
        getTransformedData: () => rawContent,
        getProcessedRawData: () => rawContent,
        getRawData: () => rawContent,
      },
      // Logger mock
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      // Phase tracking
      phase: [''],
      // AttachmentUtil mock
      AttachmentUtil: undefined,
      // XMLProxy mock (for toXMLString detection)
      XMLProxy: { create: (s: string) => s },
    };

    const context = vm.createContext(scope);
    try {
      const compiled = new vm.Script(generated, { filename: 'test-transformer.js' });
      compiled.runInContext(context, { timeout: 5000 });
      return { success: true, msg: scope.msg };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  it('should provide context for circular reference errors', () => {
    const result = executeTransformer('msg = {}; msg.self = msg;');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('auto-serialization error');
    expect(result.error?.message).toContain('circular');
  });

  it('should handle very large message (1MB string) without OOM', () => {
    const result = executeTransformer("msg = 'x'.repeat(1024 * 1024);");
    expect(result.success).toBe(true);
  });

  it('should handle msg = undefined gracefully', () => {
    const result = executeTransformer('msg = undefined;');
    expect(result.success).toBe(true);
  });

  it('should handle msg = null gracefully', () => {
    const result = executeTransformer('msg = null;');
    expect(result.success).toBe(true);
  });

  it('should serialize numeric msg correctly', () => {
    const result = executeTransformer('msg = 42;');
    expect(result.success).toBe(true);
    // Numeric msg should remain as-is (not serialized by JSON.stringify,
    // just kept as the number since it's a primitive)
  });

  it('should provide context for array with circular reference', () => {
    const result = executeTransformer('msg = []; msg.push(msg);');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('auto-serialization error');
  });
});
