/**
 * Channel Commands
 *
 * Commands for listing, viewing, and controlling channels.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ApiClient, ApiError } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { ChannelResolver } from '../lib/ChannelResolver.js';
import {
  OutputFormatter,
  formatChannelStatusTable,
  formatChannelDetails,
  formatNumber,
  createTable,
} from '../lib/OutputFormatter.js';
import { GlobalOptions, ChannelStatistics } from '../types/index.js';

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
 * Register channel commands
 */
export function registerChannelCommands(program: Command): void {
  const channelsCmd = program
    .command('channels')
    .description('List and manage channels');

  // ==========================================================================
  // channels (list all)
  // ==========================================================================
  channelsCmd
    .option('-f, --filter <name>', 'Filter channels by name')
    .option('--undeployed', 'Include undeployed channels')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Fetching channels...').start();

        const statuses = await client.getChannelStatuses(undefined, options.undeployed);

        // Filter by name if specified
        let filteredStatuses = statuses;
        if (options.filter) {
          const filterLower = options.filter.toLowerCase();
          filteredStatuses = statuses.filter(
            (s) => s.name.toLowerCase().includes(filterLower)
          );
        }

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(filteredStatuses, null, 2));
        } else {
          if (filteredStatuses.length === 0) {
            formatter.warn('No channels found');
            return;
          }

          console.log(formatChannelStatusTable(filteredStatuses));
          console.log();
          console.log(chalk.gray(`${filteredStatuses.length} channel(s)`));
        }
      } catch (error) {
        formatter.error('Failed to fetch channels', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // channels list (alias for base command)
  // ==========================================================================
  channelsCmd
    .command('list')
    .description('List all channels with status')
    .option('-f, --filter <name>', 'Filter channels by name')
    .option('--undeployed', 'Include undeployed channels')
    .action(async (options, _, cmd) => {
      // Delegate to parent action
      await cmd.parent?.parseAsync(['channels', '--filter', options.filter || '']);
    });

  // ==========================================================================
  // channels get <id|name>
  // ==========================================================================
  channelsCmd
    .command('get <identifier>')
    .description('Get channel details by ID or name')
    .action(async (identifier: string, _, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);
        const spinner = ora('Fetching channel...').start();

        // Resolve channel identifier
        const resolveResult = await resolver.resolve(identifier);

        if (!resolveResult.success) {
          spinner.stop();
          formatter.error(resolveResult.error);
          if (resolveResult.suggestions && resolveResult.suggestions.length > 0) {
            console.log(chalk.gray('Did you mean one of these?'));
            for (const s of resolveResult.suggestions) {
              console.log(`  ${chalk.cyan(s.name)} (${s.id})`);
            }
          }
          process.exit(1);
        }

        const channelId = resolveResult.channel.id;

        // Get channel status with details
        const status = await client.getChannelStatus(channelId);

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(formatChannelDetails(status));
        }
      } catch (error) {
        formatter.error('Failed to get channel', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // channels stats [id|name]
  // ==========================================================================
  channelsCmd
    .command('stats [identifier]')
    .description('Show channel statistics')
    .action(async (identifier: string | undefined, _, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Fetching statistics...').start();

        if (identifier) {
          // Get stats for specific channel
          const resolver = new ChannelResolver(client);
          const resolveResult = await resolver.resolve(identifier);

          if (!resolveResult.success) {
            spinner.stop();
            formatter.error(resolveResult.error);
            process.exit(1);
          }

          const stats = await client.getChannelStatistics(resolveResult.channel.id);
          spinner.stop();

          if (globalOpts.json) {
            console.log(JSON.stringify({ channelId: resolveResult.channel.id, ...stats }, null, 2));
          } else {
            console.log(chalk.bold(`Statistics for: ${resolveResult.channel.name}`));
            console.log();
            console.log(`  ${chalk.gray('Received:')}  ${formatNumber(stats.received)}`);
            console.log(`  ${chalk.gray('Filtered:')}  ${formatNumber(stats.filtered)}`);
            console.log(`  ${chalk.gray('Queued:')}    ${formatNumber(stats.queued)}`);
            console.log(`  ${chalk.gray('Sent:')}      ${formatNumber(stats.sent)}`);
            console.log(`  ${chalk.gray('Errored:')}   ${stats.errored ? chalk.red(formatNumber(stats.errored)) : '0'}`);
          }
        } else {
          // Get all channel stats
          const statuses = await client.getChannelStatuses();
          spinner.stop();

          if (globalOpts.json) {
            const statsMap: Record<string, ChannelStatistics & { name: string }> = {};
            for (const status of statuses) {
              statsMap[status.channelId] = {
                name: status.name,
                ...status.statistics,
              };
            }
            console.log(JSON.stringify(statsMap, null, 2));
          } else {
            // Create stats table
            const columns = [
              { header: 'NAME', width: 30 },
              { header: 'RECV', width: 8, align: 'right' as const },
              { header: 'FILT', width: 8, align: 'right' as const },
              { header: 'QUEUED', width: 8, align: 'right' as const },
              { header: 'SENT', width: 8, align: 'right' as const },
              { header: 'ERR', width: 6, align: 'right' as const },
            ];

            const data = statuses.map((s) => [
              s.name.slice(0, 30),
              formatNumber(s.statistics?.received || 0),
              formatNumber(s.statistics?.filtered || 0),
              formatNumber(s.statistics?.queued || 0),
              formatNumber(s.statistics?.sent || 0),
              s.statistics?.errored ? chalk.red(formatNumber(s.statistics.errored)) : '0',
            ]);

            console.log(createTable(data, { columns }));
          }
        }
      } catch (error) {
        formatter.error('Failed to get statistics', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // Channel control commands (deploy, undeploy, start, stop, pause, resume)
  // ==========================================================================

  /**
   * Create a channel control command
   */
  function createControlCommand(
    name: string,
    description: string,
    action: (client: ApiClient, channelId: string) => Promise<void>,
    pastTense: string
  ): void {
    channelsCmd
      .command(`${name} <identifier>`)
      .description(description)
      .action(async (identifier: string, _, cmd) => {
        const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
        const formatter = new OutputFormatter(globalOpts.json);

        try {
          const client = createClient(globalOpts);
          const resolver = new ChannelResolver(client);

          // Resolve channel
          const resolveResult = await resolver.resolve(identifier);
          if (!resolveResult.success) {
            formatter.error(resolveResult.error);
            if (resolveResult.suggestions?.length) {
              console.log(chalk.gray('Did you mean one of these?'));
              for (const s of resolveResult.suggestions) {
                console.log(`  ${chalk.cyan(s.name)} (${s.id})`);
              }
            }
            process.exit(1);
          }

          const { id, name: channelName } = resolveResult.channel;
          const spinner = ora(`${name.charAt(0).toUpperCase() + name.slice(1)}ing ${channelName}...`).start();

          await action(client, id);

          spinner.stop();
          formatter.success(`Channel ${channelName} ${pastTense}`);
        } catch (error) {
          if (error instanceof ApiError) {
            formatter.error(`Failed to ${name} channel: ${error.message}`);
          } else {
            formatter.error(`Failed to ${name} channel`, (error as Error).message);
          }
          process.exit(1);
        }
      });
  }

  // Register control commands
  createControlCommand(
    'deploy',
    'Deploy a channel',
    (client, id) => client.deployChannel(id),
    'deployed'
  );

  createControlCommand(
    'undeploy',
    'Undeploy a channel',
    (client, id) => client.undeployChannel(id),
    'undeployed'
  );

  createControlCommand(
    'start',
    'Start a channel',
    (client, id) => client.startChannel(id),
    'started'
  );

  createControlCommand(
    'stop',
    'Stop a channel',
    (client, id) => client.stopChannel(id),
    'stopped'
  );

  createControlCommand(
    'pause',
    'Pause a channel',
    (client, id) => client.pauseChannel(id),
    'paused'
  );

  createControlCommand(
    'resume',
    'Resume a paused channel',
    (client, id) => client.resumeChannel(id),
    'resumed'
  );
}

export default registerChannelCommands;
