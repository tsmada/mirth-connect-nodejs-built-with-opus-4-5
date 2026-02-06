/**
 * TraceServlet Unit Tests
 *
 * Tests for the trace endpoint:
 * - GET /api/messages/trace/:channelId/:messageId
 *
 * Mocks TraceService to test HTTP layer in isolation.
 */

import { Request, Response, NextFunction } from 'express';

// Mock authorization
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  MESSAGE_TRACE: { name: 'traceMessage' },
}));

// Mock TraceService
const mockTraceMessage = jest.fn();
jest.mock('../../../../src/api/services/TraceService.js', () => ({
  traceMessage: mockTraceMessage,
}));

import express, { Express } from 'express';
import request from 'supertest';
import { traceRouter } from '../../../../src/api/servlets/TraceServlet';

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/messages/trace', traceRouter);
  return app;
}

const MOCK_TRACE_RESULT = {
  root: {
    channelId: 'ch-001',
    channelName: 'Test Channel',
    messageId: 1,
    receivedDate: '2026-02-06T14:30:45.123Z',
    status: 'SENT',
    connectorName: 'Source',
    depth: 0,
    children: [],
  },
  totalNodes: 1,
  maxDepth: 0,
  totalLatencyMs: 0,
  hasErrors: false,
  truncated: false,
};

describe('TraceServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /:channelId/:messageId', () => {
    it('should return trace result for valid parameters', async () => {
      mockTraceMessage.mockResolvedValue(MOCK_TRACE_RESULT);

      const res = await request(app)
        .get('/api/messages/trace/ch-001/1')
        .expect(200);

      expect(res.body.root.channelId).toBe('ch-001');
      expect(res.body.root.status).toBe('SENT');
      expect(res.body.totalNodes).toBe(1);
      expect(mockTraceMessage).toHaveBeenCalledWith('ch-001', 1, expect.any(Object));
    });

    it('should return 400 for non-numeric messageId', async () => {
      const res = await request(app)
        .get('/api/messages/trace/ch-001/abc')
        .expect(400);

      expect(res.body.error).toBe('Invalid message ID');
      expect(mockTraceMessage).not.toHaveBeenCalled();
    });

    it('should pass query parameters as trace options', async () => {
      mockTraceMessage.mockResolvedValue(MOCK_TRACE_RESULT);

      await request(app)
        .get('/api/messages/trace/ch-001/1')
        .query({
          includeContent: 'false',
          maxDepth: '5',
          maxChildren: '20',
          maxContentLength: '200',
          direction: 'forward',
          contentTypes: 'raw,transformed',
        })
        .expect(200);

      expect(mockTraceMessage).toHaveBeenCalledWith('ch-001', 1, {
        includeContent: false,
        maxDepth: 5,
        maxChildren: 20,
        maxContentLength: 200,
        direction: 'forward',
        contentTypes: ['raw', 'transformed'],
      });
    });

    it('should ignore invalid direction values', async () => {
      mockTraceMessage.mockResolvedValue(MOCK_TRACE_RESULT);

      await request(app)
        .get('/api/messages/trace/ch-001/1')
        .query({ direction: 'sideways' })
        .expect(200);

      // direction should NOT be passed since 'sideways' is invalid
      const calledOptions = mockTraceMessage.mock.calls[0][2];
      expect(calledOptions.direction).toBeUndefined();
    });

    it('should ignore non-positive maxDepth', async () => {
      mockTraceMessage.mockResolvedValue(MOCK_TRACE_RESULT);

      await request(app)
        .get('/api/messages/trace/ch-001/1')
        .query({ maxDepth: '-5' })
        .expect(200);

      const calledOptions = mockTraceMessage.mock.calls[0][2];
      expect(calledOptions.maxDepth).toBeUndefined();
    });

    it('should cap maxDepth at 50', async () => {
      mockTraceMessage.mockResolvedValue(MOCK_TRACE_RESULT);

      await request(app)
        .get('/api/messages/trace/ch-001/1')
        .query({ maxDepth: '100' })
        .expect(200);

      const calledOptions = mockTraceMessage.mock.calls[0][2];
      expect(calledOptions.maxDepth).toBeUndefined();
    });

    it('should return 404 when traceMessage throws "not found"', async () => {
      mockTraceMessage.mockRejectedValue(new Error('Message not found in channel'));

      const res = await request(app)
        .get('/api/messages/trace/ch-001/999')
        .expect(404);

      expect(res.body.error).toContain('not found');
    });

    it('should return 404 when traceMessage throws "not deployed"', async () => {
      mockTraceMessage.mockRejectedValue(new Error('Channel has no message data (not deployed?)'));

      const res = await request(app)
        .get('/api/messages/trace/ch-missing/1')
        .expect(404);

      expect(res.body.error).toContain('not deployed');
    });

    it('should return 500 for unexpected errors', async () => {
      mockTraceMessage.mockRejectedValue(new Error('Database connection lost'));

      const res = await request(app)
        .get('/api/messages/trace/ch-001/1')
        .expect(500);

      expect(res.body.error).toBe('Failed to trace message');
    });

    it('should handle includeContent=true explicitly', async () => {
      mockTraceMessage.mockResolvedValue(MOCK_TRACE_RESULT);

      await request(app)
        .get('/api/messages/trace/ch-001/1')
        .query({ includeContent: 'true' })
        .expect(200);

      const calledOptions = mockTraceMessage.mock.calls[0][2];
      expect(calledOptions.includeContent).toBe(true);
    });
  });
});
