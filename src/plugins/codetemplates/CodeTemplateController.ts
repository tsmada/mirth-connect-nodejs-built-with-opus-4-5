/**
 * Code Template Controller
 *
 * Business logic for code template management.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/controllers/DefaultCodeTemplateController.java
 */

import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import * as MirthDao from '../../db/MirthDao.js';
import {
  CodeTemplate,
  CodeTemplateSummary,
  createCodeTemplate,
  getCode,
  shouldAddToScripts,
  appliesToContext,
} from './models/CodeTemplate.js';
import {
  CodeTemplateLibrary,
  CodeTemplateLibrarySaveResult,
  createCodeTemplateLibrary,
  getTemplatesForChannel,
} from './models/CodeTemplateLibrary.js';
import { ContextType } from './models/ContextType.js';
import { CodeTemplateType } from './models/CodeTemplateProperties.js';

// In-memory cache for code templates
let codeTemplateCache: Map<string, CodeTemplate> = new Map();
let libraryCache: Map<string, CodeTemplateLibrary> = new Map();
let cacheInitialized = false;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
});

/**
 * Initialize the code template cache from database
 */
export async function initializeCache(): Promise<void> {
  if (cacheInitialized) {
    return;
  }

  try {
    // Load all code templates
    const templateRows = await MirthDao.getCodeTemplates();
    for (const row of templateRows) {
      const template = deserializeCodeTemplate(row.CODE_TEMPLATE);
      if (template) {
        template.id = row.ID;
        template.name = row.NAME;
        template.revision = row.REVISION;
        codeTemplateCache.set(template.id, template);
      }
    }

    // Load all libraries
    const libraryRows = await MirthDao.getCodeTemplateLibraries();
    for (const row of libraryRows) {
      const library = deserializeLibrary(row.LIBRARY);
      if (library) {
        library.id = row.ID;
        library.name = row.NAME;
        library.revision = row.REVISION;
        libraryCache.set(library.id, library);
      }
    }

    cacheInitialized = true;
  } catch (error) {
    console.error('Failed to initialize code template cache:', error);
    throw error;
  }
}

/**
 * Clear the cache (for testing)
 */
export function clearCache(): void {
  codeTemplateCache.clear();
  libraryCache.clear();
  cacheInitialized = false;
}

/**
 * Get all code templates
 */
export async function getCodeTemplates(templateIds?: Set<string>): Promise<CodeTemplate[]> {
  await initializeCache();

  const templates = Array.from(codeTemplateCache.values());

  if (templateIds && templateIds.size > 0) {
    return templates.filter((t) => templateIds.has(t.id));
  }

  return templates;
}

/**
 * Get a code template by ID
 */
export async function getCodeTemplate(templateId: string): Promise<CodeTemplate | null> {
  await initializeCache();
  return codeTemplateCache.get(templateId) ?? null;
}

/**
 * Get code template summaries for cache synchronization
 */
export async function getCodeTemplateSummary(
  clientRevisions: Map<string, number>
): Promise<CodeTemplateSummary[]> {
  await initializeCache();

  const summaries: CodeTemplateSummary[] = [];
  const serverTemplateIds = new Set(codeTemplateCache.keys());

  // Check for updated/unchanged templates
  for (const [id, template] of codeTemplateCache) {
    const clientRevision = clientRevisions.get(id);

    if (clientRevision === undefined) {
      // New template
      summaries.push({
        id,
        name: template.name,
        revision: template.revision,
        lastModified: template.lastModified,
        codeTemplate: template,
      });
    } else if (clientRevision !== template.revision) {
      // Updated template
      summaries.push({
        id,
        name: template.name,
        revision: template.revision,
        lastModified: template.lastModified,
        codeTemplate: template,
      });
    } else {
      // Unchanged
      summaries.push({
        id,
        name: template.name,
        revision: template.revision,
        lastModified: template.lastModified,
      });
    }
  }

  // Check for deleted templates
  for (const clientId of clientRevisions.keys()) {
    if (!serverTemplateIds.has(clientId)) {
      summaries.push({
        id: clientId,
        name: '',
        deleted: true,
      });
    }
  }

  return summaries;
}

/**
 * Update a code template
 */
export async function updateCodeTemplate(
  templateId: string,
  template: CodeTemplate,
  override: boolean
): Promise<boolean> {
  await initializeCache();

  const existing = codeTemplateCache.get(templateId);

  // Check revision for conflicts
  if (existing && !override && existing.revision !== template.revision) {
    return false;
  }

  // Update revision
  template.id = templateId;
  template.revision = (existing?.revision ?? 0) + 1;
  template.lastModified = new Date();

  // Save to database
  const templateXml = serializeCodeTemplate(template);
  await MirthDao.upsertCodeTemplate(templateId, template.name, templateXml, template.revision);

  // Update cache
  codeTemplateCache.set(templateId, template);

  return true;
}

/**
 * Remove a code template
 */
export async function removeCodeTemplate(templateId: string): Promise<void> {
  await MirthDao.deleteCodeTemplate(templateId);
  codeTemplateCache.delete(templateId);
}

/**
 * Get all code template libraries
 */
export async function getCodeTemplateLibraries(
  libraryIds?: Set<string>,
  includeCodeTemplates: boolean = false
): Promise<CodeTemplateLibrary[]> {
  await initializeCache();

  let libraries = Array.from(libraryCache.values());

  if (libraryIds && libraryIds.size > 0) {
    libraries = libraries.filter((l) => libraryIds.has(l.id));
  }

  // Include full code templates if requested
  if (includeCodeTemplates) {
    return libraries.map((lib) => ({
      ...lib,
      codeTemplates: lib.codeTemplates.map((ct) => {
        const fullTemplate = codeTemplateCache.get(ct.id);
        return fullTemplate ?? ct;
      }),
    }));
  }

  return libraries;
}

/**
 * Get a code template library by ID
 */
export async function getCodeTemplateLibrary(
  libraryId: string,
  includeCodeTemplates: boolean = false
): Promise<CodeTemplateLibrary | null> {
  await initializeCache();

  const library = libraryCache.get(libraryId);
  if (!library) {
    return null;
  }

  if (includeCodeTemplates) {
    return {
      ...library,
      codeTemplates: library.codeTemplates.map((ct) => {
        const fullTemplate = codeTemplateCache.get(ct.id);
        return fullTemplate ?? ct;
      }),
    };
  }

  return library;
}

/**
 * Update all code template libraries
 */
export async function updateCodeTemplateLibraries(
  libraries: CodeTemplateLibrary[],
  override: boolean
): Promise<boolean> {
  await initializeCache();

  // Check revisions if not overriding
  if (!override) {
    for (const library of libraries) {
      const existing = libraryCache.get(library.id);
      if (existing && existing.revision !== library.revision) {
        return false;
      }
    }
  }

  // Get current library IDs to detect deletions
  const currentIds = new Set(libraryCache.keys());
  const newIds = new Set(libraries.map((l) => l.id));

  // Delete removed libraries
  for (const id of currentIds) {
    if (!newIds.has(id)) {
      await MirthDao.deleteCodeTemplateLibrary(id);
      libraryCache.delete(id);
    }
  }

  // Update/add libraries
  for (const library of libraries) {
    const existing = libraryCache.get(library.id);
    library.revision = (existing?.revision ?? 0) + 1;
    library.lastModified = new Date();

    const libraryXml = serializeLibrary(library);
    await MirthDao.upsertCodeTemplateLibrary(library.id, library.name, libraryXml, library.revision);
    libraryCache.set(library.id, library);
  }

  return true;
}

/**
 * Bulk update libraries and templates
 */
export async function updateLibrariesAndTemplates(
  libraries: CodeTemplateLibrary[],
  removedLibraryIds: Set<string>,
  updatedCodeTemplates: CodeTemplate[],
  removedCodeTemplateIds: Set<string>,
  override: boolean
): Promise<CodeTemplateLibrarySaveResult> {
  await initializeCache();

  const result: CodeTemplateLibrarySaveResult = {
    librariesSuccess: true,
    codeTemplatesSuccess: true,
    overrideNeeded: false,
    updatedLibraries: [],
    updatedCodeTemplates: [],
  };

  // Check for revision conflicts
  if (!override) {
    for (const library of libraries) {
      const existing = libraryCache.get(library.id);
      if (existing && existing.revision !== library.revision) {
        result.overrideNeeded = true;
        result.librariesSuccess = false;
      }
    }

    for (const template of updatedCodeTemplates) {
      const existing = codeTemplateCache.get(template.id);
      if (existing && existing.revision !== template.revision) {
        result.overrideNeeded = true;
        result.codeTemplatesSuccess = false;
      }
    }

    if (result.overrideNeeded) {
      return result;
    }
  }

  // Remove deleted templates
  for (const id of removedCodeTemplateIds) {
    await removeCodeTemplate(id);
  }

  // Remove deleted libraries
  for (const id of removedLibraryIds) {
    await MirthDao.deleteCodeTemplateLibrary(id);
    libraryCache.delete(id);
  }

  // Update templates
  for (const template of updatedCodeTemplates) {
    const success = await updateCodeTemplate(template.id, template, true);
    if (success) {
      const updated = codeTemplateCache.get(template.id);
      if (updated) {
        result.updatedCodeTemplates.push(updated);
      }
    }
  }

  // Update libraries
  for (const library of libraries) {
    const existing = libraryCache.get(library.id);
    library.revision = (existing?.revision ?? 0) + 1;
    library.lastModified = new Date();

    const libraryXml = serializeLibrary(library);
    await MirthDao.upsertCodeTemplateLibrary(library.id, library.name, libraryXml, library.revision);
    libraryCache.set(library.id, library);
    result.updatedLibraries.push(library);
  }

  return result;
}

/**
 * Get code template scripts for a channel and context
 */
export async function getCodeTemplateScripts(
  channelId: string,
  context: ContextType
): Promise<string[]> {
  await initializeCache();

  const scripts: string[] = [];

  // Get all libraries that apply to this channel
  for (const library of libraryCache.values()) {
    const templates = getTemplatesForChannel(library, channelId);

    for (const templateRef of templates) {
      const template = codeTemplateCache.get(templateRef.id);
      if (template && shouldAddToScripts(template) && appliesToContext(template, context)) {
        scripts.push(getCode(template));
      }
    }
  }

  return scripts;
}

/**
 * Serialize a code template to XML
 */
function serializeCodeTemplate(template: CodeTemplate): string {
  const obj = {
    codeTemplate: {
      '@_version': '3.9.0',
      id: template.id,
      name: template.name,
      revision: template.revision,
      lastModified: template.lastModified?.toISOString() ?? new Date().toISOString(),
      contextSet: {
        delegate: {
          contextType: template.contextSet,
        },
      },
      properties: {
        '@_class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties',
        type: template.properties.type,
        code: template.properties.code,
      },
    },
  };

  return xmlBuilder.build(obj);
}

/**
 * Deserialize a code template from XML
 */
function deserializeCodeTemplate(xml: string): CodeTemplate | null {
  try {
    const parsed = xmlParser.parse(xml);
    const ct = parsed.codeTemplate;

    if (!ct) {
      return null;
    }

    let contextSet: ContextType[] = [];
    if (ct.contextSet?.delegate?.contextType) {
      const contextTypes = ct.contextSet.delegate.contextType;
      contextSet = Array.isArray(contextTypes) ? contextTypes : [contextTypes];
    }

    return {
      id: ct.id ?? '',
      name: ct.name ?? '',
      revision: ct.revision ? parseInt(ct.revision, 10) : 1,
      lastModified: ct.lastModified ? new Date(ct.lastModified) : undefined,
      contextSet,
      properties: {
        type: ct.properties?.type ?? 'FUNCTION',
        code: ct.properties?.code ?? '',
        description: ct.properties?.description,
      },
    };
  } catch (error) {
    console.error('Failed to deserialize code template:', error);
    return null;
  }
}

/**
 * Serialize a library to XML
 */
function serializeLibrary(library: CodeTemplateLibrary): string {
  const obj = {
    codeTemplateLibrary: {
      '@_version': '3.9.0',
      id: library.id,
      name: library.name,
      revision: library.revision,
      lastModified: library.lastModified?.toISOString() ?? new Date().toISOString(),
      description: library.description ?? '',
      includeNewChannels: library.includeNewChannels,
      enabledChannelIds: {
        string: library.enabledChannelIds,
      },
      disabledChannelIds: {
        string: library.disabledChannelIds,
      },
      codeTemplates: {
        codeTemplate: library.codeTemplates.map((ct) => ({
          id: ct.id,
        })),
      },
    },
  };

  return xmlBuilder.build(obj);
}

/**
 * Deserialize a library from XML
 */
function deserializeLibrary(xml: string): CodeTemplateLibrary | null {
  try {
    const parsed = xmlParser.parse(xml);
    const lib = parsed.codeTemplateLibrary;

    if (!lib) {
      return null;
    }

    // Parse enabled channel IDs
    let enabledChannelIds: string[] = [];
    if (lib.enabledChannelIds?.string) {
      const strings = lib.enabledChannelIds.string;
      enabledChannelIds = Array.isArray(strings) ? strings : [strings];
    }

    // Parse disabled channel IDs
    let disabledChannelIds: string[] = [];
    if (lib.disabledChannelIds?.string) {
      const strings = lib.disabledChannelIds.string;
      disabledChannelIds = Array.isArray(strings) ? strings : [strings];
    }

    // Parse code template references
    let codeTemplates: CodeTemplate[] = [];
    if (lib.codeTemplates?.codeTemplate) {
      const templates = lib.codeTemplates.codeTemplate;
      const templateArray = Array.isArray(templates) ? templates : [templates];
      codeTemplates = templateArray.map((ct: { id: string }) => ({
        id: ct.id,
        name: '',
        contextSet: [],
        properties: { type: CodeTemplateType.FUNCTION, code: '' },
      }));
    }

    return {
      id: lib.id ?? '',
      name: lib.name ?? '',
      revision: lib.revision ? parseInt(lib.revision, 10) : 1,
      lastModified: lib.lastModified ? new Date(lib.lastModified) : undefined,
      description: lib.description ?? '',
      includeNewChannels: lib.includeNewChannels === 'true' || lib.includeNewChannels === true,
      enabledChannelIds,
      disabledChannelIds,
      codeTemplates,
    };
  } catch (error) {
    console.error('Failed to deserialize library:', error);
    return null;
  }
}

/**
 * Create a default code template library
 */
export function createDefaultLibrary(name: string): CodeTemplateLibrary {
  return createCodeTemplateLibrary(name);
}

/**
 * Create a default code template
 */
export function createDefaultCodeTemplate(name: string): CodeTemplate {
  return createCodeTemplate(name);
}
