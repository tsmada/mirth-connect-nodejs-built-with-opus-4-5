/**
 * Authentication Commands
 *
 * Handles login, logout, and session management for the CLI.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as readline from 'readline';
import { ApiClient } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { OutputFormatter } from '../lib/OutputFormatter.js';
import { GlobalOptions } from '../types/index.js';

/**
 * Prompt for password (hidden input)
 */
async function promptPassword(prompt: string = 'Password: '): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Hide password input
    const stdin = process.stdin;
    if (stdin.isTTY) {
      process.stdout.write(prompt);
      let password = '';

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const onData = (char: string) => {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            stdin.setRawMode(false);
            stdin.removeListener('data', onData);
            rl.close();
            console.log(); // New line after password
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.exit(1);
            break;
          case '\u007F': // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.clearLine(0);
              process.stdout.cursorTo(0);
              process.stdout.write(prompt + '*'.repeat(password.length));
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };

      stdin.on('data', onData);
    } else {
      // Non-TTY mode (piped input)
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Prompt for username
 */
async function promptUsername(prompt: string = 'Username: '): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Register auth commands
 */
export function registerAuthCommands(program: Command): void {
  // ==========================================================================
  // login command
  // ==========================================================================
  program
    .command('login')
    .description('Authenticate with the Mirth Connect server')
    .option('-u, --user <username>', 'Username')
    .option('-p, --password <password>', 'Password (insecure - prefer interactive prompt)')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        // Get URL from global options or config
        const serverUrl = globalOpts.url || ConfigManager.getServerUrl();

        // Get username (from options, global options, or prompt)
        let username = options.user || globalOpts.user;
        if (!username) {
          username = await promptUsername();
        }

        // Get password (from options or prompt)
        let password = options.password || globalOpts.password;
        if (!password) {
          password = await promptPassword();
        }

        // Create API client and login
        const spinner = ora('Logging in...').start();

        const client = new ApiClient({
          baseUrl: serverUrl,
          verbose: globalOpts.verbose,
        });

        const result = await client.login(username, password);

        if (result.status.status === 'SUCCESS' || result.status.status === 'SUCCESS_GRACE_PERIOD') {
          // Save username to config
          ConfigManager.set('username', username);

          spinner.succeed(`Logged in as ${chalk.cyan(username)}`);

          if (result.status.status === 'SUCCESS_GRACE_PERIOD') {
            formatter.warn('You are in a grace period. Please update your password soon.');
          }

          if (globalOpts.verbose) {
            console.log(chalk.gray(`  Server: ${serverUrl}`));
            console.log(chalk.gray(`  Token: ${result.token?.slice(0, 20)}...`));
          }
        } else {
          spinner.fail('Login failed');
          formatter.error(result.status.message || 'Unknown error');
          process.exit(1);
        }
      } catch (error) {
        formatter.error('Login failed', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // logout command
  // ==========================================================================
  program
    .command('logout')
    .description('Clear the saved session')
    .action(async (_, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const serverUrl = globalOpts.url || ConfigManager.getServerUrl();
        const hasSession = ConfigManager.hasValidSession();

        if (hasSession) {
          // Try to logout from server
          const spinner = ora('Logging out...').start();

          try {
            const client = new ApiClient({
              baseUrl: serverUrl,
              verbose: globalOpts.verbose,
            });
            await client.logout();
            spinner.succeed('Logged out successfully');
          } catch {
            // Even if server logout fails, clear local session
            ConfigManager.clearSession();
            spinner.succeed('Session cleared (server may have already expired)');
          }
        } else {
          ConfigManager.clearSession();
          formatter.info('No active session to clear');
        }
      } catch (error) {
        formatter.error('Logout failed', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // whoami command (bonus utility)
  // ==========================================================================
  program
    .command('whoami')
    .description('Display current user and session info')
    .action(async (_, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        const serverUrl = ConfigManager.getServerUrl();
        const hasSession = ConfigManager.hasValidSession();

        if (!hasSession) {
          formatter.warn('Not logged in');
          if (globalOpts.json) {
            console.log(JSON.stringify({ loggedIn: false, serverUrl }, null, 2));
          }
          return;
        }

        // Verify session with server
        const spinner = ora('Checking session...').start();

        const client = new ApiClient({
          baseUrl: serverUrl,
          verbose: globalOpts.verbose,
        });

        const user = await client.getCurrentUser();

        if (user) {
          spinner.stop();
          if (globalOpts.json) {
            console.log(
              JSON.stringify(
                {
                  loggedIn: true,
                  serverUrl,
                  user: {
                    id: user.id,
                    username: user.username,
                  },
                },
                null,
                2
              )
            );
          } else {
            console.log(`Logged in as ${chalk.cyan(user.username)}`);
            console.log(chalk.gray(`  Server: ${serverUrl}`));
            console.log(chalk.gray(`  User ID: ${user.id}`));
          }
        } else {
          spinner.stop();
          formatter.warn('Session expired or invalid');
          ConfigManager.clearSession();
        }
      } catch (error) {
        formatter.error('Failed to verify session', (error as Error).message);
        process.exit(1);
      }
    });
}

export default registerAuthCommands;
