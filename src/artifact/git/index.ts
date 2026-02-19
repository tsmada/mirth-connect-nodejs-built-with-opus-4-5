/**
 * Git integration layer for Mirth artifact management.
 */

export { GitClient } from './GitClient.js';
export type { GitStatus, GitLogEntry, GitDiffStat } from './GitClient.js';
export { GitSyncService } from './GitSyncService.js';
export type {
  SyncResult,
  PushOptions,
  PullOptions,
  RepoMetadata,
  CodeTemplateExport,
  GroupExport,
  ConfigExport,
} from './GitSyncService.js';
export { GitWatcher } from './GitWatcher.js';
export { CommitMapper } from './CommitMapper.js';
export type { SyncRecord } from './CommitMapper.js';
