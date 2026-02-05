/**
 * ReportGenerator - Generate upgrade plan reports.
 */

import type { UpgradePlan } from '../models/MigrationTask.js';

export class ReportGenerator {
  /**
   * Generate a comprehensive upgrade plan report.
   */
  generatePlanReport(plan: UpgradePlan): string {
    const lines: string[] = [];

    lines.push(`# Upgrade Plan: ${plan.fromVersion} → ${plan.toVersion}`);
    lines.push('');
    lines.push(`Generated: ${plan.generatedAt}`);
    lines.push(`Feature Branch: \`${plan.featureBranch}\``);
    lines.push('');

    // Executive summary
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Tasks | ${plan.totalTasks} |`);
    lines.push(`| Waves | ${plan.waves.length} |`);
    lines.push(`| Estimated Effort | ${plan.estimatedEffort} |`);
    lines.push(`| Breaking Changes | ${plan.summary.breaking} |`);
    lines.push(`| Major Changes | ${plan.summary.major} |`);
    lines.push(`| Minor Changes | ${plan.summary.minor} |`);
    lines.push(`| Patch Changes | ${plan.summary.patch} |`);
    lines.push('');

    // Risk assessment
    lines.push('## Risk Assessment');
    lines.push('');
    if (plan.summary.breaking > 0) {
      lines.push(
        `⚠️ **HIGH RISK**: ${plan.summary.breaking} breaking change(s) detected. ` +
          `These require careful review and may need API compatibility shims.`
      );
    } else if (plan.summary.major > 0) {
      lines.push(
        `🔶 **MODERATE RISK**: ${plan.summary.major} major change(s) detected. ` +
          `Review behavioral changes carefully.`
      );
    } else {
      lines.push(
        `✅ **LOW RISK**: No breaking or major changes detected. ` +
          `This should be a straightforward upgrade.`
      );
    }
    lines.push('');

    // Wave breakdown
    lines.push('## Wave Breakdown');
    lines.push('');
    lines.push(
      'Tasks are grouped into waves for parallel execution. ' +
        'Each wave can run multiple agents concurrently using git worktrees.'
    );
    lines.push('');

    for (const wave of plan.waves) {
      lines.push(`### Wave ${wave.number}: ${wave.description}`);
      lines.push('');
      lines.push(`- **Tasks**: ${wave.tasks.length}`);
      lines.push(`- **Estimated Effort**: ${wave.totalEffort}`);
      lines.push(`- **Can Start**: ${wave.canStart ? 'Yes' : 'No (blocked by previous wave)'}`);
      lines.push('');

      if (wave.tasks.length > 0) {
        lines.push('| Component | Severity | Effort | Files |');
        lines.push('|-----------|----------|--------|-------|');
        for (const task of wave.tasks) {
          const severity = this.getSeverityEmoji(task.severity);
          lines.push(
            `| ${task.category}/${task.component} | ${severity} | ${task.effort} | ${task.javaChanges.length} Java, ${task.nodeFiles.length} Node |`
          );
        }
        lines.push('');
      }
    }

    // Schema migrations
    if (plan.schemaTasks.length > 0) {
      lines.push('## Schema Migrations');
      lines.push('');
      lines.push(
        'The following database schema changes need to be applied. ' +
          'Run these after core component updates (Wave 2).'
      );
      lines.push('');

      for (const task of plan.schemaTasks) {
        lines.push(`### ${task.title}`);
        lines.push('');
        if (task.description) {
          lines.push(task.description);
          lines.push('');
        }
      }
    }

    // Execution plan
    lines.push('## Execution Plan');
    lines.push('');
    lines.push('### Prerequisites');
    lines.push('');
    lines.push('1. Ensure all current tests pass: `npm test`');
    lines.push(`2. Create feature branch: \`git checkout -b ${plan.featureBranch} master\``);
    lines.push(`3. Update manifest.json with version metadata for ${plan.toVersion}`);
    lines.push('');

    lines.push('### Wave Execution');
    lines.push('');
    lines.push('For each wave:');
    lines.push('');
    lines.push('1. Create worktrees for wave tasks');
    lines.push('2. Spawn Claude agents (one per task)');
    lines.push('3. Wait for all agents to complete');
    lines.push('4. Merge branches back to feature branch');
    lines.push('5. Run tests to verify wave');
    lines.push('6. Clean up worktrees');
    lines.push('');

    lines.push('### Worktree Commands');
    lines.push('');
    lines.push('```bash');
    lines.push('# Wave 1 setup');
    for (const task of plan.waves[0]?.tasks || []) {
      lines.push(
        `git worktree add ../mirth-${plan.toVersion}-${task.component} -b upgrade/${plan.toVersion}-${task.component} ${plan.featureBranch}`
      );
    }
    lines.push('');
    lines.push('# After wave completion');
    lines.push(`git checkout ${plan.featureBranch}`);
    lines.push(`git merge --no-ff upgrade/${plan.toVersion}-* -m "Merge Wave 1"`);
    lines.push('git worktree prune');
    lines.push('```');
    lines.push('');

    // Validation steps
    lines.push('### Validation');
    lines.push('');
    lines.push('After all waves complete:');
    lines.push('');
    lines.push('1. Run full test suite: `npm test`');
    lines.push(`2. Run validation: \`mirth-version validate ${plan.toVersion}\``);
    lines.push('3. Update version in package.json');
    lines.push('4. Update manifest.json status to "validated"');
    lines.push('5. Merge to master: `git checkout master && git merge ' + plan.featureBranch + '`');
    lines.push('');

    // Rollback plan
    lines.push('## Rollback Plan');
    lines.push('');
    lines.push('If issues are discovered:');
    lines.push('');
    lines.push('1. Switch back to master: `git checkout master`');
    lines.push(`2. Delete feature branch: \`git branch -D ${plan.featureBranch}\``);
    lines.push('3. Investigate issues in a new branch');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Get emoji for severity level.
   */
  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'breaking':
        return '🔴 Breaking';
      case 'major':
        return '🟡 Major';
      case 'minor':
        return '🔵 Minor';
      case 'patch':
        return '🟢 Patch';
      default:
        return severity;
    }
  }
}
