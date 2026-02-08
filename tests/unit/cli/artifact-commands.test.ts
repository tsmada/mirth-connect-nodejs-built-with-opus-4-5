/**
 * Artifact CLI commands tests
 *
 * Tests that the CLI command tree is properly registered with the right
 * subcommands, options, and hierarchy.
 *
 * Note: We mock ora and chalk since they are ESM-only modules that
 * don't work with Jest's CJS transform.
 */

// Mock ESM-only modules before any imports
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  }),
}));

const passthroughFn = (s: string) => s;
const chainable: any = Object.assign(passthroughFn, {
  red: passthroughFn,
  green: passthroughFn,
  yellow: passthroughFn,
  cyan: passthroughFn,
  gray: passthroughFn,
  bold: passthroughFn,
  white: passthroughFn,
});
chainable.red.bold = passthroughFn;
chainable.green.bold = passthroughFn;
chainable.yellow.bold = passthroughFn;

jest.mock('chalk', () => ({
  __esModule: true,
  default: chainable,
}));

jest.mock('conf', () => ({
  __esModule: true,
  default: class MockConf {
    get() { return undefined; }
    set() {}
    delete() {}
    has() { return false; }
  },
}));

jest.mock('../../../src/cli/lib/ConfigManager', () => ({
  ConfigManager: {
    getServerUrl: () => 'http://localhost:8081',
    getSessionToken: () => null,
    setSessionToken: jest.fn(),
    getConfig: () => ({}),
    setConfig: jest.fn(),
  },
}));

jest.mock('../../../src/cli/lib/ApiClient', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
  })),
  ApiError: class ApiError extends Error {
    statusCode?: number;
    response?: unknown;
    constructor(msg: string, code?: number) {
      super(msg);
      this.name = 'ApiError';
      this.statusCode = code;
    }
  },
}));

jest.mock('../../../src/cli/lib/ChannelResolver', () => ({
  ChannelResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn(),
  })),
}));

import { Command } from 'commander';
import { registerArtifactCommands } from '../../../src/cli/commands/artifact';

describe('artifact CLI commands', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.option('--url <url>', 'Server URL');
    program.option('--json', 'JSON output');
    program.option('-v, --verbose', 'Verbose');
    registerArtifactCommands(program);
  });

  function findCommand(parent: Command, name: string): Command | undefined {
    return parent.commands.find((c: Command) => c.name() === name);
  }

  function findOption(cmd: Command, longFlag: string): boolean {
    return cmd.options.some((o: any) => o.long === longFlag);
  }

  // --- Top-level registration ------------------------------------------------

  it('registers artifact command', () => {
    const cmd = findCommand(program, 'artifact');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toMatch(/artifact/i);
  });

  // --- Export / Import -------------------------------------------------------

  it('registers artifact export subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const exportCmd = findCommand(artifact, 'export');
    expect(exportCmd).toBeDefined();
  });

  it('artifact export has --all option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const exportCmd = findCommand(artifact, 'export')!;
    expect(findOption(exportCmd, '--all')).toBe(true);
  });

  it('artifact export has --mask-secrets option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const exportCmd = findCommand(artifact, 'export')!;
    expect(findOption(exportCmd, '--mask-secrets')).toBe(true);
  });

  it('artifact export has --push option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const exportCmd = findCommand(artifact, 'export')!;
    expect(findOption(exportCmd, '--push')).toBe(true);
  });

  it('artifact export has -m/--message option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const exportCmd = findCommand(artifact, 'export')!;
    expect(findOption(exportCmd, '--message')).toBe(true);
  });

  it('registers artifact import subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const importCmd = findCommand(artifact, 'import');
    expect(importCmd).toBeDefined();
  });

  it('artifact import has --env option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const importCmd = findCommand(artifact, 'import')!;
    expect(findOption(importCmd, '--env')).toBe(true);
  });

  // --- Git subcommands -------------------------------------------------------

  it('registers artifact git subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git');
    expect(gitCmd).toBeDefined();
  });

  it('registers git init subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const initCmd = findCommand(gitCmd, 'init');
    expect(initCmd).toBeDefined();
  });

  it('registers git status subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const statusCmd = findCommand(gitCmd, 'status');
    expect(statusCmd).toBeDefined();
  });

  it('registers git push subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const pushCmd = findCommand(gitCmd, 'push');
    expect(pushCmd).toBeDefined();
  });

  it('git push has -m/--message option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const pushCmd = findCommand(gitCmd, 'push')!;
    expect(findOption(pushCmd, '--message')).toBe(true);
  });

  it('registers git pull subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const pullCmd = findCommand(gitCmd, 'pull');
    expect(pullCmd).toBeDefined();
  });

  it('git pull has --env option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const pullCmd = findCommand(gitCmd, 'pull')!;
    expect(findOption(pullCmd, '--env')).toBe(true);
  });

  it('git pull has --deploy option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const pullCmd = findCommand(gitCmd, 'pull')!;
    expect(findOption(pullCmd, '--deploy')).toBe(true);
  });

  it('registers git log subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const logCmd = findCommand(gitCmd, 'log');
    expect(logCmd).toBeDefined();
  });

  it('git log has -n/--limit option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    const logCmd = findCommand(gitCmd, 'log')!;
    expect(findOption(logCmd, '--limit')).toBe(true);
  });

  // --- Analysis commands -----------------------------------------------------

  it('registers artifact diff subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const diffCmd = findCommand(artifact, 'diff');
    expect(diffCmd).toBeDefined();
  });

  it('registers artifact secrets subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const secretsCmd = findCommand(artifact, 'secrets');
    expect(secretsCmd).toBeDefined();
  });

  it('registers artifact deps subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const depsCmd = findCommand(artifact, 'deps');
    expect(depsCmd).toBeDefined();
  });

  // --- Promotion -------------------------------------------------------------

  it('registers artifact promote subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const promoteCmd = findCommand(artifact, 'promote');
    expect(promoteCmd).toBeDefined();
  });

  it('artifact promote has --force option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const promoteCmd = findCommand(artifact, 'promote')!;
    expect(findOption(promoteCmd, '--force')).toBe(true);
  });

  it('artifact promote has --dry-run option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const promoteCmd = findCommand(artifact, 'promote')!;
    expect(findOption(promoteCmd, '--dry-run')).toBe(true);
  });

  it('artifact promote has --source option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const promoteCmd = findCommand(artifact, 'promote')!;
    expect(findOption(promoteCmd, '--source')).toBe(true);
  });

  // --- Deploy ----------------------------------------------------------------

  it('registers artifact deploy subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const deployCmd = findCommand(artifact, 'deploy');
    expect(deployCmd).toBeDefined();
  });

  it('artifact deploy has --delta option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const deployCmd = findCommand(artifact, 'deploy')!;
    expect(findOption(deployCmd, '--delta')).toBe(true);
  });

  it('artifact deploy has --from option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const deployCmd = findCommand(artifact, 'deploy')!;
    expect(findOption(deployCmd, '--from')).toBe(true);
  });

  it('artifact deploy has --channels option', () => {
    const artifact = findCommand(program, 'artifact')!;
    const deployCmd = findCommand(artifact, 'deploy')!;
    expect(findOption(deployCmd, '--channels')).toBe(true);
  });

  // --- Rollback --------------------------------------------------------------

  it('registers artifact rollback subcommand', () => {
    const artifact = findCommand(program, 'artifact')!;
    const rollbackCmd = findCommand(artifact, 'rollback');
    expect(rollbackCmd).toBeDefined();
  });

  // --- Overall structure -----------------------------------------------------

  it('has the expected number of subcommands', () => {
    const artifact = findCommand(program, 'artifact')!;
    // export, import, git, diff, secrets, deps, promote, deploy, rollback = 9
    expect(artifact.commands.length).toBe(9);
  });

  it('git has 5 subcommands (init, status, push, pull, log)', () => {
    const artifact = findCommand(program, 'artifact')!;
    const gitCmd = findCommand(artifact, 'git')!;
    expect(gitCmd.commands.length).toBe(5);
  });
});
