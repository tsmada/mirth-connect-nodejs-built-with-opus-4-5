/**
 * E4X Pattern Detector
 *
 * Identifies E4X syntax patterns in Mirth Connect scripts.
 * Each pattern is classified as runtime-handled (E4XTranspiler covers it)
 * or extended (codemod must handle it).
 */

import type { E4XPattern, E4XPatternType, PatternConfidence } from '../types.js';

interface PatternRule {
  type: E4XPatternType;
  regex: RegExp;
  confidence: PatternConfidence;
  runtimeHandled: boolean;
}

export class E4XDetector {
  /**
   * Pattern rules ordered from most-specific to least-specific.
   * Each regex is designed to run against individual lines.
   */
  private static readonly PATTERN_RULES: PatternRule[] = [
    // Runtime-handled (E4XTranspiler covers these)
    { type: 'default-namespace', regex: /default\s+xml\s+namespace\s*=/, confidence: 'definite', runtimeHandled: true },
    { type: 'for-each', regex: /for\s+each\s*\(/, confidence: 'definite', runtimeHandled: true },
    { type: 'xml-constructor', regex: /(?<![.\w])new\s+XML\s*\(/, confidence: 'definite', runtimeHandled: true },
    { type: 'descendant-access', regex: /\w+\.\.[A-Z]\w*/, confidence: 'definite', runtimeHandled: true },
    { type: 'attribute-write', regex: /\.@\w+\s*=\s*(?!=)/, confidence: 'definite', runtimeHandled: true },
    { type: 'attribute-read', regex: /\.@\w+/, confidence: 'definite', runtimeHandled: true },
    { type: 'wildcard-attribute', regex: /\.@\*/, confidence: 'definite', runtimeHandled: true },
    { type: 'wildcard-element', regex: /(\w)\.\*(?![*\w])/, confidence: 'likely', runtimeHandled: true },
    { type: 'filter-predicate', regex: /\.\w+\.\(/, confidence: 'likely', runtimeHandled: true },
    { type: 'delete-property', regex: /delete\s+\w+(?:\.\w+)+/, confidence: 'definite', runtimeHandled: true },
    { type: 'xml-append', regex: /\w+\s*\+=\s*<[a-zA-Z]/, confidence: 'likely', runtimeHandled: true },
    { type: 'xml-literal', regex: /<[a-zA-Z][\w.-]*(?:\s+[\w.-]+\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))*\s*\/?>/, confidence: 'likely', runtimeHandled: true },

    // Extended transforms (codemod handles)
    { type: 'namespace-constructor', regex: /new\s+Namespace\s*\(/, confidence: 'definite', runtimeHandled: false },
    { type: 'qname-constructor', regex: /new\s+QName\s*\(/, confidence: 'definite', runtimeHandled: false },
    { type: 'xml-settings', regex: /XML\.(ignoreWhitespace|ignoreComments|prettyPrinting)\s*=/, confidence: 'definite', runtimeHandled: false },
    { type: 'import-class', regex: /importClass\s*\(/, confidence: 'definite', runtimeHandled: false },
    { type: 'xmllist-constructor', regex: /(?<![.\w])new\s+XMLList\s*\(/, confidence: 'definite', runtimeHandled: false },
  ];

  /**
   * Quick check -- does this script contain any E4X syntax?
   * Uses a few definitive patterns for fast short-circuit without full analysis.
   */
  hasE4X(source: string): boolean {
    // Fast checks for unambiguous E4X markers
    if (/\w+\.\.[A-Z]\w*/.test(source)) return true;        // descendant ..
    if (/for\s+each\s*\(/.test(source)) return true;          // for each
    if (/(?<![.\w])new\s+XML\s*\(/.test(source)) return true; // new XML(
    if (/\.@\w+/.test(source)) return true;                    // .@attr
    if (/default\s+xml\s+namespace/.test(source)) return true; // default xml namespace
    if (/new\s+Namespace\s*\(/.test(source)) return true;      // new Namespace(
    if (/new\s+QName\s*\(/.test(source)) return true;          // new QName(
    if (/importClass\s*\(/.test(source)) return true;          // importClass(
    if (/XML\.(ignoreWhitespace|ignoreComments|prettyPrinting)\s*=/.test(source)) return true;
    return false;
  }

  /**
   * Detect all E4X patterns with locations.
   * Returns pattern objects with line number, column, match text, confidence, and runtimeHandled flag.
   */
  detect(source: string): E4XPattern[] {
    const patterns: E4XPattern[] = [];
    const lines = source.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;

      for (const rule of E4XDetector.PATTERN_RULES) {
        // Reset regex state for each line
        const regex = new RegExp(rule.regex.source, rule.regex.flags.replace('g', '') + 'g');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(line)) !== null) {
          const column = match.index;

          // Skip matches inside strings or comments
          if (this.isInsideStringOrComment(source, lineIdx, column)) {
            continue;
          }

          // For xml-literal, make sure we aren't matching a comparison operator
          if (rule.type === 'xml-literal') {
            if (this.looksLikeComparison(line, column)) {
              continue;
            }
          }

          // For wildcard-element, make sure we aren't matching multiplication
          if (rule.type === 'wildcard-element') {
            if (this.looksLikeMultiplication(line, column, match[0])) {
              continue;
            }
          }

          // Avoid duplicate detections at the same location
          const alreadyDetected = patterns.some(
            p => p.line === lineIdx + 1 && p.column === column && p.type === rule.type
          );
          if (alreadyDetected) continue;

          patterns.push({
            type: rule.type,
            line: lineIdx + 1,
            column,
            match: match[0],
            confidence: rule.confidence,
            runtimeHandled: rule.runtimeHandled,
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Check if a position within a specific line is inside a string literal or comment.
   * Converts (lineIdx, col) to a flat offset and scans from the start of source.
   */
  private isInsideStringOrComment(source: string, targetLineIdx: number, targetCol: number): boolean {
    // Convert line/col to flat offset
    const lines = source.split('\n');
    let flatOffset = 0;
    for (let i = 0; i < targetLineIdx; i++) {
      flatOffset += lines[i]!.length + 1; // +1 for \n
    }
    flatOffset += targetCol;

    return this.isInsideStringOrCommentFlat(source, flatOffset);
  }

  /**
   * Check if a flat character offset is inside a string, comment, or regex.
   */
  private isInsideStringOrCommentFlat(code: string, position: number): boolean {
    let inString: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = 0; i < position; i++) {
      const ch = code[i]!;
      const nextCh = i + 1 < code.length ? code[i + 1] : '';

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && nextCh === '/') {
          inBlockComment = false;
          i++; // skip /
        }
        continue;
      }

      if (escaped) {
        escaped = false;
        continue;
      }

      if (inString !== null) {
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }

      // Not inside anything — check for starts
      if (ch === '/' && nextCh === '/') {
        inLineComment = true;
        i++; // skip second /
        continue;
      }

      if (ch === '/' && nextCh === '*') {
        inBlockComment = true;
        i++; // skip *
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        continue;
      }
    }

    return inString !== null || inLineComment || inBlockComment;
  }

  /**
   * Heuristic: does the `<` at this position look like a comparison operator
   * rather than an XML tag open?
   */
  private looksLikeComparison(line: string, index: number): boolean {
    // Look at what's before the <
    const before = line.slice(0, index).trimEnd();
    // If preceded by a word character or ) or ], it's likely a comparison
    if (before.length > 0) {
      const lastChar = before[before.length - 1]!;
      if (/[\w)\].]/.test(lastChar)) {
        // Could be comparison like `x < tag` or could be XML assignment like `var x = <tag>`
        // Check if there's an = or other assignment/expression operator before
        const trimmed = before.trimEnd();
        // If preceded by a comparison-like context (no = sign), likely comparison
        if (/[<>!=]=?\s*$/.test(trimmed)) return true;
        // If preceded by a variable name with space, could be comparison
        if (/\w\s+$/.test(before) && !/=\s*$/.test(before) && !/return\s+$/.test(before)) return true;
      }
    }
    return false;
  }

  /**
   * Heuristic: does `.*` at this position look like multiplication?
   */
  private looksLikeMultiplication(line: string, _index: number, match: string): boolean {
    // The regex capture group should have a word char before the dot
    // Check if followed by a digit or word (multiplication context)
    const afterMatch = line.slice(_index + match.length);
    if (/^\s*\d/.test(afterMatch)) return true;
    return false;
  }
}
