/**
 * EventServlet Unit Tests
 *
 * Tests for audit log endpoints including:
 * - GET /events/maxEventId - Get max event ID
 * - GET /events/:eventId - Get event by ID
 * - POST /events/_search - Search events with filter body
 * - GET /events - Search events with query params
 * - POST /events/count/_search - Count events with filter body
 * - GET /events/count - Count events with query params
 * - POST /events/_export - Export events to CSV
 * - DELETE /events - Remove all events
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
  EVENT_GET: { name: 'getEvent' },
  EVENT_GET_MAX_ID: { name: 'getMaxEventId' },
  EVENT_GET_COUNT: { name: 'getEventCount' },
  EVENT_SEARCH: { name: 'getEvents' },
  EVENT_EXPORT: { name: 'exportAllEvents' },
  EVENT_REMOVE: { name: 'removeAllEvents' },
}));

// Mock EventDao
const mockGetMaxEventId = jest.fn();
const mockGetEventById = jest.fn();
const mockSearchEvents = jest.fn();
const mockCountEvents = jest.fn();
const mockRemoveAllEvents = jest.fn();
const mockGetAllEvents = jest.fn();
const mockExportEventsToCSV = jest.fn();

jest.mock('../../../../src/db/EventDao.js', () => ({
  getMaxEventId: (...args: unknown[]) => mockGetMaxEventId(...args),
  getEventById: (...args: unknown[]) => mockGetEventById(...args),
  searchEvents: (...args: unknown[]) => mockSearchEvents(...args),
  countEvents: (...args: unknown[]) => mockCountEvents(...args),
  removeAllEvents: (...args: unknown[]) => mockRemoveAllEvents(...args),
  getAllEvents: (...args: unknown[]) => mockGetAllEvents(...args),
  exportEventsToCSV: (...args: unknown[]) => mockExportEventsToCSV(...args),
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

import express, { Express } from 'express';
import { eventRouter } from '../../../../src/api/servlets/EventServlet.js';

// ============================================================================
// Test fixtures
// ============================================================================

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    eventTime: new Date('2026-02-10T12:00:00.000Z'),
    level: 'INFORMATION',
    name: 'Channel deployed',
    attributes: new Map([['channelId', 'abc-123']]),
    outcome: 'SUCCESS',
    userId: 1,
    ipAddress: '127.0.0.1',
    serverId: 'server-1',
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

  app.use('/events', eventRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('EventServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /events/maxEventId
  // ==========================================================================

  describe('GET /events/maxEventId', () => {
    it('should return the max event ID', async () => {
      mockGetMaxEventId.mockResolvedValueOnce(42);

      const response = await request(app).get('/events/maxEventId');

      expect(response.status).toBe(200);
      expect(response.body).toBe(42);
      expect(mockGetMaxEventId).toHaveBeenCalled();
    });

    it('should return 500 on error', async () => {
      mockGetMaxEventId.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/events/maxEventId');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get max event ID');
    });
  });

  // ==========================================================================
  // GET /events/count
  // ==========================================================================

  describe('GET /events/count', () => {
    it('should return event count', async () => {
      mockCountEvents.mockResolvedValueOnce(100);

      const response = await request(app).get('/events/count');

      expect(response.status).toBe(200);
      expect(response.body).toBe(100);
    });

    it('should pass query params as filter', async () => {
      mockCountEvents.mockResolvedValueOnce(5);

      const response = await request(app)
        .get('/events/count?level=ERROR&name=deploy');

      expect(response.status).toBe(200);
      expect(response.body).toBe(5);
      expect(mockCountEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          levels: ['ERROR'],
          name: 'deploy',
        })
      );
    });

    it('should return 500 on error', async () => {
      mockCountEvents.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/events/count');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get event count');
    });
  });

  // ==========================================================================
  // POST /events/count/_search
  // ==========================================================================

  describe('POST /events/count/_search', () => {
    it('should count events with filter in body', async () => {
      mockCountEvents.mockResolvedValueOnce(25);

      const response = await request(app)
        .post('/events/count/_search')
        .send({ name: 'Channel deployed', outcome: 'SUCCESS' });

      expect(response.status).toBe(200);
      expect(response.body).toBe(25);
      expect(mockCountEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Channel deployed',
          outcome: 'SUCCESS',
        })
      );
    });

    it('should return 500 on error', async () => {
      mockCountEvents.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/events/count/_search')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get event count');
    });
  });

  // ==========================================================================
  // GET /events/:eventId
  // ==========================================================================

  describe('GET /events/:eventId', () => {
    it('should return an event by ID', async () => {
      const event = makeEvent();
      mockGetEventById.mockResolvedValueOnce(event);

      const response = await request(app).get('/events/1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(1);
      expect(response.body.name).toBe('Channel deployed');
      expect(response.body.level).toBe('INFORMATION');
      expect(response.body.outcome).toBe('SUCCESS');
      expect(response.body.serverId).toBe('server-1');
      expect(mockGetEventById).toHaveBeenCalledWith(1);
    });

    it('should return 404 when event not found', async () => {
      mockGetEventById.mockResolvedValueOnce(null);

      const response = await request(app).get('/events/999');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Event not found');
    });

    it('should return 400 for invalid event ID', async () => {
      const response = await request(app).get('/events/notanumber');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid event ID');
    });

    it('should return 500 on error', async () => {
      mockGetEventById.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/events/1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get event');
    });
  });

  // ==========================================================================
  // POST /events/_search
  // ==========================================================================

  describe('POST /events/_search', () => {
    it('should search events with filter body', async () => {
      const events = [makeEvent(), makeEvent({ id: 2, name: 'User login' })];
      mockSearchEvents.mockResolvedValueOnce(events);

      const response = await request(app)
        .post('/events/_search')
        .send({ outcome: 'SUCCESS' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(1);
      expect(response.body[1].id).toBe(2);
    });

    it('should pass offset and limit from query params', async () => {
      mockSearchEvents.mockResolvedValueOnce([]);

      await request(app)
        .post('/events/_search?offset=10&limit=20')
        .send({ level: 'ERROR' });

      expect(mockSearchEvents).toHaveBeenCalledWith(
        expect.objectContaining({ levels: ['ERROR'] }),
        10,
        20
      );
    });

    it('should pass undefined offset/limit when not provided', async () => {
      mockSearchEvents.mockResolvedValueOnce([]);

      await request(app)
        .post('/events/_search')
        .send({});

      expect(mockSearchEvents).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
        undefined
      );
    });

    it('should return 500 on error', async () => {
      mockSearchEvents.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/events/_search')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to search events');
    });
  });

  // ==========================================================================
  // GET /events
  // ==========================================================================

  describe('GET /events', () => {
    it('should search events with query params', async () => {
      const events = [makeEvent()];
      mockSearchEvents.mockResolvedValueOnce(events);

      const response = await request(app).get('/events');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });

    it('should parse filter from query params', async () => {
      mockSearchEvents.mockResolvedValueOnce([]);

      await request(app)
        .get('/events?level=WARNING&name=deploy&outcome=FAILURE&userId=5');

      expect(mockSearchEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          levels: ['WARNING'],
          name: 'deploy',
          outcome: 'FAILURE',
          userId: 5,
        }),
        undefined,
        undefined
      );
    });

    it('should pass offset and limit from query params', async () => {
      mockSearchEvents.mockResolvedValueOnce([]);

      await request(app).get('/events?offset=5&limit=50');

      expect(mockSearchEvents).toHaveBeenCalledWith(
        expect.any(Object),
        5,
        50
      );
    });

    it('should return 500 on error', async () => {
      mockSearchEvents.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/events');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get events');
    });
  });

  // ==========================================================================
  // POST /events/_export
  // ==========================================================================

  describe('POST /events/_export', () => {
    it('should export events as CSV', async () => {
      const events = [makeEvent()];
      const csvContent = 'id,name,level\n1,Channel deployed,INFORMATION\n';
      mockGetAllEvents.mockResolvedValueOnce(events);
      mockExportEventsToCSV.mockReturnValueOnce(csvContent);

      const response = await request(app).post('/events/_export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('events.csv');
      expect(response.text).toBe(csvContent);
    });

    it('should return 500 on error', async () => {
      mockGetAllEvents.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).post('/events/_export');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to export events');
    });
  });

  // ==========================================================================
  // DELETE /events
  // ==========================================================================

  describe('DELETE /events', () => {
    it('should remove all events and return 204', async () => {
      mockRemoveAllEvents.mockResolvedValueOnce(undefined);

      const response = await request(app).delete('/events');

      expect(response.status).toBe(204);
      expect(mockRemoveAllEvents).toHaveBeenCalled();
    });

    it('should export before removing when export=true', async () => {
      const events = [makeEvent()];
      const csvContent = 'id,name\n1,Channel deployed\n';
      mockGetAllEvents.mockResolvedValueOnce(events);
      mockExportEventsToCSV.mockReturnValueOnce(csvContent);
      mockRemoveAllEvents.mockResolvedValueOnce(undefined);

      const response = await request(app).delete('/events?export=true');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text).toBe(csvContent);
      expect(mockGetAllEvents).toHaveBeenCalled();
      expect(mockRemoveAllEvents).toHaveBeenCalled();
    });

    it('should not export when export param is not true', async () => {
      mockRemoveAllEvents.mockResolvedValueOnce(undefined);

      const response = await request(app).delete('/events?export=false');

      expect(response.status).toBe(204);
      expect(mockGetAllEvents).not.toHaveBeenCalled();
    });

    it('should return 500 on error', async () => {
      mockRemoveAllEvents.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).delete('/events');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to remove events');
    });
  });
});
