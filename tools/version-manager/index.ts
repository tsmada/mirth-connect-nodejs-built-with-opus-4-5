#!/usr/bin/env node
/**
 * Mirth Version Manager CLI
 *
 * A tool for managing Mirth Connect version upgrades and tracking porting progress.
 *
 * Usage:
 *   mirth-version status                    # Show current version status
 *   mirth-version diff 3.9.1 3.10.0         # Compare Java versions
 *   mirth-version upgrade plan 3.10.0       # Generate upgrade plan
 *   mirth-version upgrade tasks 3.10.0      # Generate task list
 *   mirth-version validate 3.10.0           # Run version-specific validation
 */

import { Command } from 'commander';
import { statusCommand } from './commands/status.js';
import { diffCommand } from './commands/diff.js';
import { upgradeCommand } from './commands/upgrade.js';
import { validateCommand } from './commands/validate.js';
import { branchCommand } from './commands/branch.js';

const program = new Command();

program
  .name('mirth-version')
  .description('Mirth Connect version management and upgrade tooling')
  .version('0.1.0');

// Status command
program
  .command('status')
  .description('Show current version status and component breakdown')
  .option('-v, --verbose', 'Show detailed component information')
  .option('--json', 'Output as JSON')
  .action(statusCommand);

// Diff command
program
  .command('diff <from> <to>')
  .description('Compare changes between two Java Mirth versions')
  .option('--impact', 'Include impact assessment')
  .option('--component <name>', 'Filter to specific component')
  .option('--category <name>', 'Filter to specific category')
  .option('--json', 'Output as JSON')
  .action(diffCommand);

// Upgrade command with subcommands
const upgrade = program
  .command('upgrade')
  .description('Plan and execute version upgrades');

upgrade
  .command('plan <version>')
  .description('Generate a comprehensive upgrade plan')
  .option('--output <file>', 'Output file path')
  .option('--json', 'Output as JSON')
  .action((version, options) => upgradeCommand('plan', version, options));

upgrade
  .command('tasks <version>')
  .description('Generate migration tasks for todo.md')
  .option('--output <file>', 'Output file path (default: tasks/upgrade-{version}.md)')
  .option('--parallel-agents', 'Include wave breakdown for parallel agent execution')
  .option('--json', 'Output as JSON')
  .action((version, options) => upgradeCommand('tasks', version, options));

upgrade
  .command('worktrees <version>')
  .description('Create git worktrees for parallel agent execution')
  .option('--base <branch>', 'Base branch (default: feature/{version})')
  .option('--dry-run', 'Show commands without executing')
  .action((version, options) => upgradeCommand('worktrees', version, options));

// Branch command
program
  .command('branch <action> <version>')
  .description('Manage version branches (create, status, merge)')
  .option('--from <branch>', 'Source branch for create (default: master)')
  .action(branchCommand);

// Validate command
program
  .command('validate <version>')
  .description('Run validation against a specific Java Mirth version')
  .option('--deploy-java', 'Start Java Mirth Docker container')
  .option('--scenarios <ids>', 'Comma-separated scenario IDs to run')
  .option('--priority <level>', 'Run scenarios up to priority level')
  .action(validateCommand);

program.parse();
