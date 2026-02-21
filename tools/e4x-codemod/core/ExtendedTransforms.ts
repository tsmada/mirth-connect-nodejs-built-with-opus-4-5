/**
 * Extended E4X Transforms
 *
 * Handles the deferred E4X patterns that the runtime E4XTranspiler does not cover.
 * These are patterns that require pre-migration transformation because
 * the Node.js runtime shims cannot handle them transparently.
 *
 * Transform rules:
 * - new Namespace("uri") -> { uri: "uri" }
 * - new Namespace("prefix", "uri") -> { prefix: "prefix", uri: "uri" }
 * - new QName(ns, "localName") -> { namespace: ns, localName: "localName" }
 * - new QName("localName") -> { localName: "localName" }
 * - XML.ignoreWhitespace = true -> CODEMOD comment (not supported)
 * - XML.ignoreComments = false -> CODEMOD comment
 * - XML.prettyPrinting = true -> CODEMOD comment
 * - importClass(...) -> prefixed with CODEMOD comment
 */

import type { TransformWarning } from '../types.js';

export interface ExtendedTransformResult {
  code: string;
  applied: string[];  // names of transforms that were applied
  warnings: TransformWarning[];
}

export class ExtendedTransforms {
  /**
   * Apply all extended transforms to the source code.
   * Returns the transformed code, list of applied transforms, and any warnings.
   */
  transform(source: string): ExtendedTransformResult {
    let code = source;
    const applied: string[] = [];
    const warnings: TransformWarning[] = [];

    // Apply each transform in order
    const transforms: Array<{
      name: string;
      fn: (code: string) => { code: string; applied: boolean; warnings?: TransformWarning[] };
    }> = [
      { name: 'namespace-constructor', fn: (c) => this.transformNamespaceConstructor(c) },
      { name: 'qname-constructor', fn: (c) => this.transformQNameConstructor(c) },
      { name: 'xml-settings', fn: (c) => this.transformXmlSettings(c) },
      { name: 'import-class', fn: (c) => this.transformImportClass(c) },
    ];

    for (const t of transforms) {
      const result = t.fn(code);
      code = result.code;
      if (result.applied) {
        applied.push(t.name);
      }
      if (result.warnings) {
        warnings.push(...result.warnings);
      }
    }

    // Detection-only: XMLList constructor — add warning but don't transform
    // (Runtime handles new XMLList via E4XTranspiler.transpileXMLConstructor)
    const xmllistMatches = code.matchAll(/new\s+XMLList\s*\(/g);
    for (const m of xmllistMatches) {
      const line = this.getLineNumber(code, m.index!);
      warnings.push({
        line,
        message: 'new XMLList() usage detected. Handled by runtime transpiler, but verify behavior.',
        severity: 'info',
      });
    }

    return { code, applied, warnings };
  }

  /**
   * Transform: new Namespace("uri") -> { uri: "uri" }
   * Transform: new Namespace("prefix", "uri") -> { prefix: "prefix", uri: "uri" }
   */
  private transformNamespaceConstructor(code: string): { code: string; applied: boolean; warnings?: TransformWarning[] } {
    let applied = false;
    const warnings: TransformWarning[] = [];

    // 2-arg form: new Namespace("prefix", "uri") or with variables
    code = code.replace(
      /new\s+Namespace\s*\(\s*("[^"]*"|'[^']*'|\w[\w.]*)\s*,\s*("[^"]*"|'[^']*'|\w[\w.]*)\s*\)/g,
      (match, prefix: string, uri: string, offset: number) => {
        applied = true;
        const line = this.getLineNumber(code, offset);
        warnings.push({
          line,
          message: `Transformed: ${match} -> object literal with prefix and uri`,
          severity: 'info',
        });
        return `{ prefix: ${prefix}, uri: ${uri} }`;
      }
    );

    // 1-arg form: new Namespace("uri") or with variable
    code = code.replace(
      /new\s+Namespace\s*\(\s*("[^"]*"|'[^']*'|\w[\w.]*)\s*\)/g,
      (match, uri: string, offset: number) => {
        applied = true;
        const line = this.getLineNumber(code, offset);
        warnings.push({
          line,
          message: `Transformed: ${match} -> object literal with uri`,
          severity: 'info',
        });
        return `{ uri: ${uri} }`;
      }
    );

    return { code, applied, warnings };
  }

  /**
   * Transform: new QName(ns, "localName") -> { namespace: ns, localName: "localName" }
   * Transform: new QName("localName") -> { localName: "localName" }
   */
  private transformQNameConstructor(code: string): { code: string; applied: boolean; warnings?: TransformWarning[] } {
    let applied = false;
    const warnings: TransformWarning[] = [];

    // 2-arg form: new QName(ns, "localName")
    code = code.replace(
      /new\s+QName\s*\(\s*("[^"]*"|'[^']*'|\w[\w.]*)\s*,\s*("[^"]*"|'[^']*'|\w[\w.]*)\s*\)/g,
      (match, ns: string, localName: string, offset: number) => {
        applied = true;
        const line = this.getLineNumber(code, offset);
        warnings.push({
          line,
          message: `Transformed: ${match} -> object literal with namespace and localName`,
          severity: 'info',
        });
        return `{ namespace: ${ns}, localName: ${localName} }`;
      }
    );

    // 1-arg form: new QName("localName")
    code = code.replace(
      /new\s+QName\s*\(\s*("[^"]*"|'[^']*'|\w[\w.]*)\s*\)/g,
      (match, localName: string, offset: number) => {
        applied = true;
        const line = this.getLineNumber(code, offset);
        warnings.push({
          line,
          message: `Transformed: ${match} -> object literal with localName`,
          severity: 'info',
        });
        return `{ localName: ${localName} }`;
      }
    );

    return { code, applied, warnings };
  }

  /**
   * Transform: XML.ignoreWhitespace = value -> CODEMOD comment
   * Transform: XML.ignoreComments = value -> CODEMOD comment
   * Transform: XML.prettyPrinting = value -> CODEMOD comment
   */
  private transformXmlSettings(code: string): { code: string; applied: boolean; warnings?: TransformWarning[] } {
    let applied = false;
    const warnings: TransformWarning[] = [];

    code = code.replace(
      /^(\s*)(XML\.(ignoreWhitespace|ignoreComments|prettyPrinting)\s*=\s*[^;\n]+;?)/gm,
      (_match, indent: string, statement: string, settingName: string, offset: number) => {
        applied = true;
        const line = this.getLineNumber(code, offset);
        warnings.push({
          line,
          message: `XML.${settingName} is not supported in the Node.js runtime. Statement commented out.`,
          severity: 'warn',
        });
        return `${indent}/* CODEMOD: ${statement.trim()} -- not supported in Node.js runtime */`;
      }
    );

    return { code, applied, warnings };
  }

  /**
   * Transform: importClass(...) -> prefixed with CODEMOD comment
   * The runtime shim handles importClass, but we flag it for awareness.
   */
  private transformImportClass(code: string): { code: string; applied: boolean; warnings?: TransformWarning[] } {
    let applied = false;
    const warnings: TransformWarning[] = [];

    code = code.replace(
      /^(\s*)(importClass\s*\([^)]*\)\s*;?)/gm,
      (_match, indent: string, statement: string, offset: number) => {
        applied = true;
        const line = this.getLineNumber(code, offset);
        warnings.push({
          line,
          message: 'importClass() is deprecated. Handled by runtime shim, but consider removing.',
          severity: 'info',
        });
        return `${indent}/* CODEMOD: importClass deprecated -- handled by runtime shim */ ${statement.trim()}`;
      }
    );

    return { code, applied, warnings };
  }

  /**
   * Get the 1-based line number for a character offset.
   */
  private getLineNumber(code: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < code.length; i++) {
      if (code[i] === '\n') line++;
    }
    return line;
  }
}
