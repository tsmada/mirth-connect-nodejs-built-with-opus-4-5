#!/usr/bin/env node
/**
 * E4X Codemod Tool
 *
 * Analyzes and transforms E4X syntax in Mirth Connect channel scripts,
 * bridging the gap between the runtime E4XTranspiler and 14 deferred
 * patterns that require pre-migration transformation.
 *
 * Usage:
 *   npx ts-node tools/e4x-codemod/index.ts analyze --channel-xml channels/*.xml
 *   npx ts-node tools/e4x-codemod/index.ts transform --repo /path/to/mirth-config
 *   npx ts-node tools/e4x-codemod/index.ts diff --channel-xml ADT-Receiver.xml
 *   npx ts-node tools/e4x-codemod/index.ts verify --repo /path/to/mirth-config
 */

import { Command } from 'commander';
import { runAnalyze } from './commands/analyze.js';
import { runTransform } from './commands/transform.js';
import { runVerify } from './commands/verify.js';
import { runDiff } from './commands/diff.js';

const program = new Command();

program
  .name('e4x-codemod')
  .description('Analyze and transform E4X syntax in Mirth Connect channel scripts')
  .version('0.1.0');

// Common options added to all commands
function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--channel-xml <paths...>', 'Channel XML file(s)')
    .option('--repo <path>', 'Decomposed artifact repo directory')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show per-pattern details');
}

// analyze command
addCommonOptions(
  program
    .command('analyze')
    .description('Scan channel scripts for E4X usage and report findings')
)
  .option('--pattern <type>', 'Filter to specific pattern type')
  .option('--unsupported-only', 'Show only patterns the runtime transpiler cannot handle')
  .option('--output <file>', 'Write report to file')
  .action(runAnalyze);

// transform command
addCommonOptions(
  program
    .command('transform')
    .description('Apply E4X transformations to channel scripts')
)
  .option('--dry-run', 'Show what would change without writing')
  .option('--backup', 'Create .bak files before modifying (default: true)', true)
  .option('--no-backup', 'Skip backup')
  .option('--backup-dir <dir>', 'Custom backup directory')
  .option('--verify', 'Run verification after transform')
  .option('--extended-only', 'Only apply extended transforms (skip runtime-handled patterns)')
  .action(runTransform);

// verify command
addCommonOptions(
  program
    .command('verify')
    .description('Verify that codemod output matches runtime transpiler')
)
  .action(runVerify);

// diff command
addCommonOptions(
  program
    .command('diff')
    .description('Show before/after diff of E4X transformations')
)
  .action(runDiff);

program.parse();
