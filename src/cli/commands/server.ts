/**
 * Server Commands
 *
 * Commands for viewing server information, status, and statistics.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ApiClient, ApiError } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import {
  OutputFormatter,
  formatSystemInfo,
  formatSystemStats,
} from '../lib/OutputFormatter.js';
import { GlobalOptions } from '../types/index.js';

/**
 * Register server commands
 */
export function registerServerCommands(program: Command): void {
  const serverCmd = program
    .command('server')
    .description('Server information and status commands');

  // ==========================================================================
  // server info
  // ==========================================================================
  serverCmd
    .command('info')
    .description('Display server information')
    .action(async (_, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const serverUrl = globalOpts.url || ConfigManager.getServerUrl();
        const spinner = ora('Fetching server info...').start();

        const client = new ApiClient({
          baseUrl: serverUrl,
          verbose: globalOpts.verbose,
        });

        // Fetch both system info and version in parallel
        const [systemInfo, version] = await Promise.all([
          client.getSystemInfo(),
          client.getServerVersion().catch(() => 'Unknown'),
        ]);

        spinner.stop();

        if (globalOpts.json) {
          console.log(
            JSON.stringify(
              {
                server: serverUrl,
                version,
                system: systemInfo,
              },
              null,
              2
            )
          );
        } else {
          console.log(chalk.bold('Mirth Connect Server'));
          console.log();
          console.log(`  ${chalk.gray('URL:')}       ${serverUrl}`);
          console.log(`  ${chalk.gray('Version:')}   ${version}`);
          console.log();
          console.log(formatSystemInfo(systemInfo));
        }
      } catch (error) {
        if (error instanceof ApiError) {
          formatter.error(`Failed to get server info: ${error.message}`, {
            statusCode: error.statusCode,
          });
        } else {
          formatter.error('Failed to get server info', (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // server status
  // ==========================================================================
  serverCmd
    .command('status')
    .description('Check server status and connectivity')
    .action(async (_, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const serverUrl = globalOpts.url || ConfigManager.getServerUrl();
        const spinner = ora(`Connecting to ${serverUrl}...`).start();

        const client = new ApiClient({
          baseUrl: serverUrl,
          verbose: globalOpts.verbose,
          timeout: 10000, // Short timeout for status check
        });

        const startTime = Date.now();

        // Try to fetch system info as a connectivity test
        const systemInfo = await client.getSystemInfo();
        const latency = Date.now() - startTime;

        // Check if user is logged in
        const currentUser = await client.getCurrentUser().catch(() => null);

        spinner.stop();

        if (globalOpts.json) {
          console.log(
            JSON.stringify(
              {
                status: 'online',
                server: serverUrl,
                latencyMs: latency,
                authenticated: !!currentUser,
                user: currentUser?.username,
                runtime: systemInfo.jvmVersion,
              },
              null,
              2
            )
          );
        } else {
          console.log(
            chalk.green('●') + ' ' + chalk.bold('Server Online')
          );
          console.log();
          console.log(`  ${chalk.gray('URL:')}          ${serverUrl}`);
          console.log(`  ${chalk.gray('Latency:')}      ${latency}ms`);
          console.log(`  ${chalk.gray('Runtime:')}      ${systemInfo.jvmVersion}`);
          console.log();
          if (currentUser) {
            console.log(
              `  ${chalk.gray('Logged in as:')} ${chalk.cyan(currentUser.username)}`
            );
          } else {
            console.log(`  ${chalk.gray('Logged in:')}    ${chalk.yellow('No')}`);
          }
        }
      } catch (error) {
        if (error instanceof ApiError) {
          if (globalOpts.json) {
            console.log(
              JSON.stringify(
                {
                  status: 'error',
                  server: globalOpts.url || ConfigManager.getServerUrl(),
                  error: error.message,
                  statusCode: error.statusCode,
                },
                null,
                2
              )
            );
          } else {
            const serverUrl = globalOpts.url || ConfigManager.getServerUrl();
            console.log(chalk.red('●') + ' ' + chalk.bold('Server Error'));
            console.log();
            console.log(`  ${chalk.gray('URL:')}    ${serverUrl}`);
            console.log(`  ${chalk.gray('Error:')}  ${error.message}`);
            if (error.statusCode) {
              console.log(`  ${chalk.gray('Status:')} ${error.statusCode}`);
            }
          }
        } else {
          const serverUrl = globalOpts.url || ConfigManager.getServerUrl();
          if (globalOpts.json) {
            console.log(
              JSON.stringify(
                {
                  status: 'offline',
                  server: serverUrl,
                  error: (error as Error).message,
                },
                null,
                2
              )
            );
          } else {
            console.log(chalk.red('●') + ' ' + chalk.bold('Server Offline'));
            console.log();
            console.log(`  ${chalk.gray('URL:')}    ${serverUrl}`);
            console.log(`  ${chalk.gray('Error:')}  ${(error as Error).message}`);
          }
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // server stats
  // ==========================================================================
  serverCmd
    .command('stats')
    .description('Display server statistics')
    .option('-w, --watch', 'Watch stats (refresh every 2 seconds)')
    .option('-i, --interval <seconds>', 'Refresh interval when watching', '2')
    .action(async (options, _, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      const fetchAndDisplayStats = async (client: ApiClient): Promise<void> => {
        const stats = await client.getSystemStats();

        if (globalOpts.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          // Clear screen for watch mode
          if (options.watch) {
            console.clear();
            console.log(chalk.gray(`Refreshing every ${options.interval}s (Ctrl+C to stop)`));
            console.log();
          }
          console.log(formatSystemStats(stats));

          // Add memory bar visualization
          const memUsed = stats.allocatedMemoryBytes - stats.freeMemoryBytes;
          const memPercent = (memUsed / stats.maxMemoryBytes) * 100;
          const barWidth = 40;
          const filledWidth = Math.round((memPercent / 100) * barWidth);
          const bar =
            chalk.green('█'.repeat(filledWidth)) +
            chalk.gray('░'.repeat(barWidth - filledWidth));

          console.log();
          console.log(`  ${chalk.gray('Memory:')} [${bar}] ${memPercent.toFixed(1)}%`);
        }
      };

      try {
        const serverUrl = globalOpts.url || ConfigManager.getServerUrl();
        const client = new ApiClient({
          baseUrl: serverUrl,
          verbose: globalOpts.verbose,
        });

        if (options.watch && !globalOpts.json) {
          const interval = parseInt(options.interval, 10) * 1000;

          // Initial fetch
          await fetchAndDisplayStats(client);

          // Set up interval for watching
          const intervalId = setInterval(async () => {
            try {
              await fetchAndDisplayStats(client);
            } catch (error) {
              console.error(chalk.red('Error fetching stats:'), (error as Error).message);
            }
          }, interval);

          // Handle Ctrl+C gracefully
          process.on('SIGINT', () => {
            clearInterval(intervalId);
            console.log();
            console.log(chalk.gray('Stopped watching stats.'));
            process.exit(0);
          });
        } else {
          const spinner = ora('Fetching stats...').start();
          spinner.stop();
          await fetchAndDisplayStats(client);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          formatter.error(`Failed to get stats: ${error.message}`, {
            statusCode: error.statusCode,
          });
        } else {
          formatter.error('Failed to get stats', (error as Error).message);
        }
        process.exit(1);
      }
    });
}

export default registerServerCommands;
