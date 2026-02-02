/**
 * Event Servlet
 *
 * Handles audit log (event) operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/EventServletInterface.java
 *
 * Endpoints:
 * - GET /events/maxEventId - Get max event ID
 * - GET /events/:eventId - Get event by ID
 * - POST /events/_search - Search events with filter
 * - GET /events - Search events (query params)
 * - POST /events/count/_search - Count events with filter
 * - GET /events/count - Count events
 * - POST /events/_export - Export all events
 * - DELETE /events - Remove all events
 */

import { Router, Request, Response } from 'express';
import {
  getEventById,
  getMaxEventId,
  searchEvents,
  countEvents,
  removeAllEvents,
  getAllEvents,
  exportEventsToCSV,
} from '../../db/EventDao.js';
import {
  parseEventFilter,
  toServerEventResponse,
} from '../models/ServerEvent.js';
import { authorize } from '../middleware/authorization.js';
import {
  EVENT_GET,
  EVENT_GET_MAX_ID,
  EVENT_GET_COUNT,
  EVENT_SEARCH,
  EVENT_EXPORT,
  EVENT_REMOVE,
} from '../middleware/operations.js';

export const eventRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface EventIdParams {
  eventId: string;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /events/maxEventId
 * Get the maximum event ID
 */
eventRouter.get(
  '/maxEventId',
  authorize({ operation: EVENT_GET_MAX_ID }),
  async (_req: Request, res: Response) => {
    try {
      const maxId = await getMaxEventId();
      res.sendData(maxId);
    } catch (error) {
      console.error('Get max event ID error:', error);
      res.status(500).json({ error: 'Failed to get max event ID' });
    }
  }
);

/**
 * GET /events/count
 * Count events with query parameters
 */
eventRouter.get(
  '/count',
  authorize({ operation: EVENT_GET_COUNT }),
  async (req: Request, res: Response) => {
    try {
      const filter = parseEventFilter(req.query as Record<string, unknown>);
      const count = await countEvents(filter);
      res.sendData(count);
    } catch (error) {
      console.error('Get event count error:', error);
      res.status(500).json({ error: 'Failed to get event count' });
    }
  }
);

/**
 * POST /events/count/_search
 * Count events with filter in body
 */
eventRouter.post(
  '/count/_search',
  authorize({ operation: EVENT_GET_COUNT }),
  async (req: Request, res: Response) => {
    try {
      const filter = parseEventFilter(req.body as Record<string, unknown>);
      const count = await countEvents(filter);
      res.sendData(count);
    } catch (error) {
      console.error('Get event count POST error:', error);
      res.status(500).json({ error: 'Failed to get event count' });
    }
  }
);

/**
 * GET /events/:eventId
 * Get event by ID
 */
eventRouter.get(
  '/:eventId',
  authorize({ operation: EVENT_GET }),
  async (req: Request, res: Response) => {
    try {
      const { eventId: eventIdStr } = req.params as unknown as EventIdParams; const eventId = parseInt(eventIdStr, 10);

      if (isNaN(eventId)) {
        res.status(400).json({ error: 'Invalid event ID' });
        return;
      }

      const event = await getEventById(eventId);

      if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }

      res.sendData(toServerEventResponse(event));
    } catch (error) {
      console.error('Get event error:', error);
      res.status(500).json({ error: 'Failed to get event' });
    }
  }
);

/**
 * POST /events/_search
 * Search events with filter in body
 */
eventRouter.post(
  '/_search',
  authorize({ operation: EVENT_SEARCH }),
  async (req: Request, res: Response) => {
    try {
      const filter = parseEventFilter(req.body as Record<string, unknown>);
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

      const events = await searchEvents(filter, offset, limit);
      const responses = events.map(toServerEventResponse);

      res.sendData(responses);
    } catch (error) {
      console.error('Search events error:', error);
      res.status(500).json({ error: 'Failed to search events' });
    }
  }
);

/**
 * GET /events
 * Search events with query parameters
 */
eventRouter.get(
  '/',
  authorize({ operation: EVENT_SEARCH }),
  async (req: Request, res: Response) => {
    try {
      const filter = parseEventFilter(req.query as Record<string, unknown>);
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

      const events = await searchEvents(filter, offset, limit);
      const responses = events.map(toServerEventResponse);

      res.sendData(responses);
    } catch (error) {
      console.error('Get events error:', error);
      res.status(500).json({ error: 'Failed to get events' });
    }
  }
);

/**
 * POST /events/_export
 * Export all events to CSV
 */
eventRouter.post(
  '/_export',
  authorize({ operation: EVENT_EXPORT }),
  async (_req: Request, res: Response) => {
    try {
      const events = await getAllEvents();
      const csv = exportEventsToCSV(events);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');
      res.send(csv);
    } catch (error) {
      console.error('Export events error:', error);
      res.status(500).json({ error: 'Failed to export events' });
    }
  }
);

/**
 * DELETE /events
 * Remove all events
 *
 * Query params:
 * - export (boolean): Export events before removing
 */
eventRouter.delete(
  '/',
  authorize({ operation: EVENT_REMOVE }),
  async (req: Request, res: Response) => {
    try {
      const shouldExport = req.query.export === 'true';

      if (shouldExport) {
        // Export before removing
        const events = await getAllEvents();
        const csv = exportEventsToCSV(events);

        // Remove all events
        await removeAllEvents();

        // Return CSV
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');
        res.send(csv);
      } else {
        // Just remove
        await removeAllEvents();
        res.status(204).end();
      }
    } catch (error) {
      console.error('Remove events error:', error);
      res.status(500).json({ error: 'Failed to remove events' });
    }
  }
);
