/**
 * DatabaseTaskServlet Unit Tests
 *
 * Tests for database task management endpoints including:
 * - GET / - List all database tasks
 * - GET /:taskId - Get task by ID
 * - POST /:taskId/_run - Run a task
 * - POST /:taskId/_cancel - Cancel a task
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock authorization
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  DATABASE_TASK_GET: { name: 'getDatabaseTask' },
  DATABASE_TASK_GET_ALL: { name: 'getAllDatabaseTasks' },
  DATABASE_TASK_RUN: { name: 'runDatabaseTask' },
  DATABASE_TASK_CANCEL: { name: 'cancelDatabaseTask' },
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
import { databaseTaskRouter } from '../../../../src/api/servlets/DatabaseTaskServlet.js';

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

  app.use('/databaseTasks', databaseTaskRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('DatabaseTaskServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Use fake timers to control setTimeout in runTask
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ==========================================================================
  // GET /databaseTasks - List all tasks
  // ==========================================================================

  describe('GET /databaseTasks', () => {
    it('should return all available database tasks', async () => {
      const response = await request(app).get('/databaseTasks');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(5);

      // Check well-known tasks exist
      const taskIds = response.body.map((t: { id: string }) => t.id);
      expect(taskIds).toContain('vacuum-tables');
      expect(taskIds).toContain('analyze-tables');
      expect(taskIds).toContain('rebuild-indexes');
      expect(taskIds).toContain('clear-global-map');
      expect(taskIds).toContain('clear-configuration-map');
    });

    it('should return tasks with required fields', async () => {
      const response = await request(app).get('/databaseTasks');

      expect(response.status).toBe(200);
      for (const task of response.body) {
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('name');
        expect(task).toHaveProperty('description');
        expect(task).toHaveProperty('status');
        expect(task).toHaveProperty('runnable');
        expect(task).toHaveProperty('cancellable');
      }
    });

    it('should return tasks with IDLE status by default', async () => {
      const response = await request(app).get('/databaseTasks');

      expect(response.status).toBe(200);
      for (const task of response.body) {
        expect(task.status).toBe('IDLE');
      }
    });
  });

  // ==========================================================================
  // GET /databaseTasks/:taskId - Get task by ID
  // ==========================================================================

  describe('GET /databaseTasks/:taskId', () => {
    it('should return a specific task by ID', async () => {
      const response = await request(app).get('/databaseTasks/vacuum-tables');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('vacuum-tables');
      expect(response.body.name).toBe('Vacuum Tables');
      expect(response.body.runnable).toBe(true);
    });

    it('should return 404 for unknown task ID', async () => {
      const response = await request(app).get('/databaseTasks/nonexistent-task');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Task not found');
    });

    it('should include confirmation message in task details', async () => {
      const response = await request(app).get('/databaseTasks/clear-global-map');

      expect(response.status).toBe(200);
      expect(response.body.confirmationMessage).toBeTruthy();
      expect(response.body.confirmationMessage).toContain('global map');
    });
  });

  // ==========================================================================
  // POST /databaseTasks/:taskId/_run - Run a task
  // ==========================================================================

  describe('POST /databaseTasks/:taskId/_run', () => {
    it('should start a task and return success', async () => {
      const response = await request(app)
        .post('/databaseTasks/vacuum-tables/_run');

      expect(response.status).toBe(200);
      expect(response.body.started).toBe(true);
      expect(response.body.taskId).toBe('vacuum-tables');
    });

    it('should show task as RUNNING after starting', async () => {
      await request(app).post('/databaseTasks/analyze-tables/_run');

      const response = await request(app).get('/databaseTasks/analyze-tables');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('RUNNING');
      expect(response.body.startTime).toBeTruthy();
    });

    it('should return 400 when task is already running', async () => {
      // Start the task first
      await request(app).post('/databaseTasks/rebuild-indexes/_run');

      // Try to start it again
      const response = await request(app)
        .post('/databaseTasks/rebuild-indexes/_run');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Task is already running');
    });

    it('should return 400 for unknown task ID', async () => {
      const response = await request(app)
        .post('/databaseTasks/nonexistent-task/_run');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Task not found');
    });
  });

  // ==========================================================================
  // POST /databaseTasks/:taskId/_cancel - Cancel a task
  // ==========================================================================

  describe('POST /databaseTasks/:taskId/_cancel', () => {
    it('should cancel a running cancellable task', async () => {
      // Start the cancellable task first
      await request(app).post('/databaseTasks/rebuild-indexes/_run');

      const response = await request(app)
        .post('/databaseTasks/rebuild-indexes/_cancel');

      expect(response.status).toBe(200);
      expect(response.body.cancelled).toBe(true);
      expect(response.body.taskId).toBe('rebuild-indexes');
    });

    it('should show task as CANCELLED after cancelling', async () => {
      // Start then cancel
      await request(app).post('/databaseTasks/rebuild-indexes/_run');
      await request(app).post('/databaseTasks/rebuild-indexes/_cancel');

      const response = await request(app).get('/databaseTasks/rebuild-indexes');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CANCELLED');
      expect(response.body.endTime).toBeTruthy();
    });

    it('should return 400 when task is not cancellable', async () => {
      // vacuum-tables is not cancellable
      await request(app).post('/databaseTasks/vacuum-tables/_run');

      const response = await request(app)
        .post('/databaseTasks/vacuum-tables/_cancel');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Task cannot be cancelled');
    });

    it('should return 400 when task is not running', async () => {
      // rebuild-indexes is cancellable but not running
      const response = await request(app)
        .post('/databaseTasks/rebuild-indexes/_cancel');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Task is not running');
    });

    it('should return 400 for unknown task ID', async () => {
      const response = await request(app)
        .post('/databaseTasks/nonexistent-task/_cancel');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Task not found');
    });
  });
});
