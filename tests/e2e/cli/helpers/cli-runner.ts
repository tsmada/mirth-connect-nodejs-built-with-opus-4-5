/**
 * CLI Runner Helper
 *
 * Utility for running CLI commands in E2E tests and capturing output.
 */

import { spawn, SpawnOptions } from 'child_process';
import * as http from 'http';
import * as path from 'path';

/**
 * Result of a CLI command execution
 */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  duration: number;
}

/**
 * Options for running CLI commands
 */
export interface RunOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const CLI_PATH = path.resolve(__dirname, '../../../../dist/cli/index.js');

/**
 * Run a CLI command and return the result
 *
 * @param args - Command-line arguments
 * @param options - Execution options
 * @returns Promise resolving to the command result
 */
export async function runCli(
  args: string[],
  options: RunOptions = {}
): Promise<CliResult> {
  const timeout = options.timeout ?? 30000;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      timeout,
    };

    const proc = spawn('node', [CLI_PATH, ...args], spawnOptions);

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const finish = (exitCode: number) => {
      if (resolved) return;
      resolved = true;

      const duration = Date.now() - startTime;
      resolve({
        stdout,
        stderr,
        exitCode,
        success: exitCode === 0,
        duration,
      });
    };

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      finish(code ?? 1);
    });

    proc.on('error', (err) => {
      stderr += err.message;
      finish(1);
    });

    // Handle timeout
    setTimeout(() => {
      if (!resolved) {
        proc.kill('SIGKILL');
        stderr += '\nCommand timed out';
        finish(124); // Standard timeout exit code
      }
    }, timeout);
  });
}

/**
 * Run CLI command and expect success
 */
export async function runCliExpectSuccess(
  args: string[],
  options: RunOptions = {}
): Promise<CliResult> {
  const result = await runCli(args, options);
  if (!result.success) {
    throw new Error(
      `CLI command failed with exit code ${result.exitCode}:\n` +
        `stdout: ${result.stdout}\n` +
        `stderr: ${result.stderr}`
    );
  }
  return result;
}

/**
 * Run CLI command and expect failure
 */
export async function runCliExpectFailure(
  args: string[],
  options: RunOptions = {}
): Promise<CliResult> {
  const result = await runCli(args, options);
  if (result.success) {
    throw new Error(
      `CLI command succeeded but was expected to fail:\n` +
        `stdout: ${result.stdout}`
    );
  }
  return result;
}

/**
 * Run login command
 */
export async function login(
  user: string = 'admin',
  password: string = 'admin'
): Promise<CliResult> {
  return runCliExpectSuccess(['login', '--user', user, '--password', password]);
}

/**
 * Run logout command
 */
export async function logout(): Promise<CliResult> {
  return runCli(['logout']);
}

/**
 * Check if the Mirth server is available for E2E tests
 */
export async function isServerAvailable(
  url: string = 'http://localhost:8081/api/server/version'
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      // Any response means the server is up
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Strip ANSI color codes from string
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Parse table output from CLI
 */
export function parseTable(output: string): string[][] {
  const lines = stripAnsi(output).split('\n');
  const rows: string[][] = [];

  for (const line of lines) {
    // Skip separator lines
    if (line.startsWith('├') || line.startsWith('└') || line.startsWith('┌')) {
      continue;
    }
    // Parse data rows
    if (line.startsWith('│')) {
      const cells = line
        .split('│')
        .slice(1, -1) // Remove first and last empty elements
        .map((cell) => cell.trim());
      rows.push(cells);
    }
  }

  return rows;
}
