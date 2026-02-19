/**
 * Deploy-time environment variable resolver.
 *
 * Resolves ${VAR} and ${VAR:default} placeholders in channel configuration
 * using a priority chain:
 *   1. process.env (runtime overrides)
 *   2. environments/{env}.yaml (environment-specific)
 *   3. environments/base.yaml (shared defaults)
 *   4. Inline defaults ${VAR:default_value}
 *   5. extraVariables (programmatic overrides, lowest of explicit sources)
 *
 * This is distinct from ValueReplacer, which handles runtime $c/$s/$g map
 * variables during message processing.
 */

import * as yaml from 'js-yaml';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ResolveResult {
  resolved: string;
  unresolvedVars: string[];
}

export interface ResolveOptions {
  environment?: string;
  repoPath?: string;
  extraVariables?: Record<string, string>;
  strict?: boolean;
}

interface VariableSource {
  value: string;
  source: string;
}

const MAX_NESTING_DEPTH = 10;

export class VariableResolver {
  private envVars: Map<string, string> = new Map();
  private baseVars: Map<string, string> = new Map();
  private extraVars: Map<string, string> = new Map();
  private strict: boolean;

  constructor(options?: ResolveOptions) {
    this.strict = options?.strict ?? false;

    if (options?.extraVariables) {
      for (const [key, value] of Object.entries(options.extraVariables)) {
        this.extraVars.set(key, value);
      }
    }
  }

  /**
   * Load environment YAML files from the repo's environments/ directory.
   * Loads base.yaml first, then the environment-specific file if provided.
   */
  async loadEnvironment(repoPath: string, environment?: string): Promise<void> {
    const envDir = path.join(repoPath, 'environments');

    // Load base.yaml
    const basePath = path.join(envDir, 'base.yaml');
    try {
      const baseContent = await fs.readFile(basePath, 'utf-8');
      const baseData = yaml.load(baseContent);
      if (baseData && typeof baseData === 'object') {
        for (const [key, value] of Object.entries(baseData as Record<string, unknown>)) {
          this.baseVars.set(key, String(value));
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // base.yaml not found is acceptable
    }

    // Load environment-specific YAML
    if (environment) {
      const envPath = path.join(envDir, `${environment}.yaml`);
      try {
        const envContent = await fs.readFile(envPath, 'utf-8');
        const envData = yaml.load(envContent);
        if (envData && typeof envData === 'object') {
          for (const [key, value] of Object.entries(envData as Record<string, unknown>)) {
            this.envVars.set(key, String(value));
          }
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        // Missing env file is acceptable
      }
    }
  }

  /**
   * Resolve all ${VAR} and ${VAR:default} placeholders in a string.
   */
  resolve(input: string): ResolveResult {
    if (!VariableResolver.hasVariables(input)) {
      return { resolved: input, unresolvedVars: [] };
    }

    const unresolvedVars: string[] = [];
    const resolved = this.resolveString(input, unresolvedVars, new Set(), 0);

    if (this.strict && unresolvedVars.length > 0) {
      throw new Error(`Unresolved variables in strict mode: ${unresolvedVars.join(', ')}`);
    }

    return { resolved, unresolvedVars: [...new Set(unresolvedVars)] };
  }

  /**
   * Recursively resolve all string values in an object (deep clone).
   */
  resolveObject<T>(obj: T): { resolved: T; unresolvedVars: string[] } {
    const allUnresolved: string[] = [];
    const resolved = this.resolveDeep(obj, allUnresolved);

    if (this.strict && allUnresolved.length > 0) {
      throw new Error(
        `Unresolved variables in strict mode: ${[...new Set(allUnresolved)].join(', ')}`
      );
    }

    return { resolved: resolved as T, unresolvedVars: [...new Set(allUnresolved)] };
  }

  /**
   * Get all known variable names with their values and sources.
   */
  getVariableMap(): Map<string, VariableSource> {
    const result = new Map<string, VariableSource>();

    // Add in reverse priority order so higher-priority overwrites
    for (const [key, value] of this.extraVars) {
      result.set(key, { value, source: 'extra' });
    }
    for (const [key, value] of this.baseVars) {
      result.set(key, { value, source: 'base.yaml' });
    }
    for (const [key, value] of this.envVars) {
      result.set(key, { value, source: 'environment' });
    }
    // process.env has highest priority — overwrite anything below
    for (const key of [...this.baseVars.keys(), ...this.envVars.keys(), ...this.extraVars.keys()]) {
      const envVal = process.env[key];
      if (envVal !== undefined) {
        result.set(key, { value: envVal, source: 'process.env' });
      }
    }

    return result;
  }

  /**
   * Check if a string contains ${...} variable references.
   */
  static hasVariables(input: string): boolean {
    return input.includes('${');
  }

  /**
   * Extract all variable names from a string, including those nested
   * inside default values. Uses brace-aware parsing (not regex) to
   * handle `${URL:http://${HOST}:${PORT}/db}` correctly.
   */
  static extractVariableNames(input: string): string[] {
    const names: string[] = [];
    VariableResolver.collectVarNames(input, names);
    return [...new Set(names)];
  }

  private static collectVarNames(input: string, names: string[]): void {
    let i = 0;
    while (i < input.length) {
      if (input[i] === '$' && i + 1 < input.length && input[i + 1] === '{') {
        i += 2; // skip ${
        let braceDepth = 1;
        let inner = '';
        while (i < input.length && braceDepth > 0) {
          if (input[i] === '$' && i + 1 < input.length && input[i + 1] === '{') {
            braceDepth++;
            inner += '${';
            i += 2;
          } else if (input[i] === '}') {
            braceDepth--;
            if (braceDepth > 0) inner += '}';
            i++;
          } else {
            inner += input[i];
            i++;
          }
        }
        // inner is the content between ${ and }
        const colonIdx = inner.indexOf(':');
        const varName = colonIdx === -1 ? inner.trim() : inner.substring(0, colonIdx).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
          names.push(varName);
        }
        // Recurse into the default value portion (and the inner content generally)
        // to pick up nested variable names
        if (colonIdx !== -1) {
          VariableResolver.collectVarNames(inner.substring(colonIdx + 1), names);
        }
      } else {
        i++;
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Lookup a variable by name through the priority chain.
   * Returns undefined if not found in any source.
   */
  private lookupVariable(name: string): string | undefined {
    // Priority 1: process.env
    const envVal = process.env[name];
    if (envVal !== undefined) return envVal;

    // Priority 2: environment-specific YAML
    const envYaml = this.envVars.get(name);
    if (envYaml !== undefined) return envYaml;

    // Priority 3: base YAML
    const baseYaml = this.baseVars.get(name);
    if (baseYaml !== undefined) return baseYaml;

    // Priority 4: extra variables
    const extra = this.extraVars.get(name);
    if (extra !== undefined) return extra;

    return undefined;
  }

  /**
   * Core resolution engine. Replaces ${VAR} and ${VAR:default} tokens,
   * handling nested references and circular detection.
   */
  private resolveString(
    input: string,
    unresolvedVars: string[],
    resolutionStack: Set<string>,
    depth: number
  ): string {
    if (depth > MAX_NESTING_DEPTH) {
      throw new Error(`Variable resolution exceeded maximum nesting depth (${MAX_NESTING_DEPTH})`);
    }

    // We need a custom parser because regex cannot handle nested ${} correctly.
    // For example: ${DB_URL:jdbc:mysql://${DB_HOST}:${DB_PORT}/mirthdb}
    // The outer } matched by regex would be the one after DB_HOST, not the real end.
    return this.parseAndResolve(input, unresolvedVars, resolutionStack, depth);
  }

  /**
   * Parse input character-by-character to correctly handle nested ${...}.
   */
  private parseAndResolve(
    input: string,
    unresolvedVars: string[],
    resolutionStack: Set<string>,
    depth: number
  ): string {
    let result = '';
    let i = 0;

    while (i < input.length) {
      // Look for ${ start
      if (input[i] === '$' && i + 1 < input.length && input[i + 1] === '{') {
        // Find the matching closing brace, accounting for nesting
        const start = i;
        i += 2; // skip ${
        let braceDepth = 1;
        let inner = '';

        while (i < input.length && braceDepth > 0) {
          if (input[i] === '$' && i + 1 < input.length && input[i + 1] === '{') {
            braceDepth++;
            inner += '${';
            i += 2;
          } else if (input[i] === '}') {
            braceDepth--;
            if (braceDepth > 0) {
              inner += '}';
            }
            i++;
          } else {
            inner += input[i];
            i++;
          }
        }

        if (braceDepth > 0) {
          // Unmatched brace — leave as-is
          result += input.substring(start);
          break;
        }

        // inner now contains the content between ${ and }
        result += this.resolveToken(inner, unresolvedVars, resolutionStack, depth);
      } else {
        result += input[i];
        i++;
      }
    }

    return result;
  }

  /**
   * Resolve a single token (the content between ${ and }).
   * Token format: VAR_NAME or VAR_NAME:default_value
   */
  private resolveToken(
    token: string,
    unresolvedVars: string[],
    resolutionStack: Set<string>,
    depth: number
  ): string {
    // Split on the FIRST colon to get name and default
    const colonIdx = token.indexOf(':');
    let varName: string;
    let defaultValue: string | undefined;

    if (colonIdx === -1) {
      varName = token.trim();
    } else {
      varName = token.substring(0, colonIdx).trim();
      defaultValue = token.substring(colonIdx + 1);
    }

    // Validate variable name
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
      // Not a valid variable name — return the original token as-is
      return `\${${token}}`;
    }

    // Circular reference detection
    if (resolutionStack.has(varName)) {
      throw new Error(
        `Circular variable reference detected: ${[...resolutionStack, varName].join(' -> ')}`
      );
    }

    // Look up value from priority chain
    const value = this.lookupVariable(varName);

    if (value !== undefined) {
      // Found in a source — resolve any nested variables within the value
      resolutionStack.add(varName);
      const resolved = this.resolveString(value, unresolvedVars, resolutionStack, depth + 1);
      resolutionStack.delete(varName);
      return resolved;
    }

    // Not found in any source — try the inline default
    if (defaultValue !== undefined) {
      // Resolve any nested variables in the default value
      return this.resolveString(defaultValue, unresolvedVars, resolutionStack, depth + 1);
    }

    // Completely unresolved
    unresolvedVars.push(varName);
    return `\${${varName}}`;
  }

  /**
   * Recursively resolve all string values in any data structure.
   */
  private resolveDeep(value: unknown, unresolvedVars: string[]): unknown {
    if (typeof value === 'string') {
      const result = this.resolve(value);
      unresolvedVars.push(...result.unresolvedVars);
      return result.resolved;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveDeep(item, unresolvedVars));
    }

    if (value !== null && typeof value === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = this.resolveDeep(val, unresolvedVars);
      }
      return resolved;
    }

    // Numbers, booleans, null, undefined — pass through
    return value;
  }
}
