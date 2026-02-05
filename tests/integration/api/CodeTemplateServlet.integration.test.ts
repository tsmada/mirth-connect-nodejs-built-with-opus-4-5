/**
 * CodeTemplateServlet Integration Tests
 *
 * Tests the Code Template API endpoints against a real MySQL database.
 * Run with: npm run docker:up && npm test -- --testPathPattern=integration
 */

import { initPool, closePool, getPool } from '../../../src/db/pool';
import * as MirthDao from '../../../src/db/MirthDao';

// Check if DB is available
const isDbAvailable = async (): Promise<boolean> => {
  try {
    initPool({
      host: process.env['DB_HOST'] ?? 'localhost',
      port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
      database: process.env['DB_NAME'] ?? 'mirthdb',
      user: process.env['DB_USER'] ?? 'mirth',
      password: process.env['DB_PASSWORD'] ?? 'mirth',
    });
    const pool = getPool();
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

describe('CodeTemplateServlet Integration Tests', () => {
  let dbAvailable = false;
  const TEST_TEMPLATE_ID = 'test-template-' + Date.now();
  const TEST_LIBRARY_ID = 'test-library-' + Date.now();

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) {
      console.warn('Database not available, skipping integration tests');
      return;
    }
    await MirthDao.initializeSchema();
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Clean up test data
      const pool = getPool();
      try {
        await pool.query("DELETE FROM CODE_TEMPLATE WHERE ID LIKE 'test-%'");
        await pool.query("DELETE FROM CODE_TEMPLATE_LIBRARY WHERE ID LIKE 'test-%'");
      } catch {
        // Ignore
      }
      await closePool();
    }
  });

  describe('Code Template CRUD', () => {
    it('should create a code template', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const template = {
        id: TEST_TEMPLATE_ID,
        name: 'Test Helper Function',
        code: `function testHelper() {
  return "Hello from helper!";
}`,
        type: 'FUNCTION',
        description: 'A test helper function',
      };

      await MirthDao.upsertCodeTemplate(
        template.id,
        template.name,
        JSON.stringify(template),
        1
      );

      const retrieved = await MirthDao.getCodeTemplateById(TEST_TEMPLATE_ID);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.NAME).toBe('Test Helper Function');
    });

    it('should update a code template', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const updatedTemplate = {
        id: TEST_TEMPLATE_ID,
        name: 'Updated Helper Function',
        code: `function testHelper() {
  return "Updated!";
}`,
        type: 'FUNCTION',
        description: 'Updated description',
      };

      await MirthDao.upsertCodeTemplate(
        updatedTemplate.id,
        updatedTemplate.name,
        JSON.stringify(updatedTemplate),
        2
      );

      const retrieved = await MirthDao.getCodeTemplateById(TEST_TEMPLATE_ID);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.NAME).toBe('Updated Helper Function');
      expect(retrieved?.REVISION).toBe(2);
    });

    it('should delete a code template', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Create a template to delete
      const deleteId = 'test-delete-' + Date.now();
      await MirthDao.upsertCodeTemplate(
        deleteId,
        'To Delete',
        '{}',
        1
      );

      // Delete it
      await MirthDao.deleteCodeTemplate(deleteId);

      // Verify deletion
      const retrieved = await MirthDao.getCodeTemplateById(deleteId);
      expect(retrieved).toBeNull();
    });
  });

  describe('Code Template Library CRUD', () => {
    it('should create a code template library', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const library = {
        id: TEST_LIBRARY_ID,
        name: 'Test Library',
        description: 'A test code template library',
        includeNewChannels: true,
        enabledChannelIds: [],
        disabledChannelIds: [],
        codeTemplates: [],
      };

      await MirthDao.upsertCodeTemplateLibrary(
        library.id,
        library.name,
        JSON.stringify(library),
        1
      );

      const retrieved = await MirthDao.getCodeTemplateLibraryById(TEST_LIBRARY_ID);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.NAME).toBe('Test Library');
    });

    it('should list all code template libraries', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const libraries = await MirthDao.getCodeTemplateLibraries();

      expect(Array.isArray(libraries)).toBe(true);
      expect(libraries.some((lib) => lib.ID === TEST_LIBRARY_ID)).toBe(true);
    });

    it('should associate template with library', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Update library with template reference
      const library = {
        id: TEST_LIBRARY_ID,
        name: 'Test Library',
        description: 'Updated with templates',
        codeTemplates: [TEST_TEMPLATE_ID],
      };

      await MirthDao.upsertCodeTemplateLibrary(
        library.id,
        library.name,
        JSON.stringify(library),
        2
      );

      const retrieved = await MirthDao.getCodeTemplateLibraryById(TEST_LIBRARY_ID);
      const data = JSON.parse(retrieved?.LIBRARY || '{}');

      expect(data.codeTemplates).toContain(TEST_TEMPLATE_ID);
    });
  });
});
