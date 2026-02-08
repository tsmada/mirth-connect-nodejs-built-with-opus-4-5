/**
 * GitWatcher — Filesystem watcher for auto-sync on git changes.
 *
 * Uses fs.watch() with recursive option to detect changes in the git
 * repository. Debounces events to avoid triggering multiple times
 * during multi-file operations like `git pull` or `git checkout`.
 */

import * as fs from 'fs';
import * as path from 'path';

export class GitWatcher {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private watching = false;

  constructor(
    private repoPath: string,
    private onChange: () => Promise<void>,
    private debounceMs: number = 2000
  ) {}

  /**
   * Start watching the repository for file changes.
   *
   * Ignores changes inside .git/ directory (internal git state changes).
   * Debounces the callback so a multi-file git pull triggers only once.
   */
  start(): void {
    if (this.watching) return;

    this.watcher = fs.watch(
      this.repoPath,
      { recursive: true },
      (_eventType: string, filename: string | null) => {
        if (!filename) return;

        // Ignore .git internal changes (index, HEAD, refs, etc.)
        if (filename.startsWith('.git' + path.sep) || filename === '.git') {
          return;
        }

        this.scheduleCallback();
      }
    );

    this.watcher.on('error', () => {
      // Silently handle watcher errors (e.g., directory removed)
      this.stop();
    });

    this.watching = true;
  }

  /**
   * Stop watching and clean up resources.
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.watching = false;
  }

  /**
   * Whether the watcher is currently active.
   */
  isWatching(): boolean {
    return this.watching;
  }

  private scheduleCallback(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onChange().catch(() => {
        // Callback errors are silently swallowed to keep watcher alive
      });
    }, this.debounceMs);
  }
}
