/**
 * Code Template Servlet
 *
 * REST API for code templates and libraries.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/CodeTemplateServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../api/middleware/auth.js';
import { authorize } from '../../api/middleware/authorization.js';
import {
  CODE_TEMPLATE_GET,
  CODE_TEMPLATE_GET_ALL,
  CODE_TEMPLATE_UPDATE,
  CODE_TEMPLATE_REMOVE,
  CODE_TEMPLATE_LIBRARY_GET,
  CODE_TEMPLATE_LIBRARY_GET_ALL,
  CODE_TEMPLATE_LIBRARY_UPDATE,
} from '../../api/middleware/operations.js';
import * as CodeTemplateController from './CodeTemplateController.js';
import { CodeTemplate } from './models/CodeTemplate.js';
import { CodeTemplateLibrary } from './models/CodeTemplateLibrary.js';

export const codeTemplateRouter = Router();

/**
 * Normalize a code template library from XML-parsed body.
 * fast-xml-parser produces structures like:
 *   { codeTemplates: { codeTemplate: [...] }, enabledChannelIds: "" }
 * We need to normalize these to:
 *   { codeTemplates: [...], enabledChannelIds: [] }
 */
/**
 * Normalize a code template from XML-parsed body.
 * Handles contextSet: { delegate: { contextType: [...] } } → [...]
 */
function normalizeTemplate(raw: any): any {
  const t = { ...raw };

  // Normalize contextSet: { delegate: { contextType: [...] } } → [...]
  if (t.contextSet && !Array.isArray(t.contextSet)) {
    const delegate = t.contextSet.delegate;
    if (delegate?.contextType) {
      t.contextSet = Array.isArray(delegate.contextType)
        ? delegate.contextType
        : [delegate.contextType];
    } else {
      t.contextSet = [];
    }
  }
  if (!Array.isArray(t.contextSet)) {
    t.contextSet = [];
  }

  // Normalize includeNewChannels from string to boolean
  if (typeof t.includeNewChannels === 'string') {
    t.includeNewChannels = t.includeNewChannels === 'true';
  }

  return t;
}

function normalizeLibrary(raw: any): CodeTemplateLibrary {
  const lib = { ...raw };

  // Normalize codeTemplates: { codeTemplate: [...] } → [...]
  if (lib.codeTemplates && !Array.isArray(lib.codeTemplates)) {
    const ct = lib.codeTemplates.codeTemplate;
    if (ct == null) {
      lib.codeTemplates = [];
    } else {
      lib.codeTemplates = Array.isArray(ct) ? ct : [ct];
    }
  }
  if (!Array.isArray(lib.codeTemplates)) {
    lib.codeTemplates = [];
  }

  // Normalize each embedded template
  lib.codeTemplates = lib.codeTemplates.map(normalizeTemplate);

  // Normalize enabledChannelIds/disabledChannelIds: empty string → []
  if (!lib.enabledChannelIds || typeof lib.enabledChannelIds === 'string') {
    lib.enabledChannelIds = lib.enabledChannelIds ? [lib.enabledChannelIds] : [];
  }
  if (!lib.disabledChannelIds || typeof lib.disabledChannelIds === 'string') {
    lib.disabledChannelIds = lib.disabledChannelIds ? [lib.disabledChannelIds] : [];
  }

  // Normalize includeNewChannels from string to boolean
  if (typeof lib.includeNewChannels === 'string') {
    lib.includeNewChannels = lib.includeNewChannels === 'true';
  }

  return lib as CodeTemplateLibrary;
}

/**
 * Extract an array of libraries from the XML-parsed body.
 * Handles: raw array, { list: { codeTemplateLibrary: ... } }, or single object.
 */
function extractLibraries(body: any): CodeTemplateLibrary[] {
  let raw: any;

  if (Array.isArray(body)) {
    raw = body;
  } else if (body?.list?.codeTemplateLibrary != null) {
    raw = body.list.codeTemplateLibrary;
    if (!Array.isArray(raw)) raw = [raw];
  } else if (body?.codeTemplateLibrary != null) {
    raw = body.codeTemplateLibrary;
    if (!Array.isArray(raw)) raw = [raw];
  } else if (body?.id) {
    // Single library object
    raw = [body];
  } else {
    return [];
  }

  return raw.map(normalizeLibrary);
}

// All routes require authentication
codeTemplateRouter.use(authMiddleware({ required: true }));

/**
 * GET /codeTemplateLibraries
 * Get all code template libraries or specific ones by ID
 */
codeTemplateRouter.get('/codeTemplateLibraries', authorize({ operation: CODE_TEMPLATE_LIBRARY_GET_ALL }), async (req: Request, res: Response) => {
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
  authorize({ operation: CODE_TEMPLATE_LIBRARY_GET_ALL }),
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
codeTemplateRouter.get('/codeTemplateLibraries/:libraryId', authorize({ operation: CODE_TEMPLATE_LIBRARY_GET }), async (req: Request, res: Response) => {
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
codeTemplateRouter.put('/codeTemplateLibraries', authorize({ operation: CODE_TEMPLATE_LIBRARY_UPDATE }), async (req: Request, res: Response) => {
  try {
    const libraries = extractLibraries(req.body);
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
codeTemplateRouter.get('/codeTemplates', authorize({ operation: CODE_TEMPLATE_GET_ALL }), async (req: Request, res: Response) => {
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
codeTemplateRouter.post('/codeTemplates/_getCodeTemplates', authorize({ operation: CODE_TEMPLATE_GET_ALL }), async (req: Request, res: Response) => {
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
codeTemplateRouter.get('/codeTemplates/:codeTemplateId', authorize({ operation: CODE_TEMPLATE_GET }), async (req: Request, res: Response) => {
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
codeTemplateRouter.post('/codeTemplates/_getSummary', authorize({ operation: CODE_TEMPLATE_GET_ALL }), async (req: Request, res: Response) => {
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
codeTemplateRouter.put('/codeTemplates/:codeTemplateId', authorize({ operation: CODE_TEMPLATE_UPDATE }), async (req: Request, res: Response) => {
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
codeTemplateRouter.delete('/codeTemplates/:codeTemplateId', authorize({ operation: CODE_TEMPLATE_REMOVE }), async (req: Request, res: Response) => {
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
codeTemplateRouter.post('/codeTemplateLibraries/_bulkUpdate', authorize({ operation: CODE_TEMPLATE_LIBRARY_UPDATE }), async (req: Request, res: Response) => {
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
