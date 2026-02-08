/**
 * GitClient tests — uses real temporary git repositories.
 *
 * Each test suite creates fresh temp directories and initializes
 * real git repos to test against. No mocking of git operations.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitClient } from '../../../src/artifact/git/GitClient';

describe('GitClient', () => {
  let tmpDir: string;
  let client: GitClient;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-test-'));
    client = new GitClient(tmpDir);
    await client.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('init and isRepo', () => {
    it('should initialize a git repository', async () => {
      const isRepo = await client.isRepo();
      expect(isRepo).toBe(true);
    });

    it('should return false for non-git directory', async () => {
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'not-git-'));
      const nonGitClient = new GitClient(nonGitDir);
      const isRepo = await nonGitClient.isRepo();
      expect(isRepo).toBe(false);
      await fs.rm(nonGitDir, { recursive: true, force: true });
    });
  });

  describe('add and commit', () => {
    it('should add and commit a file', async () => {
      await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello');
      await client.add('test.txt');
      const hash = await client.commit('initial commit');

      expect(hash).toBeTruthy();
      expect(hash.length).toBe(40); // full SHA-1 hash
    });

    it('should add multiple files', async () => {
      await fs.writeFile(path.join(tmpDir, 'a.txt'), 'aaa');
      await fs.writeFile(path.join(tmpDir, 'b.txt'), 'bbb');
      await client.add(['a.txt', 'b.txt']);
      await client.commit('add two files');

      const status = await client.status();
      expect(status.clean).toBe(true);
    });
  });

  describe('status', () => {
    it('should report clean status after commit', async () => {
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
      await client.add('file.txt');
      await client.commit('commit');

      const status = await client.status();
      expect(status.clean).toBe(true);
      expect(status.staged).toEqual([]);
      expect(status.unstaged).toEqual([]);
      expect(status.untracked).toEqual([]);
    });

    it('should detect untracked files', async () => {
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
      await client.add('file.txt');
      await client.commit('commit');

      await fs.writeFile(path.join(tmpDir, 'new.txt'), 'new');
      const status = await client.status();
      expect(status.clean).toBe(false);
      expect(status.untracked).toContain('new.txt');
    });

    it('should detect staged files', async () => {
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
      await client.add('file.txt');

      const status = await client.status();
      expect(status.staged).toContain('file.txt');
    });

    it('should detect unstaged modifications', async () => {
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
      await client.add('file.txt');
      await client.commit('commit');

      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'modified');
      const status = await client.status();
      expect(status.clean).toBe(false);
      expect(status.unstaged).toContain('file.txt');
    });

    it('should report branch name', async () => {
      await fs.writeFile(path.join(tmpDir, 'init.txt'), '');
      await client.add('init.txt');
      await client.commit('init');

      const status = await client.status();
      // Could be 'main' or 'master' depending on git config
      expect(['main', 'master']).toContain(status.branch);
    });
  });

  describe('branch and checkout', () => {
    beforeEach(async () => {
      // Need an initial commit for branching to work
      await fs.writeFile(path.join(tmpDir, 'init.txt'), 'init');
      await client.add('init.txt');
      await client.commit('initial commit');
    });

    it('should return current branch', async () => {
      const branch = await client.branch();
      expect(['main', 'master']).toContain(branch);
    });

    it('should create and switch to new branch', async () => {
      await client.checkout('feature-test', true);
      const branch = await client.branch();
      expect(branch).toBe('feature-test');
    });

    it('should switch between branches', async () => {
      const originalBranch = await client.branch();
      await client.checkout('feature-branch', true);
      expect(await client.branch()).toBe('feature-branch');

      await client.checkout(originalBranch);
      expect(await client.branch()).toBe(originalBranch);
    });

    it('should list branches', async () => {
      await client.checkout('branch-a', true);
      await client.checkout('branch-b', true);

      const branches = await client.listBranches();
      expect(branches).toContain('branch-a');
      expect(branches).toContain('branch-b');
    });
  });

  describe('log', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'first');
      await client.add('file1.txt');
      await client.commit('first commit');

      await fs.writeFile(path.join(tmpDir, 'file2.txt'), 'second');
      await client.add('file2.txt');
      await client.commit('second commit');

      await fs.writeFile(path.join(tmpDir, 'file3.txt'), 'third');
      await client.add('file3.txt');
      await client.commit('third commit');
    });

    it('should return commit log', async () => {
      const log = await client.log();
      expect(log.length).toBe(3);
      expect(log[0]!.message).toBe('third commit');
      expect(log[2]!.message).toBe('first commit');
    });

    it('should limit log entries', async () => {
      const log = await client.log(2);
      expect(log.length).toBe(2);
      expect(log[0]!.message).toBe('third commit');
    });

    it('should include hash, author, and date', async () => {
      const log = await client.log(1);
      expect(log[0]!.hash).toHaveLength(40);
      expect(log[0]!.shortHash.length).toBeLessThanOrEqual(12);
      expect(log[0]!.author).toBe('Mirth Sync');
      expect(log[0]!.date).toBeTruthy();
    });

    it('should filter by path', async () => {
      const log = await client.log(undefined, 'file1.txt');
      expect(log.length).toBe(1);
      expect(log[0]!.message).toBe('first commit');
    });
  });

  describe('diff', () => {
    let firstHash: string;

    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'original');
      await client.add('file.txt');
      firstHash = await client.commit('initial');

      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'modified');
      await fs.writeFile(path.join(tmpDir, 'new.txt'), 'new file');
      await client.add(['file.txt', 'new.txt']);
      await client.commit('second');
    });

    it('should produce diff output', async () => {
      const diffOutput = await client.diff(firstHash);
      expect(diffOutput).toContain('modified');
    });

    it('should list changed files by name', async () => {
      const names = await client.diffNameOnly(firstHash);
      expect(names).toContain('file.txt');
      expect(names).toContain('new.txt');
    });

    it('should produce diff stats', async () => {
      const stat = await client.diffStat(firstHash);
      expect(stat.filesChanged).toBe(2);
      expect(stat.insertions).toBeGreaterThan(0);
      expect(stat.files.length).toBe(2);

      const newFile = stat.files.find(f => f.path === 'new.txt');
      expect(newFile).toBeDefined();
      expect(newFile!.status).toBe('added');
    });

    it('should diff between two refs', async () => {
      const headHash = await client.getCommitHash();
      const names = await client.diffNameOnly(firstHash, headHash);
      expect(names.length).toBeGreaterThan(0);
    });
  });

  describe('getCommitHash', () => {
    it('should return HEAD hash', async () => {
      await fs.writeFile(path.join(tmpDir, 'test.txt'), 'data');
      await client.add('test.txt');
      const commitHash = await client.commit('test');
      const headHash = await client.getCommitHash();

      expect(headHash).toBe(commitHash);
    });

    it('should return hash for specific ref', async () => {
      await fs.writeFile(path.join(tmpDir, 'test.txt'), 'data');
      await client.add('test.txt');
      await client.commit('test');
      const hash = await client.getCommitHash('HEAD');
      expect(hash).toHaveLength(40);
    });
  });

  describe('error handling', () => {
    it('should throw descriptive error for invalid git operations', async () => {
      await expect(client.checkout('nonexistent-branch'))
        .rejects.toThrow(/git checkout/);
    });

    it('should throw on commit with nothing staged', async () => {
      await expect(client.commit('empty'))
        .rejects.toThrow(/git commit/);
    });
  });
});
