/**
 * Secrets CLI commands for mirth-cli.
 *
 * Commands for managing secrets and vault-backed configuration.
 *
 * Usage:
 *   mirth-cli secrets status
 *   mirth-cli secrets list
 *   mirth-cli secrets get <key> [--show]
 *   mirth-cli secrets set <key> <value>
 *   mirth-cli secrets preload <keys...>
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient, ApiError } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { GlobalOptions } from '../types/index.js';

/**
 * Create API client from global options
 */
function createClient(globalOpts: GlobalOptions): ApiClient {
  return new ApiClient({
    baseUrl: globalOpts.url || ConfigManager.getServerUrl(),
    verbose: globalOpts.verbose,
  });
}

/**
 * Register secrets management commands
 */
export function registerSecretsCommands(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Manage secrets and vault-backed configuration');

  // ==========================================================================
  // secrets status
  // ==========================================================================
  secrets
    .command('status')
    .description('Show secrets provider status and cache statistics')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);
        const response = await client.request<{
          providers: Array<{ name: string; initialized: boolean }>;
          cache: { size: number; hits: number; misses: number; evictions: number };
        }>({ method: 'GET', url: '/api/secrets/status' });

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(chalk.bold('\nSecrets Provider Status'));
        console.log('-'.repeat(50));

        if (response.providers && response.providers.length > 0) {
          for (const provider of response.providers) {
            const status = provider.initialized ? chalk.green('initialized') : chalk.red('failed');
            console.log(`  ${provider.name}: ${status}`);
          }
        } else {
          console.log(chalk.yellow('  No providers configured'));
        }

        if (response.cache) {
          console.log(chalk.bold('\nCache Statistics'));
          console.log('-'.repeat(50));
          console.log(`  Size:      ${response.cache.size} entries`);
          console.log(`  Hits:      ${response.cache.hits}`);
          console.log(`  Misses:    ${response.cache.misses}`);
          console.log(`  Evictions: ${response.cache.evictions}`);
        }
        console.log();
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 503) {
          console.log(chalk.yellow('Secrets manager not initialized.'));
          console.log(chalk.gray('Set MIRTH_SECRETS_PROVIDERS to enable (e.g., env,file,aws)'));
        } else if (error instanceof ApiError) {
          console.error(chalk.red('Error:'), error.message);
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // secrets list
  // ==========================================================================
  secrets
    .command('list')
    .description('List available secret providers')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);
        const response = await client.request<{
          providers: string[];
          note: string;
        }>({ method: 'GET', url: '/api/secrets/keys' });

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(chalk.bold('\nConfigured Providers:'));
        for (const name of response.providers ?? []) {
          console.log(`  - ${name}`);
        }
        console.log();
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 503) {
          console.log(chalk.yellow('Secrets manager not initialized.'));
        } else if (error instanceof ApiError) {
          console.error(chalk.red('Error:'), error.message);
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // secrets get <key>
  // ==========================================================================
  secrets
    .command('get <key>')
    .description('Get a secret value')
    .option('--show', 'Show actual value (default: redacted)')
    .action(async (key: string, options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);
        const params = options.show ? '?showValue=true' : '';
        const response = await client.request<{
          key: string;
          value: string;
          source: string;
          fetchedAt: string;
          version?: string;
          expiresAt?: string;
        }>({ method: 'GET', url: `/api/secrets/${encodeURIComponent(key)}${params}` });

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(chalk.bold(`\nSecret: ${response.key}`));
        console.log('-'.repeat(50));
        console.log(`  Value:    ${options.show ? response.value : chalk.gray('********')}`);
        console.log(`  Source:   ${response.source}`);
        console.log(`  Fetched:  ${response.fetchedAt}`);
        if (response.version) console.log(`  Version:  ${response.version}`);
        if (response.expiresAt) console.log(`  Expires:  ${response.expiresAt}`);
        console.log();
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 404) {
          console.log(chalk.yellow(`Secret '${key}' not found in any provider.`));
        } else if (error instanceof ApiError && error.statusCode === 503) {
          console.log(chalk.yellow('Secrets manager not initialized.'));
        } else if (error instanceof ApiError) {
          console.error(chalk.red('Error:'), error.message);
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // secrets set <key> <value>
  // ==========================================================================
  secrets
    .command('set <key> <value>')
    .description('Set a secret value (if provider supports writes)')
    .action(async (key: string, value: string, _options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);
        await client.request({
          method: 'POST',
          url: `/api/secrets/${encodeURIComponent(key)}`,
          data: { value },
        });
        console.log(chalk.green(`Secret '${key}' set successfully.`));
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.statusCode === 409 || error.statusCode === 501) {
            const resp = error.response as Record<string, unknown> | undefined;
            console.log(chalk.yellow(String(resp?.message ?? error.message)));
          } else {
            console.error(chalk.red('Error:'), error.message);
          }
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // secrets preload <keys...>
  // ==========================================================================
  secrets
    .command('preload <keys...>')
    .description('Pre-load keys into the sync cache for fast access')
    .action(async (keys: string[], _options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);
        const response = await client.request<{ preloaded: number; keys: string[] }>({
          method: 'POST',
          url: '/api/secrets/preload',
          data: { keys },
        });
        console.log(chalk.green(`Pre-loaded ${response.preloaded} keys into sync cache.`));
      } catch (error) {
        if (error instanceof ApiError) {
          console.error(chalk.red('Error:'), error.message);
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });
}
