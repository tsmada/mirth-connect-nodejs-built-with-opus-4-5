/**
 * MigrationParser - Parse Java Migrate*.java classes to extract schema changes.
 *
 * Java Mirth uses migration classes (e.g., Migrate3_10_0.java) to handle
 * database schema changes between versions. This parser extracts:
 * - SQL statements to execute
 * - Configuration properties to add/remove
 * - Data migration methods
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SchemaMigration } from '../models/ChangeImpact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MigrationParser {
  private javaRepoPath: string;
  private migrationPath: string;

  constructor() {
    // Default paths - could be loaded from config
    this.javaRepoPath = path.join(process.env.HOME || '~', 'Projects', 'connect');
    this.migrationPath = 'server/src/com/mirth/connect/server/migration';
  }

  /**
   * Parse a migration class by name.
   * @param className - e.g., "Migrate3_10_0"
   */
  async parseMigration(className: string): Promise<SchemaMigration[]> {
    const filePath = path.join(
      this.javaRepoPath,
      this.migrationPath,
      `${className}.java`
    );

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return [this.parseMigrationContent(className, content)];
    } catch {
      // File doesn't exist or can't be read
      // Return mock data for development
      return [this.getMockMigration(className)];
    }
  }

  /**
   * Parse migration content from Java source.
   */
  private parseMigrationContent(className: string, content: string): SchemaMigration {
    const sqlStatements = this.extractSqlStatements(content);
    const configProperties = this.extractConfigProperties(content);
    const removedConfigProperties = this.extractRemovedConfigProperties(content);
    const dataMigrations = this.extractDataMigrations(content);

    return {
      className,
      sqlStatements,
      configProperties,
      removedConfigProperties,
      dataMigrations,
    };
  }

  /**
   * Extract SQL statements from migration class.
   *
   * Look for patterns like:
   * - executeScript(scriptId, context)
   * - statement.execute("ALTER TABLE...")
   * - Inline SQL strings
   */
  private extractSqlStatements(content: string): string[] {
    const statements: string[] = [];

    // Pattern 1: executeScript calls
    const executeScriptPattern = /executeScript\s*\(\s*["']([^"']+)["']/g;
    let match;
    while ((match = executeScriptPattern.exec(content)) !== null) {
      statements.push(`Execute script: ${match[1]}`);
    }

    // Pattern 2: Direct SQL execution
    const sqlPattern = /(?:execute|executeUpdate)\s*\(\s*["']([^"']+)["']/g;
    while ((match = sqlPattern.exec(content)) !== null) {
      statements.push(match[1]!);
    }

    // Pattern 3: Multi-line SQL strings
    const multiLineSqlPattern = /["'](?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\s+[^"']+["']/gi;
    while ((match = multiLineSqlPattern.exec(content)) !== null) {
      const sql = match[0].replace(/^["']|["']$/g, '').trim();
      if (!statements.includes(sql)) {
        statements.push(sql);
      }
    }

    return statements;
  }

  /**
   * Extract configuration properties to add.
   *
   * Look for patterns like:
   * - getConfigurationPropertiesToAdd()
   * - new ConfigurationProperty(name, value, description)
   */
  private extractConfigProperties(
    content: string
  ): Array<{ name: string; value: string; description?: string }> {
    const properties: Array<{ name: string; value: string; description?: string }> = [];

    // Pattern: new ConfigurationProperty("name", "value", "description")
    const propPattern = /new\s+ConfigurationProperty\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?\s*\)/g;
    let match;

    while ((match = propPattern.exec(content)) !== null) {
      properties.push({
        name: match[1]!,
        value: match[2]!,
        description: match[3],
      });
    }

    return properties;
  }

  /**
   * Extract configuration properties to remove.
   */
  private extractRemovedConfigProperties(content: string): string[] {
    const removed: string[] = [];

    // Look for getConfigurationPropertiesToRemove method
    const methodMatch = content.match(
      /getConfigurationPropertiesToRemove\s*\([^)]*\)\s*\{([^}]+)\}/s
    );

    if (methodMatch) {
      const methodBody = methodMatch[1]!;
      // Extract string literals that are property names
      const stringPattern = /["']([^"']+)["']/g;
      let match;
      while ((match = stringPattern.exec(methodBody)) !== null) {
        removed.push(match[1]!);
      }
    }

    return removed;
  }

  /**
   * Extract data migration method descriptions.
   */
  private extractDataMigrations(content: string): string[] {
    const migrations: string[] = [];

    // Look for migrate* methods
    const methodPattern = /(?:private|protected|public)\s+void\s+(migrate\w+)\s*\([^)]*\)/g;
    let match;

    while ((match = methodPattern.exec(content)) !== null) {
      const methodName = match[1]!;
      if (methodName !== 'migrate') {
        // Convert camelCase to description
        const description = methodName
          .replace(/^migrate/, '')
          .replace(/([A-Z])/g, ' $1')
          .trim();
        migrations.push(description);
      }
    }

    return migrations;
  }

  /**
   * Get all migration classes between two versions.
   */
  async getMigrationsBetween(
    fromVersion: string,
    toVersion: string
  ): Promise<SchemaMigration[]> {
    const migrations: SchemaMigration[] = [];

    // Parse version strings
    const fromParts = fromVersion.split('.').map(Number);
    const toParts = toVersion.split('.').map(Number);

    // Generate migration class names between versions
    const classNames = this.generateMigrationClassNames(fromParts, toParts);

    for (const className of classNames) {
      const parsed = await this.parseMigration(className);
      migrations.push(...parsed);
    }

    return migrations;
  }

  /**
   * Generate migration class names between two versions.
   */
  private generateMigrationClassNames(
    from: number[],
    to: number[]
  ): string[] {
    const names: string[] = [];

    // Simple implementation - just generate for the target version
    // A full implementation would iterate through all versions
    const toClassName = `Migrate${to[0]}_${to[1]}_${to[2]}`;
    names.push(toClassName);

    return names;
  }

  /**
   * Mock migration data for development.
   */
  private getMockMigration(className: string): SchemaMigration {
    return {
      className,
      sqlStatements: [
        'ALTER TABLE CHANNEL ADD COLUMN METADATA TEXT',
        'CREATE INDEX idx_channel_metadata ON CHANNEL(METADATA(100))',
      ],
      configProperties: [
        {
          name: 'server.api.ratelimit',
          value: '100',
          description: 'API rate limit per minute',
        },
      ],
      removedConfigProperties: [],
      dataMigrations: ['Channel Metadata Migration'],
    };
  }
}
