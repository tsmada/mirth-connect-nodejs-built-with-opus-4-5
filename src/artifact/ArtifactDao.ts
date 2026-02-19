/**
 * ArtifactDao — CRUD operations for the D_ARTIFACT_SYNC table.
 *
 * Tracks which channel/artifact revisions have been synced to/from git,
 * enabling the CommitMapper to determine if artifacts are up-to-date.
 *
 * Table schema:
 *   D_ARTIFACT_SYNC (
 *     ID VARCHAR(36) PRIMARY KEY,
 *     ARTIFACT_TYPE VARCHAR(20),
 *     ARTIFACT_ID VARCHAR(36),
 *     ARTIFACT_NAME VARCHAR(255),
 *     REVISION INT,
 *     COMMIT_HASH VARCHAR(40),
 *     SYNC_DIRECTION VARCHAR(10),
 *     SYNCED_AT TIMESTAMP,
 *     SYNCED_BY VARCHAR(255),
 *     ENVIRONMENT VARCHAR(50)
 *   )
 */

import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export interface SyncRecord {
  id: string;
  artifactType: 'channel' | 'code_template' | 'group' | 'config';
  artifactId: string;
  artifactName?: string;
  revision?: number;
  commitHash?: string;
  syncDirection: 'push' | 'pull';
  syncedAt: Date;
  syncedBy?: string;
  environment?: string;
}

interface SyncRow extends RowDataPacket {
  ID: string;
  ARTIFACT_TYPE: string;
  ARTIFACT_ID: string;
  ARTIFACT_NAME: string | null;
  REVISION: number | null;
  COMMIT_HASH: string | null;
  SYNC_DIRECTION: string;
  SYNCED_AT: Date;
  SYNCED_BY: string | null;
  ENVIRONMENT: string | null;
}

function rowToRecord(row: SyncRow): SyncRecord {
  return {
    id: row.ID,
    artifactType: row.ARTIFACT_TYPE as SyncRecord['artifactType'],
    artifactId: row.ARTIFACT_ID,
    artifactName: row.ARTIFACT_NAME ?? undefined,
    revision: row.REVISION ?? undefined,
    commitHash: row.COMMIT_HASH ?? undefined,
    syncDirection: row.SYNC_DIRECTION as SyncRecord['syncDirection'],
    syncedAt: row.SYNCED_AT,
    syncedBy: row.SYNCED_BY ?? undefined,
    environment: row.ENVIRONMENT ?? undefined,
  };
}

export class ArtifactDao {
  /**
   * Insert a new sync record.
   */
  static async insertSync(record: Omit<SyncRecord, 'id' | 'syncedAt'>): Promise<string> {
    const id = uuidv4();
    await execute(
      `INSERT INTO D_ARTIFACT_SYNC
        (ID, ARTIFACT_TYPE, ARTIFACT_ID, ARTIFACT_NAME, REVISION,
         COMMIT_HASH, SYNC_DIRECTION, SYNCED_BY, ENVIRONMENT)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.artifactType,
        record.artifactId,
        record.artifactName ?? null,
        record.revision ?? null,
        record.commitHash ?? null,
        record.syncDirection,
        record.syncedBy ?? null,
        record.environment ?? null,
      ] as unknown as Record<string, unknown>
    );
    return id;
  }

  /**
   * Get the most recent sync record for an artifact.
   */
  static async getLastSync(artifactType: string, artifactId: string): Promise<SyncRecord | null> {
    const rows = await query<SyncRow>(
      `SELECT * FROM D_ARTIFACT_SYNC
       WHERE ARTIFACT_TYPE = ? AND ARTIFACT_ID = ?
       ORDER BY SYNCED_AT DESC
       LIMIT 1`,
      [artifactType, artifactId] as unknown as Record<string, unknown>
    );
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]!);
  }

  /**
   * Get sync history for an artifact, most recent first.
   */
  static async getSyncHistory(
    artifactType: string,
    artifactId: string,
    limit?: number
  ): Promise<SyncRecord[]> {
    const sql = limit
      ? `SELECT * FROM D_ARTIFACT_SYNC
         WHERE ARTIFACT_TYPE = ? AND ARTIFACT_ID = ?
         ORDER BY SYNCED_AT DESC
         LIMIT ?`
      : `SELECT * FROM D_ARTIFACT_SYNC
         WHERE ARTIFACT_TYPE = ? AND ARTIFACT_ID = ?
         ORDER BY SYNCED_AT DESC`;

    const params = limit ? [artifactType, artifactId, limit] : [artifactType, artifactId];

    const rows = await query<SyncRow>(sql, params as unknown as Record<string, unknown>);
    return rows.map(rowToRecord);
  }

  /**
   * Get all sync records for a specific git commit.
   */
  static async getSyncsByCommit(commitHash: string): Promise<SyncRecord[]> {
    const rows = await query<SyncRow>(
      `SELECT * FROM D_ARTIFACT_SYNC
       WHERE COMMIT_HASH = ?
       ORDER BY SYNCED_AT DESC`,
      [commitHash] as unknown as Record<string, unknown>
    );
    return rows.map(rowToRecord);
  }

  /**
   * Delete sync records older than a given date.
   * Returns the number of rows deleted.
   */
  static async deleteOldSyncs(olderThan: Date): Promise<number> {
    const result = await execute(`DELETE FROM D_ARTIFACT_SYNC WHERE SYNCED_AT < ?`, [
      olderThan,
    ] as unknown as Record<string, unknown>);
    return result.affectedRows;
  }
}
