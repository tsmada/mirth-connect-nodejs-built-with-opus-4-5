/**
 * Shadow Mode Commands
 *
 * Commands for managing shadow mode during takeover operations.
 * Shadow mode deploys channels in read-only state for safe observation
 * before progressive cutover from Java Mirth.
 *
 * Usage:
 *   mirth-cli shadow status
 *   mirth-cli shadow promote <channel>
 *   mirth-cli shadow promote --all
 *   mirth-cli shadow demote <channel>
 *   mirth-cli shadow cutover
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ApiClient, ApiError } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { ChannelResolver } from '../lib/ChannelResolver.js';
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
 * Register shadow mode commands
 */
export function registerShadowCommands(program: Command): void {
  const shadowCmd = program
    .command('shadow')
    .description('Manage shadow mode for safe takeover operations');

  // ==========================================================================
  // shadow status
  // ==========================================================================
  shadowCmd
    .command('status')
    .description('Show shadow mode status and promoted channels')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Checking shadow mode status...').start();

        const response = await client.request<{
          shadowMode: boolean;
          promotedChannels: string[];
          promotedCount: number;
          deployedCount: number;
          serverId: string;
        }>({ method: 'GET', url: '/api/system/shadow' });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        const { shadowMode, promotedChannels, promotedCount, deployedCount, serverId } = response;

        if (!shadowMode) {
          console.log(chalk.green('Shadow mode is not active.'));
          console.log(chalk.gray(`Server: ${serverId}`));
          return;
        }

        console.log(chalk.yellow.bold('SHADOW MODE ACTIVE'));
        console.log();
        console.log(`  Server:    ${chalk.cyan(serverId)}`);
        console.log(`  Deployed:  ${chalk.white(String(deployedCount))} channels`);
        console.log(`  Promoted:  ${chalk.green(String(promotedCount))} / ${deployedCount}`);
        console.log(`  Shadowed:  ${chalk.gray(String(deployedCount - promotedCount))}`);
        console.log();

        if (promotedChannels.length > 0) {
          console.log(chalk.bold('Promoted channels:'));
          for (const id of promotedChannels) {
            console.log(`  ${chalk.green('\u25CF')} ${id}`);
          }
        } else {
          console.log(chalk.gray('No channels promoted yet.'));
          console.log(chalk.gray('Use: mirth-cli shadow promote <channel>'));
        }
      } catch (error) {
        if (error instanceof ApiError) {
          console.error(chalk.red('Error:'), error.message);
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // shadow promote [channel]
  // ==========================================================================
  shadowCmd
    .command('promote [channel]')
    .description('Promote a channel from shadow to active state')
    .option('--all', 'Promote all channels (full cutover)')
    .action(async (channel: string | undefined, options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);

        // Full cutover
        if (options.all) {
          console.log(chalk.yellow.bold('WARNING: Full cutover will:'));
          console.log('  - Start all deployed channels');
          console.log('  - Disable shadow mode');
          console.log('  - Enable message processing for all channels');
          console.log();

          const spinner = ora('Promoting all channels...').start();

          const response = await client.request<{
            deployedCount: number;
            startErrors?: Array<{ channelId: string; error: string }>;
          }>({ method: 'POST', url: '/api/system/shadow/promote', data: { all: true } });

          spinner.stop();

          if (globalOpts.json) {
            console.log(JSON.stringify(response, null, 2));
            return;
          }

          console.log(chalk.green.bold('Full cutover complete.'));
          console.log(`  Channels started: ${response.deployedCount}`);
          if (response.startErrors && response.startErrors.length > 0) {
            console.log(chalk.yellow(`  Start errors: ${response.startErrors.length}`));
            for (const err of response.startErrors) {
              console.log(chalk.red(`    ${err.channelId}: ${err.error}`));
            }
          }
          return;
        }

        // Single channel promote
        if (!channel) {
          console.error(chalk.red('Error: Specify a channel name/ID or use --all'));
          process.exit(1);
        }

        // Resolve channel name to ID
        const resolver = new ChannelResolver(client);
        const resolveResult = await resolver.resolve(channel);

        if (!resolveResult.success) {
          console.error(chalk.red(`Error: ${resolveResult.error}`));
          if (resolveResult.suggestions && resolveResult.suggestions.length > 0) {
            console.log(chalk.gray('Did you mean one of these?'));
            for (const s of resolveResult.suggestions) {
              console.log(`  ${chalk.cyan(s.name)} (${s.id})`);
            }
          }
          process.exit(1);
        }

        const channelId = resolveResult.channel.id;
        const channelName = resolveResult.channel.name;

        console.log(chalk.yellow('WARNING: Ensure this channel is stopped on Java Mirth before promoting.'));
        console.log();

        const spinner = ora(`Promoting channel ${channelName}...`).start();

        const response = await client.request<{
          warning?: string;
        }>({ method: 'POST', url: '/api/system/shadow/promote', data: { channelId } });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(chalk.green(`Channel ${channelName} promoted and started.`));
        if (response.warning) {
          console.log(chalk.yellow(`  ${response.warning}`));
        }
      } catch (error) {
        if (error instanceof ApiError) {
          console.error(chalk.red('Error:'), error.message);
          if (error.response && typeof error.response === 'object') {
            const resp = error.response as Record<string, unknown>;
            if (resp.hint) {
              console.log(chalk.yellow(`Hint: ${resp.hint}`));
            }
          }
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // shadow demote <channel>
  // ==========================================================================
  shadowCmd
    .command('demote <channel>')
    .description('Stop and demote a promoted channel back to shadow')
    .action(async (channel: string, _options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);

        // Resolve channel name to ID
        const resolver = new ChannelResolver(client);
        const resolveResult = await resolver.resolve(channel);

        if (!resolveResult.success) {
          console.error(chalk.red(`Error: ${resolveResult.error}`));
          if (resolveResult.suggestions && resolveResult.suggestions.length > 0) {
            console.log(chalk.gray('Did you mean one of these?'));
            for (const s of resolveResult.suggestions) {
              console.log(`  ${chalk.cyan(s.name)} (${s.id})`);
            }
          }
          process.exit(1);
        }

        const channelId = resolveResult.channel.id;
        const channelName = resolveResult.channel.name;

        const spinner = ora(`Demoting channel ${channelName}...`).start();

        await client.request({ method: 'POST', url: '/api/system/shadow/demote', data: { channelId } });

        spinner.stop();

        console.log(chalk.green(`Channel ${channelName} stopped and returned to shadow mode.`));
      } catch (error) {
        if (error instanceof ApiError) {
          console.error(chalk.red('Error:'), error.message);
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  // ==========================================================================
  // shadow cutover (guided full cutover)
  // ==========================================================================
  shadowCmd
    .command('cutover')
    .description('Interactive guided cutover from Java Mirth')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;

      try {
        const client = createClient(globalOpts);

        // Get current status
        const status = await client.request<{
          shadowMode: boolean;
          promotedChannels: string[];
          promotedCount: number;
          deployedCount: number;
          serverId: string;
        }>({ method: 'GET', url: '/api/system/shadow' });

        if (!status.shadowMode) {
          console.log(chalk.green('Shadow mode is not active. Nothing to cut over.'));
          return;
        }

        const unpromoted = status.deployedCount - status.promotedCount;

        console.log(chalk.yellow.bold('=== Shadow Mode Cutover ==='));
        console.log();
        console.log(`  Deployed channels:  ${status.deployedCount}`);
        console.log(`  Already promoted:   ${chalk.green(String(status.promotedCount))}`);
        console.log(`  Remaining:          ${chalk.yellow(String(unpromoted))}`);
        console.log();

        if (unpromoted === 0) {
          console.log(chalk.green('All channels are already promoted.'));
          console.log('Performing full cutover to disable shadow mode...');
        } else {
          console.log(chalk.yellow.bold('WARNING: Full cutover will:'));
          console.log('  1. Start ALL remaining channels on this Node.js instance');
          console.log('  2. Disable shadow mode permanently');
          console.log('  3. Initialize VMRouter for cross-channel routing');
          console.log('  4. Initialize DataPruner for message cleanup');
          console.log();
          console.log(chalk.red.bold('ENSURE ALL CHANNELS ARE STOPPED ON JAVA MIRTH FIRST'));
          console.log();
        }

        // Perform full cutover
        const spinner = ora('Performing full cutover...').start();

        const response = await client.request<{
          deployedCount: number;
          startErrors?: Array<{ channelId: string; error: string }>;
        }>({ method: 'POST', url: '/api/system/shadow/promote', data: { all: true } });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log();
        console.log(chalk.green.bold('Cutover complete!'));
        console.log(`  Channels active: ${response.deployedCount}`);
        if (response.startErrors && response.startErrors.length > 0) {
          console.log(chalk.yellow(`  Errors: ${response.startErrors.length}`));
          for (const err of response.startErrors) {
            console.log(chalk.red(`    ${err.channelId}: ${err.error}`));
          }
          console.log();
          console.log(chalk.yellow('Some channels failed to start. Check if ports are still in use on Java Mirth.'));
        } else {
          console.log(chalk.green('  All channels started successfully.'));
        }
        console.log();
        console.log(chalk.gray('You can now safely shut down the Java Mirth instance.'));
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
