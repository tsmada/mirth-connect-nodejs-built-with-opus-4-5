import { VerificationEngine } from '../verify/VerificationEngine.js';
import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler.js';
import type { TransformResult, ScriptLocation } from '../types.js';

function makeLocation(overrides: Partial<ScriptLocation> = {}): ScriptLocation {
  return {
    channelName: 'Test Channel',
    connectorName: 'Source',
    scriptType: 'transformer',
    filePath: '/test/transformer.js',
    ...overrides,
  };
}

function makeResult(original: string, transformed: string, overrides: Partial<TransformResult> = {}): TransformResult {
  return {
    location: makeLocation(),
    original,
    transformed,
    changed: true,
    transformedPatterns: [],
    warnings: [],
    untransformablePatterns: [],
    ...overrides,
  };
}

describe('VerificationEngine', () => {
  const engine = new VerificationEngine();
  const transpiler = new E4XTranspiler();

  it('passes when codemod output matches runtime transpiler', () => {
    const original = 'var pid = msg..PID;\nvar mrn = pid.toString();';
    const runtimeOutput = transpiler.transpile(original).code;

    const result = makeResult(original, runtimeOutput, {
      transformedPatterns: ['descendant-access'],
    });

    const verification = engine.verifyOne(result);
    expect(verification.passed).toBe(true);
    expect(verification.differences).toHaveLength(0);
    expect(verification.hasExtendedTransforms).toBe(false);
  });

  it('detects mismatches between codemod and runtime output', () => {
    const original = 'var pid = msg..PID;';
    // Deliberately wrong transformation
    const wrongTransform = 'var pid = msg.get("PID");';

    const result = makeResult(original, wrongTransform, {
      transformedPatterns: ['descendant-access'],
    });

    const verification = engine.verifyOne(result);
    expect(verification.passed).toBe(false);
    expect(verification.differences.length).toBeGreaterThan(0);
    expect(verification.differences[0]).toContain('Line 1');
  });

  it('flags expected divergences for extended transforms', () => {
    const original = 'var ns = new Namespace("urn:hl7-org:v3");\nvar pid = msg..PID;';
    // Extended transform changes Namespace constructor, plus runtime-handled descendant
    const runtimeOutput = transpiler.transpile(original).code;
    const codemodOutput = runtimeOutput.replace(
      'new Namespace("urn:hl7-org:v3")',
      'XMLProxy.createNamespace("urn:hl7-org:v3")'
    );

    const result = makeResult(original, codemodOutput, {
      transformedPatterns: ['namespace-constructor', 'descendant-access'],
    });

    const verification = engine.verifyOne(result);
    // Passes because extended transforms are expected to diverge
    expect(verification.passed).toBe(true);
    expect(verification.hasExtendedTransforms).toBe(true);
    expect(verification.differences.length).toBeGreaterThan(0);
  });

  it('produces correct summary in verification report', () => {
    const original1 = 'var pid = msg..PID;';
    const runtime1 = transpiler.transpile(original1).code;
    const result1 = makeResult(original1, runtime1, {
      transformedPatterns: ['descendant-access'],
    });

    const original2 = 'var version = msg.@version;';
    const result2 = makeResult(original2, 'var version = msg.get("WRONG");', {
      transformedPatterns: ['attribute-read'],
    });

    const original3 = 'var ns = new Namespace("uri");\nvar x = msg..PID;';
    const runtime3 = transpiler.transpile(original3).code;
    const codemodOutput3 = runtime3.replace('new Namespace("uri")', 'createNs("uri")');
    const result3 = makeResult(original3, codemodOutput3, {
      transformedPatterns: ['namespace-constructor', 'descendant-access'],
    });

    const report = engine.verify([result1, result2, result3]);

    expect(report.summary.total).toBe(3);
    expect(report.summary.passed).toBe(2); // result1 exact match, result3 extended divergence
    expect(report.summary.failed).toBe(1); // result2 wrong output
    expect(report.summary.extendedDivergences).toBe(1); // result3
    expect(report.timestamp).toBeDefined();
  });

  it('skips unchanged results', () => {
    const result = makeResult('var x = 1;', 'var x = 1;', { changed: false });
    const report = engine.verify([result]);
    expect(report.summary.total).toBe(0);
  });
});
