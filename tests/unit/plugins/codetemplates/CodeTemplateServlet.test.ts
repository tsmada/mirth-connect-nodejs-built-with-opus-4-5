/**
 * CodeTemplateServlet Unit Tests
 *
 * Tests for code template and library management endpoints including:
 * - GET /codeTemplateLibraries - Get all libraries
 * - POST /codeTemplateLibraries/_getCodeTemplateLibraries - POST alternative for bulk library fetch
 * - GET /codeTemplateLibraries/:libraryId - Get single library
 * - PUT /codeTemplateLibraries - Replace all libraries
 * - GET /codeTemplates - Get all code templates
 * - POST /codeTemplates/_getCodeTemplates - POST alternative for bulk template fetch
 * - GET /codeTemplates/:codeTemplateId - Get single code template
 * - POST /codeTemplates/_getSummary - Get code template summaries
 * - PUT /codeTemplates/:codeTemplateId - Update a code template
 * - DELETE /codeTemplates/:codeTemplateId - Delete a code template
 * - POST /codeTemplateLibraries/_bulkUpdate - Bulk update libraries and templates
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock CodeTemplateController BEFORE importing the servlet
const mockCodeTemplateController = {
  getCodeTemplateLibraries: jest.fn(),
  getCodeTemplateLibrary: jest.fn(),
  updateCodeTemplateLibraries: jest.fn(),
  getCodeTemplates: jest.fn(),
  getCodeTemplate: jest.fn(),
  getCodeTemplateSummary: jest.fn(),
  updateCodeTemplate: jest.fn(),
  removeCodeTemplate: jest.fn(),
  updateLibrariesAndTemplates: jest.fn(),
};

jest.mock('../../../../src/plugins/codetemplates/CodeTemplateController.js', () => mockCodeTemplateController);

// Mock authorization
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  CODE_TEMPLATE_GET: { name: 'getCodeTemplate' },
  CODE_TEMPLATE_GET_ALL: { name: 'getAllCodeTemplates' },
  CODE_TEMPLATE_UPDATE: { name: 'updateCodeTemplate' },
  CODE_TEMPLATE_REMOVE: { name: 'removeCodeTemplate' },
  CODE_TEMPLATE_LIBRARY_GET: { name: 'getCodeTemplateLibrary' },
  CODE_TEMPLATE_LIBRARY_GET_ALL: { name: 'getAllCodeTemplateLibraries' },
  CODE_TEMPLATE_LIBRARY_UPDATE: { name: 'updateCodeTemplateLibrary' },
}));

// Mock auth middleware
jest.mock('../../../../src/api/middleware/auth.js', () => ({
  authMiddleware: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

// Mock multipart form middleware
jest.mock('../../../../src/api/middleware/multipartForm.js', () => ({
  multipartFormMiddleware: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
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
import { codeTemplateRouter } from '../../../../src/plugins/codetemplates/CodeTemplateServlet.js';

// ============================================================================
// Test fixtures
// ============================================================================

const TEST_TEMPLATE_ID = 'ct-1111-2222-3333-444444444444';
const TEST_TEMPLATE_ID_2 = 'ct-5555-6666-7777-888888888888';
const TEST_LIBRARY_ID = 'lib-1111-2222-3333-444444444444';
const TEST_LIBRARY_ID_2 = 'lib-5555-6666-7777-888888888888';

function makeCodeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_TEMPLATE_ID,
    name: 'Test Template',
    revision: 1,
    lastModified: '2026-01-01T00:00:00.000Z',
    contextSet: ['CHANNEL_CONTEXT'],
    properties: {
      type: 'FUNCTION',
      code: 'function test() { return true; }',
    },
    ...overrides,
  };
}

function makeLibrary(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_LIBRARY_ID,
    name: 'Test Library',
    revision: 1,
    lastModified: '2026-01-01T00:00:00.000Z',
    description: 'A test library',
    includeNewChannels: false,
    enabledChannelIds: [],
    disabledChannelIds: [],
    codeTemplates: [{ id: TEST_TEMPLATE_ID, name: 'Test Template' }],
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

  app.use('/api', codeTemplateRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('CodeTemplateServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /codeTemplateLibraries - Get all libraries
  // ==========================================================================

  describe('GET /api/codeTemplateLibraries', () => {
    it('should return all libraries', async () => {
      const libraries = [makeLibrary(), makeLibrary({ id: TEST_LIBRARY_ID_2, name: 'Lib 2' })];
      mockCodeTemplateController.getCodeTemplateLibraries.mockResolvedValueOnce(libraries);

      const response = await request(app).get('/api/codeTemplateLibraries');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(TEST_LIBRARY_ID);
      expect(response.body[1].id).toBe(TEST_LIBRARY_ID_2);
      expect(mockCodeTemplateController.getCodeTemplateLibraries).toHaveBeenCalledWith(
        undefined,
        false
      );
    });

    it('should filter by a single libraryId query parameter', async () => {
      const libraries = [makeLibrary()];
      mockCodeTemplateController.getCodeTemplateLibraries.mockResolvedValueOnce(libraries);

      const response = await request(app).get(
        `/api/codeTemplateLibraries?libraryId=${TEST_LIBRARY_ID}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockCodeTemplateController.getCodeTemplateLibraries).toHaveBeenCalledWith(
        new Set([TEST_LIBRARY_ID]),
        false
      );
    });

    it('should filter by multiple libraryId query parameters', async () => {
      const libraries = [makeLibrary(), makeLibrary({ id: TEST_LIBRARY_ID_2 })];
      mockCodeTemplateController.getCodeTemplateLibraries.mockResolvedValueOnce(libraries);

      const response = await request(app).get(
        `/api/codeTemplateLibraries?libraryId=${TEST_LIBRARY_ID}&libraryId=${TEST_LIBRARY_ID_2}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockCodeTemplateController.getCodeTemplateLibraries).toHaveBeenCalledWith(
        new Set([TEST_LIBRARY_ID, TEST_LIBRARY_ID_2]),
        false
      );
    });

    it('should pass includeCodeTemplates=true when query param is set', async () => {
      mockCodeTemplateController.getCodeTemplateLibraries.mockResolvedValueOnce([]);

      await request(app).get('/api/codeTemplateLibraries?includeCodeTemplates=true');

      expect(mockCodeTemplateController.getCodeTemplateLibraries).toHaveBeenCalledWith(
        undefined,
        true
      );
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.getCodeTemplateLibraries.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app).get('/api/codeTemplateLibraries');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get code template libraries');
    });
  });

  // ==========================================================================
  // POST /codeTemplateLibraries/_getCodeTemplateLibraries
  // ==========================================================================

  describe('POST /api/codeTemplateLibraries/_getCodeTemplateLibraries', () => {
    it('should return libraries by IDs in POST body', async () => {
      const libraries = [makeLibrary()];
      mockCodeTemplateController.getCodeTemplateLibraries.mockResolvedValueOnce(libraries);

      const response = await request(app)
        .post('/api/codeTemplateLibraries/_getCodeTemplateLibraries')
        .send([TEST_LIBRARY_ID]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockCodeTemplateController.getCodeTemplateLibraries).toHaveBeenCalledWith(
        new Set([TEST_LIBRARY_ID]),
        false
      );
    });

    it('should return all libraries when body is not an array', async () => {
      const libraries = [makeLibrary()];
      mockCodeTemplateController.getCodeTemplateLibraries.mockResolvedValueOnce(libraries);

      const response = await request(app)
        .post('/api/codeTemplateLibraries/_getCodeTemplateLibraries')
        .send({});

      expect(response.status).toBe(200);
      expect(mockCodeTemplateController.getCodeTemplateLibraries).toHaveBeenCalledWith(
        undefined,
        false
      );
    });

    it('should pass includeCodeTemplates=true when query param is set', async () => {
      mockCodeTemplateController.getCodeTemplateLibraries.mockResolvedValueOnce([]);

      await request(app)
        .post('/api/codeTemplateLibraries/_getCodeTemplateLibraries?includeCodeTemplates=true')
        .send([TEST_LIBRARY_ID]);

      expect(mockCodeTemplateController.getCodeTemplateLibraries).toHaveBeenCalledWith(
        new Set([TEST_LIBRARY_ID]),
        true
      );
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.getCodeTemplateLibraries.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app)
        .post('/api/codeTemplateLibraries/_getCodeTemplateLibraries')
        .send([TEST_LIBRARY_ID]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get code template libraries');
    });
  });

  // ==========================================================================
  // GET /codeTemplateLibraries/:libraryId - Get single library
  // ==========================================================================

  describe('GET /api/codeTemplateLibraries/:libraryId', () => {
    it('should return a library by ID', async () => {
      const library = makeLibrary();
      mockCodeTemplateController.getCodeTemplateLibrary.mockResolvedValueOnce(library);

      const response = await request(app).get(
        `/api/codeTemplateLibraries/${TEST_LIBRARY_ID}`
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(TEST_LIBRARY_ID);
      expect(response.body.name).toBe('Test Library');
      expect(mockCodeTemplateController.getCodeTemplateLibrary).toHaveBeenCalledWith(
        TEST_LIBRARY_ID,
        false
      );
    });

    it('should pass includeCodeTemplates=true', async () => {
      const library = makeLibrary();
      mockCodeTemplateController.getCodeTemplateLibrary.mockResolvedValueOnce(library);

      await request(app).get(
        `/api/codeTemplateLibraries/${TEST_LIBRARY_ID}?includeCodeTemplates=true`
      );

      expect(mockCodeTemplateController.getCodeTemplateLibrary).toHaveBeenCalledWith(
        TEST_LIBRARY_ID,
        true
      );
    });

    it('should return 404 when library not found', async () => {
      mockCodeTemplateController.getCodeTemplateLibrary.mockResolvedValueOnce(null);

      const response = await request(app).get(
        `/api/codeTemplateLibraries/${TEST_LIBRARY_ID}`
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Library not found');
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.getCodeTemplateLibrary.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app).get(
        `/api/codeTemplateLibraries/${TEST_LIBRARY_ID}`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get code template library');
    });
  });

  // ==========================================================================
  // PUT /codeTemplateLibraries - Replace all libraries
  // ==========================================================================

  describe('PUT /api/codeTemplateLibraries', () => {
    it('should update libraries from array body', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      const libraries = [makeLibrary()];
      const response = await request(app)
        .put('/api/codeTemplateLibraries')
        .send(libraries);

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
      expect(mockCodeTemplateController.updateCodeTemplateLibraries).toHaveBeenCalled();
    });

    it('should handle XML-parsed body with list.codeTemplateLibrary wrapper', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      const response = await request(app)
        .put('/api/codeTemplateLibraries')
        .send({
          list: {
            codeTemplateLibrary: [makeLibrary()],
          },
        });

      expect(response.status).toBe(200);
      expect(mockCodeTemplateController.updateCodeTemplateLibraries).toHaveBeenCalled();
      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries).toHaveLength(1);
    });

    it('should handle XML-parsed body with single codeTemplateLibrary', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      const response = await request(app)
        .put('/api/codeTemplateLibraries')
        .send({
          list: {
            codeTemplateLibrary: makeLibrary(), // single object, not array
          },
        });

      expect(response.status).toBe(200);
      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries).toHaveLength(1);
    });

    it('should handle body with top-level codeTemplateLibrary key', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      const response = await request(app)
        .put('/api/codeTemplateLibraries')
        .send({
          codeTemplateLibrary: [makeLibrary()],
        });

      expect(response.status).toBe(200);
      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries).toHaveLength(1);
    });

    it('should handle single library object with id', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      const response = await request(app)
        .put('/api/codeTemplateLibraries')
        .send(makeLibrary());

      expect(response.status).toBe(200);
      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries).toHaveLength(1);
    });

    it('should return empty array for unrecognized body format', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      const response = await request(app)
        .put('/api/codeTemplateLibraries')
        .send({ something: 'else' });

      expect(response.status).toBe(200);
      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries).toEqual([]);
    });

    it('should pass override=true when query param is set', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      await request(app)
        .put('/api/codeTemplateLibraries?override=true')
        .send([makeLibrary()]);

      expect(mockCodeTemplateController.updateCodeTemplateLibraries).toHaveBeenCalledWith(
        expect.any(Array),
        true
      );
    });

    it('should pass override=false when query param is not set', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValueOnce(true);

      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([makeLibrary()]);

      expect(mockCodeTemplateController.updateCodeTemplateLibraries).toHaveBeenCalledWith(
        expect.any(Array),
        false
      );
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app)
        .put('/api/codeTemplateLibraries')
        .send([makeLibrary()]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update code template libraries');
    });
  });

  // ==========================================================================
  // GET /codeTemplates - Get all code templates
  // ==========================================================================

  describe('GET /api/codeTemplates', () => {
    it('should return all code templates', async () => {
      const templates = [makeCodeTemplate(), makeCodeTemplate({ id: TEST_TEMPLATE_ID_2, name: 'Template 2' })];
      mockCodeTemplateController.getCodeTemplates.mockResolvedValueOnce(templates);

      const response = await request(app).get('/api/codeTemplates');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(TEST_TEMPLATE_ID);
      expect(response.body[1].id).toBe(TEST_TEMPLATE_ID_2);
      expect(mockCodeTemplateController.getCodeTemplates).toHaveBeenCalledWith(undefined);
    });

    it('should filter by a single codeTemplateId query parameter', async () => {
      const templates = [makeCodeTemplate()];
      mockCodeTemplateController.getCodeTemplates.mockResolvedValueOnce(templates);

      const response = await request(app).get(
        `/api/codeTemplates?codeTemplateId=${TEST_TEMPLATE_ID}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockCodeTemplateController.getCodeTemplates).toHaveBeenCalledWith(
        new Set([TEST_TEMPLATE_ID])
      );
    });

    it('should filter by multiple codeTemplateId query parameters', async () => {
      const templates = [makeCodeTemplate(), makeCodeTemplate({ id: TEST_TEMPLATE_ID_2 })];
      mockCodeTemplateController.getCodeTemplates.mockResolvedValueOnce(templates);

      const response = await request(app).get(
        `/api/codeTemplates?codeTemplateId=${TEST_TEMPLATE_ID}&codeTemplateId=${TEST_TEMPLATE_ID_2}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockCodeTemplateController.getCodeTemplates).toHaveBeenCalledWith(
        new Set([TEST_TEMPLATE_ID, TEST_TEMPLATE_ID_2])
      );
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.getCodeTemplates.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/api/codeTemplates');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get code templates');
    });
  });

  // ==========================================================================
  // POST /codeTemplates/_getCodeTemplates
  // ==========================================================================

  describe('POST /api/codeTemplates/_getCodeTemplates', () => {
    it('should return templates by IDs in POST body', async () => {
      const templates = [makeCodeTemplate()];
      mockCodeTemplateController.getCodeTemplates.mockResolvedValueOnce(templates);

      const response = await request(app)
        .post('/api/codeTemplates/_getCodeTemplates')
        .send([TEST_TEMPLATE_ID]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockCodeTemplateController.getCodeTemplates).toHaveBeenCalledWith(
        new Set([TEST_TEMPLATE_ID])
      );
    });

    it('should return all templates when body is not an array', async () => {
      const templates = [makeCodeTemplate()];
      mockCodeTemplateController.getCodeTemplates.mockResolvedValueOnce(templates);

      const response = await request(app)
        .post('/api/codeTemplates/_getCodeTemplates')
        .send({});

      expect(response.status).toBe(200);
      expect(mockCodeTemplateController.getCodeTemplates).toHaveBeenCalledWith(undefined);
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.getCodeTemplates.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/api/codeTemplates/_getCodeTemplates')
        .send([TEST_TEMPLATE_ID]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get code templates');
    });
  });

  // ==========================================================================
  // GET /codeTemplates/:codeTemplateId - Get single code template
  // ==========================================================================

  describe('GET /api/codeTemplates/:codeTemplateId', () => {
    it('should return a code template by ID', async () => {
      const template = makeCodeTemplate();
      mockCodeTemplateController.getCodeTemplate.mockResolvedValueOnce(template);

      const response = await request(app).get(`/api/codeTemplates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(TEST_TEMPLATE_ID);
      expect(response.body.name).toBe('Test Template');
      expect(mockCodeTemplateController.getCodeTemplate).toHaveBeenCalledWith(TEST_TEMPLATE_ID);
    });

    it('should return 404 when code template not found', async () => {
      mockCodeTemplateController.getCodeTemplate.mockResolvedValueOnce(null);

      const response = await request(app).get(`/api/codeTemplates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Code template not found');
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.getCodeTemplate.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get(`/api/codeTemplates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get code template');
    });
  });

  // ==========================================================================
  // POST /codeTemplates/_getSummary - Get code template summaries
  // ==========================================================================

  describe('POST /api/codeTemplates/_getSummary', () => {
    it('should return summaries based on client revisions', async () => {
      const summaries = [
        { id: TEST_TEMPLATE_ID, name: 'Test Template', revision: 2, codeTemplate: makeCodeTemplate({ revision: 2 }) },
        { id: TEST_TEMPLATE_ID_2, name: 'Template 2', revision: 1 },
      ];
      mockCodeTemplateController.getCodeTemplateSummary.mockResolvedValueOnce(summaries);

      const response = await request(app)
        .post('/api/codeTemplates/_getSummary')
        .send({ [TEST_TEMPLATE_ID]: 1, [TEST_TEMPLATE_ID_2]: 1 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockCodeTemplateController.getCodeTemplateSummary).toHaveBeenCalledWith(
        new Map([
          [TEST_TEMPLATE_ID, 1],
          [TEST_TEMPLATE_ID_2, 1],
        ])
      );
    });

    it('should handle empty body as empty revisions map', async () => {
      mockCodeTemplateController.getCodeTemplateSummary.mockResolvedValueOnce([]);

      const response = await request(app)
        .post('/api/codeTemplates/_getSummary')
        .send({});

      expect(response.status).toBe(200);
      expect(mockCodeTemplateController.getCodeTemplateSummary).toHaveBeenCalledWith(new Map());
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.getCodeTemplateSummary.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app)
        .post('/api/codeTemplates/_getSummary')
        .send({ someId: 1 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get code template summary');
    });
  });

  // ==========================================================================
  // PUT /codeTemplates/:codeTemplateId - Update a code template
  // ==========================================================================

  describe('PUT /api/codeTemplates/:codeTemplateId', () => {
    it('should update a code template successfully', async () => {
      mockCodeTemplateController.updateCodeTemplate.mockResolvedValueOnce(true);

      const template = makeCodeTemplate();
      const response = await request(app)
        .put(`/api/codeTemplates/${TEST_TEMPLATE_ID}`)
        .send(template);

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
      expect(mockCodeTemplateController.updateCodeTemplate).toHaveBeenCalledWith(
        TEST_TEMPLATE_ID,
        template,
        false
      );
    });

    it('should pass override=true when query param is set', async () => {
      mockCodeTemplateController.updateCodeTemplate.mockResolvedValueOnce(true);

      await request(app)
        .put(`/api/codeTemplates/${TEST_TEMPLATE_ID}?override=true`)
        .send(makeCodeTemplate());

      expect(mockCodeTemplateController.updateCodeTemplate).toHaveBeenCalledWith(
        TEST_TEMPLATE_ID,
        expect.any(Object),
        true
      );
    });

    it('should return false when revision conflict (controller returns false)', async () => {
      mockCodeTemplateController.updateCodeTemplate.mockResolvedValueOnce(false);

      const response = await request(app)
        .put(`/api/codeTemplates/${TEST_TEMPLATE_ID}`)
        .send(makeCodeTemplate());

      expect(response.status).toBe(200);
      expect(response.body).toBe(false);
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.updateCodeTemplate.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .put(`/api/codeTemplates/${TEST_TEMPLATE_ID}`)
        .send(makeCodeTemplate());

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update code template');
    });
  });

  // ==========================================================================
  // DELETE /codeTemplates/:codeTemplateId - Delete a code template
  // ==========================================================================

  describe('DELETE /api/codeTemplates/:codeTemplateId', () => {
    it('should delete a code template and return 204', async () => {
      mockCodeTemplateController.removeCodeTemplate.mockResolvedValueOnce(undefined);

      const response = await request(app).delete(`/api/codeTemplates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(204);
      expect(mockCodeTemplateController.removeCodeTemplate).toHaveBeenCalledWith(TEST_TEMPLATE_ID);
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.removeCodeTemplate.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).delete(`/api/codeTemplates/${TEST_TEMPLATE_ID}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete code template');
    });
  });

  // ==========================================================================
  // POST /codeTemplateLibraries/_bulkUpdate - Bulk update
  // ==========================================================================

  describe('POST /api/codeTemplateLibraries/_bulkUpdate', () => {
    it('should perform bulk update successfully', async () => {
      const result = {
        librariesSuccess: true,
        codeTemplatesSuccess: true,
        overrideNeeded: false,
        updatedLibraries: [makeLibrary()],
        updatedCodeTemplates: [makeCodeTemplate()],
      };
      mockCodeTemplateController.updateLibrariesAndTemplates.mockResolvedValueOnce(result);

      const response = await request(app)
        .post('/api/codeTemplateLibraries/_bulkUpdate')
        .send({
          libraries: [makeLibrary()],
          removedLibraryIds: [TEST_LIBRARY_ID_2],
          updatedCodeTemplates: [makeCodeTemplate()],
          removedCodeTemplateIds: [TEST_TEMPLATE_ID_2],
        });

      expect(response.status).toBe(200);
      expect(response.body.librariesSuccess).toBe(true);
      expect(response.body.codeTemplatesSuccess).toBe(true);
      expect(mockCodeTemplateController.updateLibrariesAndTemplates).toHaveBeenCalledWith(
        [makeLibrary()],
        new Set([TEST_LIBRARY_ID_2]),
        [makeCodeTemplate()],
        new Set([TEST_TEMPLATE_ID_2]),
        false
      );
    });

    it('should pass override=true when query param is set', async () => {
      const result = {
        librariesSuccess: true,
        codeTemplatesSuccess: true,
        overrideNeeded: false,
        updatedLibraries: [],
        updatedCodeTemplates: [],
      };
      mockCodeTemplateController.updateLibrariesAndTemplates.mockResolvedValueOnce(result);

      await request(app)
        .post('/api/codeTemplateLibraries/_bulkUpdate?override=true')
        .send({
          libraries: [],
          removedLibraryIds: [],
          updatedCodeTemplates: [],
          removedCodeTemplateIds: [],
        });

      expect(mockCodeTemplateController.updateLibrariesAndTemplates).toHaveBeenCalledWith(
        [],
        new Set([]),
        [],
        new Set([]),
        true
      );
    });

    it('should use empty defaults when body fields are missing', async () => {
      const result = {
        librariesSuccess: true,
        codeTemplatesSuccess: true,
        overrideNeeded: false,
        updatedLibraries: [],
        updatedCodeTemplates: [],
      };
      mockCodeTemplateController.updateLibrariesAndTemplates.mockResolvedValueOnce(result);

      const response = await request(app)
        .post('/api/codeTemplateLibraries/_bulkUpdate')
        .send({});

      expect(response.status).toBe(200);
      expect(mockCodeTemplateController.updateLibrariesAndTemplates).toHaveBeenCalledWith(
        [],
        new Set([]),
        [],
        new Set([]),
        false
      );
    });

    it('should return overrideNeeded when revision conflicts exist', async () => {
      const result = {
        librariesSuccess: false,
        codeTemplatesSuccess: false,
        overrideNeeded: true,
        updatedLibraries: [],
        updatedCodeTemplates: [],
      };
      mockCodeTemplateController.updateLibrariesAndTemplates.mockResolvedValueOnce(result);

      const response = await request(app)
        .post('/api/codeTemplateLibraries/_bulkUpdate')
        .send({
          libraries: [makeLibrary()],
          updatedCodeTemplates: [makeCodeTemplate()],
        });

      expect(response.status).toBe(200);
      expect(response.body.overrideNeeded).toBe(true);
      expect(response.body.librariesSuccess).toBe(false);
    });

    it('should return 500 on controller error', async () => {
      mockCodeTemplateController.updateLibrariesAndTemplates.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app)
        .post('/api/codeTemplateLibraries/_bulkUpdate')
        .send({ libraries: [makeLibrary()] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to perform bulk update');
    });
  });

  // ==========================================================================
  // normalizeLibrary / normalizeTemplate / extractLibraries (tested via PUT)
  // ==========================================================================

  describe('Library normalization (via PUT /api/codeTemplateLibraries)', () => {
    beforeEach(() => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValue(true);
    });

    it('should normalize codeTemplates from XML-parsed nested object', async () => {
      // fast-xml-parser produces { codeTemplates: { codeTemplate: [...] } }
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Normalized Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: {
              codeTemplate: [
                { id: TEST_TEMPLATE_ID, name: 'T1', contextSet: [], properties: { type: 'FUNCTION', code: '' } },
              ],
            },
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates).toEqual([
        expect.objectContaining({ id: TEST_TEMPLATE_ID }),
      ]);
      expect(Array.isArray(calledLibraries[0].codeTemplates)).toBe(true);
    });

    it('should normalize codeTemplates from single object (not array)', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Single CT Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: {
              codeTemplate: { id: TEST_TEMPLATE_ID, name: 'T1', contextSet: [], properties: { type: 'FUNCTION', code: '' } },
            },
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates).toHaveLength(1);
    });

    it('should normalize codeTemplates null to empty array', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'No CT Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: { codeTemplate: null },
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates).toEqual([]);
    });

    it('should normalize enabledChannelIds from empty string to empty array', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Empty IDs Lib',
            includeNewChannels: false,
            enabledChannelIds: '',
            disabledChannelIds: '',
            codeTemplates: [],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].enabledChannelIds).toEqual([]);
      expect(calledLibraries[0].disabledChannelIds).toEqual([]);
    });

    it('should normalize enabledChannelIds from single string to array', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Single ID Lib',
            includeNewChannels: false,
            enabledChannelIds: 'channel-1',
            disabledChannelIds: 'channel-2',
            codeTemplates: [],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].enabledChannelIds).toEqual(['channel-1']);
      expect(calledLibraries[0].disabledChannelIds).toEqual(['channel-2']);
    });

    it('should normalize enabledChannelIds from falsy to empty array', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Falsy IDs Lib',
            includeNewChannels: false,
            codeTemplates: [],
            // enabledChannelIds and disabledChannelIds omitted
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].enabledChannelIds).toEqual([]);
      expect(calledLibraries[0].disabledChannelIds).toEqual([]);
    });

    it('should normalize includeNewChannels from string "true" to boolean', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Bool Lib',
            includeNewChannels: 'true',
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: [],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].includeNewChannels).toBe(true);
    });

    it('should normalize includeNewChannels from string "false" to boolean', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Bool Lib',
            includeNewChannels: 'false',
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: [],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].includeNewChannels).toBe(false);
    });

    it('should normalize embedded template contextSet from delegate object', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Context Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: [
              {
                id: TEST_TEMPLATE_ID,
                name: 'T1',
                contextSet: {
                  delegate: {
                    contextType: ['CHANNEL_CONTEXT', 'GLOBAL_CONTEXT'],
                  },
                },
                properties: { type: 'FUNCTION', code: '' },
              },
            ],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates[0].contextSet).toEqual([
        'CHANNEL_CONTEXT',
        'GLOBAL_CONTEXT',
      ]);
    });

    it('should normalize embedded template contextSet from single delegate contextType', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Single Context Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: [
              {
                id: TEST_TEMPLATE_ID,
                name: 'T1',
                contextSet: {
                  delegate: {
                    contextType: 'CHANNEL_CONTEXT',
                  },
                },
                properties: { type: 'FUNCTION', code: '' },
              },
            ],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates[0].contextSet).toEqual(['CHANNEL_CONTEXT']);
    });

    it('should normalize embedded template contextSet with missing delegate', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'No Delegate Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: [
              {
                id: TEST_TEMPLATE_ID,
                name: 'T1',
                contextSet: { delegate: {} },
                properties: { type: 'FUNCTION', code: '' },
              },
            ],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates[0].contextSet).toEqual([]);
    });

    it('should normalize embedded template contextSet from non-object to empty array', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Invalid Context Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: [
              {
                id: TEST_TEMPLATE_ID,
                name: 'T1',
                contextSet: 'invalid',
                properties: { type: 'FUNCTION', code: '' },
              },
            ],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates[0].contextSet).toEqual([]);
    });

    it('should normalize embedded template includeNewChannels from string to boolean', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Template Bool Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: [
              {
                id: TEST_TEMPLATE_ID,
                name: 'T1',
                contextSet: [],
                includeNewChannels: 'true',
                properties: { type: 'FUNCTION', code: '' },
              },
            ],
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates[0].includeNewChannels).toBe(true);
    });

    it('should handle codeTemplates that is not an object or array', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'Numeric CT Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            codeTemplates: 42,
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates).toEqual([]);
    });

    it('should normalize missing codeTemplates (undefined) to empty array', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send([
          {
            id: TEST_LIBRARY_ID,
            name: 'No CT Field Lib',
            includeNewChannels: false,
            enabledChannelIds: [],
            disabledChannelIds: [],
            // codeTemplates deliberately omitted
          },
        ]);

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries[0].codeTemplates).toEqual([]);
    });
  });

  // ==========================================================================
  // extractLibraries edge cases (via PUT /api/codeTemplateLibraries)
  // ==========================================================================

  describe('extractLibraries edge cases (via PUT /api/codeTemplateLibraries)', () => {
    beforeEach(() => {
      mockCodeTemplateController.updateCodeTemplateLibraries.mockResolvedValue(true);
    });

    it('should handle top-level codeTemplateLibrary with single object', async () => {
      await request(app)
        .put('/api/codeTemplateLibraries')
        .send({
          codeTemplateLibrary: makeLibrary(),
        });

      const calledLibraries = mockCodeTemplateController.updateCodeTemplateLibraries.mock.calls[0][0];
      expect(calledLibraries).toHaveLength(1);
      expect(calledLibraries[0].id).toBe(TEST_LIBRARY_ID);
    });
  });
});
