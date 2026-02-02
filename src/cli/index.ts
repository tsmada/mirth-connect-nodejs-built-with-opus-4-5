#!/usr/bin/env node
/**
 * Mirth Connect CLI
 *
 * A command-line interface for monitoring and managing Mirth Connect.
 * Provides terminal-based equivalents to the Mirth Connect Administrator GUI.
 *
 * Usage: mirth-cli [options] <command> [subcommand] [arguments]
 *
 * Run `mirth-cli --help` for detailed usage information.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerServerCommands } from './commands/server.js';
import { registerChannelCommands } from './commands/channels.js';
import { registerMessageCommands } from './commands/messages.js';
import { registerSendCommands } from './commands/send.js';
import { registerEventCommands } from './commands/events.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { ConfigManager } from './lib/ConfigManager.js';

// Package version - would normally read from package.json
const VERSION = '0.1.0';

/**
 * ASCII art banner for the CLI
 */
const BANNER = `
${chalk.cyan('  __  __ _      _   _      ')}
${chalk.cyan(' |  \\/  (_)_ __| |_| |__   ')}
${chalk.cyan(" | |\\/| | | '__| __| '_ \\  ")}
${chalk.cyan(' | |  | | | |  | |_| | | | ')}
${chalk.cyan(' |_|  |_|_|_|   \\__|_| |_| ')}
${chalk.gray('          CLI v' + VERSION)}
`;

/**
 * Create and configure the CLI program
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name('mirth-cli')
    .description('CLI for monitoring and managing Mirth Connect')
    .version(VERSION, '-V, --version', 'Output the version number')
    .option(
      '--url <url>',
      'Mirth Connect server URL',
      ConfigManager.getServerUrl()
    )
    .option('-u, --user <username>', 'Username for authentication')
    .option('-p, --password <password>', 'Password for authentication')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Verbose output');

  // Register all command groups
  registerAuthCommands(program);
  registerConfigCommands(program);
  registerServerCommands(program);
  registerChannelCommands(program);
  registerMessageCommands(program);
  registerSendCommands(program);
  registerEventCommands(program);
  registerDashboardCommand(program);

  // Custom help with banner
  program.addHelpText('before', BANNER);

  // Custom help footer
  program.addHelpText(
    'after',
    `
${chalk.bold('Examples:')}
  ${chalk.gray('# Login to server')}
  $ mirth-cli login --user admin

  ${chalk.gray('# List all channels with status')}
  $ mirth-cli channels

  ${chalk.gray('# Get channel details')}
  $ mirth-cli channels get "MLLP Router"

  ${chalk.gray('# Start a channel')}
  $ mirth-cli channels start <channelId>

  ${chalk.gray('# Search for error messages')}
  $ mirth-cli messages search <channelId> --status E

  ${chalk.gray('# Send an MLLP message')}
  $ mirth-cli send mllp localhost:6662 @message.hl7

  ${chalk.gray('# Start interactive dashboard')}
  $ mirth-cli dashboard

${chalk.bold('Documentation:')}
  For more information, see: ${chalk.cyan('https://github.com/your-repo/mirth-connect-nodejs')}
`
  );

  // Handle unknown commands
  program.on('command:*', () => {
    console.error(
      chalk.red('Unknown command:'),
      program.args.join(' ')
    );
    console.log();
    console.log('Run', chalk.cyan('mirth-cli --help'), 'for usage information.');
    process.exit(1);
  });

  return program;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    // Commander already handles most errors
    if ((error as Error).message !== 'commander.helpDisplayed') {
      console.error(chalk.red('Error:'), (error as Error).message);
      process.exit(1);
    }
  }
}

// Run the CLI
main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error.message);
  process.exit(1);
});
