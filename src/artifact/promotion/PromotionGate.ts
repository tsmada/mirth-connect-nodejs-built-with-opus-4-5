/**
 * Promotion approval gate for environment promotion workflows.
 *
 * Manages approval records for channel promotions (e.g., dev -> staging).
 * This module is pure logic — no database access. The ArtifactController
 * (Phase 7) handles persistence via the CONFIGURATION table.
 */

import { randomUUID } from 'crypto';

export interface ApprovalRecord {
  id: string;
  sourceEnv: string;
  targetEnv: string;
  channelIds: string[];
  commitHash?: string;
  approvedBy: string;
  approvedAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  notes?: string;
}

export class PromotionGate {
  /**
   * Create an approval record.
   * Category: 'artifact.promotion'
   * Name: '{sourceEnv}->{targetEnv}:{timestamp}'
   */
  static createApproval(record: Omit<ApprovalRecord, 'id' | 'approvedAt'>): ApprovalRecord {
    return {
      ...record,
      id: randomUUID(),
      approvedAt: new Date(),
    };
  }

  /**
   * Get pending approvals for a target environment.
   */
  static getPendingApprovals(targetEnv: string, records: ApprovalRecord[]): ApprovalRecord[] {
    return records.filter((r) => r.targetEnv === targetEnv && r.status === 'pending');
  }

  /**
   * Check if promotion has been approved.
   * Returns true if there is an 'approved' record covering all the requested channelIds.
   */
  static isApproved(
    sourceEnv: string,
    targetEnv: string,
    channelIds: string[],
    records: ApprovalRecord[]
  ): boolean {
    const approvedRecords = records.filter(
      (r) => r.sourceEnv === sourceEnv && r.targetEnv === targetEnv && r.status === 'approved'
    );

    if (approvedRecords.length === 0) return false;

    // Collect all approved channel IDs across matching records
    const approvedChannelIds = new Set<string>();
    for (const record of approvedRecords) {
      for (const id of record.channelIds) {
        approvedChannelIds.add(id);
      }
    }

    // All requested channels must be covered
    return channelIds.every((id) => approvedChannelIds.has(id));
  }

  /**
   * Serialize an approval record to JSON string for storage.
   */
  static serialize(record: ApprovalRecord): string {
    return JSON.stringify({
      ...record,
      approvedAt: record.approvedAt.toISOString(),
    });
  }

  /**
   * Deserialize an approval record from JSON string.
   */
  static deserialize(data: string): ApprovalRecord {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    return {
      id: parsed['id'] as string,
      sourceEnv: parsed['sourceEnv'] as string,
      targetEnv: parsed['targetEnv'] as string,
      channelIds: parsed['channelIds'] as string[],
      commitHash: parsed['commitHash'] as string | undefined,
      approvedBy: parsed['approvedBy'] as string,
      approvedAt: new Date(parsed['approvedAt'] as string),
      status: parsed['status'] as ApprovalRecord['status'],
      notes: parsed['notes'] as string | undefined,
    };
  }
}
