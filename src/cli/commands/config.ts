/**
 * Configuration Commands
 *
 * Manages CLI configuration settings stored in ~/.mirth-cli.json
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from '../lib/ConfigManager.js';
import { OutputFormatter } from '../lib/OutputFormatter.js';
import { CliConfig, GlobalOptions } from '../types/index.js';

/**
 * Valid configuration keys that can be set
 */
const VALID_CONFIG_KEYS: Array<keyof CliConfig> = [
  'url',
  'username',
  'outputFormat',
  'dashboardRefresh',
];

/**
 * Configuration key descriptions
 */
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  url: 'Mirth Connect server URL',
  username: 'Default username for login',
  outputFormat: 'Default output format (table or json)',
  dashboardRefresh: 'Dashboard refresh interval in seconds',
  sessionToken: 'Session authentication token (managed by login)',
  sessionExpiry: 'Session expiry timestamp (managed by login)',
};

/**
 * Find the root program to get global options
 */
function getRootProgram(cmd: Command): Command {
  let current = cmd;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

/**
 * Get global options from any command context
 */
function getGlobalOpts(cmd: Command): GlobalOptions {
  const root = getRootProgram(cmd);
  return (root.opts() as GlobalOptions) || {};
}

/**
 * Register config commands
 */
export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command('config')
    .description('View or manage CLI configuration');

  // ==========================================================================
  // config (no args) - show all config
  // ==========================================================================
  configCmd.action((_options, cmd: Command) => {
    const globalOpts = getGlobalOpts(cmd);

    const config = ConfigManager.getAll();
    const configPath = ConfigManager.getPath();

    if (globalOpts.json) {
      console.log(
        JSON.stringify(
          {
            path: configPath,
            config: config,
          },
          null,
          2
        )
      );
    } else {
      console.log(chalk.bold('Configuration'));
      console.log(chalk.gray(`  Path: ${configPath}`));
      console.log();

      for (const [key, value] of Object.entries(config)) {
        const description = CONFIG_DESCRIPTIONS[key] || '';
        const displayValue =
          key === 'sessionToken' && value
            ? (value as string).slice(0, 20) + '...'
            : value;

        if (value !== undefined) {
          console.log(`  ${chalk.cyan(key)}: ${displayValue}`);
          if (description) {
            console.log(chalk.gray(`    ${description}`));
          }
        }
      }
    }
  });

  // ==========================================================================
  // config get <key>
  // ==========================================================================
  configCmd
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string, _options, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);

      const value = ConfigManager.get(key as keyof CliConfig);

      if (globalOpts.json) {
        console.log(JSON.stringify({ [key]: value }, null, 2));
      } else {
        if (value !== undefined) {
          console.log(value);
        } else {
          console.log(chalk.gray('(not set)'));
        }
      }
    });

  // ==========================================================================
  // config set <key> <value>
  // ==========================================================================
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string, _options, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      // Validate key
      if (!VALID_CONFIG_KEYS.includes(key as keyof CliConfig)) {
        formatter.error(
          `Invalid configuration key: ${key}`,
          `Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`
        );
        process.exit(1);
      }

      // Parse value based on key type
      let parsedValue: string | number = value;

      switch (key) {
        case 'dashboardRefresh':
          parsedValue = parseInt(value, 10);
          if (isNaN(parsedValue) || parsedValue < 1) {
            formatter.error('dashboardRefresh must be a positive integer');
            process.exit(1);
          }
          break;

        case 'outputFormat':
          if (value !== 'table' && value !== 'json') {
            formatter.error('outputFormat must be "table" or "json"');
            process.exit(1);
          }
          break;

        case 'url':
          // Normalize URL
          parsedValue = value.replace(/\/+$/, '');
          break;
      }

      ConfigManager.set(key as keyof CliConfig, parsedValue as never);
      formatter.success(`Set ${key} = ${parsedValue}`);
    });

  // ==========================================================================
  // config unset <key>
  // ==========================================================================
  configCmd
    .command('unset <key>')
    .description('Remove a configuration value (reset to default)')
    .action((key: string, _options, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      if (!VALID_CONFIG_KEYS.includes(key as keyof CliConfig)) {
        formatter.error(
          `Invalid configuration key: ${key}`,
          `Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`
        );
        process.exit(1);
      }

      ConfigManager.delete(key as keyof CliConfig);
      formatter.success(`Unset ${key}`);
    });

  // ==========================================================================
  // config reset
  // ==========================================================================
  configCmd
    .command('reset')
    .description('Reset all configuration to defaults')
    .option('-f, --force', 'Skip confirmation')
    .action((options, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      if (!options.force && !globalOpts.json) {
        console.log(chalk.yellow('This will reset all configuration to defaults.'));
        console.log('Use --force to skip this confirmation.');
        return;
      }

      ConfigManager.reset();
      formatter.success('Configuration reset to defaults');
    });

  // ==========================================================================
  // config path
  // ==========================================================================
  configCmd
    .command('path')
    .description('Show the path to the configuration file')
    .action((_options, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);

      const configPath = ConfigManager.getPath();

      if (globalOpts.json) {
        console.log(JSON.stringify({ path: configPath }, null, 2));
      } else {
        console.log(configPath);
      }
    });

  // ==========================================================================
  // config list
  // ==========================================================================
  configCmd
    .command('list')
    .description('List all available configuration keys')
    .action((_options, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);

      if (globalOpts.json) {
        const keys = VALID_CONFIG_KEYS.map((key) => ({
          key,
          description: CONFIG_DESCRIPTIONS[key],
        }));
        console.log(JSON.stringify({ keys }, null, 2));
      } else {
        console.log(chalk.bold('Available Configuration Keys:'));
        console.log();
        for (const key of VALID_CONFIG_KEYS) {
          const desc = CONFIG_DESCRIPTIONS[key] || '';
          console.log(`  ${chalk.cyan(key)}`);
          if (desc) {
            console.log(chalk.gray(`    ${desc}`));
          }
        }
      }
    });
}

export default registerConfigCommands;
