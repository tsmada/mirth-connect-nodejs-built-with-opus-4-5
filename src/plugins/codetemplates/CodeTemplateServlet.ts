/**
 * Code Template Servlet
 *
 * REST API for code templates and libraries.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/CodeTemplateServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../api/middleware/auth.js';
import * as CodeTemplateController from './CodeTemplateController.js';
import { CodeTemplate } from './models/CodeTemplate.js';
import { CodeTemplateLibrary } from './models/CodeTemplateLibrary.js';

export const codeTemplateRouter = Router();

// All routes require authentication
codeTemplateRouter.use(authMiddleware({ required: true }));

/**
 * GET /codeTemplateLibraries
 * Get all code template libraries or specific ones by ID
 */
codeTemplateRouter.get('/codeTemplateLibraries', async (req: Request, res: Response) => {
  try {
    const libraryIdParam = req.query.libraryId;
    const includeCodeTemplates = req.query.includeCodeTemplates === 'true';

    let libraryIds: Set<string> | undefined;
    if (libraryIdParam) {
      libraryIds = new Set(
        Array.isArray(libraryIdParam) ? (libraryIdParam as string[]) : [libraryIdParam as string]
      );
    }

    const libraries = await CodeTemplateController.getCodeTemplateLibraries(
      libraryIds,
      includeCodeTemplates
    );
    res.sendData(libraries);
  } catch (error) {
    console.error('Get code template libraries error:', error);
    res.status(500).json({ error: 'Failed to get code template libraries' });
  }
});

/**
 * POST /codeTemplateLibraries/_getCodeTemplateLibraries
 * Get libraries by ID (POST alternative for many IDs)
 */
codeTemplateRouter.post(
  '/codeTemplateLibraries/_getCodeTemplateLibraries',
  async (req: Request, res: Response) => {
    try {
      const libraryIds = req.body;
      const includeCodeTemplates = req.query.includeCodeTemplates === 'true';

      let libraryIdSet: Set<string> | undefined;
      if (Array.isArray(libraryIds)) {
        libraryIdSet = new Set(libraryIds as string[]);
      }

      const libraries = await CodeTemplateController.getCodeTemplateLibraries(
        libraryIdSet,
        includeCodeTemplates
      );
      res.sendData(libraries);
    } catch (error) {
      console.error('Get code template libraries error:', error);
      res.status(500).json({ error: 'Failed to get code template libraries' });
    }
  }
);

/**
 * GET /codeTemplateLibraries/:libraryId
 * Get a single code template library
 */
codeTemplateRouter.get('/codeTemplateLibraries/:libraryId', async (req: Request, res: Response) => {
  try {
    const libraryId = req.params.libraryId as string;
    const includeCodeTemplates = req.query.includeCodeTemplates === 'true';

    const library = await CodeTemplateController.getCodeTemplateLibrary(
      libraryId,
      includeCodeTemplates
    );

    if (!library) {
      res.status(404).json({ error: 'Library not found' });
      return;
    }

    res.sendData(library);
  } catch (error) {
    console.error('Get code template library error:', error);
    res.status(500).json({ error: 'Failed to get code template library' });
  }
});

/**
 * PUT /codeTemplateLibraries
 * Replace all code template libraries
 */
codeTemplateRouter.put('/codeTemplateLibraries', async (req: Request, res: Response) => {
  try {
    const libraries: CodeTemplateLibrary[] = req.body;
    const override = req.query.override === 'true';

    const success = await CodeTemplateController.updateCodeTemplateLibraries(libraries, override);
    res.sendData(success);
  } catch (error) {
    console.error('Update code template libraries error:', error);
    res.status(500).json({ error: 'Failed to update code template libraries' });
  }
});

/**
 * GET /codeTemplates
 * Get all code templates or specific ones by ID
 */
codeTemplateRouter.get('/codeTemplates', async (req: Request, res: Response) => {
  try {
    const codeTemplateIdParam = req.query.codeTemplateId;

    let templateIds: Set<string> | undefined;
    if (codeTemplateIdParam) {
      templateIds = new Set(
        Array.isArray(codeTemplateIdParam)
          ? (codeTemplateIdParam as string[])
          : [codeTemplateIdParam as string]
      );
    }

    const templates = await CodeTemplateController.getCodeTemplates(templateIds);
    res.sendData(templates);
  } catch (error) {
    console.error('Get code templates error:', error);
    res.status(500).json({ error: 'Failed to get code templates' });
  }
});

/**
 * POST /codeTemplates/_getCodeTemplates
 * Get code templates by ID (POST alternative for many IDs)
 */
codeTemplateRouter.post('/codeTemplates/_getCodeTemplates', async (req: Request, res: Response) => {
  try {
    const templateIds = req.body;

    let templateIdSet: Set<string> | undefined;
    if (Array.isArray(templateIds)) {
      templateIdSet = new Set(templateIds as string[]);
    }

    const templates = await CodeTemplateController.getCodeTemplates(templateIdSet);
    res.sendData(templates);
  } catch (error) {
    console.error('Get code templates error:', error);
    res.status(500).json({ error: 'Failed to get code templates' });
  }
});

/**
 * GET /codeTemplates/:codeTemplateId
 * Get a single code template
 */
codeTemplateRouter.get('/codeTemplates/:codeTemplateId', async (req: Request, res: Response) => {
  try {
    const codeTemplateId = req.params.codeTemplateId as string;

    const template = await CodeTemplateController.getCodeTemplate(codeTemplateId);

    if (!template) {
      res.status(404).json({ error: 'Code template not found' });
      return;
    }

    res.sendData(template);
  } catch (error) {
    console.error('Get code template error:', error);
    res.status(500).json({ error: 'Failed to get code template' });
  }
});

/**
 * POST /codeTemplates/_getSummary
 * Get code template summaries for cache sync
 */
codeTemplateRouter.post('/codeTemplates/_getSummary', async (req: Request, res: Response) => {
  try {
    const clientRevisions: Record<string, number> = req.body || {};
    const revisionMap = new Map(Object.entries(clientRevisions));

    const summaries = await CodeTemplateController.getCodeTemplateSummary(revisionMap);
    res.sendData(summaries);
  } catch (error) {
    console.error('Get code template summary error:', error);
    res.status(500).json({ error: 'Failed to get code template summary' });
  }
});

/**
 * PUT /codeTemplates/:codeTemplateId
 * Update a single code template
 */
codeTemplateRouter.put('/codeTemplates/:codeTemplateId', async (req: Request, res: Response) => {
  try {
    const codeTemplateId = req.params.codeTemplateId as string;
    const template: CodeTemplate = req.body;
    const override = req.query.override === 'true';

    const success = await CodeTemplateController.updateCodeTemplate(
      codeTemplateId,
      template,
      override
    );
    res.sendData(success);
  } catch (error) {
    console.error('Update code template error:', error);
    res.status(500).json({ error: 'Failed to update code template' });
  }
});

/**
 * DELETE /codeTemplates/:codeTemplateId
 * Delete a single code template
 */
codeTemplateRouter.delete('/codeTemplates/:codeTemplateId', async (req: Request, res: Response) => {
  try {
    const codeTemplateId = req.params.codeTemplateId as string;

    await CodeTemplateController.removeCodeTemplate(codeTemplateId);
    res.status(204).end();
  } catch (error) {
    console.error('Delete code template error:', error);
    res.status(500).json({ error: 'Failed to delete code template' });
  }
});

/**
 * POST /codeTemplateLibraries/_bulkUpdate
 * Update all libraries and templates in one request
 */
codeTemplateRouter.post('/codeTemplateLibraries/_bulkUpdate', async (req: Request, res: Response) => {
  try {
    const {
      libraries = [],
      removedLibraryIds = [],
      updatedCodeTemplates = [],
      removedCodeTemplateIds = [],
    } = req.body;
    const override = req.query.override === 'true';

    const result = await CodeTemplateController.updateLibrariesAndTemplates(
      libraries as CodeTemplateLibrary[],
      new Set(removedLibraryIds as string[]),
      updatedCodeTemplates as CodeTemplate[],
      new Set(removedCodeTemplateIds as string[]),
      override
    );

    res.sendData(result);
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({ error: 'Failed to perform bulk update' });
  }
});
