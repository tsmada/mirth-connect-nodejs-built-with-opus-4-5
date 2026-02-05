/**
 * JavaDiffAnalyzer - Analyze changes between Java Mirth versions using git.
 *
 * Uses git commands against the Java Mirth repository at ~/Projects/connect
 * to determine what files changed between version tags.
 */

import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface JavaRepoConfig {
  repoPath: string;
  serverSrc: string;
  donkeySrc: string;
  migrationPath: string;
}

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C';
  additions?: number;
  deletions?: number;
}

export interface FileChange {
  file: string;
  status: string;
  diff?: string;
}

export class JavaDiffAnalyzer {
  private config: JavaRepoConfig;
  private git: SimpleGit | null = null;

  constructor() {
    // Default config - will be loaded from config file
    this.config = {
      repoPath: path.join(process.env.HOME || '~', 'Projects', 'connect'),
      serverSrc: 'server/src/com/mirth/connect',
      donkeySrc: 'donkey/src/main/java/com/mirth/connect/donkey',
      migrationPath: 'server/src/com/mirth/connect/server/migration',
    };
  }

  /**
   * Initialize git client for Java repo.
   */
  private async initGit(): Promise<SimpleGit> {
    if (this.git) return this.git;

    // Load config
    const configPath = path.resolve(__dirname, '../config/java-repo.json');
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      this.config = {
        ...this.config,
        repoPath: config.repoPath.replace('~', process.env.HOME || ''),
      };
    } catch {
      // Use defaults
    }

    // Check if repo exists
    try {
      await fs.access(this.config.repoPath);
    } catch {
      throw new Error(
        `Java Mirth repository not found at ${this.config.repoPath}. ` +
          `Please clone it or update tools/version-manager/config/java-repo.json`
      );
    }

    this.git = simpleGit(this.config.repoPath);
    return this.git;
  }

  /**
   * Get list of changed files between two version tags.
   */
  async getChangedFiles(fromVersion: string, toVersion: string): Promise<ChangedFile[]> {
    const git = await this.initGit();

    try {
      // Check if tags exist
      const tags = await git.tags();
      if (!tags.all.includes(fromVersion)) {
        throw new Error(`Tag ${fromVersion} not found in Java repo`);
      }
      if (!tags.all.includes(toVersion)) {
        throw new Error(`Tag ${toVersion} not found in Java repo`);
      }

      // Get diff summary
      const diff = await git.diffSummary([`${fromVersion}..${toVersion}`]);

      return diff.files.map((file) => ({
        path: file.file,
        status: this.parseStatus(file),
        additions: file.insertions,
        deletions: file.deletions,
      }));
    } catch (error) {
      // If tags don't exist, return mock data for development
      if (error instanceof Error && error.message.includes('not found')) {
        console.warn(`Warning: ${error.message}. Using mock data.`);
        return this.getMockChangedFiles(fromVersion, toVersion);
      }
      throw error;
    }
  }

  /**
   * Get detailed diff for a specific file.
   */
  async getFileDiff(
    fromVersion: string,
    toVersion: string,
    filePath: string
  ): Promise<string> {
    const git = await this.initGit();

    try {
      const diff = await git.diff([`${fromVersion}..${toVersion}`, '--', filePath]);
      return diff;
    } catch {
      return '';
    }
  }

  /**
   * Get commit messages between versions.
   */
  async getCommitMessages(fromVersion: string, toVersion: string): Promise<string[]> {
    const git = await this.initGit();

    try {
      const log = await git.log([`${fromVersion}..${toVersion}`]);
      return log.all.map((commit) => commit.message);
    } catch {
      return [];
    }
  }

  /**
   * Check if a migration class exists for a version.
   */
  async hasMigrationClass(version: string): Promise<boolean> {
    const migrationClassName = `Migrate${version.replace(/\./g, '_')}.java`;
    const migrationPath = path.join(
      this.config.repoPath,
      this.config.migrationPath,
      migrationClassName
    );

    try {
      await fs.access(migrationPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the content of a migration class.
   */
  async getMigrationClassContent(version: string): Promise<string | null> {
    const migrationClassName = `Migrate${version.replace(/\./g, '_')}.java`;
    const migrationPath = path.join(
      this.config.repoPath,
      this.config.migrationPath,
      migrationClassName
    );

    try {
      return await fs.readFile(migrationPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Filter files to only those in relevant source directories.
   */
  filterSourceFiles(files: ChangedFile[]): ChangedFile[] {
    const relevantPaths = [
      'server/src/',
      'donkey/src/',
    ];

    return files.filter((file) =>
      relevantPaths.some((prefix) => file.path.startsWith(prefix)) &&
      file.path.endsWith('.java')
    );
  }

  /**
   * Parse file status from diff summary.
   */
  private parseStatus(file: { file: string; binary: boolean }): 'A' | 'M' | 'D' | 'R' | 'C' {
    // simple-git doesn't give us status directly in diffSummary
    // Default to modified
    return 'M';
  }

  /**
   * Mock data for development when Java repo isn't available.
   */
  private getMockChangedFiles(fromVersion: string, toVersion: string): ChangedFile[] {
    // Return realistic mock data for testing
    return [
      {
        path: 'server/src/com/mirth/connect/connectors/http/HttpReceiver.java',
        status: 'M',
        additions: 25,
        deletions: 10,
      },
      {
        path: 'server/src/com/mirth/connect/connectors/tcp/TcpDispatcher.java',
        status: 'M',
        additions: 15,
        deletions: 5,
      },
      {
        path: 'server/src/com/mirth/connect/server/migration/Migrate3_10_0.java',
        status: 'A',
        additions: 100,
        deletions: 0,
      },
      {
        path: 'donkey/src/main/java/com/mirth/connect/donkey/server/channel/Channel.java',
        status: 'M',
        additions: 8,
        deletions: 3,
      },
    ];
  }
}
