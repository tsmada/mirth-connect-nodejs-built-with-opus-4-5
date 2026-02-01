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

    // 2. Handle for each loops (must be before other transformations)
    code = this.transpileForEach(code);

    // 3. Handle descendant operator (..)
    code = this.transpileDescendant(code);

    // 4. Handle XML literals
    code = this.transpileXMLLiterals(code);

    // 5. Handle attribute access (@)
    code = this.transpileAttributes(code);

    // 6. Handle new XML() constructor
    code = this.transpileXMLConstructor(code);

    return {
      code,
      warnings: this.warnings,
    };
  }

  /**
   * Transform: default xml namespace = "uri"
   * To: setDefaultXmlNamespace("uri")
   */
  private transpileDefaultNamespace(code: string): string {
    // Match: default xml namespace = "..."
    // Also handles: default xml namespace = '...'
    const pattern = /default\s+xml\s+namespace\s*=\s*(["'])([^"']*)\1/g;

    return code.replace(pattern, (_match, _quote, namespace) => {
      return `setDefaultXmlNamespace("${namespace}")`;
    });
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

      result = result.replace(pattern, (_match, beforeChar, name) => {
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
    // Pattern: .@identifier
    code = code.replace(/\.@(\w+)/g, ".attr('$1')");

    // Pattern: ['@identifier'] or ["@identifier"]
    code = code.replace(/\[@(['"@])(\w+)\1\]/g, ".attr('$2')");
    code = code.replace(/\['@(\w+)'\]/g, ".attr('$1')");
    code = code.replace(/\["@(\w+)"\]/g, ".attr('$1')");

    return code;
  }

  /**
   * Transform: new XML(string) or XML(string)
   * To: XMLProxy.create(string)
   */
  private transpileXMLConstructor(code: string): string {
    // Pattern: new XML(...)
    code = code.replace(/new\s+XML\s*\(/g, 'XMLProxy.create(');

    // Pattern: XML(...) as function call (not preceded by new)
    // Be careful not to match XMLProxy or other XML-prefixed identifiers
    code = code.replace(/(?<![\w.])XML\s*\((?!Proxy)/g, 'XMLProxy.create(');

    return code;
  }

  /**
   * Check if position is inside a string literal
   */
  private isInsideString(code: string, position: number): boolean {
    let inString: string | null = null;
    let escaped = false;

    for (let i = 0; i < position; i++) {
      const char = code[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (inString === null) {
        if (char === '"' || char === "'" || char === '`') {
          inString = char;
        }
      } else if (char === inString) {
        inString = null;
      }
    }

    return inString !== null;
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
