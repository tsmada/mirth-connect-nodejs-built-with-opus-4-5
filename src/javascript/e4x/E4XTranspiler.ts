/**
 * E4X Transpiler - Converts E4X syntax to modern JavaScript
 *
 * Ported from: Custom implementation for Mirth E4X compatibility
 *
 * Key transformations:
 * - msg..OBX -> msg.descendants('OBX')
 * - for each (var x in list) -> for (const x of list)
 * - <tag>{expr}</tag> -> XMLProxy.create('<tag>' + String(expr) + '</tag>')
 * - node.@attr -> node.attr('attr')
 * - default xml namespace = "ns" -> setDefaultXmlNamespace("ns")
 */

export interface TranspileOptions {
  /** Whether to preserve original line numbers with sourcemaps */
  preserveLineNumbers?: boolean;
  /** Custom XMLProxy import path */
  xmlProxyImport?: string;
  /** Whether this is a filter/transformer script (adds return handling) */
  isFilterTransformer?: boolean;
}

export interface TranspileResult {
  code: string;
  sourceMap?: string;
  warnings: TranspileWarning[];
}

export interface TranspileWarning {
  line: number;
  column: number;
  message: string;
}

/**
 * E4X Transpiler class
 */
export class E4XTranspiler {
  private warnings: TranspileWarning[] = [];

  /**
   * Transpile E4X code to modern JavaScript
   */
  transpile(source: string, _options: TranspileOptions = {}): TranspileResult {
    this.warnings = [];

    let code = source;

    // Order matters - some transformations depend on others

    // 1. Handle default xml namespace declarations
    code = this.transpileDefaultNamespace(code);

    // 1.5. Handle E4X filter predicates (before attributes, so @attr inside predicates gets converted)
    code = this.transpileFilterPredicates(code);

    // 2. Handle for each loops (must be before other transformations)
    code = this.transpileForEach(code);

    // 3. Handle descendant operator (..)
    code = this.transpileDescendant(code);

    // 3.5. Handle E4X wildcards (.* and .@*) — after descendants so ..* is handled first
    code = this.transpileWildcards(code);

    // 4. Handle XML literals
    code = this.transpileXMLLiterals(code);

    // 5. Handle attribute access (@)
    code = this.transpileAttributes(code);

    // 5.5. Handle XML append operator (+=)
    code = this.transpileXMLAppend(code);

    // 6. Handle new XML() constructor
    code = this.transpileXMLConstructor(code);

    return {
      code,
      warnings: this.warnings,
    };
  }

  /**
   * Transform: default xml namespace = "uri" or default xml namespace = variable
   * To: setDefaultXmlNamespace("uri") or setDefaultXmlNamespace(variable)
   */
  private transpileDefaultNamespace(code: string): string {
    // Match: default xml namespace = "..." or '...' (string literals)
    const stringPattern = /default\s+xml\s+namespace\s*=\s*(["'])([^"']*)\1/g;
    code = code.replace(stringPattern, (_match, _quote, namespace) => {
      return `setDefaultXmlNamespace("${namespace}")`;
    });

    // Match: default xml namespace = identifier (variable reference, not string)
    // The identifier can be dotted (e.g., config.namespace)
    const varPattern = /default\s+xml\s+namespace\s*=\s*([\w.]+)/g;
    code = code.replace(varPattern, (_match, identifier) => {
      return `setDefaultXmlNamespace(${identifier})`;
    });

    return code;
  }

  /**
   * Transform: expr.identifier.(predicate)
   * To: expr.get('identifier').filter(function(__e4x_item) { with(__e4x_item) { return (predicate); } })
   *
   * E4X filtering predicates allow filtering XMLList children by expression.
   * The predicate runs with each element as context (via `with`), so inner property
   * access like OBX.3 resolves against the current element.
   *
   * Must run BEFORE attribute transpilation so @attr inside predicates gets converted.
   */
  private transpileFilterPredicates(code: string): string {
    // Pattern: .identifier.(expression)
    // The key distinction from a method call is that a method call has an identifier
    // immediately before ( like .toString(). A predicate has .( after the identifier.
    // E4X predicates: .name.(expr) — there's a dot then open paren with content that
    // looks like a boolean expression (contains ==, !=, >, <, etc.)
    //
    // We need to match: .identifier.( and find the matching closing paren
    // We must NOT match: .identifier( — that's a method call

    let result = '';
    let i = 0;

    while (i < code.length) {
      // Look for pattern: .identifier.(
      // The identifier is preceded by . and followed by .(
      const remaining = code.slice(i);
      const predicateStart = remaining.match(/^\.(\w+)\.\(/);

      if (predicateStart && !this.isInsideStringOrComment(code, i)) {
        const identifier = predicateStart[1];
        const parenStartIdx = i + predicateStart[0].length; // position after the (

        // Find matching closing paren
        const closeIdx = this.findMatchingParen(code, parenStartIdx - 1);
        if (closeIdx !== -1) {
          const predicate = code.slice(parenStartIdx, closeIdx);
          result += `.get('${identifier}').filter(function(__e4x_item) { with(__e4x_item) { return (${predicate}); } })`;
          i = closeIdx + 1;
          continue;
        }
      }

      result += code[i];
      i++;
    }

    return result;
  }

  /**
   * Find the index of the closing parenthesis matching the opening paren at `openIdx`.
   * Returns -1 if not found.
   */
  private findMatchingParen(code: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < code.length; i++) {
      if (this.isInsideStringOrComment(code, i)) continue;
      if (code[i] === '(') depth++;
      else if (code[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * Transform: .@* → .attributes() and identifier.* → identifier.children()
   * Must NOT convert multiplication expressions like `count * 3`.
   */
  private transpileWildcards(code: string): string {
    // .@* → .attributes() — attribute wildcard
    code = code.replace(/\.@\*/g, '.attributes()');

    // identifier.* → identifier.children() — child wildcard
    // Only when .* appears after an identifier and is NOT followed by another identifier/number
    // (which would be multiplication). Pattern: word.* at end or followed by non-word
    // Guard: Must have a dot immediately before *, and the * must not be followed by \w or preceded by space+*
    code = code.replace(/(\w)\.(\*)(?=\s*[^a-zA-Z0-9_.]|$)/g, (_match, lastChar, _star) => {
      return `${lastChar}.children()`;
    });

    return code;
  }

  /**
   * Transform: for each (var/let/const x in collection)
   * To: for (const x of collection)
   */
  private transpileForEach(code: string): string {
    // Match: for each (var|let|const identifier in expression)
    // This is tricky because the expression can be complex

    // Pattern for simple cases: for each (var x in expr)
    const simplePattern = /for\s+each\s*\(\s*(var|let|const)\s+(\w+)\s+in\s+([^)]+)\)/g;

    code = this.replaceWithStringCheck(code, simplePattern, (_match, groups) => {
      const [_declType, varName, collection] = groups;
      return `for (const ${varName} of ${(collection ?? '').trim()})`;
    });

    // Pattern for destructuring: for each (var [a, b] in expr)
    const destructPattern = /for\s+each\s*\(\s*(var|let|const)\s+(\[[^\]]+\]|\{[^}]+\})\s+in\s+([^)]+)\)/g;

    code = this.replaceWithStringCheck(code, destructPattern, (_match, groups) => {
      const [_declType, destructure, collection] = groups;
      return `for (const ${destructure} of ${(collection ?? '').trim()})`;
    });

    // Pattern for bare variable (no var/let/const): for each (x in expr)
    const barePattern = /for\s+each\s*\(\s*(\w+)\s+in\s+([^)]+)\)/g;

    code = this.replaceWithStringCheck(code, barePattern, (_match, groups) => {
      const [varName, collection] = groups;
      return `for (let ${varName} of ${(collection ?? '').trim()})`;
    });

    return code;
  }

  /**
   * Replace pattern in code, but skip matches inside string literals
   */
  private replaceWithStringCheck(
    code: string,
    pattern: RegExp,
    replacer: (match: string, groups: string[]) => string
  ): string {
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex lastIndex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(code)) !== null) {
      // Check if this match is inside a string
      if (this.isInsideString(code, match.index)) {
        continue;
      }

      // Add everything before the match
      result += code.slice(lastIndex, match.index);

      // Get capture groups (skip first element which is the full match)
      const groups = match.slice(1);

      // Add the replacement
      result += replacer(match[0], groups);

      lastIndex = match.index + match[0].length;
    }

    // Add any remaining code after the last match
    result += code.slice(lastIndex);

    return result;
  }

  /**
   * Transform: expr..name (descendant access)
   * To: expr.descendants('name')
   *
   * Careful not to match spread operator (...) or property access (..)
   */
  private transpileDescendant(code: string): string {
    // Keep processing until no more changes (handles chained descendants)
    let result = code;
    let changed = true;

    while (changed) {
      const before = result;
      // Match word or closing bracket/paren/quote followed by .. and an identifier
      // Pattern: identifier..name or )..name or ]..name or ')..name
      const pattern = /(\w+|\)|\]|['"])\.\.(\w+)/g;

      result = this.replaceWithStringCheck(result, pattern, (_match, groups) => {
        const [beforeChar, name] = groups;
        return `${beforeChar}.descendants('${name}')`;
      });

      changed = before !== result;
    }

    return result;
  }

  /**
   * Transform: <tag>content</tag> or <tag attr="val">{expr}</tag>
   * To: XMLProxy.create('<tag>content</tag>') or XMLProxy.create('<tag attr="val">' + String(expr) + '</tag>')
   */
  private transpileXMLLiterals(code: string): string {
    // This is complex - XML literals can span multiple lines and contain expressions

    // First, handle simple XML literals without embedded expressions
    // Pattern: <tagname ...>...</tagname> or <tagname ... />
    // We need to be careful not to match JSX or HTML in strings

    let result = code;
    let changed = true;

    // Keep processing until no more changes (handles nested XML)
    while (changed) {
      const before = result;

      // Match self-closing tags: <name attrs/>
      result = result.replace(
        /(<(\w+)(?:\s+[^>]*)?\/\s*>)/g,
        (match, fullTag, _tagName) => {
          // Check if this is inside a string
          if (this.isInsideString(result, result.indexOf(match))) {
            return match;
          }
          return `XMLProxy.create('${this.escapeForString(fullTag)}')`;
        }
      );

      // Match opening and closing tags with content
      // This regex is simplified - a full parser would be needed for complex cases
      result = this.processXMLTag(result);

      changed = before !== result;
    }

    // Handle embedded expressions {expr} in XML - convert to string concatenation
    result = this.processEmbeddedExpressions(result);

    return result;
  }

  /**
   * Process a single XML tag
   */
  private processXMLTag(code: string): string {
    // Find XML-like tags that aren't in strings
    // Pattern: <tagname ...>content</tagname>

    // This is a simplified approach - look for matching open/close tags
    const tagPattern = /<(\w+)(\s+[^>]*)?>([^]*?)<\/\1>/;
    const match = tagPattern.exec(code);

    if (match && !this.isInsideString(code, match.index)) {
      const [fullMatch, tagName, attrs, content] = match;
      const attrStr = attrs || '';
      const contentStr = content || '';

      // Check if content has embedded expressions
      if (contentStr.includes('{') && contentStr.includes('}')) {
        // Handle embedded expressions
        const processedContent = this.convertEmbeddedToConcat(contentStr);
        const replacement = `XMLProxy.create('<${tagName}${attrStr}>' + ${processedContent} + '</${tagName}>')`;
        return code.slice(0, match.index) + replacement + code.slice(match.index + fullMatch.length);
      } else {
        // Simple content - just escape and wrap
        const replacement = `XMLProxy.create('${this.escapeForString(fullMatch)}')`;
        return code.slice(0, match.index) + replacement + code.slice(match.index + fullMatch.length);
      }
    }

    return code;
  }

  /**
   * Convert {expr} in XML to string concatenation
   */
  private convertEmbeddedToConcat(content: string): string {
    // Split on { and }
    const parts: string[] = [];
    let inExpr = false;
    let current = '';
    let braceDepth = 0;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (char === '{' && !inExpr) {
        if (current) {
          parts.push(`'${this.escapeForString(current)}'`);
          current = '';
        }
        inExpr = true;
        braceDepth = 1;
      } else if (char === '{' && inExpr) {
        braceDepth++;
        current += char;
      } else if (char === '}' && inExpr) {
        braceDepth--;
        if (braceDepth === 0) {
          parts.push(`String(${current})`);
          current = '';
          inExpr = false;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(`'${this.escapeForString(current)}'`);
    }

    return parts.join(' + ');
  }

  /**
   * Process already-created XMLProxy.create calls with embedded expressions
   */
  private processEmbeddedExpressions(code: string): string {
    // This handles cases where we have XMLProxy.create('...{expr}...')
    // We need to convert to XMLProxy.create('...' + String(expr) + '...')

    // Pattern: XMLProxy.create('...')
    // But we need to be careful with the string content

    return code;
  }

  /**
   * Transform: node.@attr or node['@attr']
   * To: node.attr('attr')
   */
  private transpileAttributes(code: string): string {
    // WRITE: .@attr = value → .setAttr('attr', value)
    // Must come BEFORE read rule. Must not match == or != or === or !==
    code = code.replace(/\.@(\w+)\s*=\s*(?!=)([^;,\n\)]+)/g, ".setAttr('$1', $2)");

    // READ: .@identifier
    code = code.replace(/\.@(\w+)/g, ".attr('$1')");

    // Pattern: ['@identifier'] or ["@identifier"]
    // Must run BEFORE bare @identifier rule below
    code = code.replace(/\[@(['"@])(\w+)\1\]/g, ".attr('$2')");
    code = code.replace(/\['@(\w+)'\]/g, ".attr('$1')");
    code = code.replace(/\["@(\w+)"\]/g, ".attr('$1')");

    // Bare @identifier (inside predicates / with blocks) → attr('identifier')
    // Must not match email-like patterns, decorators, or already-processed .@attr.
    // Only match when preceded by non-word, non-dot, non-quote char or start of input.
    code = code.replace(/(?<=^|[^.\w'"])@(\w+)/gm, "attr('$1')");

    return code;
  }

  /**
   * Transform: xml += <tag/> or xml += variable
   * To: xml = xml.append(XMLProxy.create('<tag/>')) or xml = xml.append(variable)
   *
   * Two rules:
   * 1. XMLProxy.create() RHS (most specific — existing rule)
   * 2. Variable/expression RHS for XML-like identifiers (msg, tmp, xml*)
   *    Skips numeric literals and string literals on RHS to avoid breaking
   *    normal += operations like count += 1 or str += "text".
   */
  private transpileXMLAppend(code: string): string {
    // Rule 1: identifier += XMLProxy.create(...) — most specific, runs first
    // The XML literal has already been transpiled to XMLProxy.create() by step 4
    code = code.replace(
      /(\w+(?:\.\w+|\[['"][^'"]+['"]\])*)\s*\+=\s*(XMLProxy\.create\([^)]+\))/g,
      '$1 = $1.append($2)'
    );

    // Rule 2: XML-like identifier += variable/expression
    // LHS must start with msg, tmp, or xml (common XML variable names in Mirth scripts)
    // RHS must NOT be a numeric literal or string literal (those are normal +=)
    // Uses replaceWithStringCheck to skip matches inside string literals
    code = this.replaceWithStringCheck(code,
      /((?:msg|tmp|xml)\w*(?:\.\w+|\[['"][^'"]+['"]\])*)\s*\+=\s*([^;\n]+)/g,
      (_match, groups) => {
        const lhs = groups[0] ?? '';
        const rhs = (groups[1] ?? '').trim();
        // Skip if RHS is a numeric literal, string literal, or already an .append() call
        if (/^\d/.test(rhs) || /^['"]/.test(rhs) || rhs.includes('.append(')) {
          return `${lhs} += ${groups[1]}`;
        }
        return `${lhs} = ${lhs}.append(${rhs})`;
      }
    );

    return code;
  }

  /**
   * Transform: new XML(string) or XML(string)
   * To: XMLProxy.create(string)
   *
   * Transform: new XMLList(string) or XMLList(string)
   * To: XMLProxy.createList(string)
   */
  private transpileXMLConstructor(code: string): string {
    // Pattern: new XMLList(...)
    code = code.replace(/new\s+XMLList\s*\(/g, 'XMLProxy.createList(');

    // Pattern: XMLList(...) as function call (not preceded by new or .)
    code = code.replace(/(?<![\w.])XMLList\s*\((?!Proxy)/g, 'XMLProxy.createList(');

    // Pattern: new XML(...)
    code = code.replace(/new\s+XML\s*\(/g, 'XMLProxy.create(');

    // Pattern: XML(...) as function call (not preceded by new)
    // Be careful not to match XMLProxy or other XML-prefixed identifiers
    code = code.replace(/(?<![\w.])XML\s*\((?!Proxy)/g, 'XMLProxy.create(');

    return code;
  }

  /**
   * Check if position is inside a string literal or comment.
   * Tracks single-quoted, double-quoted, and template literal strings,
   * as well as // line comments and /* block comments.
   */
  private isInsideStringOrComment(code: string, position: number): boolean {
    let inString: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = 0; i < position; i++) {
      const char = code[i];
      const nextChar = i + 1 < code.length ? code[i + 1] : '';

      // Handle line comment end
      if (inLineComment) {
        if (char === '\n') {
          inLineComment = false;
        }
        continue;
      }

      // Handle block comment end
      if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
          inBlockComment = false;
          i++; // skip the /
        }
        continue;
      }

      // Handle string escape
      if (escaped) {
        escaped = false;
        continue;
      }

      if (inString !== null) {
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === inString) {
          inString = null;
        }
        continue;
      }

      // Not in string or comment — check for starts
      if (char === '/' && nextChar === '/') {
        inLineComment = true;
        i++; // skip second /
        continue;
      }

      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++; // skip the *
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char;
      }
    }

    return inString !== null || inLineComment || inBlockComment;
  }

  /**
   * Check if position is inside a string literal or comment.
   * Legacy name preserved for backward compatibility with replaceWithStringCheck.
   */
  private isInsideString(code: string, position: number): boolean {
    return this.isInsideStringOrComment(code, position);
  }

  /**
   * Escape a string for use in a string literal
   */
  private escapeForString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Add a warning (reserved for future use)
   */
  /* istanbul ignore next */
  protected addWarning(line: number, column: number, message: string): void {
    this.warnings.push({ line, column, message });
  }
}

/**
 * Convenience function to transpile E4X code
 */
export function transpileE4X(source: string, options?: TranspileOptions): string {
  const transpiler = new E4XTranspiler();
  return transpiler.transpile(source, options).code;
}

/**
 * Export default instance
 */
export const e4xTranspiler = new E4XTranspiler();
