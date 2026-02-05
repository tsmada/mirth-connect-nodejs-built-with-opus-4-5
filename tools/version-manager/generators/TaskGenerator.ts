/**
 * TaskGenerator - Generate migration task lists in various formats.
 *
 * Outputs:
 * - Markdown task list for tasks/upgrade-{version}.md
 * - JSON for automation
 * - Wave breakdown for parallel agent execution
 */

import type { TaskWave, MigrationTask } from '../models/MigrationTask.js';
import { generateWorktreeCommands, generateAgentCommand } from '../models/MigrationTask.js';

export class TaskGenerator {
  /**
   * Generate markdown task list.
   */
  generateTaskMarkdown(
    fromVersion: string,
    toVersion: string,
    waves: TaskWave[],
    includeAgentCommands?: boolean
  ): string {
    const lines: string[] = [];

    lines.push(`# Upgrade to ${toVersion}`);
    lines.push('');
    lines.push(`From: ${fromVersion}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Summary
    const totalTasks = waves.reduce((sum, w) => sum + w.tasks.length, 0);
    const breakingCount = waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'breaking').length;
    const majorCount = waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'major').length;
    const minorCount = waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'minor').length;
    const patchCount = waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'patch').length;

    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Total Tasks**: ${totalTasks}`);
    lines.push(`- **Waves**: ${waves.length}`);
    lines.push(`- **Breaking Changes**: ${breakingCount}`);
    lines.push(`- **Major Changes**: ${majorCount}`);
    lines.push(`- **Minor Changes**: ${minorCount}`);
    lines.push(`- **Patch Changes**: ${patchCount}`);
    lines.push('');

    // Tasks by severity
    lines.push('---');
    lines.push('');

    const allTasks = waves.flatMap((w) => w.tasks);

    // Breaking changes
    const breaking = allTasks.filter((t) => t.severity === 'breaking');
    if (breaking.length > 0) {
      lines.push('## Breaking Changes');
      lines.push('');
      lines.push('> ⚠️ These changes require immediate attention - they may break existing functionality.');
      lines.push('');
      for (const task of breaking) {
        lines.push(this.formatTask(task));
      }
      lines.push('');
    }

    // Major changes
    const major = allTasks.filter((t) => t.severity === 'major');
    if (major.length > 0) {
      lines.push('## Major Changes');
      lines.push('');
      for (const task of major) {
        lines.push(this.formatTask(task));
      }
      lines.push('');
    }

    // Minor changes
    const minor = allTasks.filter((t) => t.severity === 'minor');
    if (minor.length > 0) {
      lines.push('## Minor Changes');
      lines.push('');
      for (const task of minor) {
        lines.push(this.formatTask(task));
      }
      lines.push('');
    }

    // Patch changes
    const patch = allTasks.filter((t) => t.severity === 'patch');
    if (patch.length > 0) {
      lines.push('## Patch Changes');
      lines.push('');
      for (const task of patch) {
        lines.push(this.formatTask(task));
      }
      lines.push('');
    }

    // Wave breakdown (if parallel agents requested)
    if (includeAgentCommands && waves.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Parallel Agent Execution');
      lines.push('');
      lines.push('Use git worktrees to run agents in parallel:');
      lines.push('');

      for (const wave of waves) {
        lines.push(`### Wave ${wave.number}: ${wave.description}`);
        lines.push('');
        lines.push(`**Tasks**: ${wave.tasks.length}`);
        lines.push(`**Estimated Effort**: ${wave.totalEffort}`);
        lines.push('');

        // Worktree commands
        lines.push('```bash');
        lines.push(`# Create worktrees for Wave ${wave.number}`);
        const commands = generateWorktreeCommands(wave, `feature/${toVersion}`);
        for (const cmd of commands) {
          lines.push(cmd);
        }
        lines.push('```');
        lines.push('');

        // Agent commands (optional - can be verbose)
        if (wave.tasks.length <= 6) {
          lines.push('```bash');
          lines.push(`# Spawn agents for Wave ${wave.number}`);
          for (const task of wave.tasks) {
            lines.push(`# ${task.component}`);
            lines.push(generateAgentCommand(task));
            lines.push('');
          }
          lines.push('```');
          lines.push('');
        }
      }

      // Merge instructions
      lines.push('### Merging Waves');
      lines.push('');
      lines.push('After each wave completes:');
      lines.push('');
      lines.push('```bash');
      lines.push(`git checkout feature/${toVersion}`);
      lines.push('for branch in upgrade/${toVersion}-*; do');
      lines.push('  git merge --no-ff "$branch" -m "Merge $branch"');
      lines.push('done');
      lines.push('npm test  # Verify wave');
      lines.push('git worktree prune');
      lines.push('```');
      lines.push('');
    }

    // Validation checklist
    lines.push('---');
    lines.push('');
    lines.push('## Validation Checklist');
    lines.push('');
    lines.push('- [ ] All unit tests pass (`npm test`)');
    lines.push('- [ ] Integration tests pass');
    lines.push(`- [ ] Validation suite passes (\`mirth-version validate ${toVersion}\`)`);
    lines.push('- [ ] manifest.json updated with new version');
    lines.push('- [ ] CLAUDE.md updated if needed');
    lines.push('- [ ] README.md version badge updated');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format a single task as markdown.
   */
  private formatTask(task: MigrationTask): string {
    const effort = this.getEffortBadge(task.effort);
    const lines: string[] = [];

    lines.push(`- [ ] **${task.category}/${task.component}** ${effort}`);
    lines.push(`  - ${task.title}`);

    if (task.javaChanges.length > 0) {
      const filesShort = task.javaChanges
        .map((f) => f.split('/').pop())
        .slice(0, 3)
        .join(', ');
      lines.push(`  - Java: ${filesShort}${task.javaChanges.length > 3 ? '...' : ''}`);
    }

    if (task.nodeFiles.length > 0) {
      const filesShort = task.nodeFiles.slice(0, 3).join(', ');
      lines.push(`  - Node: ${filesShort}${task.nodeFiles.length > 3 ? '...' : ''}`);
    }

    return lines.join('\n');
  }

  /**
   * Get effort badge.
   */
  private getEffortBadge(effort: string): string {
    switch (effort) {
      case 'trivial':
        return '`[trivial]`';
      case 'small':
        return '`[small]`';
      case 'medium':
        return '`[medium]`';
      case 'large':
        return '`[large]`';
      case 'significant':
        return '`[significant]`';
      default:
        return '';
    }
  }

  /**
   * Generate JSON output for automation.
   */
  generateTaskJson(
    fromVersion: string,
    toVersion: string,
    waves: TaskWave[]
  ): object {
    return {
      upgrade: {
        from: fromVersion,
        to: toVersion,
        generatedAt: new Date().toISOString(),
      },
      summary: {
        totalTasks: waves.reduce((sum, w) => sum + w.tasks.length, 0),
        totalWaves: waves.length,
        bySeverity: {
          breaking: waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'breaking').length,
          major: waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'major').length,
          minor: waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'minor').length,
          patch: waves.flatMap((w) => w.tasks).filter((t) => t.severity === 'patch').length,
        },
      },
      waves: waves.map((wave) => ({
        number: wave.number,
        description: wave.description,
        totalEffort: wave.totalEffort,
        canStart: wave.canStart,
        tasks: wave.tasks.map((task) => ({
          id: task.id,
          component: `${task.category}/${task.component}`,
          title: task.title,
          severity: task.severity,
          effort: task.effort,
          javaChanges: task.javaChanges,
          nodeFiles: task.nodeFiles,
          dependsOn: task.dependsOn,
        })),
      })),
    };
  }
}
