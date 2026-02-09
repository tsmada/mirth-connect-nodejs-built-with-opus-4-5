import { readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import type { SecretValue, SecretsProvider } from '../types.js';

/**
 * Reads secrets from files. Two strategies:
 * 1. _FILE suffix: If process.env[KEY + '_FILE'] exists, read that path
 * 2. Direct file: Read basePath/KEY (e.g., /run/secrets/DB_PASSWORD)
 *
 * Compatible with Docker secrets (/run/secrets/) and Kubernetes secret volumes.
 */
export class FileProvider implements SecretsProvider {
  readonly name = 'file';
  private basePath: string;

  constructor(basePath: string = '/run/secrets') {
    this.basePath = basePath;
  }

  async initialize(): Promise<void> {
    // Verify base path exists — best-effort, don't fail if missing.
    // Containers that don't use file secrets simply won't have this directory.
    try {
      await access(this.basePath);
    } catch {
      // Directory doesn't exist yet — OK for containers not using file secrets
    }
  }

  async get(key: string): Promise<SecretValue | undefined> {
    // Strategy 1: _FILE suffix env var
    const filePath = process.env[`${key}_FILE`];
    if (filePath) {
      try {
        const content = await readFile(filePath, 'utf-8');
        return {
          value: content.replace(/\n$/, ''),
          source: this.name,
          fetchedAt: new Date(),
        };
      } catch {
        // File not found or unreadable, fall through to strategy 2
      }
    }

    // Strategy 2: Direct file read from basePath
    try {
      const content = await readFile(join(this.basePath, key), 'utf-8');
      return {
        value: content.replace(/\n$/, ''),
        source: this.name,
        fetchedAt: new Date(),
      };
    } catch {
      return undefined;
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.basePath);
      return files;
    } catch {
      return [];
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }
}
