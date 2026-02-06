/**
 * Trace Command
 *
 * Traces a message across VM-connected channels, showing the complete
 * message journey from source to final destination(s).
 *
 * Usage:
 *   mirth-cli trace <channel> <messageId> [options]
 *
 * Examples:
 *   mirth-cli trace "ADT Receiver" 123
 *   mirth-cli trace "ADT Receiver" 123 --verbose
 *   mirth-cli trace "ADT Receiver" 123 --direction backward
 *   mirth-cli trace "ADT Receiver" 123 --no-content
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ApiClient } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { ChannelResolver } from '../lib/ChannelResolver.js';
import { OutputFormatter } from '../lib/OutputFormatter.js';
import { formatTraceTree } from '../lib/TraceFormatter.js';
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
 * Register trace command
 */
export function registerTraceCommand(program: Command): void {
  program
    .command('trace <channel> <messageId>')
    .description('Trace a message across VM-connected channels')
    .option('-v, --verbose', 'Show full content (2000 char limit vs 200)')
    .option('-c, --content <types>', 'Content types to show (comma-separated)', 'raw,transformed,response,error')
    .option('--max-depth <n>', 'Max trace depth', '10')
    .option('--direction <dir>', 'Trace direction: both, backward, forward', 'both')
    .option('--no-content', 'Hide content, show tree structure only')
    .option('--json', 'Output raw JSON')
    .action(async (channel: string, messageIdStr: string, options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json || options.json);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);

        // Resolve channel name to ID
        const resolveResult = await resolver.resolve(channel);
        if (!resolveResult.success) {
          formatter.error(resolveResult.error);
          if (resolveResult.suggestions && resolveResult.suggestions.length > 0) {
            console.log(chalk.gray('\nDid you mean:'));
            for (const s of resolveResult.suggestions) {
              console.log(chalk.gray(`  - ${s.name} (${s.id})`));
            }
          }
          process.exit(1);
        }

        const channelId = resolveResult.channel.id;
        const messageId = parseInt(messageIdStr, 10);

        if (isNaN(messageId)) {
          formatter.error('Invalid message ID: must be a number');
          process.exit(1);
        }

        const spinner = ora('Tracing message across channels...').start();

        // Build API options
        const includeContent = options.content !== false;
        const maxPreview = options.verbose ? 2000 : 200;

        const result = await client.traceMessage(channelId, messageId, {
          includeContent,
          contentTypes: options.content !== false ? options.content : undefined,
          maxContentLength: options.verbose ? 2000 : 500,
          maxDepth: parseInt(options.maxDepth, 10) || 10,
          direction: options.direction,
        });

        spinner.stop();

        // Output
        if (globalOpts.json || options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const output = formatTraceTree(result, {
            showContent: includeContent,
            maxPreviewLength: maxPreview,
          });
          console.log(output);
        }
      } catch (error) {
        const err = error as Error & { statusCode?: number };

        if (err.statusCode === 404) {
          formatter.error(err.message || 'Message not found');
        } else {
          formatter.error('Failed to trace message', err.message);
        }
        process.exit(1);
      }
    });
}
