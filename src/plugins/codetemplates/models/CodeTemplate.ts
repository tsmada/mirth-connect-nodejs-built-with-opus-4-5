/**
 * Code Template Model
 *
 * Represents a reusable code template that can be injected into scripts.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/codetemplates/CodeTemplate.java
 */

import { v4 as uuidv4 } from 'uuid';
import { CodeTemplateContextSet } from './CodeTemplateContextSet.js';
import { ContextType } from './ContextType.js';
import {
  CodeTemplateProperties,
  CodeTemplateType,
  CodeTemplateFunctionDefinition,
  parseFunctionDefinition,
  isAddToScripts,
} from './CodeTemplateProperties.js';

/**
 * Default code for new code templates
 */
export const DEFAULT_CODE_TEMPLATE = `/**
\tModify the description here. Modify the function name and parameters as needed. One function per
\ttemplate is recommended; create a new code template for each new function.

\t@param {String} arg1 - arg1 description
\t@return {String} return description
*/
function new_function1(arg1) {
\t// TODO: Enter code here
}`;

/**
 * Code Template interface
 */
export interface CodeTemplate {
  id: string;
  name: string;
  revision?: number;
  lastModified?: Date;
  contextSet: ContextType[];
  properties: CodeTemplateProperties;
}

/**
 * Code Template Summary for caching
 */
export interface CodeTemplateSummary {
  id: string;
  name: string;
  revision?: number;
  lastModified?: Date;
  deleted?: boolean;
  codeTemplate?: CodeTemplate; // Only included if revision changed
}

/**
 * Create a new code template with default values
 */
export function createCodeTemplate(name: string): CodeTemplate {
  return {
    id: uuidv4(),
    name,
    revision: 1,
    lastModified: new Date(),
    contextSet: CodeTemplateContextSet.getConnectorContextSet().toArray(),
    properties: {
      type: CodeTemplateType.FUNCTION,
      code: DEFAULT_CODE_TEMPLATE,
    },
  };
}

/**
 * Create a code template with custom properties
 */
export function createCodeTemplateWithProps(
  name: string,
  type: CodeTemplateType,
  contextSet: CodeTemplateContextSet,
  code: string,
  description?: string
): CodeTemplate {
  let finalCode = code;
  if (description) {
    finalCode = addDescription(code, description);
  }

  return {
    id: uuidv4(),
    name,
    revision: 1,
    lastModified: new Date(),
    contextSet: contextSet.toArray(),
    properties: {
      type,
      code: finalCode,
      description,
    },
  };
}

/**
 * Clone a code template
 */
export function cloneCodeTemplate(template: CodeTemplate): CodeTemplate {
  return {
    ...template,
    contextSet: [...template.contextSet],
    properties: { ...template.properties },
  };
}

/**
 * Get code from a template
 */
export function getCode(template: CodeTemplate): string {
  return template.properties?.code ?? '';
}

/**
 * Get type from a template
 */
export function getType(template: CodeTemplate): CodeTemplateType {
  return template.properties?.type ?? CodeTemplateType.FUNCTION;
}

/**
 * Get description from a template
 */
export function getDescription(template: CodeTemplate): string | undefined {
  return template.properties?.description;
}

/**
 * Check if template should be added to scripts
 */
export function shouldAddToScripts(template: CodeTemplate): boolean {
  if (!template.properties) {
    return false;
  }
  return isAddToScripts(template.properties.type);
}

/**
 * Get function definition from a template
 */
export function getFunctionDefinition(template: CodeTemplate): CodeTemplateFunctionDefinition | null {
  if (!template.properties?.code) {
    return null;
  }
  return parseFunctionDefinition(template.properties.code);
}

/**
 * Check if template applies to a specific context
 */
export function appliesToContext(template: CodeTemplate, context: ContextType): boolean {
  return template.contextSet.includes(context);
}

/**
 * Add description as JSDoc comment
 */
function addDescription(code: string, description: string): string {
  if (!description.trim()) {
    return code;
  }

  const trimmed = code.trim();
  if (trimmed.startsWith('/**')) {
    // Code already has a documentation block, insert description at start
    const closeIndex = trimmed.indexOf('*/');
    if (closeIndex > 0) {
      const docContent = trimmed.substring(3, closeIndex).trim();
      return `/**\n\t${description}\n\t${docContent}\n*/\n${trimmed.substring(closeIndex + 2).trim()}`;
    }
  }

  // Add a new documentation block
  return `/**\n\t${description}\n*/\n${trimmed}`;
}
