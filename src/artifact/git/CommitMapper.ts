/**
 * CommitMapper — Maps channel revisions to git commits.
 *
 * Thin wrapper around ArtifactDao that provides a higher-level interface
 * for tracking which artifact revisions have been synced to which commits.
 * This enables "is artifact up-to-date?" checks and sync history lookups.
 */

import { ArtifactDao, SyncRecord } from '../ArtifactDao.js';

export { SyncRecord } from '../ArtifactDao.js';

export class CommitMapper {
  /**
   * Record a sync operation (push or pull) for an artifact.
   */
  async recordSync(
    record: Omit<SyncRecord, 'id' | 'syncedAt'>
  ): Promise<void> {
    await ArtifactDao.insertSync(record);
  }

  /**
   * Get the last sync record for an artifact.
   */
  async getLastSync(
    artifactType: string,
    artifactId: string
  ): Promise<SyncRecord | null> {
    return ArtifactDao.getLastSync(artifactType, artifactId);
  }

  /**
   * Get full sync history for an artifact.
   */
  async getSyncHistory(
    artifactType: string,
    artifactId: string,
    limit?: number
  ): Promise<SyncRecord[]> {
    return ArtifactDao.getSyncHistory(artifactType, artifactId, limit);
  }

  /**
   * Get all artifacts synced in a particular git commit.
   */
  async getSyncsByCommit(commitHash: string): Promise<SyncRecord[]> {
    return ArtifactDao.getSyncsByCommit(commitHash);
  }

  /**
   * Check if an artifact is up-to-date (synced at or after the given revision).
   *
   * Returns true if the most recent sync for this artifact has a revision >= currentRevision.
   * Returns false if never synced or if the synced revision is older.
   */
  async isUpToDate(
    artifactType: string,
    artifactId: string,
    currentRevision: number
  ): Promise<boolean> {
    const lastSync = await ArtifactDao.getLastSync(artifactType, artifactId);
    if (!lastSync) return false;
    if (lastSync.revision === undefined) return false;
    return lastSync.revision >= currentRevision;
  }
}
