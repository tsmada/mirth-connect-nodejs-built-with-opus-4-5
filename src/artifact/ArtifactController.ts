/**
 * ArtifactController -- Central orchestrator for git-backed artifact management.
 *
 * Bridges the decomposer/assembler, git client, sync service, sensitive data
 * detector, diff engine, promotion pipeline, and delta detector modules into
 * a unified API that the REST servlet and CLI consume.
 *
 * Lifecycle:
 *   1. ArtifactController.initialize(repoPath) -- sets up git client and sync
 *   2. exportChannel / importChannel -- Engine <-> Git
 *   3. diffChannel / detectSecrets / getDependencyGraph -- Analysis
 *   4. pushToGit / pullFromGit -- Git operations
 *   5. promote / detectDelta / deployDelta -- Environment promotion & delta deploy
 */

import yaml from 'js-yaml';
import { decompose, toFileTree } from './ChannelDecomposer.js';
import { assemble } from './ChannelAssembler.js';
import { SensitiveDataDetector } from './SensitiveDataDetector.js';
import { VariableResolver } from './VariableResolver.js';
import { ChannelDiff } from './ChannelDiff.js';
import type { DiffResult, DecomposedChannelFlat } from './ChannelDiff.js';
import { GitClient } from './git/GitClient.js';
import type { GitStatus, GitLogEntry } from './git/GitClient.js';
import { GitSyncService } from './git/GitSyncService.js';
import type { SyncResult } from './git/GitSyncService.js';
import { GitWatcher } from './git/GitWatcher.js';
import { DeltaDetector } from './git/DeltaDetector.js';
import type { DeltaResult } from './git/DeltaDetector.js';
import type { DependencyGraph } from './DependencySort.js';
import { PromotionPipeline } from './promotion/PromotionPipeline.js';
import type {
  PromotionRequest,
  PromotionResult,
  PromotionConfig,
} from './promotion/PromotionPipeline.js';
import { PromotionGate } from './promotion/PromotionGate.js';
import type { ApprovalRecord } from './promotion/PromotionGate.js';
import type { FileTreeEntry, SensitiveField, DecomposedChannel } from './types.js';
import { sanitizeName } from './types.js';
import type { RepoMetadata } from './git/GitSyncService.js';
import { getLogger, registerComponent } from '../logging/index.js';

registerComponent('artifact', 'Git artifact sync');
const logger = getLogger('artifact');

// --- Types -------------------------------------------------------------------

export interface PullResult {
  channels: Array<{ name: string; xml: string; warnings: string[] }>;
  syncResult: SyncResult;
}

export interface DeployResult {
  deployed: string[];
  errors: Array<{ channel: string; error: string }>;
}

// --- Controller --------------------------------------------------------------

export class ArtifactController {
  private static gitClient: GitClient | null = null;
  private static syncService: GitSyncService | null = null;
  private static watcher: GitWatcher | null = null;
  private static repoPath: string | null = null;
  private static sensitiveDetector = new SensitiveDataDetector();
  private static promotionApprovals: ApprovalRecord[] = [];

  // --- Lifecycle -------------------------------------------------------------

  /**
   * Initialize the artifact system with a git repository path.
   * Creates the git client and sync service. If the path is not already
   * a git repo, it will be initialized as one.
   */
  static async initialize(repoPath: string): Promise<void> {
    ArtifactController.repoPath = repoPath;
    ArtifactController.gitClient = new GitClient(repoPath);
    ArtifactController.syncService = new GitSyncService(ArtifactController.gitClient, repoPath);

    const isRepo = await ArtifactController.gitClient.isRepo();
    if (!isRepo) {
      await ArtifactController.gitClient.init();
    }
  }

  /**
   * Start the filesystem watcher for auto-sync on git changes.
   */
  static async startWatcher(): Promise<void> {
    ArtifactController.ensureInitialized();

    if (ArtifactController.watcher) {
      ArtifactController.watcher.stop();
    }

    ArtifactController.watcher = new GitWatcher(ArtifactController.repoPath!, async () => {
      logger.info('[Artifact] File change detected in artifact repo');
    });

    ArtifactController.watcher.start();
  }

  /**
   * Stop the filesystem watcher.
   */
  static async stopWatcher(): Promise<void> {
    if (ArtifactController.watcher) {
      ArtifactController.watcher.stop();
      ArtifactController.watcher = null;
    }
  }

  /**
   * Whether the controller has been initialized with a repo path.
   */
  static isInitialized(): boolean {
    return ArtifactController.gitClient !== null && ArtifactController.repoPath !== null;
  }

  // --- Export (Engine -> Git) -------------------------------------------------

  /**
   * Decompose a single channel XML into a file tree suitable for git storage.
   */
  static async exportChannel(
    _channelId: string,
    channelXml: string,
    options?: { maskSecrets?: boolean }
  ): Promise<FileTreeEntry[]> {
    const decomposed = decompose(channelXml);

    if (options?.maskSecrets !== false) {
      ArtifactController.sensitiveDetector.maskDecomposed(decomposed, decomposed.metadata.name);
    }

    return toFileTree(decomposed);
  }

  /**
   * Export all channels to git: decompose, write, commit, optionally push.
   */
  static async exportAll(
    channelXmls: Map<string, string>,
    options?: { maskSecrets?: boolean; push?: boolean; message?: string }
  ): Promise<SyncResult> {
    ArtifactController.ensureInitialized();

    const syncService = ArtifactController.syncService!;
    const gitClient = ArtifactController.gitClient!;

    const channelEntries: Array<{ name: string; files: FileTreeEntry[] }> = [];

    for (const [id, xml] of channelXmls) {
      const files = await ArtifactController.exportChannel(id, xml, options);
      const decomposed = decompose(xml);
      channelEntries.push({ name: sanitizeName(decomposed.metadata.name), files });
    }

    for (const entry of channelEntries) {
      // writeChannel() already joins repoPath + 'channels' + channelDir,
      // so pass just the channel name, not 'channels/{name}'
      await syncService.writeChannel(entry.name, entry.files);
    }

    // Write repo metadata (.mirth-sync.yaml) with engine info
    const metadata: RepoMetadata = {
      engine: {
        type: 'nodejs',
        mirthVersion: '3.9.1',
        nodeVersion: process.version,
        e4xSupport: true,
        schemaVersion: '1',
      },
      serverId: process.env['MIRTH_SERVER_ID'] || 'unknown',
      lastSync: new Date().toISOString(),
    };

    // Preserve existing gitFlow config if present
    const existingMeta = await syncService.readRepoMetadata();
    if (existingMeta?.gitFlow) {
      metadata.gitFlow = existingMeta.gitFlow;
    }

    await syncService.writeRepoMetadata(metadata);

    await gitClient.add('.');
    const commitMessage = options?.message || `Export ${channelXmls.size} channel(s)`;
    let commitHash: string | undefined;
    try {
      commitHash = await gitClient.commit(commitMessage);
    } catch {
      // Nothing to commit (no changes)
    }

    if (options?.push && commitHash) {
      try {
        await gitClient.push();
      } catch {
        // Push may fail if no remote configured
      }
    }

    return {
      direction: 'push',
      channelsAffected: channelEntries.map((e) => e.name),
      commitHash,
      warnings: [],
      errors: [],
    };
  }

  // --- Import (Git -> Engine) -------------------------------------------------

  /**
   * Import a single channel from the git repo by channel directory name.
   */
  static async importChannel(
    channelName: string,
    options?: { environment?: string }
  ): Promise<{ xml: string; warnings: string[] }> {
    ArtifactController.ensureInitialized();

    const syncService = ArtifactController.syncService!;
    const dirName = sanitizeName(channelName);
    // readChannel() already joins repoPath + 'channels' + channelDir
    const files = await syncService.readChannel(dirName);

    if (files.length === 0) {
      throw new Error(`Channel '${channelName}' not found in artifact repo`);
    }

    const decomposed = ArtifactController.filesToDecomposed(files);
    const warnings: string[] = [];

    if (options?.environment) {
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(ArtifactController.repoPath!, options.environment);
      let rawXml = assemble(decomposed);
      // Resolve ${secret:KEY} references from secrets providers
      try {
        const { resolveSecretReferences } =
          await import('../secrets/integration/VariableResolverPlugin.js');
        const secretResult = await resolveSecretReferences(rawXml);
        rawXml = secretResult.resolved;
      } catch {
        /* secrets module not loaded */
      }
      const result = resolver.resolve(rawXml);
      if (result.unresolvedVars.length > 0) {
        warnings.push(`Unresolved variables: ${result.unresolvedVars.join(', ')}`);
      }
      return { xml: result.resolved, warnings };
    }

    return { xml: assemble(decomposed), warnings };
  }

  /**
   * Import all channels from the git repo.
   */
  static async importAll(options?: {
    environment?: string;
  }): Promise<Array<{ name: string; xml: string; warnings: string[] }>> {
    ArtifactController.ensureInitialized();

    const syncService = ArtifactController.syncService!;
    const channelDirs = await syncService.listChannels();
    const results: Array<{ name: string; xml: string; warnings: string[] }> = [];

    for (const dir of channelDirs) {
      try {
        const result = await ArtifactController.importChannel(dir, options);
        results.push({ name: dir, ...result });
      } catch (err) {
        results.push({
          name: dir,
          xml: '',
          warnings: [`Failed to import: ${String(err)}`],
        });
      }
    }

    return results;
  }

  // --- Analysis ---------------------------------------------------------------

  /**
   * Diff a channel's current XML against the git-stored version.
   */
  static async diffChannel(_channelId: string, currentXml: string): Promise<DiffResult> {
    ArtifactController.ensureInitialized();

    const currentDecomposed = decompose(currentXml);
    const dirName = sanitizeName(currentDecomposed.metadata.name);
    const syncService = ArtifactController.syncService!;

    let gitFiles: FileTreeEntry[];
    try {
      // readChannel() already joins repoPath + 'channels' + channelDir
      gitFiles = await syncService.readChannel(dirName);
    } catch {
      gitFiles = [];
    }

    const currentFlat = ArtifactController.toFlat(currentDecomposed);

    if (gitFiles.length === 0) {
      return {
        channelName: currentDecomposed.metadata.name,
        changeCount: 1,
        configChanges: [{ path: 'channel', type: 'added', newValue: '(entire channel)' }],
        scriptChanges: [],
        summary: 'New channel (not in git)',
      };
    }

    const gitDecomposed = ArtifactController.filesToDecomposed(gitFiles);
    const gitFlat = ArtifactController.toFlat(gitDecomposed);

    return ChannelDiff.diff(gitFlat, currentFlat);
  }

  /**
   * Detect sensitive fields in channel XML.
   */
  static async detectSecrets(channelXml: string): Promise<SensitiveField[]> {
    const decomposed = decompose(channelXml);
    return ArtifactController.sensitiveDetector.detect(decomposed);
  }

  /**
   * Build a dependency graph from channel configurations.
   */
  static async getDependencyGraph(
    channels?: Array<{ id: string; xml: string }>
  ): Promise<DependencyGraph> {
    const nodes: string[] = [];
    const edges = new Map<string, string[]>();

    if (channels) {
      for (const ch of channels) {
        nodes.push(ch.id);
        const deps = ArtifactController.extractChannelWriterTargets(ch.xml);
        if (deps.length > 0) {
          edges.set(ch.id, deps);
        }
      }
    }

    return { nodes, edges };
  }

  // --- Git Operations ---------------------------------------------------------

  /**
   * Get the current git status of the artifact repo.
   */
  static async getGitStatus(): Promise<GitStatus> {
    ArtifactController.ensureInitialized();
    return ArtifactController.gitClient!.status();
  }

  /**
   * Commit and push to git.
   */
  static async pushToGit(options?: { message?: string }): Promise<SyncResult> {
    ArtifactController.ensureInitialized();

    const gitClient = ArtifactController.gitClient!;

    await gitClient.add('.');
    const message = options?.message || `Sync artifact repository`;
    let commitHash: string | undefined;
    try {
      commitHash = await gitClient.commit(message);
    } catch {
      // Nothing to commit
    }

    try {
      await gitClient.push();
    } catch {
      // Push may fail if no remote configured
    }

    return {
      direction: 'push',
      channelsAffected: [],
      commitHash,
      warnings: [],
      errors: [],
    };
  }

  /**
   * Pull from git and optionally import channels.
   */
  static async pullFromGit(options?: {
    environment?: string;
    deploy?: boolean;
  }): Promise<PullResult> {
    ArtifactController.ensureInitialized();

    const gitClient = ArtifactController.gitClient!;

    try {
      await gitClient.pull();
    } catch {
      // Pull may fail if no remote configured
    }

    const channels = await ArtifactController.importAll({ environment: options?.environment });

    return {
      channels,
      syncResult: {
        direction: 'pull',
        channelsAffected: channels.map((c) => c.name),
        warnings: channels.flatMap((c) => c.warnings),
        errors: [],
      },
    };
  }

  /**
   * Get recent git log entries.
   */
  static async getGitLog(limit?: number): Promise<GitLogEntry[]> {
    ArtifactController.ensureInitialized();
    return ArtifactController.gitClient!.log(limit || 20);
  }

  // --- Promotion --------------------------------------------------------------

  /**
   * Promote channels between environments.
   */
  static async promote(request: PromotionRequest): Promise<PromotionResult> {
    ArtifactController.ensureInitialized();

    // Read promotion config from .mirth-sync.yaml, fall back to defaults
    const syncService = ArtifactController.syncService!;
    const repoMeta = await syncService.readRepoMetadata();

    const defaultConfig: PromotionConfig = {
      gitFlow: {
        model: 'environment-branches',
        branches: { dev: 'dev', staging: 'staging', prod: 'main' },
      },
      environments: ['dev', 'staging', 'prod'],
    };

    const config: PromotionConfig = repoMeta?.gitFlow
      ? {
          gitFlow: {
            model: repoMeta.gitFlow.model || 'environment-branches',
            branches: repoMeta.gitFlow.branches || defaultConfig.gitFlow.branches,
            autoSync: repoMeta.gitFlow.autoSync,
          },
          environments: Object.keys(repoMeta.gitFlow.branches || defaultConfig.gitFlow.branches),
        }
      : defaultConfig;

    const pipeline = new PromotionPipeline(config);
    const validation = pipeline.validate(request);

    if (!validation.valid) {
      return {
        success: false,
        sourceEnv: request.sourceEnv,
        targetEnv: request.targetEnv,
        channelsPromoted: [],
        warnings: [],
        errors: validation.errors,
      };
    }

    if (request.dryRun) {
      return {
        success: true,
        sourceEnv: request.sourceEnv,
        targetEnv: request.targetEnv,
        channelsPromoted: request.channelIds || [],
        warnings: [],
        errors: [],
        blocked: false,
      };
    }

    if (request.approvedBy) {
      const approval = PromotionGate.createApproval({
        sourceEnv: request.sourceEnv,
        targetEnv: request.targetEnv,
        channelIds: request.channelIds || [],
        approvedBy: request.approvedBy,
        status: 'approved',
      });
      ArtifactController.promotionApprovals.push(approval);
    }

    // Discover channels from the git repo to pass to the pipeline
    const channelDirs = await syncService.listChannels();
    const channels: Array<{ id: string; name: string; metadata: Record<string, unknown> }> = [];

    for (const dir of channelDirs) {
      try {
        const files = await syncService.readChannel(dir);
        const yamlFile = files.find((f) => f.path.endsWith('channel.yaml'));
        if (yamlFile) {
          const parsed = yaml.load(yamlFile.content) as Record<string, unknown> | undefined;
          channels.push({
            id: (parsed?.id as string) || dir,
            name: (parsed?.name as string) || dir,
            metadata: parsed || {},
          });
        } else {
          channels.push({ id: dir, name: dir, metadata: {} });
        }
      } catch {
        channels.push({ id: dir, name: dir, metadata: {} });
      }
    }

    const result = await pipeline.promote(request, channels, undefined, undefined);
    return result;
  }

  /**
   * Get promotion approval status.
   */
  static async getPromotionStatus(): Promise<{
    pending: ApprovalRecord[];
    history: ApprovalRecord[];
  }> {
    const pending = ArtifactController.promotionApprovals.filter((a) => a.status === 'pending');
    const history = ArtifactController.promotionApprovals.filter((a) => a.status !== 'pending');
    return { pending, history };
  }

  // --- Delta Deploy -----------------------------------------------------------

  /**
   * Detect changed artifacts between two git refs.
   */
  static async detectDelta(fromRef?: string, toRef?: string): Promise<DeltaResult> {
    ArtifactController.ensureInitialized();

    const gitClient = ArtifactController.gitClient!;
    const from = fromRef || 'HEAD~1';
    const to = toRef || 'HEAD';

    let changedFiles: string[];
    try {
      changedFiles = await gitClient.diffNameOnly(from, to);
    } catch {
      return {
        changedChannels: [],
        changedCodeTemplates: [],
        changedConfig: [],
        cascadedChannels: [],
        totalAffected: 0,
        summary: 'No changes detected (invalid git refs)',
      };
    }

    return DeltaDetector.detect(changedFiles);
  }

  /**
   * Deploy changed artifacts (delta deploy).
   * Returns the list of channel names that need redeployment.
   */
  static async deployDelta(options?: {
    fromRef?: string;
    channels?: string[];
  }): Promise<DeployResult> {
    const delta = await ArtifactController.detectDelta(options?.fromRef);

    let channelsToProcess = delta.changedChannels.map((c) => c.channelName);
    const cascaded = delta.cascadedChannels.map((c) => c.channelName);
    channelsToProcess = [...new Set([...channelsToProcess, ...cascaded])];

    if (options?.channels && options.channels.length > 0) {
      const requested = new Set(options.channels);
      channelsToProcess = channelsToProcess.filter((c) => requested.has(c));
    }

    return {
      deployed: channelsToProcess,
      errors: [],
    };
  }

  // --- Helpers ----------------------------------------------------------------

  private static ensureInitialized(): void {
    if (!ArtifactController.isInitialized()) {
      throw new Error(
        'ArtifactController not initialized. Call ArtifactController.initialize(repoPath) first.'
      );
    }
  }

  /**
   * Convert a FileTreeEntry[] back into a DecomposedChannel structure.
   */
  private static filesToDecomposed(files: FileTreeEntry[]): DecomposedChannel {
    let metadata: Record<string, unknown> = {
      id: '',
      name: '',
      version: '',
      revision: 0,
      enabled: true,
    };
    const scripts: Record<string, string> = {};
    let source: Record<string, unknown> = {
      name: 'Source',
      metaDataId: 0,
      transportName: 'Channel Reader',
      mode: 'SOURCE',
      enabled: true,
      properties: {},
      propertiesClass: '',
    };
    const destinations = new Map<string, Record<string, unknown>>();

    for (const file of files) {
      const parts = file.path.split('/');

      if (file.path.endsWith('channel.yaml')) {
        const parsed = yaml.load(file.content);
        if (parsed && typeof parsed === 'object') {
          metadata = { ...metadata, ...(parsed as Record<string, unknown>) };
        }
      } else if (parts.includes('scripts')) {
        const scriptName = parts[parts.length - 1]?.replace(/\.js$/, '');
        if (scriptName) {
          scripts[scriptName] = file.content;
        }
      } else if (parts.includes('source')) {
        if (file.path.endsWith('connector.yaml')) {
          const parsed = yaml.load(file.content);
          if (parsed && typeof parsed === 'object') {
            source = { ...source, ...(parsed as Record<string, unknown>) };
          }
        }
      } else if (parts.includes('destinations')) {
        const destIdx = parts.indexOf('destinations');
        const destName = parts[destIdx + 1];
        if (destName) {
          if (!destinations.has(destName)) {
            destinations.set(destName, {
              name: destName,
              metaDataId: 1,
              transportName: 'Channel Writer',
              mode: 'DESTINATION',
              enabled: true,
              properties: {},
              propertiesClass: '',
            });
          }
          if (file.path.endsWith('connector.yaml')) {
            const parsed = yaml.load(file.content);
            if (parsed && typeof parsed === 'object') {
              destinations.set(destName, {
                ...destinations.get(destName)!,
                ...(parsed as Record<string, unknown>),
              });
            }
          }
        }
      }
    }

    // Read _raw.xml if present — the assembler needs this for lossless round-trip
    const rawFile = files.find((f) => f.path.endsWith('_raw.xml'));
    const rawXml = rawFile?.content || '';

    return {
      metadata: metadata as any,
      source: source as any,
      destinations: destinations as any,
      scripts: scripts as any,
      rawXml,
    };
  }

  /**
   * Convert a DecomposedChannel to the flat format used by ChannelDiff.
   */
  private static toFlat(decomposed: DecomposedChannel): DecomposedChannelFlat {
    const destinations: Record<
      string,
      { connector: Record<string, unknown>; scripts: Record<string, string> }
    > = {};

    for (const [name, dest] of decomposed.destinations) {
      const destScripts: Record<string, string> = {};
      if (dest.transformer) {
        for (const step of dest.transformer.steps) {
          destScripts[`transformer-${step.sequenceNumber}`] = step.script;
        }
      }
      if (dest.filter) {
        for (const rule of dest.filter.rules) {
          destScripts[`filter-${rule.sequenceNumber}`] = rule.script;
        }
      }
      destinations[name] = {
        connector: dest.properties,
        scripts: destScripts,
      };
    }

    const sourceScripts: Record<string, string> = {};
    if (decomposed.source.transformer) {
      for (const step of decomposed.source.transformer.steps) {
        sourceScripts[`transformer-${step.sequenceNumber}`] = step.script;
      }
    }
    if (decomposed.source.filter) {
      for (const rule of decomposed.source.filter.rules) {
        sourceScripts[`filter-${rule.sequenceNumber}`] = rule.script;
      }
    }

    return {
      metadata: decomposed.metadata as unknown as Record<string, unknown>,
      scripts: decomposed.scripts as unknown as Record<string, string>,
      sourceConnector: decomposed.source.properties,
      sourceScripts,
      destinations,
    };
  }

  /**
   * Extract channel IDs from Channel Writer destination configurations in XML.
   */
  private static extractChannelWriterTargets(xml: string): string[] {
    const targets: string[] = [];
    const regex = /<channelId>([^<]+)<\/channelId>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      targets.push(match[1]!);
    }
    return targets;
  }

  /**
   * Reset internal state (for testing).
   */
  static _reset(): void {
    ArtifactController.gitClient = null;
    ArtifactController.syncService = null;
    ArtifactController.watcher = null;
    ArtifactController.repoPath = null;
    ArtifactController.promotionApprovals = [];
  }
}
