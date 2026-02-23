/**
 * Channel Group Commands
 *
 * Commands for listing, viewing, and managing channel groups.
 * All write operations use the _bulkUpdate endpoint (read-modify-write pattern).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';
import { ApiClient } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { GroupResolver } from '../lib/GroupResolver.js';
import { ChannelResolver } from '../lib/ChannelResolver.js';
import { OutputFormatter, formatGroupTable, formatGroupDetails } from '../lib/OutputFormatter.js';
import {
  GlobalOptions,
  ChannelGroup,
  ChannelState,
  CHANNEL_GROUP_DEFAULT_ID,
  CHANNEL_GROUP_DEFAULT_NAME,
} from '../types/index.js';

function getGlobalOpts(cmd: Command): GlobalOptions {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return cmd.parent?.opts?.() ?? cmd.opts();
}

function createClient(globalOpts: GlobalOptions): ApiClient {
  return new ApiClient({
    baseUrl: globalOpts.url || ConfigManager.getServerUrl(),
    verbose: globalOpts.verbose,
  });
}

export function registerGroupCommands(program: Command): void {
  const groupsCmd = program.command('groups').description('List and manage channel groups');

  // ==========================================================================
  // groups (list all)
  // ==========================================================================
  groupsCmd.action(async (_options: unknown, cmd: Command) => {
    const globalOpts = getGlobalOpts(cmd);
    const formatter = new OutputFormatter(globalOpts.json);

    try {
      const client = createClient(globalOpts);
      const spinner = ora('Fetching groups...').start();

      const [groups, statuses] = await Promise.all([
        client.getChannelGroups(),
        client.getChannelStatuses(undefined, true),
      ]);

      spinner.stop();

      // Compute ungrouped count
      const groupedChannelIds = new Set<string>();
      for (const group of groups) {
        for (const channelId of group.channels || []) {
          groupedChannelIds.add(channelId);
        }
      }
      const ungroupedCount = statuses.filter((s) => !groupedChannelIds.has(s.channelId)).length;

      if (globalOpts.json) {
        console.log(JSON.stringify({ groups, ungroupedCount }, null, 2));
      } else {
        if (groups.length === 0 && ungroupedCount === 0) {
          formatter.warn('No groups or channels found');
          return;
        }
        console.log(formatGroupTable(groups, ungroupedCount));
        console.log();
        console.log(
          chalk.gray(`${groups.length} group(s), ${ungroupedCount} ungrouped channel(s)`)
        );
      }
    } catch (error) {
      formatter.error('Failed to fetch groups', (error as Error).message);
      process.exit(1);
    }
  });

  // ==========================================================================
  // groups list (alias)
  // ==========================================================================
  groupsCmd
    .command('list')
    .description('List all channel groups (alias for `groups`)')
    .action(async (_options: unknown, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Fetching groups...').start();

        const [groups, statuses] = await Promise.all([
          client.getChannelGroups(),
          client.getChannelStatuses(undefined, true),
        ]);

        spinner.stop();

        const groupedChannelIds = new Set<string>();
        for (const group of groups) {
          for (const channelId of group.channels || []) {
            groupedChannelIds.add(channelId);
          }
        }
        const ungroupedCount = statuses.filter((s) => !groupedChannelIds.has(s.channelId)).length;

        if (globalOpts.json) {
          console.log(JSON.stringify({ groups, ungroupedCount }, null, 2));
        } else {
          if (groups.length === 0 && ungroupedCount === 0) {
            formatter.warn('No groups or channels found');
            return;
          }
          console.log(formatGroupTable(groups, ungroupedCount));
          console.log();
          console.log(
            chalk.gray(`${groups.length} group(s), ${ungroupedCount} ungrouped channel(s)`)
          );
        }
      } catch (error) {
        formatter.error('Failed to fetch groups', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // groups get <name|id>
  // ==========================================================================
  groupsCmd
    .command('get <identifier>')
    .description('Get group details with member channel statuses')
    .action(async (identifier: string, _options: unknown, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Fetching group...').start();

        const resolver = new GroupResolver(client);
        const result = await resolver.resolve(identifier);

        if (!result.success) {
          spinner.stop();
          formatter.error(result.error);
          if (result.suggestions) {
            console.log(chalk.gray('\nDid you mean:'));
            for (const s of result.suggestions) {
              console.log(chalk.gray(`  - ${s.name} (${s.id})`));
            }
          }
          process.exit(1);
        }

        // Fetch the full group data
        const groups = await client.getChannelGroups();
        const group = groups.find((g) => g.id === result.group.id);

        if (!group) {
          spinner.stop();
          formatter.error(`Group '${identifier}' not found`);
          process.exit(1);
        }

        // Fetch channel statuses for member channels
        const channelIds = group.channels || [];
        let channelDetails: Array<{ id: string; name: string; state?: ChannelState }> = [];

        if (channelIds.length > 0) {
          try {
            const statuses = await client.getChannelStatuses(channelIds, true);
            channelDetails = statuses.map((s) => ({
              id: s.channelId,
              name: s.name,
              state: s.state,
            }));

            // Add any channel IDs that didn't return a status
            const returnedIds = new Set(statuses.map((s) => s.channelId));
            for (const id of channelIds) {
              if (!returnedIds.has(id)) {
                channelDetails.push({ id, name: id, state: undefined });
              }
            }
          } catch {
            // If status fetch fails, just show IDs
            channelDetails = channelIds.map((id) => ({ id, name: id }));
          }
        }

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify({ ...group, channelDetails }, null, 2));
        } else {
          console.log(formatGroupDetails(group, channelDetails));
        }
      } catch (error) {
        formatter.error('Failed to fetch group', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // groups create <name>
  // ==========================================================================
  groupsCmd
    .command('create <name>')
    .description('Create a new channel group')
    .option('-d, --description <description>', 'Group description')
    .action(async (name: string, options: { description?: string }, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Creating group...').start();

        // Reject Default Group name
        if (name === CHANNEL_GROUP_DEFAULT_NAME) {
          spinner.stop();
          formatter.error(
            `Cannot create a group named '${CHANNEL_GROUP_DEFAULT_NAME}' — this name is reserved`
          );
          process.exit(1);
        }

        // Check for duplicate name
        const existingGroups = await client.getChannelGroups();
        const duplicate = existingGroups.find((g) => g.name.toLowerCase() === name.toLowerCase());
        if (duplicate) {
          spinner.stop();
          formatter.error(`A group named '${duplicate.name}' already exists (${duplicate.id})`);
          process.exit(1);
        }

        const newGroup: ChannelGroup = {
          id: uuidv4(),
          name,
          description: options.description,
          revision: 1,
          channels: [],
        };

        await client.bulkUpdateChannelGroups([newGroup]);

        spinner.stop();
        formatter.success(`Created group '${name}' (${newGroup.id})`);
      } catch (error) {
        formatter.error('Failed to create group', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // groups rename <name|id> <newName>
  // ==========================================================================
  groupsCmd
    .command('rename <identifier> <newName>')
    .description('Rename a channel group')
    .action(async (identifier: string, newName: string, _options: unknown, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Renaming group...').start();

        const resolver = new GroupResolver(client);
        const result = await resolver.resolve(identifier);

        if (!result.success) {
          spinner.stop();
          formatter.error(result.error);
          if (result.suggestions) {
            console.log(chalk.gray('\nDid you mean:'));
            for (const s of result.suggestions) {
              console.log(chalk.gray(`  - ${s.name} (${s.id})`));
            }
          }
          process.exit(1);
        }

        // Reject renaming the Default Group or renaming to the Default Group name
        if (result.group.id === CHANNEL_GROUP_DEFAULT_ID) {
          spinner.stop();
          formatter.error('Cannot rename the Default Group');
          process.exit(1);
        }
        if (newName === CHANNEL_GROUP_DEFAULT_NAME) {
          spinner.stop();
          formatter.error(
            `Cannot rename a group to '${CHANNEL_GROUP_DEFAULT_NAME}' — this name is reserved`
          );
          process.exit(1);
        }

        // Read-modify-write: fetch full group, mutate name, send back
        const groups = await client.getChannelGroups();
        const group = groups.find((g) => g.id === result.group.id);
        if (!group) {
          spinner.stop();
          formatter.error(`Group '${identifier}' not found`);
          process.exit(1);
        }

        // Check for duplicate name
        const duplicate = groups.find(
          (g) => g.id !== group.id && g.name.toLowerCase() === newName.toLowerCase()
        );
        if (duplicate) {
          spinner.stop();
          formatter.error(`A group named '${duplicate.name}' already exists (${duplicate.id})`);
          process.exit(1);
        }

        const oldName = group.name;
        group.name = newName;
        group.revision = (group.revision || 0) + 1;

        await client.bulkUpdateChannelGroups([group]);

        spinner.stop();
        formatter.success(`Renamed group '${oldName}' to '${newName}'`);
      } catch (error) {
        formatter.error('Failed to rename group', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // groups delete <name|id>
  // ==========================================================================
  groupsCmd
    .command('delete <identifier>')
    .description('Delete a channel group')
    .option('-f, --force', 'Skip confirmation')
    .action(async (identifier: string, options: { force?: boolean }, cmd: Command) => {
      const globalOpts = getGlobalOpts(cmd);
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new GroupResolver(client);
        const result = await resolver.resolve(identifier);

        if (!result.success) {
          formatter.error(result.error);
          if (result.suggestions) {
            console.log(chalk.gray('\nDid you mean:'));
            for (const s of result.suggestions) {
              console.log(chalk.gray(`  - ${s.name} (${s.id})`));
            }
          }
          process.exit(1);
        }

        if (!options.force && !globalOpts.json) {
          console.log(
            chalk.yellow(`This will delete group '${result.group.name}' (${result.group.id}).`)
          );
          console.log(chalk.yellow('Channels in this group will become ungrouped, not deleted.'));
          console.log('Use --force to skip this confirmation.');
          return;
        }

        const spinner = ora('Deleting group...').start();

        await client.bulkUpdateChannelGroups([], [result.group.id]);

        spinner.stop();
        formatter.success(`Deleted group '${result.group.name}'`);
      } catch (error) {
        formatter.error('Failed to delete group', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // groups add <group> <channels...>
  // ==========================================================================
  groupsCmd
    .command('add <group> <channels...>')
    .description('Add channels to a group (by name or ID)')
    .action(
      async (
        groupIdentifier: string,
        channelIdentifiers: string[],
        _options: unknown,
        cmd: Command
      ) => {
        const globalOpts = getGlobalOpts(cmd);
        const formatter = new OutputFormatter(globalOpts.json);

        try {
          const client = createClient(globalOpts);
          const spinner = ora('Adding channels to group...').start();

          // Resolve group
          const groupResolver = new GroupResolver(client);
          const groupResult = await groupResolver.resolve(groupIdentifier);

          if (!groupResult.success) {
            spinner.stop();
            formatter.error(groupResult.error);
            if (groupResult.suggestions) {
              console.log(chalk.gray('\nDid you mean:'));
              for (const s of groupResult.suggestions) {
                console.log(chalk.gray(`  - ${s.name} (${s.id})`));
              }
            }
            process.exit(1);
          }

          // Resolve channels
          const channelResolver = new ChannelResolver(client);
          const { resolved, failed } = await channelResolver.resolveMany(channelIdentifiers);

          // Report resolution failures
          for (const f of failed) {
            formatter.warn(`Could not resolve channel '${f.identifier}': ${f.error}`);
          }

          if (resolved.length === 0) {
            spinner.stop();
            formatter.error('No channels could be resolved');
            process.exit(1);
          }

          // Fetch full group
          const groups = await client.getChannelGroups();
          const group = groups.find((g) => g.id === groupResult.group.id);
          if (!group) {
            spinner.stop();
            formatter.error(`Group '${groupIdentifier}' not found`);
            process.exit(1);
          }

          // Add channels, deduplicating
          const existingIds = new Set(group.channels || []);
          let addedCount = 0;
          for (const ch of resolved) {
            if (existingIds.has(ch.id)) {
              spinner.stop();
              formatter.info(`Channel '${ch.name}' is already in group '${group.name}'`);
              spinner.start();
            } else {
              group.channels = group.channels || [];
              group.channels.push(ch.id);
              existingIds.add(ch.id);
              addedCount++;
            }
          }

          if (addedCount === 0) {
            spinner.stop();
            formatter.info('No new channels to add');
            return;
          }

          group.revision = (group.revision || 0) + 1;
          await client.bulkUpdateChannelGroups([group]);

          spinner.stop();
          formatter.success(`Added ${addedCount} channel(s) to group '${group.name}'`);
        } catch (error) {
          formatter.error('Failed to add channels to group', (error as Error).message);
          process.exit(1);
        }
      }
    );

  // ==========================================================================
  // groups remove <group> <channels...>
  // ==========================================================================
  groupsCmd
    .command('remove <group> <channels...>')
    .description('Remove channels from a group (by name or ID)')
    .action(
      async (
        groupIdentifier: string,
        channelIdentifiers: string[],
        _options: unknown,
        cmd: Command
      ) => {
        const globalOpts = getGlobalOpts(cmd);
        const formatter = new OutputFormatter(globalOpts.json);

        try {
          const client = createClient(globalOpts);
          const spinner = ora('Removing channels from group...').start();

          // Resolve group
          const groupResolver = new GroupResolver(client);
          const groupResult = await groupResolver.resolve(groupIdentifier);

          if (!groupResult.success) {
            spinner.stop();
            formatter.error(groupResult.error);
            if (groupResult.suggestions) {
              console.log(chalk.gray('\nDid you mean:'));
              for (const s of groupResult.suggestions) {
                console.log(chalk.gray(`  - ${s.name} (${s.id})`));
              }
            }
            process.exit(1);
          }

          // Resolve channels
          const channelResolver = new ChannelResolver(client);
          const { resolved, failed } = await channelResolver.resolveMany(channelIdentifiers);

          for (const f of failed) {
            formatter.warn(`Could not resolve channel '${f.identifier}': ${f.error}`);
          }

          if (resolved.length === 0) {
            spinner.stop();
            formatter.error('No channels could be resolved');
            process.exit(1);
          }

          // Fetch full group
          const groups = await client.getChannelGroups();
          const group = groups.find((g) => g.id === groupResult.group.id);
          if (!group) {
            spinner.stop();
            formatter.error(`Group '${groupIdentifier}' not found`);
            process.exit(1);
          }

          // Remove channels
          const existingIds = new Set(group.channels || []);
          let removedCount = 0;
          for (const ch of resolved) {
            if (!existingIds.has(ch.id)) {
              spinner.stop();
              formatter.info(`Channel '${ch.name}' is not in group '${group.name}'`);
              spinner.start();
            } else {
              existingIds.delete(ch.id);
              removedCount++;
            }
          }

          if (removedCount === 0) {
            spinner.stop();
            formatter.info('No channels to remove');
            return;
          }

          group.channels = Array.from(existingIds);
          group.revision = (group.revision || 0) + 1;
          await client.bulkUpdateChannelGroups([group]);

          spinner.stop();
          formatter.success(`Removed ${removedCount} channel(s) from group '${group.name}'`);
        } catch (error) {
          formatter.error('Failed to remove channels from group', (error as Error).message);
          process.exit(1);
        }
      }
    );
}
