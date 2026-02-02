/**
 * Alert Data Access Object
 *
 * Handles CRUD operations for the ALERT table.
 *
 * Table schema:
 * - ID VARCHAR(36) PRIMARY KEY
 * - NAME VARCHAR(255) UNIQUE
 * - ALERT LONGTEXT (serialized AlertModel as JSON)
 */

import { query, execute } from './pool.js';
import { RowDataPacket } from 'mysql2';
import {
  AlertModel,
  AlertStatus,
  serializeAlertModel,
  deserializeAlertModel,
  toAlertStatus,
} from '../api/models/Alert.js';

// ============================================================================
// Database Row Interface
// ============================================================================

interface AlertRow extends RowDataPacket {
  ID: string;
  NAME: string;
  ALERT: string;
}

// ============================================================================
// In-Memory Alert Status Tracking
// ============================================================================

// Track alert fired counts (in production, this could be Redis or database)
const alertedCounts = new Map<string, number>();

/**
 * Increment the alerted count for an alert
 */
export function incrementAlertedCount(alertId: string): void {
  const current = alertedCounts.get(alertId) ?? 0;
  alertedCounts.set(alertId, current + 1);
}

/**
 * Get the alerted count for an alert
 */
export function getAlertedCount(alertId: string): number {
  return alertedCounts.get(alertId) ?? 0;
}

/**
 * Reset alerted count for an alert
 */
export function resetAlertedCount(alertId: string): void {
  alertedCounts.delete(alertId);
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get all alerts
 */
export async function getAlerts(): Promise<AlertModel[]> {
  const rows = await query<AlertRow>('SELECT * FROM ALERT ORDER BY NAME');
  return rows.map((row) => deserializeAlertModel(row.ALERT));
}

/**
 * Get alerts by IDs
 */
export async function getAlertsByIds(ids: string[]): Promise<AlertModel[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map((_, i) => `:id${i}`);
  const params: Record<string, string> = {};
  ids.forEach((id, i) => {
    params[`id${i}`] = id;
  });

  const rows = await query<AlertRow>(
    `SELECT * FROM ALERT WHERE ID IN (${placeholders.join(', ')}) ORDER BY NAME`,
    params
  );

  return rows.map((row) => deserializeAlertModel(row.ALERT));
}

/**
 * Get alert by ID
 */
export async function getAlertById(id: string): Promise<AlertModel | null> {
  const rows = await query<AlertRow>('SELECT * FROM ALERT WHERE ID = :id', { id });
  if (rows.length === 0) {
    return null;
  }
  return deserializeAlertModel(rows[0]!.ALERT);
}

/**
 * Get alert by name
 */
export async function getAlertByName(name: string): Promise<AlertModel | null> {
  const rows = await query<AlertRow>('SELECT * FROM ALERT WHERE NAME = :name', { name });
  if (rows.length === 0) {
    return null;
  }
  return deserializeAlertModel(rows[0]!.ALERT);
}

/**
 * Create or update an alert
 */
export async function upsertAlert(alert: AlertModel): Promise<void> {
  const serialized = serializeAlertModel(alert);

  await execute(
    `INSERT INTO ALERT (ID, NAME, ALERT)
     VALUES (:id, :name, :alertData)
     ON DUPLICATE KEY UPDATE NAME = :name, ALERT = :alertData`,
    {
      id: alert.id,
      name: alert.name,
      alertData: serialized,
    }
  );
}

/**
 * Update an existing alert
 */
export async function updateAlert(alert: AlertModel): Promise<boolean> {
  const serialized = serializeAlertModel(alert);

  const result = await execute(
    'UPDATE ALERT SET NAME = :name, ALERT = :alertData WHERE ID = :id',
    {
      id: alert.id,
      name: alert.name,
      alertData: serialized,
    }
  );

  return result.affectedRows > 0;
}

/**
 * Delete an alert
 */
export async function deleteAlert(id: string): Promise<boolean> {
  const result = await execute('DELETE FROM ALERT WHERE ID = :id', { id });
  resetAlertedCount(id);
  return result.affectedRows > 0;
}

/**
 * Check if alert exists
 */
export async function alertExists(id: string): Promise<boolean> {
  const rows = await query<RowDataPacket>('SELECT 1 FROM ALERT WHERE ID = :id', { id });
  return rows.length > 0;
}

/**
 * Check if alert name is taken (by another alert)
 */
export async function isAlertNameTaken(name: string, excludeId?: string): Promise<boolean> {
  if (excludeId) {
    const rows = await query<RowDataPacket>(
      'SELECT 1 FROM ALERT WHERE NAME = :name AND ID != :excludeId',
      { name, excludeId }
    );
    return rows.length > 0;
  } else {
    const rows = await query<RowDataPacket>('SELECT 1 FROM ALERT WHERE NAME = :name', { name });
    return rows.length > 0;
  }
}

// ============================================================================
// Status Operations
// ============================================================================

/**
 * Get all alert statuses (for dashboard)
 */
export async function getAlertStatuses(): Promise<AlertStatus[]> {
  const alerts = await getAlerts();
  return alerts.map((alert) => toAlertStatus(alert, getAlertedCount(alert.id)));
}

/**
 * Enable an alert
 */
export async function enableAlert(id: string): Promise<boolean> {
  const alert = await getAlertById(id);
  if (!alert) {
    return false;
  }

  alert.enabled = true;
  return await updateAlert(alert);
}

/**
 * Disable an alert
 */
export async function disableAlert(id: string): Promise<boolean> {
  const alert = await getAlertById(id);
  if (!alert) {
    return false;
  }

  alert.enabled = false;
  return await updateAlert(alert);
}

// ============================================================================
// Table Creation (for initialization)
// ============================================================================

/**
 * Create ALERT table if not exists
 */
export async function createAlertTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS ALERT (
      ID VARCHAR(36) NOT NULL PRIMARY KEY,
      NAME VARCHAR(255) NOT NULL UNIQUE,
      ALERT LONGTEXT NOT NULL
    ) ENGINE=InnoDB
  `);
}
