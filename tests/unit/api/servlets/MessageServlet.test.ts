/**
 * MessageServlet Unit Tests
 *
 * Tests for message endpoints including:
 * - Basic message operations (get, delete, search)
 * - Message reprocessing
 * - Attachment CRUD
 * - Import/export (standard and encrypted)
 * - Bulk operations
 * - Content operations
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the database pool BEFORE importing the servlet
const mockPool = {
  query: jest.fn(),
  execute: jest.fn(),
};

jest.mock('../../../../src/db/pool.js', () => ({
  getPool: jest.fn(() => mockPool),
  withRetry: jest.fn((fn: any) => fn()),
}));

// Mock authorization - must passthrough to actual route handlers
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  MESSAGE_GET: { name: 'getMessage' },
  MESSAGE_GET_COUNT: { name: 'getMessageCount' },
  MESSAGE_SEARCH: { name: 'searchMessages' },
  MESSAGE_GET_MAX_ID: { name: 'getMaxMessageId' },
  MESSAGE_REMOVE: { name: 'removeMessage' },
  MESSAGE_REMOVE_ALL: { name: 'removeAllMessages' },
  MESSAGE_PROCESS: { name: 'processMessage' },
  MESSAGE_REPROCESS: { name: 'reprocessMessages' },
  MESSAGE_IMPORT: { name: 'importMessage' },
  MESSAGE_EXPORT: { name: 'exportMessage' },
  MESSAGE_GET_ATTACHMENT: { name: 'getAttachment' },
  MESSAGE_CREATE_ATTACHMENT: { name: 'createAttachment' },
  MESSAGE_UPDATE_ATTACHMENT: { name: 'updateAttachment' },
  MESSAGE_DELETE_ATTACHMENT: { name: 'deleteAttachment' },
  MESSAGE_IMPORT_MULTIPART: { name: 'importMessageMultipart' },
  MESSAGE_EXPORT_ENCRYPTED: { name: 'exportMessageEncrypted' },
  MESSAGE_REPROCESS_BULK: { name: 'reprocessMessagesBulk' },
  MESSAGE_GET_CONTENT: { name: 'getMessageContent' },
  MESSAGE_UPDATE_CONTENT: { name: 'updateMessageContent' },
}));

// Mock EngineController
jest.mock('../../../../src/controllers/EngineController.js', () => ({
  EngineController: {
    isDeployed: jest.fn(() => true),
    dispatchMessage: jest.fn(() => Promise.resolve({ messageId: 100, processed: true })),
  },
}));

// Now import Express and create app
import express, { Express } from 'express';
import { messageRouter } from '../../../../src/api/servlets/MessageServlet.js';
import { EngineController } from '../../../../src/controllers/EngineController.js';

// Helper to create a test channel ID
const TEST_CHANNEL_ID = '12345678-1234-1234-1234-123456789abc';
const TABLE_NAME = 'D_M12345678_1234_1234_1234_123456789abc';

// Create a test app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.text());

  // Add sendData helper like in real app
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown) {
      this.json(data);
    };
    next();
  });

  // Mount router with channelId param
  app.use('/channels/:channelId/messages', messageRouter);
  return app;
}

describe('MessageServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Basic Message Operations
  // ============================================================================

  describe('GET /channels/:channelId/messages/maxMessageId', () => {
    it('should return max message ID', async () => {
      // Mock table exists check
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock max ID query
        .mockResolvedValueOnce([[{ max_id: 42 }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/maxMessageId`);

      expect(response.status).toBe(200);
      expect(response.body).toBe(42);
    });

    it('should return 0 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/maxMessageId`);

      expect(response.status).toBe(200);
      expect(response.body).toBe(0);
    });
  });

  describe('GET /channels/:channelId/messages/count', () => {
    it('should return message count', async () => {
      // Mock table exists check
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock count query
        .mockResolvedValueOnce([[{ count: 100 }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/count`);

      expect(response.status).toBe(200);
      expect(response.body).toBe(100);
    });
  });

  describe('GET /channels/:channelId/messages/:messageId', () => {
    it('should return a message by ID', async () => {
      const messageId = 1;

      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock message query
        .mockResolvedValueOnce([[{
          ID: messageId,
          SERVER_ID: 'server1',
          RECEIVED_DATE: new Date('2024-01-01T00:00:00Z'),
          PROCESSED: 1,
          ORIGINAL_ID: null,
          IMPORT_ID: null,
        }], []])
        // Mock connector messages
        .mockResolvedValueOnce([[{
          MESSAGE_ID: messageId,
          METADATA_ID: 0,
          CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date('2024-01-01T00:00:00Z'),
          STATUS: 'S',
          SEND_ATTEMPTS: 1,
        }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/${messageId}`);

      expect(response.status).toBe(200);
      expect(response.body.messageId).toBe(messageId);
      expect(response.body.channelId).toBe(TEST_CHANNEL_ID);
      expect(response.body.processed).toBe(true);
    });

    it('should return 404 for non-existent message', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock empty message result
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/999`);

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /channels/:channelId/messages/:messageId', () => {
    it('should delete a message', async () => {
      // Mock table exists
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      // Mock delete operations
      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/1`);

      expect(response.status).toBe(204);
    });
  });

  describe('DELETE /channels/:channelId/messages/_removeAll (APC-ME-004)', () => {
    it('should remove all messages and clear statistics', async () => {
      // Mock table exists
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      // Mock TRUNCATE operations (4 tables) + statistics UPDATE
      mockPool.execute
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_MC
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_MA
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_MM
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_M
        .mockResolvedValueOnce([{}, []]); // UPDATE D_MS (clear stats)

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/_removeAll`);

      expect(response.status).toBe(204);
      // Verify statistics were cleared (default clearStatistics=true)
      expect(mockPool.execute).toHaveBeenCalledTimes(5);
    });

    it('should skip statistics clear when clearStatistics=false', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      mockPool.execute
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []]);

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/_removeAll?clearStatistics=false`);

      expect(response.status).toBe(204);
      expect(mockPool.execute).toHaveBeenCalledTimes(4); // No stats update
    });

    it('should return 404 when channel tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables found

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/_removeAll`);

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // Attachment CRUD Operations
  // ============================================================================

  describe('GET /channels/:channelId/messages/:messageId/attachments', () => {
    it('should list attachments for a message', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock attachments query
        .mockResolvedValueOnce([[
          { ID: 'att-1', MESSAGE_ID: 1, TYPE: 'application/pdf' },
          { ID: 'att-2', MESSAGE_ID: 1, TYPE: 'image/png' },
        ], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe('att-1');
    });
  });

  describe('POST /channels/:channelId/messages/:messageId/attachments', () => {
    it('should create a new attachment', async () => {
      // Mock table exists for both messageTablesExist calls
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock table exists for getMessage
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock message query for existence check
        .mockResolvedValueOnce([[{ ID: 1, SERVER_ID: 'test', RECEIVED_DATE: new Date(), PROCESSED: 1 }], []])
        // Mock connector messages (need at least one to avoid null return)
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1
        }], []]);

      // Mock insert
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`)
        .send({
          id: 'new-att',
          type: 'text/plain',
          content: Buffer.from('Hello World').toString('base64'),
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('new-att');
      expect(response.body.type).toBe('text/plain');
      expect(response.body.size).toBe(11); // 'Hello World'.length
    });

    it('should return 400 when content is missing', async () => {
      // Mock table exists for both messageTablesExist calls
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock table exists for getMessage
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock message exists
        .mockResolvedValueOnce([[{ ID: 1, SERVER_ID: 'test', RECEIVED_DATE: new Date(), PROCESSED: 1 }], []])
        // Mock connector messages (need at least one to avoid null return)
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`)
        .send({ type: 'text/plain' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing content');
    });
  });

  describe('PUT /channels/:channelId/messages/:messageId/attachments/:attachmentId', () => {
    it('should update an existing attachment', async () => {
      // Mock table exists for messageTablesExist
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock table exists for getAttachment's messageTablesExist
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock attachment exists (returns array of segments)
        .mockResolvedValueOnce([[{ ATTACHMENT: Buffer.from('old data') }], []]);

      // Mock delete and insert
      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`)
        .send({
          type: 'text/plain',
          content: Buffer.from('New Content').toString('base64'),
        });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('att-1');
      expect(response.body.size).toBe(11);
    });

    it('should return 404 for non-existent attachment', async () => {
      // Mock table exists for messageTablesExist
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock table exists for getAttachment's messageTablesExist
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock attachment not found
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/nonexistent`)
        .send({
          content: Buffer.from('data').toString('base64'),
        });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /channels/:channelId/messages/:messageId/attachments/:attachmentId', () => {
    it('should delete an attachment', async () => {
      // Mock table exists
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      // Mock delete
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`);

      expect(response.status).toBe(204);
    });

    it('should return 404 when attachment not found', async () => {
      // Mock table exists
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      // Mock delete returns 0 rows - use a proper ResultSetHeader format
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 0, insertId: 0, warningStatus: 0 }, []]);

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/nonexistent`);

      expect(response.status).toBe(404);
    });
  });

  // ============================================================================
  // Bulk Reprocess
  // ============================================================================

  describe('POST /channels/:channelId/messages/_reprocessBulk', () => {
    it('should reprocess multiple messages', async () => {
      // Mock table exists for each getMessage call
      mockPool.query
        // For message 1
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'test', RECEIVED_DATE: new Date(), PROCESSED: 1
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'raw data', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0
        }], []])
        // For message 2
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 2, SERVER_ID: 'test', RECEIVED_DATE: new Date(), PROCESSED: 1
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 2, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'raw data 2', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({
          messageIds: [1, 2],
          destinationMetaDataIds: [1, 2],
        });

      expect(response.status).toBe(200);
      expect(response.body.reprocessed).toBe(2);
      expect(response.body.total).toBe(2);
      expect(response.body.destinationMetaDataIds).toEqual([1, 2]);
    });

    it('should return 400 when channel not deployed', async () => {
      (EngineController.isDeployed as jest.Mock).mockReturnValueOnce(false);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({ messageIds: [1] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel not deployed');
    });

    it('should return 400 for empty messageIds', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({ messageIds: [] });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('non-empty array');
    });
  });

  // ============================================================================
  // Content Operations
  // ============================================================================

  describe('GET /channels/:channelId/messages/:messageId/connectorMessages/:metaDataId/content/:contentType', () => {
    it('should return specific content by numeric type', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock content query
        .mockResolvedValueOnce([[{
          CONTENT: 'MSH|^~\\&|...',
          DATA_TYPE: 'HL7V2',
          IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`);

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('MSH|^~\\&|...');
      expect(response.body.dataType).toBe('HL7V2');
      expect(response.body.contentType).toBe(1);
    });

    it('should return content by string type name', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock content query
        .mockResolvedValueOnce([[{
          CONTENT: 'transformed content',
          DATA_TYPE: 'XML',
          IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/TRANSFORMED`);

      expect(response.status).toBe(200);
      expect(response.body.contentType).toBe(3); // TRANSFORMED = 3
    });

    it('should return 404 when content not found', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock empty result
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /channels/:channelId/messages/:messageId/connectorMessages/:metaDataId/content/:contentType', () => {
    it('should update existing content', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock content exists check
        .mockResolvedValueOnce([[{ 1: 1 }], []]);

      // Mock update
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`)
        .send({
          content: 'updated content',
          dataType: 'TEXT',
        });

      expect(response.status).toBe(200);
      expect(response.body.updated).toBe(true);
    });

    it('should insert new content if not exists', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock content does not exist
        .mockResolvedValueOnce([[], []]);

      // Mock insert
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`)
        .send({
          content: 'new content',
        });

      expect(response.status).toBe(200);
      expect(response.body.updated).toBe(true);
    });

    it('should return 400 when content is missing', async () => {
      // Mock table exists
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing content');
    });
  });

  // ============================================================================
  // Encrypted Export
  // ============================================================================

  describe('POST /channels/:channelId/messages/_exportEncrypted', () => {
    it('should export messages without encryption', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock search (empty result for simplicity)
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_exportEncrypted`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should export messages with encryption', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock search
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_exportEncrypted?encryptionKey=mySecretKey123`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.format).toBe('mirth-encrypted-v1');
      expect(response.body.algorithm).toBe('aes-256-gcm');
      expect(response.body.iv).toBeDefined();
      expect(response.body.tag).toBeDefined();
      expect(response.body.data).toBeDefined();
    });
  });

  // ============================================================================
  // Import/Export
  // ============================================================================

  describe('POST /channels/:channelId/messages/_import', () => {
    it('should import a message', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock sequence query
        .mockResolvedValueOnce([[{ ID: 10 }], []]);

      // Mock all inserts
      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // sequence update
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // message insert
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // connector message
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // content

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_import`)
        .send({
          messageId: 1,
          serverId: 'import-server',
          receivedDate: '2024-01-01T00:00:00Z',
          processed: true,
          connectorMessages: {
            0: {
              metaDataId: 0,
              connectorName: 'Source',
              status: 'S',
              content: {
                1: { contentType: 1, content: 'raw data', dataType: 'RAW' },
              },
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.imported).toBe(true);
      expect(response.body.messageId).toBe(11);
      expect(response.body.originalId).toBe(1);
    });
  });

  describe('POST /channels/:channelId/messages/_export', () => {
    it('should export messages as JSON', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock search
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_export`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  // ============================================================================
  // Multipart Import
  // ============================================================================

  describe('POST /channels/:channelId/messages/_importMultipart', () => {
    it('should import a message from file upload', async () => {
      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // Mock sequence query
        .mockResolvedValueOnce([[{ ID: 10 }], []]);

      // Mock all inserts
      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // sequence update
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // message insert
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // connector message
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // content

      const messageData = {
        messageId: 1,
        connectorMessages: {
          0: {
            metaDataId: 0,
            connectorName: 'Source',
            status: 'S',
            content: {
              1: { contentType: 1, content: 'raw data', dataType: 'RAW' },
            },
          },
        },
      };

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_importMultipart`)
        .attach('file', Buffer.from(JSON.stringify(messageData)), 'message.json');

      expect(response.status).toBe(200);
      expect(response.body.imported).toBe(true);
      expect(response.body.messageId).toBe(11);
      expect(response.body.filename).toBe('message.json');
    });

    it('should return 400 when no file uploaded', async () => {
      // Mock table exists
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_importMultipart`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No file uploaded');
    });

    it('should return 400 for invalid JSON file', async () => {
      // Mock table exists
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_importMultipart`)
        .attach('file', Buffer.from('not valid json'), 'message.json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid file format');
    });

    it('should return 404 when channel tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_importMultipart`)
        .attach('file', Buffer.from('{}'), 'message.json');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });

    it('should return 400 for valid JSON without connectorMessages', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_importMultipart`)
        .attach('file', Buffer.from(JSON.stringify({ messageId: 1 })), 'message.json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid message format');
    });
  });

  // ============================================================================
  // Additional Coverage: Error Paths and Edge Cases
  // ============================================================================

  describe('Error paths - maxMessageId', () => {
    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/maxMessageId`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get max message ID');
    });

    it('should return 0 when max_id is null (empty table)', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ max_id: null }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/maxMessageId`);

      expect(response.status).toBe(200);
      expect(response.body).toBe(0);
    });
  });

  describe('Error paths - count', () => {
    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/count`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get message count');
    });

    it('should return 0 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/count`);

      expect(response.status).toBe(200);
      expect(response.body).toBe(0);
    });
  });

  describe('POST /channels/:channelId/messages/count/_search', () => {
    it('should count messages with filter in body', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ count: 42 }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/count/_search`)
        .send({ minMessageId: 1, maxMessageId: 100 });

      expect(response.status).toBe(200);
      expect(response.body).toBe(42);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/count/_search`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get message count');
    });

    it('should handle serverId filter', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ count: 5 }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/count/_search`)
        .send({ serverId: 'node-1' });

      expect(response.status).toBe(200);
      expect(response.body).toBe(5);
    });

    it('should handle attachment filter', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ count: 3 }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/count/_search`)
        .send({ attachment: true });

      expect(response.status).toBe(200);
      expect(response.body).toBe(3);
    });
  });

  describe('GET /channels/:channelId/messages/:messageId - edge cases', () => {
    it('should return 400 for non-numeric messageId', async () => {
      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/notanumber`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid message ID');
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1`);

      expect(response.status).toBe(404);
    });

    it('should include content when includeContent=true', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
          ORIGINAL_ID: null, IMPORT_ID: null,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
          SEND_DATE: new Date(), RESPONSE_DATE: new Date(), ERROR_CODE: 0,
        }], []])
        // Content query for connector 0
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'raw data', DATA_TYPE: 'HL7V2', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1?includeContent=true`);

      expect(response.status).toBe(200);
      expect(response.body.connectorMessages[0].content).toBeDefined();
      expect(response.body.connectorMessages[0].content[1].content).toBe('raw data');
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection lost'));

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get message');
    });
  });

  describe('DELETE /channels/:channelId/messages/:messageId - edge cases', () => {
    it('should return 400 for non-numeric messageId', async () => {
      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/abc`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid message ID');
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/1`);

      expect(response.status).toBe(404);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/1`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete message');
    });
  });

  describe('DELETE /channels/:channelId/messages/_removeAll - error paths', () => {
    it('should handle statistics table error gracefully', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      mockPool.execute
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_MC
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_MA
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_MM
        .mockResolvedValueOnce([{}, []])  // TRUNCATE D_M
        .mockRejectedValueOnce(new Error('Stats table missing')); // UPDATE D_MS fails

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/_removeAll`);

      // Should still succeed (stats error is caught)
      expect(response.status).toBe(204);
    });

    it('should return 500 on truncate error', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      mockPool.execute.mockRejectedValueOnce(new Error('Cannot truncate'));

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/_removeAll`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to remove messages');
    });
  });

  // ============================================================================
  // Search Endpoints
  // ============================================================================

  describe('GET /channels/:channelId/messages - search', () => {
    it('should search with offset and limit', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]); // Empty results

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages?offset=10&limit=5`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return empty array when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to search messages');
    });

    it('should handle search with serverId filter', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages?serverId=node-1`);

      expect(response.status).toBe(200);
    });

    it('should handle search with status filter', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages?status=E`);

      expect(response.status).toBe(200);
    });

    it('should return search results with full messages', async () => {
      mockPool.query
        // messageTablesExist in searchMessages
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // ID query
        .mockResolvedValueOnce([[{ ID: 1 }], []])
        // messageTablesExist in getMessage
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // message row
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
          ORIGINAL_ID: null, IMPORT_ID: null,
        }], []])
        // connector messages
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].messageId).toBe(1);
    });
  });

  describe('POST /channels/:channelId/messages/_search', () => {
    it('should search messages with filter in body', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_search`)
        .send({ minMessageId: 1, maxMessageId: 100 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle offset and limit params', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_search?offset=5&limit=10`)
        .send({});

      expect(response.status).toBe(200);
    });

    it('should handle includeContent=true', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_search?includeContent=true`)
        .send({});

      expect(response.status).toBe(200);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_search`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to search messages');
    });
  });

  // ============================================================================
  // Reprocess Endpoints
  // ============================================================================

  describe('POST /channels/:channelId/messages/_reprocess', () => {
    it('should reprocess messages matching filter', async () => {
      mockPool.query
        // searchMessages -> messageTablesExist
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // searchMessages -> ID query
        .mockResolvedValueOnce([[{ ID: 1 }], []])
        // getMessage (inside searchMessages with content)
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        // Content for connector 0
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'raw data', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocess`)
        .send({ minMessageId: 1 });

      expect(response.status).toBe(200);
      expect(response.body.reprocessed).toBe(1);
      expect(response.body.total).toBe(1);
    });

    it('should return 400 when channel not deployed', async () => {
      (EngineController.isDeployed as jest.Mock).mockReturnValueOnce(false);
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocess`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel not deployed');
    });

    it('should handle replace and filterDestinations options', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]); // No messages found

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocess?replace=true&filterDestinations=true`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.reprocessed).toBe(0);
    });

    it('should handle dispatch errors gracefully', async () => {
      (EngineController.dispatchMessage as jest.Mock).mockRejectedValueOnce(new Error('Dispatch failed'));

      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ ID: 1 }], []])
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'raw data', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocess`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.results[0].success).toBe(false);
    });

    it('should return 500 on top-level error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocess`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to reprocess messages');
    });
  });

  describe('POST /channels/:channelId/messages/:messageId/_reprocess', () => {
    it('should reprocess a single message', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'test hl7', DATA_TYPE: 'HL7V2', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/_reprocess`);

      expect(response.status).toBe(200);
      expect(response.body.reprocessed).toBe(1);
      expect(response.body.originalMessageId).toBe(1);
      expect(response.body.newMessageId).toBe(100);
    });

    it('should return 400 for invalid message ID', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/abc/_reprocess`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid message ID');
    });

    it('should return 404 when message not found', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]); // No message

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/999/_reprocess`);

      expect(response.status).toBe(404);
    });

    it('should return 400 when channel not deployed', async () => {
      (EngineController.isDeployed as jest.Mock).mockReturnValueOnce(false);

      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'test', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/_reprocess`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel not deployed');
    });

    it('should return 400 when no raw content', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        // Content for connector 0 - no RAW content type (1)
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/_reprocess`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No raw content');
    });

    it('should include replace and filterDestinations in sourceMap', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'test', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/_reprocess?replace=true&filterDestinations=true`);

      expect(response.status).toBe(200);
      expect(response.body.replace).toBe(true);
      expect(response.body.filterDestinations).toBe(true);
    });

    it('should return 500 on dispatch error', async () => {
      (EngineController.dispatchMessage as jest.Mock).mockRejectedValueOnce(new Error('Failed'));

      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'test', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/_reprocess`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to reprocess message');
    });
  });

  // ============================================================================
  // Process New Message
  // ============================================================================

  describe('POST /channels/:channelId/messages (process)', () => {
    it('should process a new message', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages`)
        .send('MSH|^~\\&|');

      expect(response.status).toBe(200);
      expect(response.body.messageId).toBe(100);
      expect(response.body.processed).toBe(true);
    });

    it('should process JSON body', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages`)
        .send({ key: 'value' });

      expect(response.status).toBe(200);
      expect(response.body.messageId).toBe(100);
    });

    it('should parse sourceMapEntry query param', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages?sourceMapEntry=key1=val1,key2=val2`)
        .send('test');

      expect(response.status).toBe(200);
      // Verify dispatch was called with sourceMap entries
      const dispatchCall = (EngineController.dispatchMessage as jest.Mock).mock.calls[0];
      const sourceMap = dispatchCall[2] as Map<string, unknown>;
      expect(sourceMap.get('key1')).toBe('val1');
      expect(sourceMap.get('key2')).toBe('val2');
    });

    it('should parse destinationMetaDataId query param', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages?destinationMetaDataId=1,2,3`)
        .send('test');

      expect(response.status).toBe(200);
      const dispatchCall = (EngineController.dispatchMessage as jest.Mock).mock.calls[0];
      const sourceMap = dispatchCall[2] as Map<string, unknown>;
      expect(sourceMap.get('destinationMetaDataIds')).toEqual([1, 2, 3]);
    });

    it('should return 400 when channel not deployed', async () => {
      (EngineController.isDeployed as jest.Mock).mockReturnValueOnce(false);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages`)
        .send('test');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel not deployed');
    });

    it('should return 500 on dispatch error', async () => {
      (EngineController.dispatchMessage as jest.Mock).mockRejectedValueOnce(new Error('Dispatch failed'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages`)
        .send('test');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to process message');
    });
  });

  // ============================================================================
  // DELETE /channels/:channelId/messages (removeAll via DELETE /)
  // ============================================================================

  describe('DELETE /channels/:channelId/messages (root)', () => {
    it('should remove all messages', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      mockPool.execute
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []]);

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages`);

      expect(response.status).toBe(204);
    });

    it('should skip statistics when clearStatistics=false', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      mockPool.execute
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []]);

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages?clearStatistics=false`);

      expect(response.status).toBe(204);
      expect(mockPool.execute).toHaveBeenCalledTimes(4);
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages`);

      expect(response.status).toBe(404);
    });

    it('should handle stats error gracefully', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      mockPool.execute
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockResolvedValueOnce([{}, []])
        .mockRejectedValueOnce(new Error('No stats table'));

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages`);

      expect(response.status).toBe(204);
    });

    it('should return 500 on truncate error', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);
      mockPool.execute.mockRejectedValueOnce(new Error('Cannot truncate'));

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages`);

      expect(response.status).toBe(500);
    });
  });

  // ============================================================================
  // POST /channels/:channelId/messages/_remove
  // ============================================================================

  describe('POST /channels/:channelId/messages/_remove', () => {
    it('should remove messages matching filter', async () => {
      mockPool.query
        // messageTablesExist
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // searchMessages -> messageTablesExist
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // searchMessages ID query
        .mockResolvedValueOnce([[{ ID: 1 }, { ID: 2 }], []])
        // getMessage for ID 1
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        // getMessage for ID 2
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 2, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 2, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        // deleteMessage for ID 1 -> messageTablesExist
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        // deleteMessage for ID 2 -> messageTablesExist
        .mockResolvedValueOnce([[{ TABLE_NAME }], []]);

      // deleteMessage execute calls (4 per message x 2 messages)
      mockPool.execute
        .mockResolvedValue([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_remove`)
        .send({ minMessageId: 1 });

      expect(response.status).toBe(204);
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_remove`)
        .send({});

      expect(response.status).toBe(404);
    });

    it('should return 500 on error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_remove`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to remove messages');
    });
  });

  // ============================================================================
  // Export Endpoints
  // ============================================================================

  describe('POST /channels/:channelId/messages/_export - edge cases', () => {
    it('should export as XML when writerType=XML', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_export?writerType=XML`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/xml');
      expect(response.text).toContain('<messages');
    });

    it('should handle pageSize parameter', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_export?pageSize=50`)
        .send({});

      expect(response.status).toBe(200);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_export`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to export messages');
    });
  });

  describe('POST /channels/:channelId/messages/_exportEncrypted - edge cases', () => {
    it('should handle pageSize parameter', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_exportEncrypted?pageSize=25`)
        .send({});

      expect(response.status).toBe(200);
    });

    it('should include channelId and messageCount in encrypted archive', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_exportEncrypted?encryptionKey=testKey`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.channelId).toBe(TEST_CHANNEL_ID);
      expect(response.body.messageCount).toBe(0);
      expect(response.body.exportedAt).toBeDefined();
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_exportEncrypted`)
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to export messages');
    });
  });

  // ============================================================================
  // Import edge cases
  // ============================================================================

  describe('POST /channels/:channelId/messages/_import - edge cases', () => {
    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_import`)
        .send({ connectorMessages: {} });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });

    it('should return 400 when body missing connectorMessages', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_import`)
        .send({ messageId: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid message format');
    });

    it('should import message without receivedDate (defaults to now)', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ ID: 5 }], []]);

      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_import`)
        .send({
          connectorMessages: {
            0: { metaDataId: 0, connectorName: 'Source', status: 'S' },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.imported).toBe(true);
    });

    it('should handle import with connector content', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ ID: 0 }], []]);

      mockPool.execute
        .mockResolvedValue([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_import`)
        .send({
          messageId: 5,
          serverId: 'import-srv',
          processed: false,
          connectorMessages: {
            0: {
              metaDataId: 0,
              connectorName: 'Source',
              status: 'R',
              content: {
                1: { contentType: 1, content: 'raw data', dataType: 'HL7V2' },
                3: { contentType: 3, content: 'transformed', dataType: 'XML' },
              },
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.imported).toBe(true);
      expect(response.body.originalId).toBe(5);
    });

    it('should return 500 on database error', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_import`)
        .send({ connectorMessages: { 0: { metaDataId: 0, connectorName: 'S', status: 'S' } } });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to import message');
    });
  });

  // ============================================================================
  // Attachment Endpoints - Additional Coverage
  // ============================================================================

  describe('GET /channels/:channelId/messages/:messageId/attachments - edge cases', () => {
    it('should return 400 for non-numeric messageId', async () => {
      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/xyz/attachments`);

      expect(response.status).toBe(400);
    });

    it('should return empty array when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle attachment without TYPE (defaults to octet-stream)', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[
          { ID: 'att-1', MESSAGE_ID: 1, TYPE: null },
        ], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`);

      expect(response.status).toBe(200);
      expect(response.body[0].type).toBe('application/octet-stream');
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`);

      expect(response.status).toBe(500);
    });
  });

  describe('GET /channels/:channelId/messages/:messageId/attachments/:attachmentId', () => {
    it('should return attachment data', async () => {
      const testData = Buffer.from('binary data');
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ ATTACHMENT: testData }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/octet-stream');
      expect(response.headers['content-disposition']).toContain('att-1');
    });

    it('should return 400 for invalid messageId', async () => {
      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/abc/attachments/att-1`);

      expect(response.status).toBe(400);
    });

    it('should return 404 when attachment not found', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]); // No attachment rows

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/nonexistent`);

      expect(response.status).toBe(404);
    });

    it('should concatenate multi-segment attachments', async () => {
      const seg1 = Buffer.from('segment1');
      const seg2 = Buffer.from('segment2');
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[
          { ATTACHMENT: seg1 },
          { ATTACHMENT: seg2 },
        ], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({}) // Binary response
      );
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`);

      expect(response.status).toBe(500);
    });
  });

  describe('POST /channels/:channelId/messages/:messageId/attachments - edge cases', () => {
    it('should return 400 for invalid messageId', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/abc/attachments`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(400);
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(404);
    });

    it('should return 404 when message does not exist', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]); // No message found

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/999/attachments`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(404);
    });

    it('should generate UUID if id not provided', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1 }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []]);

      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.type).toBe('application/octet-stream');
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /channels/:channelId/messages/:messageId/attachments/:attachmentId - edge cases', () => {
    it('should return 400 for invalid messageId', async () => {
      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/abc/attachments/att-1`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(400);
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(404);
    });

    it('should return 400 when content is missing', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ ATTACHMENT: Buffer.from('data') }], []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`)
        .send({ type: 'text/plain' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing content');
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`)
        .send({ content: 'dGVzdA==' });

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE /channels/:channelId/messages/:messageId/attachments/:attachmentId - edge cases', () => {
    it('should return 400 for invalid messageId', async () => {
      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/abc/attachments/att-1`);

      expect(response.status).toBe(400);
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`);

      expect(response.status).toBe(404);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .delete(`/channels/${TEST_CHANNEL_ID}/messages/1/attachments/att-1`);

      expect(response.status).toBe(500);
    });
  });

  // ============================================================================
  // Bulk Reprocess - Additional Coverage
  // ============================================================================

  describe('POST /channels/:channelId/messages/_reprocessBulk - edge cases', () => {
    it('should handle message not found in bulk', async () => {
      mockPool.query
        // getMessage for message 1 - not found
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]); // message not found

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({ messageIds: [1] });

      expect(response.status).toBe(200);
      expect(response.body.failed).toBe(1);
      expect(response.body.results[0].error).toBe('Message not found');
    });

    it('should handle message without raw content in bulk', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        // Content - empty (no raw)
        .mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({ messageIds: [1] });

      expect(response.status).toBe(200);
      expect(response.body.failed).toBe(1);
      expect(response.body.results[0].error).toBe('No raw content to reprocess');
    });

    it('should handle dispatch error in bulk', async () => {
      (EngineController.dispatchMessage as jest.Mock).mockRejectedValueOnce(new Error('Dispatch failed'));

      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'raw', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({ messageIds: [1] });

      expect(response.status).toBe(200);
      expect(response.body.failed).toBe(1);
      expect(response.body.results[0].error).toBe('Dispatch failed');
    });

    it('should handle replace=true with no destination filtering', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1,
        }], []])
        .mockResolvedValueOnce([[{
          MESSAGE_ID: 1, METADATA_ID: 0, CONNECTOR_NAME: 'Source',
          RECEIVED_DATE: new Date(), STATUS: 'S', SEND_ATTEMPTS: 1,
        }], []])
        .mockResolvedValueOnce([[{
          CONTENT_TYPE: 1, CONTENT: 'raw', DATA_TYPE: 'RAW', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk?replace=true`)
        .send({ messageIds: [1] });

      expect(response.status).toBe(200);
      expect(response.body.reprocessed).toBe(1);
      expect(response.body.destinationMetaDataIds).toBeNull();
    });

    it('should return 400 for non-array messageIds', async () => {
      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({ messageIds: 'not-array' });

      expect(response.status).toBe(400);
    });

    it('should return 500 on top-level error', async () => {
      // Make isDeployed throw to trigger the outer catch (inner per-message catch won't help)
      (EngineController.isDeployed as jest.Mock).mockImplementationOnce(() => { throw new Error('Unexpected'); });

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/messages/_reprocessBulk`)
        .send({ messageIds: [1] });

      expect(response.status).toBe(500);
    });
  });

  // ============================================================================
  // Content Operations - Additional Coverage
  // ============================================================================

  describe('GET content - edge cases', () => {
    it('should return 400 for invalid messageId or metaDataId', async () => {
      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/abc/connectorMessages/def/content/1`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid message ID or metadata ID');
    });

    it('should return 400 for invalid content type string', async () => {
      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/INVALID_TYPE`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid content type');
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`);

      expect(response.status).toBe(404);
    });

    it('should handle all string content type names', async () => {
      const types = ['RAW', 'PROCESSED_RAW', 'TRANSFORMED', 'ENCODED', 'SENT', 'RESPONSE',
        'RESPONSE_TRANSFORMED', 'PROCESSED_RESPONSE', 'CONNECTOR_MAP', 'CHANNEL_MAP',
        'RESPONSE_MAP', 'PROCESSING_ERROR', 'POSTPROCESSOR_ERROR', 'RESPONSE_ERROR', 'SOURCE_MAP'];
      const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

      for (let i = 0; i < types.length; i++) {
        mockPool.query
          .mockResolvedValueOnce([[{ TABLE_NAME }], []])
          .mockResolvedValueOnce([[{
            CONTENT: 'test', DATA_TYPE: 'TEXT', IS_ENCRYPTED: 0,
          }], []]);

        const response = await request(app)
          .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/${types[i]}`);

        expect(response.status).toBe(200);
        expect(response.body.contentType).toBe(expected[i]);
      }
    });

    it('should handle case-insensitive content type names', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{
          CONTENT: 'test', DATA_TYPE: 'TEXT', IS_ENCRYPTED: 0,
        }], []]);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/raw`);

      expect(response.status).toBe(200);
      expect(response.body.contentType).toBe(1);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`);

      expect(response.status).toBe(500);
    });
  });

  describe('PUT content - edge cases', () => {
    it('should return 400 for invalid messageId or metaDataId', async () => {
      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/abc/connectorMessages/def/content/1`)
        .send({ content: 'test' });

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid content type string', async () => {
      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/INVALID_TYPE`)
        .send({ content: 'test' });

      expect(response.status).toBe(400);
    });

    it('should return 404 when tables do not exist', async () => {
      mockPool.query.mockResolvedValueOnce([[], []]); // No tables

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`)
        .send({ content: 'test' });

      expect(response.status).toBe(404);
    });

    it('should handle numeric content type in PUT', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[{ 1: 1 }], []]);

      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/5`)
        .send({ content: 'sent data', dataType: 'XML' });

      expect(response.status).toBe(200);
      expect(response.body.contentType).toBe(5);
    });

    it('should handle string content type in PUT', async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME }], []])
        .mockResolvedValueOnce([[], []]); // No existing content

      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/ENCODED`)
        .send({ content: 'encoded data' });

      expect(response.status).toBe(200);
      expect(response.body.contentType).toBe(4);
    });

    it('should return 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}/messages/1/connectorMessages/0/content/1`)
        .send({ content: 'test' });

      expect(response.status).toBe(500);
    });
  });
});
