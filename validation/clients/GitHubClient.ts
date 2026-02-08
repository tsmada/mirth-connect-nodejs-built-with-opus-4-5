import { execSync } from 'child_process';
import * as http from 'http';

/**
 * Thin wrapper around `gh` CLI for ephemeral test repo lifecycle.
 *
 * Handles: create, delete, verify, detect owner, prerequisite checks.
 * Auth comes from `gh auth login` (user does this once).
 */
export class GitHubClient {
  private owner: string;

  constructor(owner: string) {
    this.owner = owner;
  }

  /**
   * Create a public GitHub repo.
   * Returns the HTTPS clone URL.
   */
  async createRepo(name: string, description?: string): Promise<string> {
    const desc = description || 'Ephemeral Mirth artifact integration test';
    const fullName = `${this.owner}/${name}`;

    exec(`gh repo create ${fullName} --public --description "${desc}" --clone=false`);

    // Return HTTPS clone URL
    return `https://github.com/${fullName}.git`;
  }

  /**
   * Delete a GitHub repo (requires delete_repo scope).
   */
  async deleteRepo(name: string): Promise<void> {
    const fullName = `${this.owner}/${name}`;
    exec(`gh repo delete ${fullName} --yes`);
  }

  /**
   * Check if a repo exists.
   */
  async repoExists(name: string): Promise<boolean> {
    const fullName = `${this.owner}/${name}`;
    try {
      exec(`gh repo view ${fullName} --json name`);
      return true;
    } catch {
      return false;
    }
  }

  get ownerName(): string {
    return this.owner;
  }

  /**
   * Detect GitHub owner from env var or `gh api user`.
   */
  static async detectOwner(): Promise<string> {
    // 1. Env var
    if (process.env.GITHUB_OWNER) {
      return process.env.GITHUB_OWNER;
    }

    // 2. gh api user
    try {
      const login = exec('gh api user --jq ".login"').trim();
      if (login) return login;
    } catch {
      // fall through
    }

    throw new Error(
      'Cannot detect GitHub owner. Set GITHUB_OWNER env var or authenticate with `gh auth login`.'
    );
  }

  /**
   * Verify all prerequisites for artifact integration tests.
   */
  static async checkPrerequisites(nodeApiUrl: string): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];

    // 1. gh CLI installed
    try {
      exec('gh --version');
    } catch {
      errors.push('gh CLI not installed. Install from https://cli.github.com/');
    }

    // 2. gh authenticated
    try {
      exec('gh auth status');
    } catch {
      errors.push('gh CLI not authenticated. Run `gh auth login` first.');
    }

    // 3. Node.js Mirth reachable
    try {
      await new Promise<void>((resolve, reject) => {
        const url = new URL(nodeApiUrl);
        const req = http.get(
          { hostname: url.hostname, port: url.port, path: '/api/health', timeout: 5000 },
          (res) => {
            if (res.statusCode === 200) resolve();
            else reject(new Error(`Health check returned ${res.statusCode}`));
          }
        );
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
    } catch {
      errors.push(`Node.js Mirth not reachable at ${nodeApiUrl}. Start with: PORT=8081 npm run dev`);
    }

    return { ok: errors.length === 0, errors };
  }

  /**
   * Configure git credential helper via gh.
   */
  static async setupGitCredentials(): Promise<void> {
    exec('gh auth setup-git');
  }

  /**
   * Generate a unique repo name with timestamp.
   */
  static generateRepoName(): string {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // YYYYMMDDHHmmss
    return `mirth-artifact-test-${ts}`;
  }
}

/**
 * Execute a shell command synchronously. Returns stdout.
 * Throws on non-zero exit code.
 */
function exec(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
}
