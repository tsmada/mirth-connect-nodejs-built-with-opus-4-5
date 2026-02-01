/**
 * Code Template Library Model
 *
 * A library is a collection of code templates with channel association.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/codetemplates/CodeTemplateLibrary.java
 */

import { v4 as uuidv4 } from 'uuid';
import { CodeTemplate, cloneCodeTemplate } from './CodeTemplate.js';

/**
 * Code Template Library interface
 */
export interface CodeTemplateLibrary {
  id: string;
  name: string;
  revision?: number;
  lastModified?: Date;
  description?: string;
  includeNewChannels: boolean;
  enabledChannelIds: string[];
  disabledChannelIds: string[];
  codeTemplates: CodeTemplate[];
}

/**
 * Result from saving libraries and templates
 */
export interface CodeTemplateLibrarySaveResult {
  librariesSuccess: boolean;
  codeTemplatesSuccess: boolean;
  overrideNeeded: boolean;
  updatedLibraries: CodeTemplateLibrary[];
  updatedCodeTemplates: CodeTemplate[];
}

/**
 * Create a new empty library
 */
export function createCodeTemplateLibrary(name?: string): CodeTemplateLibrary {
  return {
    id: uuidv4(),
    name: name ?? '',
    revision: 1,
    lastModified: new Date(),
    description: '',
    includeNewChannels: false,
    enabledChannelIds: [],
    disabledChannelIds: [],
    codeTemplates: [],
  };
}

/**
 * Clone a library
 */
export function cloneCodeTemplateLibrary(library: CodeTemplateLibrary): CodeTemplateLibrary {
  return {
    ...library,
    enabledChannelIds: [...library.enabledChannelIds],
    disabledChannelIds: [...library.disabledChannelIds],
    codeTemplates: library.codeTemplates.map(cloneCodeTemplate),
  };
}

/**
 * Sort code templates in a library by name
 */
export function sortCodeTemplates(library: CodeTemplateLibrary): void {
  library.codeTemplates.sort((a, b) => {
    if (a.name == null && b.name != null) return -1;
    if (a.name != null && b.name == null) return 1;
    if (a.name == null && b.name == null) return 0;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/**
 * Replace code templates with ID-only references
 * Used when serializing libraries without full template content
 */
export function replaceCodeTemplatesWithIds(library: CodeTemplateLibrary): CodeTemplateLibrary {
  return {
    ...library,
    enabledChannelIds: [...library.enabledChannelIds],
    disabledChannelIds: [...library.disabledChannelIds],
    codeTemplates: library.codeTemplates.map((ct) => ({
      id: ct.id,
      name: '',
      contextSet: [],
      properties: { type: ct.properties.type, code: '' },
    })),
  };
}

/**
 * Check if a library is enabled for a channel
 */
export function isLibraryEnabledForChannel(
  library: CodeTemplateLibrary,
  channelId: string
): boolean {
  // Check disabled list first
  if (library.disabledChannelIds.includes(channelId)) {
    return false;
  }

  // If enabled for new channels and not explicitly disabled, it's enabled
  if (library.includeNewChannels) {
    return true;
  }

  // Otherwise check enabled list
  return library.enabledChannelIds.includes(channelId);
}

/**
 * Get all code templates from a library that are enabled for a channel
 */
export function getTemplatesForChannel(
  library: CodeTemplateLibrary,
  channelId: string
): CodeTemplate[] {
  if (!isLibraryEnabledForChannel(library, channelId)) {
    return [];
  }
  return library.codeTemplates;
}
