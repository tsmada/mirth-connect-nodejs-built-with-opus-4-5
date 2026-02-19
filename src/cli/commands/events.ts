/**
 * Events Commands
 *
 * Commands for browsing and searching audit events.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ApiClient } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { OutputFormatter, formatEventTable, formatDate } from '../lib/OutputFormatter.js';
import { GlobalOptions, EventFilter, EventLevel } from '../types/index.js';

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
 * Parse level filter from command line
 */
function parseLevelFilter(level: string | string[] | undefined): EventLevel[] | undefined {
  if (!level) return undefined;

  const levels: EventLevel[] = [];
  const inputs = Array.isArray(level) ? level : [level];

  for (const input of inputs) {
    const parts = input.split(',').map((s) => s.trim().toUpperCase());
    for (const part of parts) {
      if (['INFORMATION', 'WARNING', 'ERROR', 'INFO'].includes(part)) {
        // Normalize INFO to INFORMATION
        levels.push(part === 'INFO' ? 'INFORMATION' : (part as EventLevel));
      }
    }
  }

  return levels.length > 0 ? levels : undefined;
}

/**
 * Parse date filter
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

  return dateStr;
}

/**
 * Register event commands
 */
export function registerEventCommands(program: Command): void {
  const eventsCmd = program.command('events').description('View and search audit events');

  // ==========================================================================
  // events (list recent)
  // ==========================================================================
  eventsCmd
    .option('-l, --limit <n>', 'Limit results', '50')
    .option('-o, --offset <n>', 'Skip first N results', '0')
    .option('--level <level>', 'Filter by level (INFORMATION, WARNING, ERROR)')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Fetching events...').start();

        const filter: EventFilter = {
          levels: parseLevelFilter(options.level),
        };

        const events = await client.searchEvents(filter, {
          offset: parseInt(options.offset, 10),
          limit: parseInt(options.limit, 10),
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(events, null, 2));
        } else {
          if (events.length === 0) {
            formatter.warn('No events found');
            return;
          }

          console.log(formatEventTable(events));
          console.log();
          console.log(chalk.gray(`${events.length} event(s)`));
        }
      } catch (error) {
        formatter.error('Failed to fetch events', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // events search
  // ==========================================================================
  eventsCmd
    .command('search')
    .description('Search events with filters')
    .option('--from <datetime>', 'Events from date/time')
    .option('--to <datetime>', 'Events to date/time')
    .option('--level <level>', 'Filter by level', (v, prev: string[]) => [...prev, v], [])
    .option('--name <name>', 'Filter by event name')
    .option('--user <userId>', 'Filter by user ID')
    .option('--ip <ipAddress>', 'Filter by IP address')
    .option('-l, --limit <n>', 'Limit results', '50')
    .option('-o, --offset <n>', 'Skip first N results', '0')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Searching events...').start();

        const filter: EventFilter = {
          startDate: parseDate(options.from),
          endDate: parseDate(options.to),
          levels: parseLevelFilter(options.level),
          name: options.name,
          userId: options.user ? parseInt(options.user, 10) : undefined,
          ipAddress: options.ip,
        };

        const events = await client.searchEvents(filter, {
          offset: parseInt(options.offset, 10),
          limit: parseInt(options.limit, 10),
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(events, null, 2));
        } else {
          if (events.length === 0) {
            formatter.warn('No events found matching filter');
            return;
          }

          console.log(formatEventTable(events));
          console.log();
          console.log(chalk.gray(`${events.length} event(s)`));
        }
      } catch (error) {
        formatter.error('Failed to search events', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // events count
  // ==========================================================================
  eventsCmd
    .command('count')
    .description('Count events matching filter')
    .option('--from <datetime>', 'Events from date/time')
    .option('--to <datetime>', 'Events to date/time')
    .option('--level <level>', 'Filter by level')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Counting events...').start();

        const filter: EventFilter = {
          startDate: parseDate(options.from),
          endDate: parseDate(options.to),
          levels: parseLevelFilter(options.level),
        };

        const count = await client.getEventCount(filter);

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify({ count }, null, 2));
        } else {
          console.log(`${count} event(s)`);
        }
      } catch (error) {
        formatter.error('Failed to count events', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // events errors (convenience command for error events)
  // ==========================================================================
  eventsCmd
    .command('errors')
    .description('Show recent error events')
    .option('-l, --limit <n>', 'Limit results', '20')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Fetching error events...').start();

        const filter: EventFilter = {
          levels: ['ERROR'],
        };

        const events = await client.searchEvents(filter, {
          limit: parseInt(options.limit, 10),
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(events, null, 2));
        } else {
          if (events.length === 0) {
            formatter.success('No error events found');
            return;
          }

          console.log(chalk.red.bold('Error Events'));
          console.log();

          for (const event of events) {
            console.log(
              chalk.red('●') +
                ' ' +
                chalk.bold(event.name) +
                ' ' +
                chalk.gray(`(${formatDate(event.dateTime)})`)
            );
            if (event.attributes) {
              for (const [key, value] of Object.entries(event.attributes)) {
                if (key.toLowerCase().includes('error') || key.toLowerCase().includes('message')) {
                  console.log(chalk.gray(`  ${key}: ${value}`));
                }
              }
            }
          }
          console.log();
          console.log(chalk.gray(`${events.length} error event(s)`));
        }
      } catch (error) {
        formatter.error('Failed to fetch error events', (error as Error).message);
        process.exit(1);
      }
    });
}

export default registerEventCommands;
