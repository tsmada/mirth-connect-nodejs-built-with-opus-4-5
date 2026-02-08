/**
 * Health Check Router
 *
 * Express router providing Kubernetes-compatible health probe endpoints.
 * These endpoints are registered BEFORE auth middleware so they are
 * accessible without authentication (required for K8s liveness/readiness).
 *
 * Endpoints:
 * - GET /api/health       - Readiness probe (503 during shutdown)
 * - GET /api/health/live  - Liveness probe (always 200 if process alive)
 * - GET /api/health/startup - Startup probe (503 until channels deployed)
 * - GET /api/health/channels/:channelId - Channel-specific readiness
 */

import { Router, Request, Response } from 'express';
import { getServerId } from './ClusterIdentity.js';
import { EngineController } from '../controllers/EngineController.js';
import { DeployedState } from '../api/models/DashboardStatus.js';

let shuttingDown = false;
let startupComplete = false;
const startTime = Date.now();

/**
 * Mark the server as shutting down.
 * Health check will start returning 503 for readiness probes.
 */
export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
}

/**
 * Check if the server is in shutdown mode.
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Mark startup as complete (all channels deployed).
 */
export function setStartupComplete(value: boolean): void {
  startupComplete = value;
}

/**
 * Check if startup is complete.
 */
export function isStartupComplete(): boolean {
  return startupComplete;
}

export const healthRouter = Router();

// GET /api/health - Readiness probe
healthRouter.get('/', (_req: Request, res: Response) => {
  if (shuttingDown) {
    res.status(503).json({
      status: 'shutting_down',
      serverId: getServerId(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
    return;
  }

  res.status(200).json({
    status: 'ok',
    serverId: getServerId(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    mode: process.env['MIRTH_MODE'] || 'auto',
  });
});

// GET /api/health/live - Liveness probe (always 200 if process is alive)
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

// GET /api/health/startup - Startup probe
healthRouter.get('/startup', (_req: Request, res: Response) => {
  if (!startupComplete) {
    res.status(503).json({
      status: 'starting',
      serverId: getServerId(),
    });
    return;
  }

  res.status(200).json({
    status: 'ready',
    serverId: getServerId(),
  });
});

// GET /api/health/channels/:channelId - Channel-specific readiness
healthRouter.get('/channels/:channelId', async (req: Request, res: Response) => {
  const channelId = req.params['channelId'] as string;

  const channel = EngineController.getDeployedChannel(channelId);
  if (!channel) {
    res.status(503).json({
      status: 'not_deployed',
      channelId,
      serverId: getServerId(),
    });
    return;
  }

  const state = channel.getState();
  if (state === DeployedState.STARTED) {
    res.status(200).json({
      status: 'started',
      channelId,
      serverId: getServerId(),
    });
  } else {
    res.status(503).json({
      status: state.toLowerCase(),
      channelId,
      serverId: getServerId(),
    });
  }
});
