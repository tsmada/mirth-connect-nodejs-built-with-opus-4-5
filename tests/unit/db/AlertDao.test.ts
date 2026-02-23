/**
 * AlertDao Behavioral Tests
 *
 * Tests CRUD operations, enabled/disabled filtering, and in-memory alerted count isolation.
 * Ported from Java Alert controller behavioral contracts.
 *
 * Architecture:
 * - AlertDao.ts provides CRUD operations on the ALERT table (ID, NAME, ALERT LONGTEXT)
 * - Alert models are stored as JSON-serialized AlertModel objects in the ALERT column
 * - In-memory alertedCounts map tracks firing frequency (not persisted to DB)
 * - Mocks: pool.ts query/execute functions
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// ---------------------------------------------------------------------------
// Mock pool module
// ---------------------------------------------------------------------------
const mockQuery = jest.fn<(...args: unknown[]) => Promise<RowDataPacket[]>>();
const mockExecute = jest.fn<(...args: unknown[]) => Promise<ResultSetHeader>>();

jest.mock('../../../src/db/pool.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}));

import {
  getAlerts,
  getAlertById,
  upsertAlert,
  updateAlert,
  deleteAlert,
  enableAlert,
  disableAlert,
  getAlertsByIds,
  incrementAlertedCount,
  getAlertedCount,
  resetAlertedCount,
} from '../../../src/db/AlertDao.js';
import {
  AlertModel,
  serializeAlertModel,
} from '../../../src/api/models/Alert.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<AlertModel> = {}): AlertModel {
  return {
    id: 'alert-001',
    name: 'Test Alert',
    enabled: true,
    trigger: { name: 'ErrorAlertTrigger' },
    actionGroups: [],
    ...overrides,
  };
}

function makeAlertRow(alert: AlertModel) {
  return {
    ID: alert.id,
    NAME: alert.name,
    ALERT: serializeAlertModel(alert),
    constructor: { name: 'RowDataPacket' },
  } as unknown as RowDataPacket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertDao Behavioral Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset in-memory alertedCounts between tests
    resetAlertedCount('alert-001');
    resetAlertedCount('alert-002');
    resetAlertedCount('alert-003');
  });

  // =========================================================================
  // Contract 1: AlertDao CRUD round-trip
  // =========================================================================
  describe('CRUD round-trip', () => {
    it('should insert, get, update, and delete an alert', async () => {
      const alert = makeAlert();

      // INSERT via upsert
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 } as ResultSetHeader);
      await upsertAlert(alert);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const insertSql = (mockExecute.mock.calls[0] as unknown[])[0] as string;
      expect(insertSql).toContain('INSERT INTO ALERT');

      // GET by ID
      mockQuery.mockResolvedValueOnce([makeAlertRow(alert)] as RowDataPacket[]);
      const fetched = await getAlertById('alert-001');
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe('alert-001');
      expect(fetched!.name).toBe('Test Alert');
      expect(fetched!.enabled).toBe(true);

      // UPDATE
      alert.name = 'Updated Alert';
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 } as ResultSetHeader);
      const updated = await updateAlert(alert);
      expect(updated).toBe(true);
      const updateSql = (mockExecute.mock.calls[1] as unknown[])[0] as string;
      expect(updateSql).toContain('UPDATE ALERT');

      // DELETE
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 } as ResultSetHeader);
      const deleted = await deleteAlert('alert-001');
      expect(deleted).toBe(true);
      const deleteSql = (mockExecute.mock.calls[2] as unknown[])[0] as string;
      expect(deleteSql).toContain('DELETE FROM ALERT');
    });
  });

  // =========================================================================
  // Contract 2: getEnabledAlerts filter
  // =========================================================================
  describe('getEnabledAlerts filter', () => {
    it('should return all alerts and allow client-side enabled filtering', async () => {
      // AlertDao.getAlerts() returns ALL alerts; the servlet or caller filters.
      // Java's AlertController.getEnabledAlerts() calls getAlerts() then filters.
      const enabledAlert = makeAlert({ id: 'a1', name: 'Enabled', enabled: true });
      const disabledAlert = makeAlert({ id: 'a2', name: 'Disabled', enabled: false });

      mockQuery.mockResolvedValueOnce([
        makeAlertRow(enabledAlert),
        makeAlertRow(disabledAlert),
      ] as RowDataPacket[]);

      const allAlerts = await getAlerts();
      const enabledOnly = allAlerts.filter((a) => a.enabled);

      expect(allAlerts).toHaveLength(2);
      expect(enabledOnly).toHaveLength(1);
      expect(enabledOnly[0]!.id).toBe('a1');
    });
  });

  // =========================================================================
  // Contract 3: alertedCounts cross-channel isolation
  // =========================================================================
  describe('alertedCounts cross-channel isolation', () => {
    it('should track alerted counts independently per alert ID', () => {
      // In-memory counts are keyed by alertId, not channelId.
      // Incrementing one alert does not affect another.
      incrementAlertedCount('alert-001');
      incrementAlertedCount('alert-001');
      incrementAlertedCount('alert-002');

      expect(getAlertedCount('alert-001')).toBe(2);
      expect(getAlertedCount('alert-002')).toBe(1);
      expect(getAlertedCount('alert-003')).toBe(0); // never incremented
    });
  });

  // =========================================================================
  // Contract 4: insertAlert with all fields
  // =========================================================================
  describe('insertAlert with all fields', () => {
    it('should persist all alert properties via JSON serialization', async () => {
      const alert = makeAlert({
        id: 'full-alert',
        name: 'Full Alert',
        enabled: true,
        trigger: { name: 'ErrorAlertTrigger', errorCodes: ['500'], regex: '.*timeout.*' },
        actionGroups: [
          {
            actions: [{ protocol: 'Email', recipient: 'admin@example.com' }],
            subject: 'Alert!',
            template: 'Error occurred: ${error}',
          },
        ],
        properties: { maxAlerts: 10, cooldownMinutes: 5 },
      });

      mockExecute.mockResolvedValueOnce({ affectedRows: 1 } as ResultSetHeader);
      await upsertAlert(alert);

      // Verify the serialized JSON contains all fields
      const callArgs = mockExecute.mock.calls[0] as unknown[];
      const params = callArgs[1] as Record<string, unknown>;
      const serialized = JSON.parse(params.alertData as string);

      expect(serialized.id).toBe('full-alert');
      expect(serialized.name).toBe('Full Alert');
      expect(serialized.enabled).toBe(true);
      expect(serialized.trigger.name).toBe('ErrorAlertTrigger');
      expect(serialized.trigger.errorCodes).toEqual(['500']);
      expect(serialized.actionGroups).toHaveLength(1);
      expect(serialized.actionGroups[0].actions[0].protocol).toBe('Email');
      expect(serialized.properties.maxAlerts).toBe(10);
    });
  });

  // =========================================================================
  // Contract 5: updateAlert partial fields
  // =========================================================================
  describe('updateAlert partial fields', () => {
    it('should overwrite the entire alert JSON on update — no partial merge', async () => {
      // Java's updateAlert() replaces the entire ALERT LONGTEXT column.
      // There is no partial field update — the full serialized model is written.
      const alert = makeAlert({
        id: 'upd-alert',
        name: 'Original Name',
        enabled: true,
      });

      // First update: change name only
      alert.name = 'New Name';
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 } as ResultSetHeader);
      await updateAlert(alert);

      const callArgs = mockExecute.mock.calls[0] as unknown[];
      const params = callArgs[1] as Record<string, unknown>;
      const serialized = JSON.parse(params.alertData as string);

      // The ENTIRE model is written, including the unchanged 'enabled' field
      expect(serialized.name).toBe('New Name');
      expect(serialized.enabled).toBe(true);
      expect(serialized.id).toBe('upd-alert');
    });
  });

  // =========================================================================
  // Contract 6: deleteAlert non-existent -> graceful
  // =========================================================================
  describe('deleteAlert non-existent -> graceful', () => {
    it('should return false for missing ID without throwing', async () => {
      // Java: delete with non-existent ID returns affectedRows=0, no exception.
      mockExecute.mockResolvedValueOnce({ affectedRows: 0 } as ResultSetHeader);

      const result = await deleteAlert('non-existent-id');

      expect(result).toBe(false);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Contract 7: getAlertsByIds (batch fetch)
  // =========================================================================
  describe('getAlertsByIds', () => {
    it('should return only alerts matching the provided IDs', async () => {
      const alert1 = makeAlert({ id: 'a1', name: 'Alert 1' });
      const alert2 = makeAlert({ id: 'a2', name: 'Alert 2' });

      mockQuery.mockResolvedValueOnce([
        makeAlertRow(alert1),
        makeAlertRow(alert2),
      ] as RowDataPacket[]);

      const results = await getAlertsByIds(['a1', 'a2']);
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe('a1');
      expect(results[1]!.id).toBe('a2');

      // Verify IN clause in SQL
      const sql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      expect(sql).toContain('WHERE ID IN');
    });

    it('should return empty array for empty ID list', async () => {
      const results = await getAlertsByIds([]);
      expect(results).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Contract 8: Alert enabled/disabled toggle round-trip
  // =========================================================================
  describe('Alert enabled/disabled toggle', () => {
    it('should toggle enabled -> disabled -> enabled via enableAlert/disableAlert', async () => {
      const alert = makeAlert({ id: 'toggle-alert', name: 'Toggle', enabled: true });

      // disableAlert: reads alert, sets enabled=false, writes back
      mockQuery.mockResolvedValueOnce([makeAlertRow(alert)] as RowDataPacket[]); // getAlertById
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 } as ResultSetHeader); // updateAlert

      const disableResult = await disableAlert('toggle-alert');
      expect(disableResult).toBe(true);

      // Verify the updated model has enabled=false
      const disableParams = (mockExecute.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      const disabledModel = JSON.parse(disableParams.alertData as string);
      expect(disabledModel.enabled).toBe(false);

      // enableAlert: reads alert, sets enabled=true, writes back
      const disabledAlert = makeAlert({ id: 'toggle-alert', name: 'Toggle', enabled: false });
      mockQuery.mockResolvedValueOnce([makeAlertRow(disabledAlert)] as RowDataPacket[]); // getAlertById
      mockExecute.mockResolvedValueOnce({ affectedRows: 1 } as ResultSetHeader); // updateAlert

      const enableResult = await enableAlert('toggle-alert');
      expect(enableResult).toBe(true);

      const enableParams = (mockExecute.mock.calls[1] as unknown[])[1] as Record<string, unknown>;
      const enabledModel = JSON.parse(enableParams.alertData as string);
      expect(enabledModel.enabled).toBe(true);
    });

    it('should return false when toggling non-existent alert', async () => {
      mockQuery.mockResolvedValueOnce([] as RowDataPacket[]); // getAlertById returns null

      const result = await enableAlert('does-not-exist');
      expect(result).toBe(false);
    });
  });
});
