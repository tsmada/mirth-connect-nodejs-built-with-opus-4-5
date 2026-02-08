/**
 * GitSyncService — Orchestrates export-to-git and import-from-git workflows.
 *
 * Push workflow: channel XML -> decompose -> file tree -> git add/commit/push
 * Pull workflow: read file tree -> assemble channel XML -> optionally deploy
 *
 * The service writes channels to a standard directory layout:
 *   channels/{sanitized-name}/channel.yaml
 *   channels/{sanitized-name}/source/connector.yaml
 *   channels/{sanitized-name}/destinations/{name}/connector.yaml
 *   code-templates/{library-name}/{template-name}.js
 *   groups/groups.yaml
 *   config/config.yaml
 *   .mirth-sync.yaml
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { GitClient } from './GitClient.js';
import { decompose, toFileTree } from '../ChannelDecomposer.js';
import { assemble } from '../ChannelAssembler.js';
import { FileTreeEntry, sanitizeName, DecomposedChannel } from '../types.js';

export interface SyncResult {
  direction: 'push' | 'pull';
  channelsAffected: string[];
  commitHash?: string;
  warnings: string[];
  errors: string[];
}

export interface PushOptions {
  channels?: string[];
  message?: string;
  push?: boolean;
  maskSecrets?: boolean;
}

export interface PullOptions {
  channels?: string[];
  environment?: string;
  deploy?: boolean;
}

export interface RepoMetadata {
  engine: {
    type: 'nodejs' | 'java';
    mirthVersion: string;
    nodeVersion?: string;
    e4xSupport: boolean;
    schemaVersion: string;
  };
  serverId: string;
  lastSync: string;
  gitFlow?: {
    model: 'environment-branches' | 'trunk-based' | 'release-branches';
    branches?: Record<string, string>;
    autoSync?: Record<string, boolean>;
  };
}

export interface CodeTemplateExport {
  libraryName: string;
  libraryId: string;
  templates: Array<{ name: string; id: string; script: string }>;
  enabledChannelIds: string[];
}

export interface GroupExport {
  name: string;
  id: string;
  channelIds: string[];
}

export interface ConfigExport {
  dependencies?: Record<string, string[]>;
  tags?: Record<string, string[]>;
  metadata?: Record<string, unknown>;
  globalScripts?: Record<string, string>;
}

export class GitSyncService {
  constructor(
    private gitClient: GitClient,
    private repoPath: string
  ) {}

  /**
   * Export channels from engine to git repository.
   *
   * For each channel XML:
   * 1. Decompose into structured files (YAML config + JS scripts)
   * 2. Write to channels/{sanitized-name}/ directory
   * 3. Also store raw XML for round-trip assembly
   * 4. Stage, commit, and optionally push
   */
  async pushToGit(
    channelXmls: Map<string, string>,
    options?: PushOptions
  ): Promise<SyncResult> {
    const result: SyncResult = {
      direction: 'push',
      channelsAffected: [],
      warnings: [],
      errors: [],
    };

    const channelsDir = path.join(this.repoPath, 'channels');
    await fs.mkdir(channelsDir, { recursive: true });

    for (const [channelId, xml] of channelXmls) {
      // Filter to specific channels if requested
      if (options?.channels && !options.channels.includes(channelId)) {
        continue;
      }

      try {
        const decomposed = decompose(xml, {
          maskSecrets: options?.maskSecrets ?? true,
        });

        const channelDir = sanitizeName(decomposed.metadata.name);
        const files = toFileTree(decomposed);

        await this.writeChannel(channelDir, files);

        // Store raw XML for round-trip assembly fidelity
        const rawXmlPath = path.join(channelsDir, channelDir, '.raw.xml');
        await fs.writeFile(rawXmlPath, xml, 'utf-8');

        result.channelsAffected.push(decomposed.metadata.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Channel ${channelId}: ${msg}`);
      }
    }

    if (result.channelsAffected.length === 0 && result.errors.length > 0) {
      return result;
    }

    // Stage all changes
    try {
      await this.gitClient.add('.');

      const status = await this.gitClient.status();
      if (status.clean) {
        result.warnings.push('No changes to commit');
        return result;
      }

      const message = options?.message
        || `sync: export ${result.channelsAffected.length} channel(s)`;
      result.commitHash = await this.gitClient.commit(message);

      if (options?.push) {
        await this.gitClient.push();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Git operation failed: ${msg}`);
    }

    return result;
  }

  /**
   * Import channels from git repository back to engine-ready XML.
   *
   * For each channel directory:
   * 1. Read the decomposed file tree
   * 2. Reassemble into valid channel XML via ChannelAssembler
   * 3. Optionally resolve environment variables
   */
  async pullFromGit(
    options?: PullOptions
  ): Promise<{ channels: Array<{ id: string; name: string; xml: string }>; warnings: string[] }> {
    const warnings: string[] = [];
    const channels: Array<{ id: string; name: string; xml: string }> = [];

    const channelDirs = await this.listChannels();

    for (const channelDir of channelDirs) {
      if (options?.channels && !options.channels.includes(channelDir)) {
        continue;
      }

      try {
        const channelsBasePath = path.join(this.repoPath, 'channels', channelDir);

        // Read raw XML for round-trip assembly
        const rawXmlPath = path.join(channelsBasePath, '.raw.xml');
        let rawXml: string;
        try {
          rawXml = await fs.readFile(rawXmlPath, 'utf-8');
        } catch {
          warnings.push(`${channelDir}: no .raw.xml found, cannot assemble`);
          continue;
        }

        // Decompose from stored raw XML to get a DecomposedChannel
        const decomposed = decompose(rawXml);

        // Read any modified files from disk and overlay them
        const files = await this.readChannel(channelDir);
        this.overlayFilesOnDecomposed(decomposed, files);

        // Assemble back to XML, optionally resolving variables
        const assembleOptions = options?.environment
          ? { variables: await this.loadEnvironmentVariables(options.environment) }
          : undefined;

        const xml = assemble(decomposed, assembleOptions);

        channels.push({
          id: decomposed.metadata.id,
          name: decomposed.metadata.name,
          xml,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${channelDir}: ${msg}`);
      }
    }

    return { channels, warnings };
  }

  /**
   * Write .mirth-sync.yaml with repository metadata.
   */
  async writeRepoMetadata(metadata: RepoMetadata): Promise<void> {
    const filePath = path.join(this.repoPath, '.mirth-sync.yaml');
    const content = yaml.dump(metadata, { lineWidth: -1, noRefs: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Read .mirth-sync.yaml if present.
   */
  async readRepoMetadata(): Promise<RepoMetadata | null> {
    const filePath = path.join(this.repoPath, '.mirth-sync.yaml');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return yaml.load(content) as RepoMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Write a decomposed channel to the filesystem under channels/{channelDir}/.
   */
  async writeChannel(channelDir: string, files: FileTreeEntry[]): Promise<void> {
    const channelsBase = path.join(this.repoPath, 'channels', channelDir);

    for (const file of files) {
      const filePath = path.join(channelsBase, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, 'utf-8');
    }
  }

  /**
   * Read all files from a channel directory back into FileTreeEntry[].
   */
  async readChannel(channelDir: string): Promise<FileTreeEntry[]> {
    const channelsBase = path.join(this.repoPath, 'channels', channelDir);
    const entries: FileTreeEntry[] = [];

    await this.readDirRecursive(channelsBase, '', entries);

    return entries;
  }

  /**
   * List all channel directories in the repository.
   */
  async listChannels(): Promise<string[]> {
    const channelsDir = path.join(this.repoPath, 'channels');
    try {
      const entries = await fs.readdir(channelsDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Export code template libraries to the repository.
   *
   * Layout: code-templates/{library-name}/library.yaml + {template-name}.js
   */
  async writeCodeTemplates(templates: CodeTemplateExport[]): Promise<void> {
    const baseDir = path.join(this.repoPath, 'code-templates');
    await fs.mkdir(baseDir, { recursive: true });

    for (const lib of templates) {
      const libDir = path.join(baseDir, sanitizeName(lib.libraryName));
      await fs.mkdir(libDir, { recursive: true });

      // Library metadata
      const meta = {
        name: lib.libraryName,
        id: lib.libraryId,
        enabledChannelIds: lib.enabledChannelIds,
      };
      await fs.writeFile(
        path.join(libDir, 'library.yaml'),
        yaml.dump(meta, { lineWidth: -1, noRefs: true }),
        'utf-8'
      );

      // Individual templates as .js files
      for (const tmpl of lib.templates) {
        const header = `// @id ${tmpl.id}\n// @name ${tmpl.name}\n\n`;
        await fs.writeFile(
          path.join(libDir, `${sanitizeName(tmpl.name)}.js`),
          header + tmpl.script,
          'utf-8'
        );
      }
    }
  }

  /**
   * Export channel groups to the repository.
   */
  async writeGroups(groups: GroupExport[]): Promise<void> {
    const groupsDir = path.join(this.repoPath, 'groups');
    await fs.mkdir(groupsDir, { recursive: true });

    await fs.writeFile(
      path.join(groupsDir, 'groups.yaml'),
      yaml.dump(groups, { lineWidth: -1, noRefs: true }),
      'utf-8'
    );
  }

  /**
   * Export server configuration to the repository.
   */
  async writeConfig(config: ConfigExport): Promise<void> {
    const configDir = path.join(this.repoPath, 'config');
    await fs.mkdir(configDir, { recursive: true });

    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      yaml.dump(config, { lineWidth: -1, noRefs: true }),
      'utf-8'
    );

    // Write global scripts as separate .js files for diffability
    if (config.globalScripts) {
      const scriptsDir = path.join(configDir, 'scripts');
      await fs.mkdir(scriptsDir, { recursive: true });

      for (const [name, script] of Object.entries(config.globalScripts)) {
        await fs.writeFile(
          path.join(scriptsDir, `${sanitizeName(name)}.js`),
          script,
          'utf-8'
        );
      }
    }
  }

  // ───── Private helpers ─────

  /**
   * Recursively read a directory into FileTreeEntry[].
   * Skips .raw.xml (internal assembly artifact, not user-facing).
   */
  private async readDirRecursive(
    baseDir: string,
    relativePath: string,
    entries: FileTreeEntry[]
  ): Promise<void> {
    const fullPath = relativePath
      ? path.join(baseDir, relativePath)
      : baseDir;

    const dirEntries = await fs.readdir(fullPath, { withFileTypes: true });

    for (const entry of dirEntries) {
      const entryRelPath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        await this.readDirRecursive(baseDir, entryRelPath, entries);
      } else if (entry.isFile()) {
        // Skip internal files
        if (entry.name === '.raw.xml') continue;

        const content = await fs.readFile(
          path.join(baseDir, entryRelPath),
          'utf-8'
        );

        let type: 'yaml' | 'js' | 'xml';
        if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
          type = 'yaml';
        } else if (entry.name.endsWith('.js')) {
          type = 'js';
        } else {
          type = 'xml';
        }

        entries.push({ path: entryRelPath, content, type });
      }
    }
  }

  /**
   * Overlay modified files from disk onto a DecomposedChannel.
   *
   * This reads channel.yaml for metadata updates and script files for
   * content updates, then patches the decomposed channel in-place.
   */
  private overlayFilesOnDecomposed(
    decomposed: DecomposedChannel,
    files: FileTreeEntry[]
  ): void {
    for (const file of files) {
      if (file.path === 'channel.yaml') {
        const meta = yaml.load(file.content) as Record<string, unknown>;
        if (meta.name) decomposed.metadata.name = String(meta.name);
        if (meta.description !== undefined) {
          decomposed.metadata.description = String(meta.description);
        }
        if (meta.enabled !== undefined) {
          decomposed.metadata.enabled = Boolean(meta.enabled);
        }
      }

      // Overlay deploy/undeploy/preprocess/postprocess scripts
      if (file.path === 'scripts/deploy.js') {
        decomposed.scripts.deploy = file.content;
      }
      if (file.path === 'scripts/undeploy.js') {
        decomposed.scripts.undeploy = file.content;
      }
      if (file.path === 'scripts/preprocess.js') {
        decomposed.scripts.preprocess = file.content;
      }
      if (file.path === 'scripts/postprocess.js') {
        decomposed.scripts.postprocess = file.content;
      }

      // Overlay transformer/filter scripts
      this.overlayTransformerScript(decomposed, file);
    }
  }

  /**
   * Overlay a transformer or filter script file onto the decomposed channel.
   * Matches by path pattern, e.g., source/transformer/step-0-set-field.js
   */
  private overlayTransformerScript(
    decomposed: DecomposedChannel,
    file: FileTreeEntry
  ): void {
    if (file.type !== 'js') return;

    // Parse @sequence from header comments
    const seqMatch = file.content.match(/^\/\/ @sequence (\d+)/m);
    if (!seqMatch) return;
    const seq = parseInt(seqMatch[1]!, 10);

    // Strip header comments to get the actual script body
    const scriptBody = file.content.replace(/^\/\/ @[^\n]*\n/gm, '').replace(/^\n/, '');

    const parts = file.path.split('/');

    if (parts[0] === 'source' && parts[1] === 'transformer') {
      const step = decomposed.source.transformer?.steps.find(s => s.sequenceNumber === seq);
      if (step) step.script = scriptBody;
    } else if (parts[0] === 'source' && parts[1] === 'response-transformer') {
      const step = decomposed.source.responseTransformer?.steps.find(s => s.sequenceNumber === seq);
      if (step) step.script = scriptBody;
    } else if (parts[0] === 'source' && parts[1] === 'filter') {
      const rule = decomposed.source.filter?.rules.find(r => r.sequenceNumber === seq);
      if (rule) rule.script = scriptBody;
    } else if (parts[0] === 'destinations' && parts.length >= 4) {
      const destName = parts[1]!;
      const dest = decomposed.destinations.get(destName);
      if (!dest) return;

      if (parts[2] === 'transformer') {
        const step = dest.transformer?.steps.find(s => s.sequenceNumber === seq);
        if (step) step.script = scriptBody;
      } else if (parts[2] === 'response-transformer') {
        const step = dest.responseTransformer?.steps.find(s => s.sequenceNumber === seq);
        if (step) step.script = scriptBody;
      } else if (parts[2] === 'filter') {
        const rule = dest.filter?.rules.find(r => r.sequenceNumber === seq);
        if (rule) rule.script = scriptBody;
      }
    }
  }

  /**
   * Load environment-specific variables from an env file.
   * Looks for config/environments/{envName}.yaml in the repo.
   */
  private async loadEnvironmentVariables(
    environment: string
  ): Promise<Record<string, string>> {
    const envPath = path.join(
      this.repoPath,
      'config',
      'environments',
      `${environment}.yaml`
    );
    try {
      const content = await fs.readFile(envPath, 'utf-8');
      const vars = yaml.load(content);
      if (vars && typeof vars === 'object') {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(vars as Record<string, unknown>)) {
          result[key] = String(value);
        }
        return result;
      }
      return {};
    } catch {
      return {};
    }
  }
}
