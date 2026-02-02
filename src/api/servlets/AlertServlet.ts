/**
 * Alert Servlet
 *
 * Handles alert management operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/AlertServletInterface.java
 *
 * Endpoints:
 * - POST /alerts - Create alert
 * - GET /alerts/:alertId - Get alert by ID
 * - GET /alerts - Get all alerts
 * - POST /alerts/_getAlerts - POST alternative
 * - GET /alerts/statuses - Get alert statuses
 * - POST /alerts/:alertId/_getInfo - Get alert info
 * - POST /alerts/_getInfo - Get protocol options
 * - GET /alerts/options - Get protocol options
 * - PUT /alerts/:alertId - Update alert
 * - POST /alerts/:alertId/_enable - Enable alert
 * - POST /alerts/:alertId/_disable - Disable alert
 * - DELETE /alerts/:alertId - Remove alert
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as AlertDao from '../../db/AlertDao.js';
import { AlertModel, AlertInfo } from '../models/Alert.js';
import { authorize } from '../middleware/authorization.js';
import {
  ALERT_GET,
  ALERT_GET_ALL,
  ALERT_GET_STATUS,
  ALERT_GET_INFO,
  ALERT_GET_OPTIONS,
  ALERT_CREATE,
  ALERT_UPDATE,
  ALERT_ENABLE,
  ALERT_DISABLE,
  ALERT_REMOVE,
} from '../middleware/operations.js';

export const alertRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface AlertIdParams {
  alertId: string;
}

// ============================================================================
// Alert Protocol Options
// ============================================================================

/**
 * Get available alert protocol options
 *
 * In a full implementation, this would dynamically discover protocols
 * from registered alert action plugins. For now, we provide the built-in ones.
 */
function getAlertProtocolOptions(): Record<string, Record<string, string>> {
  return {
    Email: {
      host: 'SMTP server hostname',
      port: 'SMTP server port',
      secure: 'Use TLS (true/false)',
      username: 'SMTP username',
      password: 'SMTP password',
      from: 'From email address',
    },
    Webhook: {
      url: 'Webhook URL',
      method: 'HTTP method (POST/PUT)',
      contentType: 'Content-Type header',
      headers: 'Additional headers (JSON)',
    },
    Slack: {
      webhookUrl: 'Slack webhook URL',
      channel: 'Channel name',
      username: 'Bot username',
    },
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /alerts
 * Create a new alert
 */
alertRouter.post(
  '/',
  authorize({ operation: ALERT_CREATE }),
  async (req: Request, res: Response) => {
    try {
      const alertModel = req.body as AlertModel;

      // Generate ID if not provided
      if (!alertModel.id) {
        alertModel.id = uuidv4();
      }

      // Validate name
      if (!alertModel.name || alertModel.name.trim() === '') {
        res.status(400).json({ error: 'Alert name is required' });
        return;
      }

      // Check for duplicate name
      const nameTaken = await AlertDao.isAlertNameTaken(alertModel.name);
      if (nameTaken) {
        res.status(409).json({ error: 'An alert with that name already exists' });
        return;
      }

      // Set defaults
      if (alertModel.enabled === undefined) {
        alertModel.enabled = false;
      }
      if (!alertModel.actionGroups) {
        alertModel.actionGroups = [];
      }

      await AlertDao.upsertAlert(alertModel);
      res.sendData(alertModel);
    } catch (error) {
      console.error('Create alert error:', error);
      res.status(500).json({ error: 'Failed to create alert' });
    }
  }
);

/**
 * GET /alerts/statuses
 * Get all alert statuses (for dashboard)
 */
alertRouter.get(
  '/statuses',
  authorize({ operation: ALERT_GET_STATUS }),
  async (_req: Request, res: Response) => {
    try {
      const statuses = await AlertDao.getAlertStatuses();
      res.sendData(statuses);
    } catch (error) {
      console.error('Get alert statuses error:', error);
      res.status(500).json({ error: 'Failed to get alert statuses' });
    }
  }
);

/**
 * GET /alerts/options
 * Get alert protocol options
 */
alertRouter.get(
  '/options',
  authorize({ operation: ALERT_GET_OPTIONS }),
  async (_req: Request, res: Response) => {
    try {
      const options = getAlertProtocolOptions();
      res.sendData(options);
    } catch (error) {
      console.error('Get alert options error:', error);
      res.status(500).json({ error: 'Failed to get alert options' });
    }
  }
);

/**
 * POST /alerts/_getAlerts
 * Get alerts (POST alternative with IDs in body)
 */
alertRouter.post(
  '/_getAlerts',
  authorize({ operation: ALERT_GET_ALL }),
  async (req: Request, res: Response) => {
    try {
      let alertIds: string[] | undefined;

      // Handle various body formats
      if (Array.isArray(req.body)) {
        alertIds = req.body;
      } else if (req.body && req.body.set && req.body.set.string) {
        // XML format: <set><string>id1</string></set>
        const ids = req.body.set.string;
        alertIds = Array.isArray(ids) ? ids : [ids];
      }

      let alerts: AlertModel[];
      if (alertIds && alertIds.length > 0) {
        alerts = await AlertDao.getAlertsByIds(alertIds);
      } else {
        alerts = await AlertDao.getAlerts();
      }

      res.sendData(alerts);
    } catch (error) {
      console.error('Get alerts POST error:', error);
      res.status(500).json({ error: 'Failed to get alerts' });
    }
  }
);

/**
 * POST /alerts/_getInfo
 * Get alert protocol options and changed channels
 */
alertRouter.post(
  '/_getInfo',
  authorize({ operation: ALERT_GET_INFO }),
  async (_req: Request, res: Response) => {
    try {
      const info: AlertInfo = {
        protocolOptions: getAlertProtocolOptions(),
        changedChannels: [], // TODO: Compare with cached channels
      };
      res.sendData(info);
    } catch (error) {
      console.error('Get alert info error:', error);
      res.status(500).json({ error: 'Failed to get alert info' });
    }
  }
);

/**
 * GET /alerts/:alertId
 * Get alert by ID
 */
alertRouter.get(
  '/:alertId',
  authorize({ operation: ALERT_GET }),
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params as unknown as AlertIdParams;
      const alert = await AlertDao.getAlertById(alertId);

      if (!alert) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      res.sendData(alert);
    } catch (error) {
      console.error('Get alert error:', error);
      res.status(500).json({ error: 'Failed to get alert' });
    }
  }
);

/**
 * POST /alerts/:alertId/_getInfo
 * Get alert info for specific alert
 */
alertRouter.post(
  '/:alertId/_getInfo',
  authorize({ operation: ALERT_GET_INFO }),
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params as unknown as AlertIdParams;
      const alert = await AlertDao.getAlertById(alertId);

      if (!alert) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      const info: AlertInfo = {
        model: alert,
        protocolOptions: getAlertProtocolOptions(),
        changedChannels: [], // TODO: Compare with cached channels
      };

      res.sendData(info);
    } catch (error) {
      console.error('Get alert info error:', error);
      res.status(500).json({ error: 'Failed to get alert info' });
    }
  }
);

/**
 * PUT /alerts/:alertId
 * Update alert
 */
alertRouter.put(
  '/:alertId',
  authorize({ operation: ALERT_UPDATE }),
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params as unknown as AlertIdParams;
      const alertModel = req.body as AlertModel;

      // Ensure ID matches path
      alertModel.id = alertId;

      // Check if alert exists
      const existing = await AlertDao.getAlertById(alertId);
      if (!existing) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      // Check for duplicate name (if name changed)
      if (alertModel.name && alertModel.name !== existing.name) {
        const nameTaken = await AlertDao.isAlertNameTaken(alertModel.name, alertId);
        if (nameTaken) {
          res.status(409).json({ error: 'An alert with that name already exists' });
          return;
        }
      }

      await AlertDao.updateAlert(alertModel);
      res.sendData(alertModel);
    } catch (error) {
      console.error('Update alert error:', error);
      res.status(500).json({ error: 'Failed to update alert' });
    }
  }
);

/**
 * POST /alerts/:alertId/_enable
 * Enable alert
 */
alertRouter.post(
  '/:alertId/_enable',
  authorize({ operation: ALERT_ENABLE }),
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params as unknown as AlertIdParams;
      const success = await AlertDao.enableAlert(alertId);

      if (!success) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      console.error('Enable alert error:', error);
      res.status(500).json({ error: 'Failed to enable alert' });
    }
  }
);

/**
 * POST /alerts/:alertId/_disable
 * Disable alert
 */
alertRouter.post(
  '/:alertId/_disable',
  authorize({ operation: ALERT_DISABLE }),
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params as unknown as AlertIdParams;
      const success = await AlertDao.disableAlert(alertId);

      if (!success) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      console.error('Disable alert error:', error);
      res.status(500).json({ error: 'Failed to disable alert' });
    }
  }
);

/**
 * DELETE /alerts/:alertId
 * Remove alert
 */
alertRouter.delete(
  '/:alertId',
  authorize({ operation: ALERT_REMOVE }),
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params as unknown as AlertIdParams;
      const success = await AlertDao.deleteAlert(alertId);

      if (!success) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      console.error('Remove alert error:', error);
      res.status(500).json({ error: 'Failed to remove alert' });
    }
  }
);

/**
 * GET /alerts
 * Get all alerts or specific alerts by ID
 */
alertRouter.get(
  '/',
  authorize({ operation: ALERT_GET_ALL }),
  async (req: Request, res: Response) => {
    try {
      const alertIds = req.query.alertId;

      let alerts: AlertModel[];
      if (alertIds) {
        const ids = Array.isArray(alertIds) ? (alertIds as string[]) : [alertIds as string];
        alerts = await AlertDao.getAlertsByIds(ids);
      } else {
        alerts = await AlertDao.getAlerts();
      }

      res.sendData(alerts);
    } catch (error) {
      console.error('Get alerts error:', error);
      res.status(500).json({ error: 'Failed to get alerts' });
    }
  }
);
