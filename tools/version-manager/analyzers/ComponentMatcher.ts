/**
 * ComponentMatcher - Map Java source files to TypeScript components.
 *
 * Uses the component-map.json configuration to determine which Node.js
 * files correspond to changed Java files.
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import type { EnhancedManifest, ComponentDefinition } from '../models/Manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ComponentMapEntry {
  java: string[];
  node: string[];
}

interface ComponentMapConfig {
  mappings: Record<string, Record<string, ComponentMapEntry>>;
  packagePrefixes: Record<string, string>;
}

export interface MatchedComponent {
  category: string;
  name: string;
  definition: ComponentDefinition;
  matchedJavaFiles: string[];
  nodeFiles: string[];
}

export class ComponentMatcher {
  private config: ComponentMapConfig | null = null;
  private manifest: EnhancedManifest;

  constructor(manifest: EnhancedManifest) {
    this.manifest = manifest;
  }

  /**
   * Load component mapping configuration.
   */
  private async loadConfig(): Promise<ComponentMapConfig> {
    if (this.config) return this.config;

    const configPath = path.resolve(__dirname, '../config/component-map.json');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      this.config = JSON.parse(content);
      return this.config!;
    } catch {
      // Return minimal config if file doesn't exist
      this.config = {
        mappings: {},
        packagePrefixes: {},
      };
      return this.config;
    }
  }

  /**
   * Find components that match a set of changed Java files.
   */
  async matchComponents(javaFiles: string[]): Promise<MatchedComponent[]> {
    const config = await this.loadConfig();
    const matches: MatchedComponent[] = [];
    const seenComponents = new Set<string>();

    for (const javaFile of javaFiles) {
      // Try to match via explicit mappings
      const explicitMatch = await this.findExplicitMatch(javaFile, config);
      if (explicitMatch && !seenComponents.has(`${explicitMatch.category}/${explicitMatch.name}`)) {
        seenComponents.add(`${explicitMatch.category}/${explicitMatch.name}`);
        matches.push(explicitMatch);
        continue;
      }

      // Try to match via manifest javaSource paths
      const manifestMatch = this.findManifestMatch(javaFile);
      if (manifestMatch && !seenComponents.has(`${manifestMatch.category}/${manifestMatch.name}`)) {
        seenComponents.add(`${manifestMatch.category}/${manifestMatch.name}`);
        matches.push(manifestMatch);
        continue;
      }

      // Try to match via package prefix
      const packageMatch = await this.findPackageMatch(javaFile, config);
      if (packageMatch && !seenComponents.has(`${packageMatch.category}/${packageMatch.name}`)) {
        seenComponents.add(`${packageMatch.category}/${packageMatch.name}`);
        matches.push(packageMatch);
      }
    }

    // Group matched Java files into their components
    return this.consolidateMatches(matches, javaFiles);
  }

  /**
   * Find match in explicit mappings.
   */
  private async findExplicitMatch(
    javaFile: string,
    config: ComponentMapConfig
  ): Promise<MatchedComponent | null> {
    for (const [category, components] of Object.entries(config.mappings)) {
      for (const [name, mapping] of Object.entries(components)) {
        const matchingJava = mapping.java.find((pattern) =>
          javaFile.includes(pattern.replace(/.*\/src\//, ''))
        );

        if (matchingJava) {
          // Get component definition from manifest
          const definition = this.manifest.components[category]?.[name];

          return {
            category,
            name,
            definition: definition || {
              status: 'pending',
              description: `Component matched via mapping`,
            },
            matchedJavaFiles: [javaFile],
            nodeFiles: mapping.node,
          };
        }
      }
    }

    return null;
  }

  /**
   * Find match in manifest javaSource paths.
   */
  private findManifestMatch(javaFile: string): MatchedComponent | null {
    for (const [category, components] of Object.entries(this.manifest.components)) {
      if (!components) continue;

      for (const [name, definition] of Object.entries(components)) {
        if (definition.javaSource) {
          // Check if the java file path matches the javaSource directory
          const javaSourceNormalized = definition.javaSource
            .replace(/^\/Users\/[^/]+\/Projects\/connect\//, '')
            .replace(/\/$/, '');

          if (javaFile.startsWith(javaSourceNormalized) ||
              javaFile.includes(javaSourceNormalized)) {
            return {
              category,
              name,
              definition,
              matchedJavaFiles: [javaFile],
              nodeFiles: definition.files || [],
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Find match via package prefix.
   */
  private async findPackageMatch(
    javaFile: string,
    config: ComponentMapConfig
  ): Promise<MatchedComponent | null> {
    // Extract package from file path
    // e.g., server/src/com/mirth/connect/connectors/http/HttpReceiver.java
    // -> com.mirth.connect.connectors.http

    const match = javaFile.match(/(?:server|donkey)\/src\/(?:main\/java\/)?(.+)\/[^/]+\.java$/);
    if (!match) return null;

    const packagePath = match[1]!.replace(/\//g, '.');

    // Find matching prefix
    for (const [prefix, category] of Object.entries(config.packagePrefixes)) {
      if (packagePath.startsWith(prefix)) {
        // Try to find component in manifest by category
        const categoryComponents = this.manifest.components[category];
        if (categoryComponents) {
          // Find by filename similarity
          const fileName = path.basename(javaFile, '.java');
          for (const [name, definition] of Object.entries(categoryComponents)) {
            if (
              name.toLowerCase().includes(fileName.toLowerCase()) ||
              fileName.toLowerCase().includes(name.toLowerCase())
            ) {
              return {
                category,
                name,
                definition,
                matchedJavaFiles: [javaFile],
                nodeFiles: definition.files || [],
              };
            }
          }
        }

        // Return generic match
        const componentName = this.extractComponentName(javaFile);
        return {
          category,
          name: componentName,
          definition: {
            status: 'pending',
            description: `Component inferred from package ${packagePath}`,
          },
          matchedJavaFiles: [javaFile],
          nodeFiles: [],
        };
      }
    }

    return null;
  }

  /**
   * Extract component name from Java file path.
   */
  private extractComponentName(javaFile: string): string {
    const fileName = path.basename(javaFile, '.java');
    // Remove common suffixes
    return fileName
      .replace(/Properties$/, '')
      .replace(/Receiver$/, '')
      .replace(/Dispatcher$/, '')
      .replace(/Connector$/, '')
      .toLowerCase();
  }

  /**
   * Consolidate matches to group Java files into their components.
   */
  private consolidateMatches(
    matches: MatchedComponent[],
    allJavaFiles: string[]
  ): MatchedComponent[] {
    const componentMap = new Map<string, MatchedComponent>();

    for (const match of matches) {
      const key = `${match.category}/${match.name}`;
      const existing = componentMap.get(key);

      if (existing) {
        // Merge Java files
        for (const file of match.matchedJavaFiles) {
          if (!existing.matchedJavaFiles.includes(file)) {
            existing.matchedJavaFiles.push(file);
          }
        }
      } else {
        componentMap.set(key, match);
      }
    }

    return Array.from(componentMap.values());
  }

  /**
   * Check if a Java file affects any ported component.
   */
  async isRelevantFile(javaFile: string): Promise<boolean> {
    const config = await this.loadConfig();

    // Check explicit mappings
    for (const components of Object.values(config.mappings)) {
      for (const mapping of Object.values(components)) {
        if (mapping.java.some((pattern) => javaFile.includes(pattern.replace(/.*\/src\//, '')))) {
          return true;
        }
      }
    }

    // Check manifest javaSource
    for (const components of Object.values(this.manifest.components)) {
      if (!components) continue;
      for (const definition of Object.values(components)) {
        if (definition.javaSource) {
          const normalized = definition.javaSource
            .replace(/^\/Users\/[^/]+\/Projects\/connect\//, '')
            .replace(/\/$/, '');
          if (javaFile.startsWith(normalized) || javaFile.includes(normalized)) {
            return true;
          }
        }
      }
    }

    // Check package prefixes
    const match = javaFile.match(/(?:server|donkey)\/src\/(?:main\/java\/)?(.+)\/[^/]+\.java$/);
    if (match) {
      const packagePath = match[1]!.replace(/\//g, '.');
      for (const prefix of Object.keys(config.packagePrefixes)) {
        if (packagePath.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }
}
