/**
 * GitClient — Shell wrapper around the git CLI.
 *
 * All git operations use child_process.execFile('git', ...) to avoid
 * native git library dependencies. This is a deliberate design choice:
 * the git CLI is universally available and avoids the complexity and
 * platform-specific issues of libgit2/nodegit bindings.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitStatus {
  branch: string;
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitDiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' }>;
}

export class GitClient {
  constructor(private repoPath: string) {}

  // ───── Repository management ─────

  async init(): Promise<void> {
    await this.exec(['init']);
    // Configure user for commits (required in clean environments like CI)
    await this.exec(['config', 'user.email', 'mirth-sync@local']);
    await this.exec(['config', 'user.name', 'Mirth Sync']);
  }

  async clone(url: string, dest?: string): Promise<void> {
    const args = ['clone', url];
    if (dest) args.push(dest);
    await this.exec(args);
  }

  async isRepo(): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  // ───── Staging & committing ─────

  async add(files: string | string[]): Promise<void> {
    const fileList = Array.isArray(files) ? files : [files];
    await this.exec(['add', ...fileList]);
  }

  async commit(message: string): Promise<string> {
    await this.exec(['commit', '-m', message]);
    return this.getCommitHash();
  }

  async status(): Promise<GitStatus> {
    const branch = await this.branch();

    // --porcelain=v1 gives machine-parseable output
    const output = await this.exec(['status', '--porcelain=v1']);

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of output.split('\n')) {
      if (!line) continue;
      const x = line[0]!; // index (staging area) status
      const y = line[1]!; // worktree status
      const file = line.slice(3);

      if (x === '?' && y === '?') {
        untracked.push(file);
      } else {
        if (x !== ' ' && x !== '?') staged.push(file);
        if (y !== ' ' && y !== '?') unstaged.push(file);
      }
    }

    return {
      branch,
      clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
      staged,
      unstaged,
      untracked,
    };
  }

  // ───── Remote operations ─────

  async push(remote?: string, branch?: string): Promise<void> {
    const args = ['push'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    await this.exec(args);
  }

  async pull(remote?: string, branch?: string): Promise<void> {
    const args = ['pull'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    await this.exec(args);
  }

  async fetch(remote?: string): Promise<void> {
    const args = ['fetch'];
    if (remote) args.push(remote);
    await this.exec(args);
  }

  // ───── Branching ─────

  async branch(): Promise<string> {
    try {
      const output = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
      return output.trim();
    } catch {
      // No commits yet — read the default branch from HEAD ref
      try {
        const symbolic = await this.exec(['symbolic-ref', '--short', 'HEAD']);
        return symbolic.trim();
      } catch {
        return 'main';
      }
    }
  }

  async checkout(branch: string, create?: boolean): Promise<void> {
    const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
    await this.exec(args);
  }

  async listBranches(): Promise<string[]> {
    const output = await this.exec(['branch', '--list']);
    return output
      .split('\n')
      .map((line) => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);
  }

  // ───── Diff & history ─────

  async diff(from: string, to?: string): Promise<string> {
    const args = ['diff', from];
    if (to) args.push(to);
    return this.exec(args);
  }

  async diffNameOnly(from: string, to?: string): Promise<string[]> {
    const args = ['diff', '--name-only', from];
    if (to) args.push(to);
    const output = await this.exec(args);
    return output.split('\n').filter(Boolean);
  }

  async diffStat(from: string, to?: string): Promise<GitDiffStat> {
    // --numstat gives machine-parseable "added\tremoved\tfilename"
    const args = ['diff', '--numstat', from];
    if (to) args.push(to);
    const numstatOutput = await this.exec(args);

    // Also get file status (A/M/D/R)
    const statusArgs = ['diff', '--name-status', from];
    if (to) statusArgs.push(to);
    const statusOutput = await this.exec(statusArgs);

    const files: GitDiffStat['files'] = [];
    let totalInsertions = 0;
    let totalDeletions = 0;

    const statusMap = new Map<string, string>();
    for (const line of statusOutput.split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      const statusCode = parts[0]!;
      const filePath = parts[1] || parts[0]!;
      statusMap.set(filePath, statusCode);
    }

    for (const line of numstatOutput.split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const insertions = parseInt(parts[0]!, 10) || 0;
      const deletions = parseInt(parts[1]!, 10) || 0;
      const path = parts[2]!;

      totalInsertions += insertions;
      totalDeletions += deletions;

      const rawStatus = statusMap.get(path) || 'M';
      let status: 'added' | 'modified' | 'deleted' | 'renamed';
      if (rawStatus.startsWith('A')) status = 'added';
      else if (rawStatus.startsWith('D')) status = 'deleted';
      else if (rawStatus.startsWith('R')) status = 'renamed';
      else status = 'modified';

      files.push({ path, status });
    }

    return {
      filesChanged: files.length,
      insertions: totalInsertions,
      deletions: totalDeletions,
      files,
    };
  }

  async log(limit?: number, path?: string): Promise<GitLogEntry[]> {
    // Use a delimiter that won't appear in commit messages
    const SEP = '---GIT_LOG_SEP---';
    const format = `%H${SEP}%h${SEP}%an${SEP}%aI${SEP}%s`;
    const args = ['log', `--format=${format}`];
    if (limit) args.push(`-${limit}`);
    if (path) {
      args.push('--');
      args.push(path);
    }
    const output = await this.exec(args);

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(SEP);
        return {
          hash: parts[0]!,
          shortHash: parts[1]!,
          author: parts[2]!,
          date: parts[3]!,
          message: parts[4]!,
        };
      });
  }

  async getCommitHash(ref?: string): Promise<string> {
    const args = ['rev-parse', ref || 'HEAD'];
    const output = await this.exec(args);
    return output.trim();
  }

  // ───── Internal helpers ─────

  private async exec(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.repoPath,
        maxBuffer: 10 * 1024 * 1024, // 10MB for large diffs
      });
      return stdout;
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string; code?: number };
      const message = error.stderr?.trim() || error.message || 'Unknown git error';
      throw new Error(`git ${args[0]}: ${message}`);
    }
  }
}
