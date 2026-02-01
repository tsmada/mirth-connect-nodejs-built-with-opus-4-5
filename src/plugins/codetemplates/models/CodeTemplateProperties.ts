/**
 * Code Template Properties
 *
 * Properties for a code template including type and code content.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/codetemplates/CodeTemplateProperties.java
 * and ~/Projects/connect/server/src/com/mirth/connect/model/codetemplates/BasicCodeTemplateProperties.java
 */

/**
 * Code template types
 */
export enum CodeTemplateType {
  FUNCTION = 'FUNCTION',
  DRAG_AND_DROP_CODE = 'DRAG_AND_DROP_CODE',
  COMPILED_CODE = 'COMPILED_CODE',
}

/**
 * Function parameter definition
 */
export interface CodeTemplateParameter {
  name: string;
  type?: string;
  description?: string;
}

/**
 * Function definition extracted from code template
 */
export interface CodeTemplateFunctionDefinition {
  name: string;
  parameters: CodeTemplateParameter[];
  returnType?: string;
  returnDescription?: string;
}

/**
 * Code template properties
 */
export interface CodeTemplateProperties {
  type: CodeTemplateType;
  code: string;
  description?: string;
}

/**
 * Create basic code template properties
 */
export function createCodeTemplateProperties(
  type: CodeTemplateType,
  code: string,
  description?: string
): CodeTemplateProperties {
  if (description) {
    code = addDocComment(code, description);
  }
  return { type, code, description };
}

/**
 * Add a JSDoc comment to code
 */
function addDocComment(code: string, description: string): string {
  if (!description.trim()) {
    return code;
  }

  // Wrap description at 80 chars
  const wrapped = wrapText(description, 80);
  return `/**\n\t${wrapped}\n*/\n${code}`;
}

/**
 * Wrap text at specified width
 */
function wrapText(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join('\n\t');
}

/**
 * Parse function definition from code template
 */
export function parseFunctionDefinition(code: string): CodeTemplateFunctionDefinition | null {
  // Match function declaration: function name(params) or async function name(params)
  const funcMatch = code.match(/(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
  if (!funcMatch || !funcMatch[1]) {
    return null;
  }

  const name = funcMatch[1];
  const paramString = (funcMatch[2] ?? '').trim();

  // Parse parameters
  const parameters: CodeTemplateParameter[] = [];
  if (paramString) {
    const paramParts = paramString.split(',').map((p) => p.trim());
    for (const param of paramParts) {
      const paramName = param.replace(/\s*=\s*.*$/, '').trim(); // Remove default value
      parameters.push({ name: paramName });
    }
  }

  // Parse JSDoc for parameter types and descriptions
  const jsdocMatch = code.match(/\/\*\*([\s\S]*?)\*\//);
  if (jsdocMatch && jsdocMatch[1]) {
    const jsdoc = jsdocMatch[1];

    // Parse @param tags
    const paramTagRegex = /@param\s+(?:\{(\w+)\}\s+)?(\w+)\s*-?\s*(.*)/g;
    let match;
    while ((match = paramTagRegex.exec(jsdoc)) !== null) {
      const paramType = match[1];
      const paramName = match[2];
      const paramDesc = match[3]?.trim();

      if (paramName) {
        const param = parameters.find((p) => p.name === paramName);
        if (param) {
          param.type = paramType;
          param.description = paramDesc;
        }
      }
    }

    // Parse @return tag
    const returnMatch = jsdoc.match(/@returns?\s+(?:\{(\w+)\}\s+)?(.*)/);
    if (returnMatch) {
      return {
        name,
        parameters,
        returnType: returnMatch[1] ?? undefined,
        returnDescription: returnMatch[2]?.trim() ?? undefined,
      };
    }
  }

  return { name, parameters };
}

/**
 * Check if a code template type should be added to scripts
 */
export function isAddToScripts(type: CodeTemplateType): boolean {
  return type === CodeTemplateType.FUNCTION || type === CodeTemplateType.COMPILED_CODE;
}
