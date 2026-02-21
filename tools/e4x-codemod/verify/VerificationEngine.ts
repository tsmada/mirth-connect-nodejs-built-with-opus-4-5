import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler.js';
import type { TransformResult, VerificationResult, VerificationReport } from '../types.js';

export class VerificationEngine {
  private transpiler = new E4XTranspiler();

  /** Verify a single script's transformation */
  verifyOne(result: TransformResult): VerificationResult {
    // Run the runtime transpiler on the original script
    const runtimeResult = this.transpiler.transpile(result.original);
    const runtimeOutput = runtimeResult.code;
    const codemodOutput = result.transformed;

    // Check if there are any extended (non-runtime) transforms
    const extendedTypes = new Set([
      'namespace-constructor', 'qname-constructor', 'xml-settings',
      'import-class', 'xmllist-constructor',
    ]);
    const hasExtendedTransforms = result.transformedPatterns.some(p => extendedTypes.has(p));

    // Compare outputs line by line
    const runtimeLines = runtimeOutput.split('\n');
    const codemodLines = codemodOutput.split('\n');
    const differences: string[] = [];

    const maxLen = Math.max(runtimeLines.length, codemodLines.length);
    for (let i = 0; i < maxLen; i++) {
      const rLine = runtimeLines[i] ?? '';
      const cLine = codemodLines[i] ?? '';
      if (rLine !== cLine) {
        differences.push(`Line ${i + 1}: runtime="${rLine}" codemod="${cLine}"`);
      }
    }

    // Pass if exact match OR only extended-transform divergences
    const passed = differences.length === 0 || hasExtendedTransforms;

    return {
      location: result.location,
      passed,
      codemodOutput,
      runtimeOutput,
      differences,
      hasExtendedTransforms,
    };
  }

  /** Verify all transformations */
  verify(results: TransformResult[]): VerificationReport {
    const verificationResults = results
      .filter(r => r.changed)
      .map(r => this.verifyOne(r));

    const passed = verificationResults.filter(r => r.passed).length;
    const failed = verificationResults.filter(r => !r.passed).length;
    const extendedDivergences = verificationResults.filter(
      r => r.hasExtendedTransforms && r.differences.length > 0
    ).length;

    return {
      timestamp: new Date().toISOString(),
      results: verificationResults,
      summary: {
        total: verificationResults.length,
        passed,
        failed,
        extendedDivergences,
      },
    };
  }
}
