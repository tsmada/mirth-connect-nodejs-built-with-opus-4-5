/**
 * Orchestrates channel promotion between environments (dev -> staging -> prod).
 *
 * Validates environment ordering, runs version compatibility checks,
 * sorts channels by dependencies, and records approval gates.
 */

import { DependencySort } from '../DependencySort.js';
import type { DependencyGraph } from '../DependencySort.js';
import { VersionCompatibility } from './VersionCompatibility.js';
import type { VersionWarning, EngineInfo, ChannelVersionMetadata } from './VersionCompatibility.js';
import { PromotionGate } from './PromotionGate.js';
import type { ApprovalRecord } from './PromotionGate.js';

export interface PromotionRequest {
  sourceEnv: string;
  targetEnv: string;
  channelIds?: string[];
  approvedBy?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface PromotionResult {
  success: boolean;
  sourceEnv: string;
  targetEnv: string;
  channelsPromoted: string[];
  warnings: VersionWarning[];
  errors: string[];
  commitHash?: string;
  blocked?: boolean;
  blockReasons?: string[];
}

export interface PromotionConfig {
  gitFlow: {
    model: 'environment-branches' | 'trunk-based' | 'release-branches';
    branches: Record<string, string>;
    autoSync?: Record<string, boolean>;
  };
  environments: string[];
}

export interface ChannelInfo {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
}

export class PromotionPipeline {
  constructor(private config: PromotionConfig) {}

  /**
   * Validate that a promotion is allowed based on environment ordering.
   */
  validate(request: PromotionRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.config.environments.includes(request.sourceEnv)) {
      errors.push(`Unknown source environment: '${request.sourceEnv}'`);
    }
    if (!this.config.environments.includes(request.targetEnv)) {
      errors.push(`Unknown target environment: '${request.targetEnv}'`);
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    if (request.sourceEnv === request.targetEnv) {
      errors.push(`Source and target environment cannot be the same: '${request.sourceEnv}'`);
    } else if (!this.isValidPromotion(request.sourceEnv, request.targetEnv)) {
      errors.push(
        `Cannot promote from '${request.sourceEnv}' to '${request.targetEnv}': target must come after source in pipeline [${this.config.environments.join(' -> ')}]`
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Execute a promotion (or dry-run).
   */
  async promote(
    request: PromotionRequest,
    channels: ChannelInfo[],
    dependencyGraph?: DependencyGraph,
    targetEngine?: EngineInfo
  ): Promise<PromotionResult> {
    const result: PromotionResult = {
      success: false,
      sourceEnv: request.sourceEnv,
      targetEnv: request.targetEnv,
      channelsPromoted: [],
      warnings: [],
      errors: [],
    };

    // 1. Validate environment ordering
    const validation = this.validate(request);
    if (!validation.valid) {
      result.errors = validation.errors;
      return result;
    }

    // 2. Determine which channels to promote
    let channelsToPromote = channels;
    if (request.channelIds && request.channelIds.length > 0) {
      const requestedIds = new Set(request.channelIds);
      channelsToPromote = channels.filter((c) => requestedIds.has(c.id));

      // Check for missing channels
      const foundIds = new Set(channelsToPromote.map((c) => c.id));
      for (const id of request.channelIds) {
        if (!foundIds.has(id)) {
          result.errors.push(`Channel '${id}' not found`);
        }
      }
      if (result.errors.length > 0) {
        return result;
      }
    }

    if (channelsToPromote.length === 0) {
      result.errors.push('No channels to promote');
      return result;
    }

    // 3. Run version compatibility checks
    if (targetEngine) {
      for (const channel of channelsToPromote) {
        const versionMeta = PromotionPipeline.extractVersionMetadata(channel);
        if (versionMeta) {
          const compat = VersionCompatibility.check(
            versionMeta,
            targetEngine,
            channel.id,
            channel.name
          );
          result.warnings.push(...compat.warnings);

          if (!compat.compatible) {
            result.warnings.push(...compat.blocks);
          }
        }
      }
    }

    // Check for blocks (unless force is set)
    const blocks = result.warnings.filter((w) => w.severity === 'block');
    if (blocks.length > 0 && !request.force) {
      result.blocked = true;
      result.blockReasons = blocks.map((b) => b.message);
      return result;
    }

    // 4. Sort by dependencies
    let sortedIds = channelsToPromote.map((c) => c.id);
    if (dependencyGraph) {
      const sortResult = DependencySort.sort(dependencyGraph);
      if (sortResult.hasCycles) {
        result.warnings.push({
          channelId: '',
          channelName: '',
          severity: 'warn',
          message: `Dependency cycles detected: ${JSON.stringify(sortResult.cycles)}`,
        });
      }
      // Reorder to match topological sort (only channels in our set)
      const promoteSet = new Set(sortedIds);
      sortedIds = sortResult.sorted.filter((id) => promoteSet.has(id));
      // Add any channels not in the graph at the end
      for (const id of channelsToPromote.map((c) => c.id)) {
        if (!sortResult.sorted.includes(id)) {
          sortedIds.push(id);
        }
      }
    }

    // 5. If not dry-run, record approval
    if (!request.dryRun) {
      if (request.approvedBy) {
        PromotionGate.createApproval({
          sourceEnv: request.sourceEnv,
          targetEnv: request.targetEnv,
          channelIds: sortedIds,
          approvedBy: request.approvedBy,
          status: 'approved',
        });
      }
    }

    result.success = true;
    result.channelsPromoted = sortedIds;
    return result;
  }

  /**
   * Get the next environment in the pipeline.
   */
  getNextEnvironment(currentEnv: string): string | null {
    const idx = this.config.environments.indexOf(currentEnv);
    if (idx === -1 || idx >= this.config.environments.length - 1) {
      return null;
    }
    return this.config.environments[idx + 1] ?? null;
  }

  /**
   * Check if promotion between two environments is valid (correct ordering).
   * Allows skipping environments (e.g., dev -> prod).
   */
  isValidPromotion(sourceEnv: string, targetEnv: string): boolean {
    const sourceIdx = this.config.environments.indexOf(sourceEnv);
    const targetIdx = this.config.environments.indexOf(targetEnv);
    if (sourceIdx === -1 || targetIdx === -1) return false;
    return targetIdx > sourceIdx;
  }

  /**
   * Get git branch for an environment.
   */
  getBranch(env: string): string {
    return this.config.gitFlow.branches[env] ?? env;
  }

  /**
   * Extract version metadata from channel info for compatibility checking.
   */
  private static extractVersionMetadata(channel: ChannelInfo): ChannelVersionMetadata | null {
    const meta = channel.metadata;
    const version = meta['version'] as string | undefined;
    if (!version) return null;

    const engineVersion = meta['engineVersion'] as
      | { exportedFrom: string; exportedEngine: 'nodejs' | 'java' }
      | undefined;
    const rhinoFeatures = meta['rhinoFeatures'] as
      | { usesE4X: boolean; usesES6: boolean; usesImportPackage: boolean; usesJavaAdapter: boolean }
      | undefined;

    return { version, engineVersion, rhinoFeatures };
  }
}

// Re-export for convenience
export type { VersionWarning, ApprovalRecord, DependencyGraph };
