/**
 * Message Commands
 *
 * Commands for browsing, searching, and exporting messages.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import { ApiClient } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { ChannelResolver } from '../lib/ChannelResolver.js';
import {
  OutputFormatter,
  formatMessageTable,
  formatMessageDetails,
} from '../lib/OutputFormatter.js';
import { GlobalOptions, MessageFilter, MessageStatus } from '../types/index.js';

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
 * Parse status filter from command line (handles comma-separated and multiple --status)
 */
function parseStatusFilter(status: string | string[] | undefined): MessageStatus[] | undefined {
  if (!status) return undefined;

  const statuses: MessageStatus[] = [];
  const inputs = Array.isArray(status) ? status : [status];

  for (const input of inputs) {
    // Handle comma-separated values
    const parts = input.split(',').map((s) => s.trim().toUpperCase());
    for (const part of parts) {
      if (['R', 'F', 'T', 'S', 'Q', 'E', 'P'].includes(part)) {
        statuses.push(part as MessageStatus);
      }
    }
  }

  return statuses.length > 0 ? statuses : undefined;
}

/**
 * Parse date filter (supports relative dates like "1 hour ago")
 */
function parseDate(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;

  // Try to parse as ISO date first
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Try relative date patterns
  const now = Date.now();
  const relativePatterns = [
    { pattern: /^(\d+)\s*h(our)?s?\s*ago$/i, factor: 60 * 60 * 1000 },
    { pattern: /^(\d+)\s*m(in(ute)?)?s?\s*ago$/i, factor: 60 * 1000 },
    { pattern: /^(\d+)\s*d(ay)?s?\s*ago$/i, factor: 24 * 60 * 60 * 1000 },
    { pattern: /^today$/i, factor: 0 },
    { pattern: /^yesterday$/i, factor: 24 * 60 * 60 * 1000 },
  ];

  for (const { pattern, factor } of relativePatterns) {
    const match = dateStr.match(pattern);
    if (match) {
      if (pattern.source.includes('today')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today.toISOString();
      }
      if (pattern.source.includes('yesterday')) {
        const yesterday = new Date(now - factor);
        yesterday.setHours(0, 0, 0, 0);
        return yesterday.toISOString();
      }
      const value = parseInt(match[1]!, 10);
      return new Date(now - value * factor).toISOString();
    }
  }

  // Return as-is and let the API handle it
  return dateStr;
}

/**
 * Register message commands
 */
export function registerMessageCommands(program: Command): void {
  const messagesCmd = program
    .command('messages <channelId>')
    .description('List and search messages for a channel');

  // ==========================================================================
  // messages <channelId> (list recent)
  // ==========================================================================
  messagesCmd
    .option('-l, --limit <n>', 'Limit results', '50')
    .option('-o, --offset <n>', 'Skip first N results', '0')
    .option('-s, --status <status>', 'Filter by status (R,F,T,S,Q,E,P)')
    .option('--content', 'Include message content')
    .action(async (channelId: string, options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);

        // Resolve channel
        const resolveResult = await resolver.resolve(channelId);
        if (!resolveResult.success) {
          formatter.error(resolveResult.error);
          process.exit(1);
        }

        const spinner = ora('Fetching messages...').start();

        const filter: MessageFilter = {
          statuses: parseStatusFilter(options.status),
        };

        const messages = await client.searchMessages(
          resolveResult.channel.id,
          filter,
          {
            offset: parseInt(options.offset, 10),
            limit: parseInt(options.limit, 10),
            includeContent: options.content,
          }
        );

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(messages, null, 2));
        } else {
          if (messages.length === 0) {
            formatter.warn('No messages found');
            return;
          }

          console.log(chalk.bold(`Messages for: ${resolveResult.channel.name}`));
          console.log();
          console.log(formatMessageTable(messages));
          console.log();
          console.log(chalk.gray(`${messages.length} message(s)`));
        }
      } catch (error) {
        formatter.error('Failed to fetch messages', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // messages search <channelId>
  // ==========================================================================
  program
    .command('messages-search')
    .alias('msearch')
    .description('Search messages with filters')
    .argument('<channelId>', 'Channel ID or name')
    .option('-s, --status <status>', 'Filter by status (R,F,T,S,Q,E,P)', (v, prev: string[]) => [...prev, v], [])
    .option('--from <datetime>', 'Messages from date/time')
    .option('--to <datetime>', 'Messages to date/time')
    .option('-l, --limit <n>', 'Limit results', '50')
    .option('-o, --offset <n>', 'Skip first N results', '0')
    .option('--content', 'Include message content')
    .option('--text <search>', 'Search in message content')
    .action(async (channelId: string, options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);

        // Resolve channel
        const resolveResult = await resolver.resolve(channelId);
        if (!resolveResult.success) {
          formatter.error(resolveResult.error);
          process.exit(1);
        }

        const spinner = ora('Searching messages...').start();

        const filter: MessageFilter = {
          statuses: parseStatusFilter(options.status),
          startDate: parseDate(options.from),
          endDate: parseDate(options.to),
          textSearch: options.text,
        };

        const messages = await client.searchMessages(
          resolveResult.channel.id,
          filter,
          {
            offset: parseInt(options.offset, 10),
            limit: parseInt(options.limit, 10),
            includeContent: options.content,
          }
        );

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(messages, null, 2));
        } else {
          if (messages.length === 0) {
            formatter.warn('No messages found matching filter');
            return;
          }

          console.log(chalk.bold(`Search results for: ${resolveResult.channel.name}`));
          console.log();
          console.log(formatMessageTable(messages));
          console.log();
          console.log(chalk.gray(`${messages.length} message(s)`));
        }
      } catch (error) {
        formatter.error('Failed to search messages', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // messages get <channelId> <messageId>
  // ==========================================================================
  program
    .command('message')
    .description('Get a single message')
    .argument('<channelId>', 'Channel ID or name')
    .argument('<messageId>', 'Message ID')
    .option('--content', 'Include message content')
    .action(async (channelId: string, messageId: string, options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);

        // Resolve channel
        const resolveResult = await resolver.resolve(channelId);
        if (!resolveResult.success) {
          formatter.error(resolveResult.error);
          process.exit(1);
        }

        const spinner = ora('Fetching message...').start();

        const message = await client.getMessage(
          resolveResult.channel.id,
          parseInt(messageId, 10),
          options.content !== false
        );

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(message, null, 2));
        } else {
          console.log(formatMessageDetails(message));

          // Show content if included
          if (options.content) {
            console.log();
            console.log(chalk.bold('Content:'));
            for (const [_metaDataId, connector] of Object.entries(message.connectorMessages)) {
              if (connector.content) {
                for (const [contentType, content] of Object.entries(connector.content)) {
                  console.log();
                  console.log(
                    chalk.cyan(`  [${connector.connectorName}] ${contentType}:`)
                  );
                  // Truncate long content
                  const contentStr = content.content;
                  if (contentStr.length > 1000) {
                    console.log(chalk.gray('    ' + contentStr.slice(0, 1000) + '...'));
                    console.log(chalk.gray(`    (${contentStr.length} characters total)`));
                  } else {
                    console.log(chalk.gray('    ' + contentStr.replace(/\n/g, '\n    ')));
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        formatter.error('Failed to get message', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // messages attachments <channelId> <messageId>
  // ==========================================================================
  program
    .command('attachments')
    .description('List attachments for a message')
    .argument('<channelId>', 'Channel ID or name')
    .argument('<messageId>', 'Message ID')
    .action(async (channelId: string, messageId: string, _, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);

        // Resolve channel
        const resolveResult = await resolver.resolve(channelId);
        if (!resolveResult.success) {
          formatter.error(resolveResult.error);
          process.exit(1);
        }

        const spinner = ora('Fetching attachments...').start();

        const attachments = await client.getMessageAttachments(
          resolveResult.channel.id,
          parseInt(messageId, 10)
        );

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(attachments, null, 2));
        } else {
          if (attachments.length === 0) {
            formatter.warn('No attachments found');
            return;
          }

          console.log(chalk.bold('Attachments:'));
          for (const att of attachments) {
            console.log(`  ${chalk.cyan(att.id)} - ${att.type}`);
          }
        }
      } catch (error) {
        formatter.error('Failed to get attachments', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // messages export <channelId>
  // ==========================================================================
  program
    .command('messages-export')
    .alias('mexport')
    .description('Export messages to a file')
    .argument('<channelId>', 'Channel ID or name')
    .option('-o, --output <file>', 'Output file (default: stdout)')
    .option('--format <format>', 'Export format (json or xml)', 'json')
    .option('-s, --status <status>', 'Filter by status')
    .option('--from <datetime>', 'Messages from date/time')
    .option('--to <datetime>', 'Messages to date/time')
    .option('-l, --limit <n>', 'Limit results', '100')
    .action(async (channelId: string, options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);

        // Resolve channel
        const resolveResult = await resolver.resolve(channelId);
        if (!resolveResult.success) {
          formatter.error(resolveResult.error);
          process.exit(1);
        }

        const spinner = ora('Exporting messages...').start();

        const filter: MessageFilter = {
          statuses: parseStatusFilter(options.status),
          startDate: parseDate(options.from),
          endDate: parseDate(options.to),
        };

        const messages = await client.exportMessages(
          resolveResult.channel.id,
          filter,
          {
            pageSize: parseInt(options.limit, 10),
            format: options.format.toUpperCase() as 'JSON' | 'XML',
          }
        );

        spinner.stop();

        const output = typeof messages === 'string'
          ? messages
          : JSON.stringify(messages, null, 2);

        if (options.output) {
          fs.writeFileSync(options.output, output);
          formatter.success(`Exported to ${options.output}`);
        } else {
          console.log(output);
        }
      } catch (error) {
        formatter.error('Failed to export messages', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // messages count <channelId>
  // ==========================================================================
  program
    .command('messages-count')
    .alias('mcount')
    .description('Count messages matching filter')
    .argument('<channelId>', 'Channel ID or name')
    .option('-s, --status <status>', 'Filter by status')
    .option('--from <datetime>', 'Messages from date/time')
    .option('--to <datetime>', 'Messages to date/time')
    .action(async (channelId: string, options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);

        // Resolve channel
        const resolveResult = await resolver.resolve(channelId);
        if (!resolveResult.success) {
          formatter.error(resolveResult.error);
          process.exit(1);
        }

        const spinner = ora('Counting messages...').start();

        const filter: MessageFilter = {
          statuses: parseStatusFilter(options.status),
          startDate: parseDate(options.from),
          endDate: parseDate(options.to),
        };

        const count = await client.getMessageCount(resolveResult.channel.id, filter);

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify({ channelId: resolveResult.channel.id, count }, null, 2));
        } else {
          console.log(`${count} message(s)`);
        }
      } catch (error) {
        formatter.error('Failed to count messages', (error as Error).message);
        process.exit(1);
      }
    });
}

export default registerMessageCommands;
