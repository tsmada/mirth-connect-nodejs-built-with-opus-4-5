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
  });
});
