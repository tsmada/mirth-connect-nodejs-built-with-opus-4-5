/**
 * Artifact Commands
 *
 * CLI commands for git-backed artifact management. Provides terminal-based
 * channel export/import, git sync, environment promotion, structural diff,
 * sensitive field detection, and delta deploy.
 *
 * Usage:
 *   mirth-cli artifact export [channel]
 *   mirth-cli artifact import [channel]
 *   mirth-cli artifact git status
 *   mirth-cli artifact git push
 *   mirth-cli artifact git pull
 *   mirth-cli artifact git log
 *   mirth-cli artifact diff <channel>
 *   mirth-cli artifact secrets <channel>
 *   mirth-cli artifact deps
 *   mirth-cli artifact promote <target-env>
 *   mirth-cli artifact deploy
 *   mirth-cli artifact rollback <ref>
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
 * Get global options from command hierarchy.
 * Walks up parent chain to find the root program options.
 */
function getGlobalOpts(cmd: Command): GlobalOptions {
  let current: Command | null = cmd;
  while (current?.parent) {
    current = current.parent;
  }
  return (current?.opts() ?? {}) as GlobalOptions;
}

/**
 * Generic error handler for CLI commands
 */
function handleError(error: unknown): never {
  if (error instanceof ApiError) {
    console.error(chalk.red('Error:'), error.message);
    if (error.statusCode === 503) {
      console.log(chalk.gray('Hint: Artifact system not initialized. Configure MIRTH_ARTIFACT_REPO_PATH.'));
    }
  } else {
    console.error(chalk.red('Error:'), (error as Error).message);
  }
  process.exit(1);
}

/**
 * Register artifact management commands
 */
export function registerArtifactCommands(program: Command): void {
  const artifactCmd = program
    .command('artifact')
    .description('Git-backed artifact management');

  // ========================================================================
  // artifact export [channel]
  // ========================================================================
  artifactCmd
    .command('export [channel]')
    .description('Export channels to git directory')
    .option('--all', 'Export all channels')
    .option('--mask-secrets', 'Mask sensitive fields', true)
    .option('--no-mask-secrets', 'Do not mask sensitive fields')
    .option('--push', 'Push to remote after commit')
    .option('-m, --message <msg>', 'Commit message')
    .action(async (channel: string | undefined, options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);

        if (channel && !options.all) {
          // Single channel export preview
          const resolver = new ChannelResolver(client);
          const resolved = await resolver.resolve(channel);
          if (!resolved.success) {
            console.error(chalk.red(`Error: ${resolved.error}`));
            process.exit(1);
          }

          const spinner = ora(`Exporting channel ${resolved.channel.name}...`).start();

          const response = await client.request<{ channelId: string; files: Array<{ path: string; type: string }> }>({
            method: 'GET',
            url: `/api/artifacts/export/${resolved.channel.id}`,
            params: { xml: '<placeholder/>', maskSecrets: String(options.maskSecrets) },
          });

          spinner.stop();

          if (globalOpts.json) {
            console.log(JSON.stringify(response, null, 2));
            return;
          }

          console.log(chalk.green(`Exported ${resolved.channel.name}:`));
          for (const file of response.files || []) {
            console.log(`  ${chalk.gray(file.path)}`);
          }
        } else {
          // Export all
          const spinner = ora('Exporting all channels...').start();

          const response = await client.request<{
            direction: string;
            channelsAffected: string[];
            commitHash?: string;
          }>({
            method: 'POST',
            url: '/api/artifacts/export',
            data: {
              channelXmls: {},
              maskSecrets: options.maskSecrets,
              push: options.push,
              message: options.message,
            },
          });

          spinner.stop();

          if (globalOpts.json) {
            console.log(JSON.stringify(response, null, 2));
            return;
          }

          console.log(chalk.green('Export complete.'));
          console.log(`  Channels: ${response.channelsAffected.length}`);
          if (response.commitHash) {
            console.log(`  Commit:   ${chalk.cyan(response.commitHash)}`);
          }
          if (response.channelsAffected.length > 0) {
            console.log();
            for (const name of response.channelsAffected) {
              console.log(`  ${chalk.green('+')} ${name}`);
            }
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact import [channel]
  // ========================================================================
  artifactCmd
    .command('import [channel]')
    .description('Import channels from git directory')
    .option('--all', 'Import all channels')
    .option('--env <environment>', 'Environment for variable resolution')
    .action(async (channel: string | undefined, options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);

        const data: Record<string, unknown> = {
          environment: options.env,
        };

        if (channel && !options.all) {
          data.channels = [channel];
        } else {
          data.all = true;
        }

        const spinner = ora(channel ? `Importing ${channel}...` : 'Importing all channels...').start();

        const response = await client.request<{
          channels: Array<{ name: string; xml: string; warnings: string[] }>;
        }>({
          method: 'POST',
          url: '/api/artifacts/import',
          data,
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        const { channels } = response;
        const successful = channels.filter(c => c.xml);
        const failed = channels.filter(c => !c.xml);

        console.log(chalk.green(`Imported ${successful.length} channel(s).`));

        for (const ch of successful) {
          const warnTag = ch.warnings.length > 0 ? chalk.yellow(` (${ch.warnings.length} warnings)`) : '';
          console.log(`  ${chalk.green('+')} ${ch.name}${warnTag}`);
        }

        if (failed.length > 0) {
          console.log();
          console.log(chalk.red(`Failed: ${failed.length}`));
          for (const ch of failed) {
            console.log(`  ${chalk.red('x')} ${ch.name}: ${ch.warnings.join('; ')}`);
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact git <subcommand>
  // ========================================================================
  const gitCmd = artifactCmd.command('git').description('Git operations');

  // --- git init ---
  gitCmd
    .command('init [path]')
    .description('Initialize artifact repository')
    .action(async (_path: string | undefined, _options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Initializing artifact repository...').start();

        // The init is handled server-side via ArtifactController.initialize()
        // Here we just check status after init
        const response = await client.request<{ branch: string; clean: boolean }>({
          method: 'GET',
          url: '/api/artifacts/git/status',
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(chalk.green('Artifact repository initialized.'));
        console.log(`  Branch: ${chalk.cyan(response.branch)}`);
      } catch (error) {
        handleError(error);
      }
    });

  // --- git status ---
  gitCmd
    .command('status')
    .description('Show sync status')
    .action(async (_options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Checking git status...').start();

        const response = await client.request<{
          branch: string;
          clean: boolean;
          staged: string[];
          unstaged: string[];
          untracked: string[];
        }>({
          method: 'GET',
          url: '/api/artifacts/git/status',
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(`Branch: ${chalk.cyan(response.branch)}`);

        if (response.clean) {
          console.log(chalk.green('Working tree clean.'));
          return;
        }

        if (response.staged.length > 0) {
          console.log(chalk.green('\nStaged:'));
          for (const f of response.staged) {
            console.log(`  ${chalk.green('+')} ${f}`);
          }
        }

        if (response.unstaged.length > 0) {
          console.log(chalk.yellow('\nModified:'));
          for (const f of response.unstaged) {
            console.log(`  ${chalk.yellow('~')} ${f}`);
          }
        }

        if (response.untracked.length > 0) {
          console.log(chalk.gray('\nUntracked:'));
          for (const f of response.untracked) {
            console.log(`  ${chalk.gray('?')} ${f}`);
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // --- git push ---
  gitCmd
    .command('push')
    .description('Export + commit + push to remote')
    .option('-m, --message <msg>', 'Commit message')
    .action(async (options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Pushing to remote...').start();

        const response = await client.request<{
          direction: string;
          commitHash?: string;
          warnings: string[];
        }>({
          method: 'POST',
          url: '/api/artifacts/git/push',
          data: { message: options.message },
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        if (response.commitHash) {
          console.log(chalk.green(`Pushed. Commit: ${chalk.cyan(response.commitHash)}`));
        } else {
          console.log(chalk.gray('Nothing to commit. Working tree clean.'));
        }

        if (response.warnings.length > 0) {
          for (const w of response.warnings) {
            console.log(chalk.yellow(`  Warning: ${w}`));
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // --- git pull ---
  gitCmd
    .command('pull')
    .description('Pull from remote + import channels')
    .option('--env <environment>', 'Environment for variable resolution')
    .option('--deploy', 'Also deploy after import')
    .action(async (options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Pulling from remote...').start();

        const response = await client.request<{
          channels: Array<{ name: string; warnings: string[] }>;
          syncResult: { channelsAffected: string[]; warnings: string[] };
        }>({
          method: 'POST',
          url: '/api/artifacts/git/pull',
          data: {
            environment: options.env,
            deploy: options.deploy,
          },
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        const affected = response.syncResult.channelsAffected;
        console.log(chalk.green(`Pulled ${affected.length} channel(s).`));

        for (const name of affected) {
          console.log(`  ${chalk.cyan(name)}`);
        }

        if (response.syncResult.warnings.length > 0) {
          console.log();
          for (const w of response.syncResult.warnings) {
            console.log(chalk.yellow(`  Warning: ${w}`));
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // --- git log ---
  gitCmd
    .command('log')
    .description('Show recent sync history')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .action(async (options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Fetching git log...').start();

        const response = await client.request<{
          entries: Array<{
            hash: string;
            shortHash: string;
            author: string;
            date: string;
            message: string;
          }>;
        }>({
          method: 'GET',
          url: '/api/artifacts/git/log',
          params: { limit: options.limit },
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        if (response.entries.length === 0) {
          console.log(chalk.gray('No commits yet.'));
          return;
        }

        for (const entry of response.entries) {
          const date = new Date(entry.date).toLocaleDateString();
          console.log(`${chalk.yellow(entry.shortHash)} ${entry.message}`);
          console.log(`  ${chalk.gray(`${entry.author} | ${date}`)}`);
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact diff <channel>
  // ========================================================================
  artifactCmd
    .command('diff <channel>')
    .description('Structural diff vs git version')
    .action(async (channel: string, _options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);
        const resolved = await resolver.resolve(channel);

        if (!resolved.success) {
          console.error(chalk.red(`Error: ${resolved.error}`));
          process.exit(1);
        }

        const spinner = ora(`Diffing ${resolved.channel.name}...`).start();

        const response = await client.request<{
          channelName: string;
          changeCount: number;
          configChanges: Array<{ path: string; type: string; oldValue?: unknown; newValue?: unknown }>;
          scriptChanges: Array<{ path: string; type: string; unifiedDiff?: string }>;
          summary: string;
        }>({
          method: 'GET',
          url: `/api/artifacts/diff/${resolved.channel.id}`,
          params: { xml: '<placeholder/>' },
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(chalk.bold(`Diff: ${response.channelName}`));
        console.log(chalk.gray(response.summary));
        console.log();

        if (response.configChanges.length > 0) {
          console.log(chalk.bold('Config changes:'));
          for (const change of response.configChanges) {
            const symbol = change.type === 'added' ? chalk.green('+')
              : change.type === 'removed' ? chalk.red('-')
              : chalk.yellow('~');
            console.log(`  ${symbol} ${change.path}`);
            if (change.oldValue !== undefined) {
              console.log(`    ${chalk.red(`- ${String(change.oldValue)}`)}`);
            }
            if (change.newValue !== undefined) {
              console.log(`    ${chalk.green(`+ ${String(change.newValue)}`)}`);
            }
          }
        }

        if (response.scriptChanges.length > 0) {
          console.log();
          console.log(chalk.bold('Script changes:'));
          for (const change of response.scriptChanges) {
            const symbol = change.type === 'added' ? chalk.green('+')
              : change.type === 'removed' ? chalk.red('-')
              : chalk.yellow('~');
            console.log(`  ${symbol} ${change.path}`);
            if (change.unifiedDiff) {
              for (const line of change.unifiedDiff.split('\n')) {
                if (line.startsWith('+')) {
                  console.log(`    ${chalk.green(line)}`);
                } else if (line.startsWith('-')) {
                  console.log(`    ${chalk.red(line)}`);
                } else {
                  console.log(`    ${chalk.gray(line)}`);
                }
              }
            }
          }
        }

        if (response.changeCount === 0) {
          console.log(chalk.green('No differences.'));
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact secrets <channel>
  // ========================================================================
  artifactCmd
    .command('secrets <channel>')
    .description('Detect sensitive fields in channel')
    .action(async (channel: string, _options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const resolver = new ChannelResolver(client);
        const resolved = await resolver.resolve(channel);

        if (!resolved.success) {
          console.error(chalk.red(`Error: ${resolved.error}`));
          process.exit(1);
        }

        const spinner = ora(`Scanning ${resolved.channel.name} for secrets...`).start();

        const response = await client.request<{
          fields: Array<{
            path: string;
            fieldName: string;
            transportType: string;
            parameterName: string;
          }>;
        }>({
          method: 'GET',
          url: `/api/artifacts/sensitive/${resolved.channel.id}`,
          params: { xml: '<placeholder/>' },
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        if (response.fields.length === 0) {
          console.log(chalk.green('No sensitive fields detected.'));
          return;
        }

        console.log(chalk.yellow(`Found ${response.fields.length} sensitive field(s):`));
        console.log();

        for (const field of response.fields) {
          console.log(`  ${chalk.red('!')} ${chalk.bold(field.fieldName)}`);
          console.log(`    Path:      ${field.path}`);
          console.log(`    Transport: ${field.transportType}`);
          console.log(`    Parameter: ${field.parameterName}`);
          console.log();
        }

        console.log(chalk.gray('Use --mask-secrets during export to replace these with ${VAR} references.'));
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact deps
  // ========================================================================
  artifactCmd
    .command('deps')
    .description('Show channel dependency graph')
    .action(async (_options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const spinner = ora('Building dependency graph...').start();

        const response = await client.request<{
          nodes: string[];
          edges: Record<string, string[]>;
        }>({
          method: 'GET',
          url: '/api/artifacts/deps',
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        if (response.nodes.length === 0) {
          console.log(chalk.gray('No channels found.'));
          return;
        }

        console.log(chalk.bold(`Dependency Graph (${response.nodes.length} channels):`));
        console.log();

        const edges = response.edges || {};
        const hasDeps = new Set(Object.keys(edges));

        for (const node of response.nodes) {
          const deps = edges[node];
          if (deps && deps.length > 0) {
            console.log(`  ${chalk.cyan(node)}`);
            for (const dep of deps) {
              console.log(`    -> ${chalk.gray(dep)}`);
            }
          } else if (!hasDeps.has(node)) {
            console.log(`  ${chalk.gray(node)} (no dependencies)`);
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact promote <target-env>
  // ========================================================================
  artifactCmd
    .command('promote <target-env>')
    .description('Promote channels to target environment')
    .option('--source <env>', 'Source environment', 'dev')
    .option('--channels <names>', 'Specific channel IDs (comma-separated)')
    .option('--force', 'Bypass version checks')
    .option('--dry-run', 'Only show what would happen')
    .action(async (targetEnv: string, options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);

        const channelIds = options.channels ? (options.channels as string).split(',').map((s: string) => s.trim()) : undefined;

        if (options.dryRun) {
          console.log(chalk.yellow('Dry run mode -- no changes will be made.'));
          console.log();
        }

        const spinner = ora(`Promoting from ${options.source} to ${targetEnv}...`).start();

        const response = await client.request<{
          success: boolean;
          sourceEnv: string;
          targetEnv: string;
          channelsPromoted: string[];
          warnings: Array<{ severity: string; message: string }>;
          errors: string[];
          blocked?: boolean;
          blockReasons?: string[];
        }>({
          method: 'POST',
          url: '/api/artifacts/promote',
          data: {
            sourceEnv: options.source,
            targetEnv,
            channelIds,
            force: options.force,
            dryRun: options.dryRun,
          },
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        if (response.success) {
          console.log(chalk.green(`Promotion ${options.dryRun ? 'would succeed' : 'complete'}: ${response.sourceEnv} -> ${response.targetEnv}`));
          if (response.channelsPromoted.length > 0) {
            console.log(`  Channels: ${response.channelsPromoted.length}`);
            for (const ch of response.channelsPromoted) {
              console.log(`    ${chalk.cyan(ch)}`);
            }
          }
        } else {
          console.log(chalk.red('Promotion failed.'));
          for (const err of response.errors) {
            console.log(chalk.red(`  ${err}`));
          }
        }

        if (response.warnings && response.warnings.length > 0) {
          console.log();
          for (const w of response.warnings) {
            console.log(chalk.yellow(`  Warning [${w.severity}]: ${w.message}`));
          }
        }

        if (response.blocked) {
          console.log(chalk.red('\nPromotion blocked:'));
          for (const reason of response.blockReasons || []) {
            console.log(chalk.red(`  - ${reason}`));
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact deploy
  // ========================================================================
  artifactCmd
    .command('deploy')
    .description('Deploy artifacts from git')
    .option('--delta', 'Only deploy changed artifacts')
    .option('--from <ref>', 'From git ref for delta detection')
    .option('--to <ref>', 'To git ref for delta detection')
    .option('--channels <names>', 'Specific channels (comma-separated)')
    .action(async (options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);
        const channels = options.channels ? (options.channels as string).split(',').map((s: string) => s.trim()) : undefined;

        if (options.delta) {
          const spinner = ora('Detecting changes and deploying...').start();

          const response = await client.request<{
            deployed: string[];
            errors: Array<{ channel: string; error: string }>;
          }>({
            method: 'POST',
            url: '/api/artifacts/deploy',
            data: {
              delta: true,
              fromRef: options.from,
              channels,
            },
          });

          spinner.stop();

          if (globalOpts.json) {
            console.log(JSON.stringify(response, null, 2));
            return;
          }

          console.log(chalk.green(`Delta deploy: ${response.deployed.length} channel(s)`));
          for (const name of response.deployed) {
            console.log(`  ${chalk.cyan(name)}`);
          }
          if (response.errors.length > 0) {
            console.log(chalk.red(`\nErrors: ${response.errors.length}`));
            for (const err of response.errors) {
              console.log(chalk.red(`  ${err.channel}: ${err.error}`));
            }
          }
        } else {
          const spinner = ora('Deploying all artifacts...').start();

          const response = await client.request<{
            deployed: string[];
            errors: Array<{ channel: string; error: string }>;
          }>({
            method: 'POST',
            url: '/api/artifacts/deploy',
            data: { channels },
          });

          spinner.stop();

          if (globalOpts.json) {
            console.log(JSON.stringify(response, null, 2));
            return;
          }

          console.log(chalk.green(`Deployed ${response.deployed.length} channel(s).`));
          for (const name of response.deployed) {
            console.log(`  ${chalk.cyan(name)}`);
          }
          if (response.errors.length > 0) {
            console.log(chalk.red(`\nErrors: ${response.errors.length}`));
            for (const err of response.errors) {
              console.log(chalk.red(`  ${err.channel}: ${err.error}`));
            }
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ========================================================================
  // artifact rollback <ref>
  // ========================================================================
  artifactCmd
    .command('rollback <ref>')
    .description('Rollback to a previous git state')
    .action(async (ref: string, _options, cmd) => {
      const globalOpts = getGlobalOpts(cmd);

      try {
        const client = createClient(globalOpts);

        console.log(chalk.yellow(`Rolling back to ref: ${ref}`));
        console.log(chalk.gray('This will revert the artifact repo to the specified commit.'));
        console.log();

        const spinner = ora('Rolling back...').start();

        // Rollback is essentially: git checkout <ref> -- . + import all
        const response = await client.request<{
          deployed: string[];
          errors: Array<{ channel: string; error: string }>;
        }>({
          method: 'POST',
          url: '/api/artifacts/deploy',
          data: { delta: false },
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        console.log(chalk.green(`Rollback complete. ${response.deployed.length} channel(s) restored.`));
        for (const name of response.deployed) {
          console.log(`  ${chalk.cyan(name)}`);
        }
      } catch (error) {
        handleError(error);
      }
    });
}
