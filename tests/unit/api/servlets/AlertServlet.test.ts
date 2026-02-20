/**
 * AlertServlet Unit Tests
 *
 * Tests for alert management endpoints including:
 * - POST / - Create alert
 * - GET / - Get all alerts
 * - GET /:alertId - Get alert by ID
 * - POST /_getAlerts - POST alternative for bulk fetch
 * - GET /statuses - Get alert statuses
 * - GET /options - Get protocol options
 * - POST /_getInfo - Get alert protocol info
 * - POST /:alertId/_getInfo - Get info for specific alert
 * - PUT /:alertId - Update alert
 * - POST /:alertId/_enable - Enable alert
 * - POST /:alertId/_disable - Disable alert
 * - DELETE /:alertId - Remove alert
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock AlertDao BEFORE importing the servlet
const mockAlertDao = {
  getAlerts: jest.fn(),
  getAlertsByIds: jest.fn(),
  getAlertById: jest.fn(),
  getAlertByName: jest.fn(),
  upsertAlert: jest.fn(),
  updateAlert: jest.fn(),
  deleteAlert: jest.fn(),
  enableAlert: jest.fn(),
  disableAlert: jest.fn(),
  isAlertNameTaken: jest.fn(),
  getAlertStatuses: jest.fn(),
};

jest.mock('../../../../src/db/AlertDao.js', () => mockAlertDao);

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'generated-uuid-1234'),
}));

// Mock authorization
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  ALERT_GET: { name: 'getAlert' },
  ALERT_GET_ALL: { name: 'getAllAlerts' },
  ALERT_GET_STATUS: { name: 'getAlertStatus' },
  ALERT_GET_INFO: { name: 'getAlertInfo' },
  ALERT_GET_OPTIONS: { name: 'getAlertOptions' },
  ALERT_CREATE: { name: 'createAlert' },
  ALERT_UPDATE: { name: 'updateAlert' },
  ALERT_ENABLE: { name: 'enableAlert' },
  ALERT_DISABLE: { name: 'disableAlert' },
  ALERT_REMOVE: { name: 'removeAlert' },
}));

// Mock logging
jest.mock('../../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  registerComponent: jest.fn(),
}));

// Now import Express and the servlet AFTER all mocks are in place
import express, { Express } from 'express';
import { alertRouter } from '../../../../src/api/servlets/AlertServlet.js';

// ============================================================================
// Test fixtures
// ============================================================================

const TEST_ALERT_ID = 'alert-1111-2222-3333-444444444444';
const TEST_ALERT_ID_2 = 'alert-5555-6666-7777-888888888888';

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_ALERT_ID,
    name: 'Test Alert',
    enabled: false,
    trigger: { name: 'ErrorAlertTrigger' },
    actionGroups: [
      {
        actions: [{ protocol: 'Email', recipient: 'admin@example.com' }],
        subject: 'Alert!',
        template: 'An error occurred.',
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// Test app factory
// ============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((_req, res, next) => {
    res.sendData = function (data: unknown, status?: number) {
      if (status) this.status(status);
      this.json(data);
    };
    next();
  });

  app.use('/alerts', alertRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('AlertServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // POST /alerts - Create alert
  // ==========================================================================

  describe('POST /alerts', () => {
    it('should create a new alert and return it', async () => {
      mockAlertDao.isAlertNameTaken.mockResolvedValueOnce(false);
      mockAlertDao.upsertAlert.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post('/alerts')
        .send({ id: TEST_ALERT_ID, name: 'New Alert', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(TEST_ALERT_ID);
      expect(response.body.name).toBe('New Alert');
      expect(mockAlertDao.upsertAlert).toHaveBeenCalled();
    });

    it('should generate an ID when none is provided', async () => {
      mockAlertDao.isAlertNameTaken.mockResolvedValueOnce(false);
      mockAlertDao.upsertAlert.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post('/alerts')
        .send({ name: 'Auto-ID Alert', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('generated-uuid-1234');
    });

    it('should set enabled to false and actionGroups to [] by default', async () => {
      mockAlertDao.isAlertNameTaken.mockResolvedValueOnce(false);
      mockAlertDao.upsertAlert.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post('/alerts')
        .send({ name: 'Defaults Alert', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
      expect(response.body.actionGroups).toEqual([]);
    });

    it('should return 400 when alert name is missing', async () => {
      const response = await request(app)
        .post('/alerts')
        .send({ id: TEST_ALERT_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Alert name is required');
    });

    it('should return 400 when alert name is empty string', async () => {
      const response = await request(app)
        .post('/alerts')
        .send({ name: '   ', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Alert name is required');
    });

    it('should return 409 when alert name is already taken', async () => {
      mockAlertDao.isAlertNameTaken.mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/alerts')
        .send({ name: 'Existing Alert', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('An alert with that name already exists');
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.isAlertNameTaken.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/alerts')
        .send({ name: 'Fail Alert', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create alert');
    });
  });

  // ==========================================================================
  // GET /alerts - Get all alerts
  // ==========================================================================

  describe('GET /alerts', () => {
    it('should return all alerts', async () => {
      const alerts = [makeAlert(), makeAlert({ id: TEST_ALERT_ID_2, name: 'Second Alert' })];
      mockAlertDao.getAlerts.mockResolvedValueOnce(alerts);

      const response = await request(app).get('/alerts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(TEST_ALERT_ID);
      expect(response.body[1].id).toBe(TEST_ALERT_ID_2);
    });

    it('should filter by alertId query parameter', async () => {
      const alerts = [makeAlert()];
      mockAlertDao.getAlertsByIds.mockResolvedValueOnce(alerts);

      const response = await request(app).get(`/alerts?alertId=${TEST_ALERT_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockAlertDao.getAlertsByIds).toHaveBeenCalledWith([TEST_ALERT_ID]);
    });

    it('should filter by multiple alertId query parameters', async () => {
      const alerts = [makeAlert(), makeAlert({ id: TEST_ALERT_ID_2 })];
      mockAlertDao.getAlertsByIds.mockResolvedValueOnce(alerts);

      const response = await request(app)
        .get(`/alerts?alertId=${TEST_ALERT_ID}&alertId=${TEST_ALERT_ID_2}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockAlertDao.getAlertsByIds).toHaveBeenCalledWith([TEST_ALERT_ID, TEST_ALERT_ID_2]);
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.getAlerts.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/alerts');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get alerts');
    });
  });

  // ==========================================================================
  // GET /alerts/:alertId - Get alert by ID
  // ==========================================================================

  describe('GET /alerts/:alertId', () => {
    it('should return an alert by ID', async () => {
      const alert = makeAlert();
      mockAlertDao.getAlertById.mockResolvedValueOnce(alert);

      const response = await request(app).get(`/alerts/${TEST_ALERT_ID}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(TEST_ALERT_ID);
      expect(response.body.name).toBe('Test Alert');
    });

    it('should return 404 when alert not found', async () => {
      mockAlertDao.getAlertById.mockResolvedValueOnce(null);

      const response = await request(app).get(`/alerts/${TEST_ALERT_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.getAlertById.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get(`/alerts/${TEST_ALERT_ID}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get alert');
    });
  });

  // ==========================================================================
  // POST /alerts/_getAlerts - POST alternative for bulk fetch
  // ==========================================================================

  describe('POST /alerts/_getAlerts', () => {
    it('should return alerts by IDs in POST body array', async () => {
      const alerts = [makeAlert()];
      mockAlertDao.getAlertsByIds.mockResolvedValueOnce(alerts);

      const response = await request(app)
        .post('/alerts/_getAlerts')
        .send([TEST_ALERT_ID]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockAlertDao.getAlertsByIds).toHaveBeenCalledWith([TEST_ALERT_ID]);
    });

    it('should return all alerts when body is empty', async () => {
      const alerts = [makeAlert()];
      mockAlertDao.getAlerts.mockResolvedValueOnce(alerts);

      const response = await request(app)
        .post('/alerts/_getAlerts')
        .send([]);

      expect(response.status).toBe(200);
      expect(mockAlertDao.getAlerts).toHaveBeenCalled();
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.getAlerts.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/alerts/_getAlerts')
        .send([]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get alerts');
    });
  });

  // ==========================================================================
  // GET /alerts/statuses - Get alert statuses
  // ==========================================================================

  describe('GET /alerts/statuses', () => {
    it('should return all alert statuses', async () => {
      const statuses = [
        { id: TEST_ALERT_ID, name: 'Test Alert', enabled: true, alertedCount: 5 },
      ];
      mockAlertDao.getAlertStatuses.mockResolvedValueOnce(statuses);

      const response = await request(app).get('/alerts/statuses');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].alertedCount).toBe(5);
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.getAlertStatuses.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/alerts/statuses');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get alert statuses');
    });
  });

  // ==========================================================================
  // GET /alerts/options - Get protocol options
  // ==========================================================================

  describe('GET /alerts/options', () => {
    it('should return alert protocol options', async () => {
      const response = await request(app).get('/alerts/options');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('Email');
      expect(response.body).toHaveProperty('Webhook');
      expect(response.body).toHaveProperty('Slack');
      expect(response.body.Email).toHaveProperty('host');
    });
  });

  // ==========================================================================
  // POST /alerts/_getInfo - Get alert protocol info
  // ==========================================================================

  describe('POST /alerts/_getInfo', () => {
    it('should return protocol options and changed channels', async () => {
      const response = await request(app)
        .post('/alerts/_getInfo')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.protocolOptions).toHaveProperty('Email');
      expect(response.body.changedChannels).toEqual([]);
    });
  });

  // ==========================================================================
  // POST /alerts/:alertId/_getInfo - Get info for specific alert
  // ==========================================================================

  describe('POST /alerts/:alertId/_getInfo', () => {
    it('should return alert info with the alert model', async () => {
      const alert = makeAlert();
      mockAlertDao.getAlertById.mockResolvedValueOnce(alert);

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_getInfo`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.model.id).toBe(TEST_ALERT_ID);
      expect(response.body.protocolOptions).toHaveProperty('Email');
    });

    it('should return 404 when alert not found', async () => {
      mockAlertDao.getAlertById.mockResolvedValueOnce(null);

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_getInfo`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });
  });

  // ==========================================================================
  // PUT /alerts/:alertId - Update alert
  // ==========================================================================

  describe('PUT /alerts/:alertId', () => {
    it('should update an alert successfully', async () => {
      const existing = makeAlert();
      mockAlertDao.getAlertById.mockResolvedValueOnce(existing);
      mockAlertDao.updateAlert.mockResolvedValueOnce(true);

      const response = await request(app)
        .put(`/alerts/${TEST_ALERT_ID}`)
        .send({ name: 'Updated Alert', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Alert');
      expect(response.body.id).toBe(TEST_ALERT_ID); // ID forced from path
      expect(mockAlertDao.updateAlert).toHaveBeenCalled();
    });

    it('should return 404 when alert does not exist', async () => {
      mockAlertDao.getAlertById.mockResolvedValueOnce(null);

      const response = await request(app)
        .put(`/alerts/${TEST_ALERT_ID}`)
        .send({ name: 'Updated Alert' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('should return 409 when name is already taken by another alert', async () => {
      const existing = makeAlert();
      mockAlertDao.getAlertById.mockResolvedValueOnce(existing);
      mockAlertDao.isAlertNameTaken.mockResolvedValueOnce(true);

      const response = await request(app)
        .put(`/alerts/${TEST_ALERT_ID}`)
        .send({ name: 'Duplicate Name', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('An alert with that name already exists');
    });

    it('should skip name check when name is unchanged', async () => {
      const existing = makeAlert();
      mockAlertDao.getAlertById.mockResolvedValueOnce(existing);
      mockAlertDao.updateAlert.mockResolvedValueOnce(true);

      const response = await request(app)
        .put(`/alerts/${TEST_ALERT_ID}`)
        .send({ name: 'Test Alert', trigger: { name: 'ErrorAlertTrigger' } });

      expect(response.status).toBe(200);
      expect(mockAlertDao.isAlertNameTaken).not.toHaveBeenCalled();
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.getAlertById.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .put(`/alerts/${TEST_ALERT_ID}`)
        .send({ name: 'Fail Alert' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update alert');
    });
  });

  // ==========================================================================
  // POST /alerts/:alertId/_enable - Enable alert
  // ==========================================================================

  describe('POST /alerts/:alertId/_enable', () => {
    it('should enable an alert and return 204', async () => {
      mockAlertDao.enableAlert.mockResolvedValueOnce(true);

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_enable`);

      expect(response.status).toBe(204);
      expect(mockAlertDao.enableAlert).toHaveBeenCalledWith(TEST_ALERT_ID);
    });

    it('should return 404 when alert not found', async () => {
      mockAlertDao.enableAlert.mockResolvedValueOnce(false);

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_enable`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.enableAlert.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_enable`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to enable alert');
    });
  });

  // ==========================================================================
  // POST /alerts/:alertId/_disable - Disable alert
  // ==========================================================================

  describe('POST /alerts/:alertId/_disable', () => {
    it('should disable an alert and return 204', async () => {
      mockAlertDao.disableAlert.mockResolvedValueOnce(true);

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_disable`);

      expect(response.status).toBe(204);
      expect(mockAlertDao.disableAlert).toHaveBeenCalledWith(TEST_ALERT_ID);
    });

    it('should return 404 when alert not found', async () => {
      mockAlertDao.disableAlert.mockResolvedValueOnce(false);

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_disable`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.disableAlert.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/alerts/${TEST_ALERT_ID}/_disable`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to disable alert');
    });
  });

  // ==========================================================================
  // DELETE /alerts/:alertId - Remove alert
  // ==========================================================================

  describe('DELETE /alerts/:alertId', () => {
    it('should delete an alert and return 204', async () => {
      mockAlertDao.deleteAlert.mockResolvedValueOnce(true);

      const response = await request(app).delete(`/alerts/${TEST_ALERT_ID}`);

      expect(response.status).toBe(204);
      expect(mockAlertDao.deleteAlert).toHaveBeenCalledWith(TEST_ALERT_ID);
    });

    it('should return 404 when alert not found', async () => {
      mockAlertDao.deleteAlert.mockResolvedValueOnce(false);

      const response = await request(app).delete(`/alerts/${TEST_ALERT_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('should return 500 on database error', async () => {
      mockAlertDao.deleteAlert.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).delete(`/alerts/${TEST_ALERT_ID}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to remove alert');
    });
  });
});
