/**
 * Database Task Servlet
 *
 * Handles database task operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/DatabaseTaskServletInterface.java
 *
 * Database tasks are long-running operations like:
 * - Vacuum/Analyze tables
 * - Rebuild indexes
 * - Clear old data
 *
 * Endpoints:
 * - GET /databaseTasks - Get all tasks
 * - GET /databaseTasks/:taskId - Get task by ID
 * - POST /databaseTasks/:taskId/_run - Run task
 * - POST /databaseTasks/:taskId/_cancel - Cancel task
 */

import { Router, Request, Response } from 'express';
import { authorize } from '../middleware/authorization.js';
import {
  DATABASE_TASK_GET,
  DATABASE_TASK_GET_ALL,
  DATABASE_TASK_RUN,
  DATABASE_TASK_CANCEL,
} from '../middleware/operations.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const databaseTaskRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface TaskIdParams {
  taskId: string;
}

type TaskStatus = 'IDLE' | 'RUNNING' | 'CANCELLING' | 'CANCELLED' | 'COMPLETED' | 'FAILED';

interface DatabaseTask {
  id: string;
  name: string;
  description: string;
  status: TaskStatus;
  progress?: number;
  startTime?: string;
  endTime?: string;
  error?: string;
  confirmationMessage?: string;
  affectedChannels?: string[];
  runnable: boolean;
  cancellable: boolean;
}

// ============================================================================
// Task Registry
// ============================================================================

// In-memory task state
const taskStates = new Map<
  string,
  { status: TaskStatus; progress: number; startTime?: Date; endTime?: Date; error?: string }
>();

/**
 * Get available database tasks
 */
function getAvailableTasks(): DatabaseTask[] {
  const tasks: DatabaseTask[] = [
    {
      id: 'vacuum-tables',
      name: 'Vacuum Tables',
      description: 'Reclaims storage and optimizes database tables',
      status: 'IDLE',
      confirmationMessage: 'This operation may take a while. Continue?',
      runnable: true,
      cancellable: false,
    },
    {
      id: 'analyze-tables',
      name: 'Analyze Tables',
      description: 'Updates table statistics for query optimization',
      status: 'IDLE',
      confirmationMessage: 'This will analyze all tables. Continue?',
      runnable: true,
      cancellable: false,
    },
    {
      id: 'rebuild-indexes',
      name: 'Rebuild Indexes',
      description: 'Rebuilds database indexes for better performance',
      status: 'IDLE',
      confirmationMessage: 'This operation may cause temporary slowdowns. Continue?',
      runnable: true,
      cancellable: true,
    },
    {
      id: 'clear-global-map',
      name: 'Clear Global Map',
      description: 'Clears all entries from the global map',
      status: 'IDLE',
      confirmationMessage: 'This will permanently clear all global map entries. Continue?',
      runnable: true,
      cancellable: false,
    },
    {
      id: 'clear-configuration-map',
      name: 'Clear Configuration Map',
      description: 'Clears all entries from the configuration map',
      status: 'IDLE',
      confirmationMessage: 'This will permanently clear all configuration map entries. Continue?',
      runnable: true,
      cancellable: false,
    },
  ];

  // Apply current state
  return tasks.map((task) => {
    const state = taskStates.get(task.id);
    if (state) {
      return {
        ...task,
        status: state.status,
        progress: state.progress,
        startTime: state.startTime?.toISOString(),
        endTime: state.endTime?.toISOString(),
        error: state.error,
      };
    }
    return task;
  });
}

/**
 * Get task by ID
 */
function getTask(taskId: string): DatabaseTask | null {
  const tasks = getAvailableTasks();
  return tasks.find((t) => t.id === taskId) ?? null;
}

/**
 * Run a database task
 */
async function runTask(taskId: string): Promise<{ success: boolean; message?: string }> {
  const task = getTask(taskId);
  if (!task) {
    return { success: false, message: 'Task not found' };
  }

  const currentState = taskStates.get(taskId);
  if (currentState?.status === 'RUNNING') {
    return { success: false, message: 'Task is already running' };
  }

  // Start the task
  taskStates.set(taskId, {
    status: 'RUNNING',
    progress: 0,
    startTime: new Date(),
  });

  // Simulate task execution (in a real implementation, this would do actual work)
  setTimeout(() => {
    const state = taskStates.get(taskId);
    if (state && state.status === 'RUNNING') {
      taskStates.set(taskId, {
        status: 'COMPLETED',
        progress: 100,
        startTime: state.startTime,
        endTime: new Date(),
      });
    }
  }, 5000); // Simulate 5 second task

  return { success: true };
}

/**
 * Cancel a database task
 */
function cancelTask(taskId: string): { success: boolean; message?: string } {
  const task = getTask(taskId);
  if (!task) {
    return { success: false, message: 'Task not found' };
  }

  if (!task.cancellable) {
    return { success: false, message: 'Task cannot be cancelled' };
  }

  const currentState = taskStates.get(taskId);
  if (!currentState || currentState.status !== 'RUNNING') {
    return { success: false, message: 'Task is not running' };
  }

  taskStates.set(taskId, {
    status: 'CANCELLED',
    progress: currentState.progress,
    startTime: currentState.startTime,
    endTime: new Date(),
  });

  return { success: true };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /databaseTasks
 * Get all database tasks
 */
databaseTaskRouter.get(
  '/',
  authorize({ operation: DATABASE_TASK_GET_ALL }),
  async (_req: Request, res: Response) => {
    try {
      const tasks = getAvailableTasks();
      res.sendData(tasks);
    } catch (error) {
      logger.error('Get database tasks error', error as Error);
      res.status(500).json({ error: 'Failed to get database tasks' });
    }
  }
);

/**
 * GET /databaseTasks/:taskId
 * Get database task by ID
 */
databaseTaskRouter.get(
  '/:taskId',
  authorize({ operation: DATABASE_TASK_GET }),
  async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params as unknown as TaskIdParams;
      const task = getTask(taskId);

      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      res.sendData(task);
    } catch (error) {
      logger.error('Get database task error', error as Error);
      res.status(500).json({ error: 'Failed to get database task' });
    }
  }
);

/**
 * POST /databaseTasks/:taskId/_run
 * Run a database task
 */
databaseTaskRouter.post(
  '/:taskId/_run',
  authorize({ operation: DATABASE_TASK_RUN }),
  async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params as unknown as TaskIdParams;
      const result = await runTask(taskId);

      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      res.sendData({ started: true, taskId });
    } catch (error) {
      logger.error('Run database task error', error as Error);
      res.status(500).json({ error: 'Failed to run database task' });
    }
  }
);

/**
 * POST /databaseTasks/:taskId/_cancel
 * Cancel a database task
 */
databaseTaskRouter.post(
  '/:taskId/_cancel',
  authorize({ operation: DATABASE_TASK_CANCEL }),
  async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params as unknown as TaskIdParams;
      const result = cancelTask(taskId);

      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      res.sendData({ cancelled: true, taskId });
    } catch (error) {
      logger.error('Cancel database task error', error as Error);
      res.status(500).json({ error: 'Failed to cancel database task' });
    }
  }
);
