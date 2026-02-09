import { readFile } from 'fs/promises';
import type { SecretValue, SecretsProvider } from '../types.js';

/**
 * Reads Java-style .properties files and .env files.
 *
 * Supports:
 * - key=value, key: value, key value (Java .properties separators)
 * - # and ! line comments
 * - Blank lines ignored
 * - Leading/trailing whitespace trimmed from values
 * - Quoted values: key="value with spaces" or key='value'
 */
export class PropertiesFileProvider implements SecretsProvider {
  readonly name = 'props';
  private filePath: string;
  private properties = new Map<string, string>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      this.properties = PropertiesFileProvider.parse(content);
    } catch (err) {
      console.warn(
        `[PropertiesFileProvider] Failed to read ${this.filePath}: ${(err as Error).message}`
      );
    }
  }

  /**
   * Parse a .properties or .env file into key-value pairs.
   *
   * Separator precedence: first unescaped `=` or `:` wins.
   * If neither is found, the first whitespace acts as separator.
   */
  static parse(content: string): Map<string, string> {
    const result = new Map<string, string>();

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;

      // Find separator: first unescaped = or :, falling back to first whitespace
      let hardSepIdx = -1;
      let softSepIdx = -1;

      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') {
          i++; // skip escaped character
          continue;
        }
        if (line[i] === '=' || line[i] === ':') {
          hardSepIdx = i;
          break;
        }
        if (softSepIdx === -1 && (line[i] === ' ' || line[i] === '\t')) {
          softSepIdx = i;
        }
      }

      const sepIdx = hardSepIdx !== -1 ? hardSepIdx : softSepIdx;
      if (sepIdx === -1) continue;

      const key = line.substring(0, sepIdx).trim();
      let value = line.substring(sepIdx + 1).trim();

      // Strip matching quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key) result.set(key, value);
    }

    return result;
  }

  async get(key: string): Promise<SecretValue | undefined> {
    const value = this.properties.get(key);
    if (value === undefined) return undefined;
    return {
      value,
      source: this.name,
      fetchedAt: new Date(),
    };
  }

  async has(key: string): Promise<boolean> {
    return this.properties.has(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.properties.keys());
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }
}
