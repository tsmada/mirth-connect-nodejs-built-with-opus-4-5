/**
 * Script Transformer
 *
 * Orchestrates the transformation pipeline for a single script:
 * 1. ExtendedTransforms — handles deferred patterns the runtime skips
 * 2. E4XTranspiler — handles the 23+ runtime patterns
 * 3. E4XDetector — identifies any remaining untransformable patterns
 */

import { E4XTranspiler } from '../../../src/javascript/e4x/E4XTranspiler.js';
import { ExtendedTransforms } from './ExtendedTransforms.js';
import { E4XDetector } from './E4XDetector.js';
import type { TransformResult, ScriptLocation, TransformWarning, E4XPatternType } from '../types.js';

export class ScriptTransformer {
  private transpiler = new E4XTranspiler();
  private extendedTransforms = new ExtendedTransforms();
  private detector = new E4XDetector();

  /**
   * Transform a single script through the full pipeline.
   *
   * 1. Apply ExtendedTransforms (deferred patterns: Namespace, QName, XML settings, importClass)
   * 2. Apply E4XTranspiler.transpile() (runtime patterns: descendants, attributes, for-each, etc.)
   * 3. Detect any remaining patterns that couldn't be transformed
   *
   * @param source - The original script source code
   * @param location - Where the script lives (channel, connector, script type)
   * @returns TransformResult with original, transformed, warnings, and untransformable patterns
   */
  transform(source: string, location: ScriptLocation): TransformResult {
    const transformedPatterns: E4XPatternType[] = [];
    const warnings: TransformWarning[] = [];

    // Quick check — if no E4X at all, pass through unchanged
    if (!this.detector.hasE4X(source)) {
      return {
        location,
        original: source,
        transformed: source,
        changed: false,
        transformedPatterns: [],
        warnings: [],
        untransformablePatterns: [],
      };
    }

    // Detect patterns before transformation (for reporting)
    const patternsBefore = this.detector.detect(source);

    // Phase 1: Extended transforms (deferred patterns)
    const extResult = this.extendedTransforms.transform(source);
    let code = extResult.code;

    for (const name of extResult.applied) {
      transformedPatterns.push(name as E4XPatternType);
    }
    warnings.push(...extResult.warnings);

    // Phase 2: Runtime transpiler (23+ patterns)
    const transpileResult = this.transpiler.transpile(code);
    code = transpileResult.code;

    // Map transpiler warnings to our format
    for (const w of transpileResult.warnings) {
      warnings.push({
        line: w.line,
        message: w.message,
        severity: 'warn',
      });
    }

    // Determine which runtime pattern types were present and thus transformed
    const runtimePatternTypes = new Set(
      patternsBefore
        .filter(p => p.runtimeHandled)
        .map(p => p.type)
    );
    for (const t of runtimePatternTypes) {
      if (!transformedPatterns.includes(t)) {
        transformedPatterns.push(t);
      }
    }

    // Phase 3: Detect remaining untransformable patterns
    const patternsAfter = this.detector.detect(code);
    const untransformablePatterns = patternsAfter.filter(p => !p.runtimeHandled);

    const changed = source !== code;

    return {
      location,
      original: source,
      transformed: code,
      changed,
      transformedPatterns,
      warnings,
      untransformablePatterns,
    };
  }
}
