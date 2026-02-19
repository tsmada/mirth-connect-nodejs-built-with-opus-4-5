/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/messagebuilder/MessageBuilderStep.java
 *
 * Purpose: Build message segments in transformer
 *
 * Key behaviors to replicate:
 * - Assigns values to message segments (e.g., tmp['MSH']['MSH.3'])
 * - Supports default values when mapping fails
 * - Supports regex replacements
 * - Generates appropriate segment creation for E4X and regular objects
 */

export const MESSAGE_BUILDER_STEP_PLUGIN_POINT = 'Message Builder';

/**
 * Replacement pair for regex substitutions
 */
export interface ReplacementPair {
  pattern: string;
  replacement: string;
}

/**
 * Interface for message builder step data
 */
export interface MessageBuilderStepData {
  sequenceNumber?: number;
  name?: string;
  enabled?: boolean;
  messageSegment?: string;
  mapping?: string;
  defaultValue?: string;
  replacements?: ReplacementPair[];
}

/**
 * Iterator properties for batch processing
 */
export interface IteratorProperties {
  indexVariable: string;
}

/**
 * Expression part for parsing segment paths
 */
export interface ExprPart {
  value: string;
  propertyName: string;
  isNumberLiteral: boolean;
}

/**
 * Message Builder transformer step
 *
 * The Message Builder step assigns a value to a message segment,
 * creating the segment structure if it doesn't exist.
 */
export class MessageBuilderStep {
  private sequenceNumber: number;
  private name: string;
  private enabled: boolean;
  private messageSegment: string;
  private mapping: string;
  private defaultValue: string;
  private replacements: ReplacementPair[];

  /**
   * Plugin point identifier
   */
  static readonly PLUGIN_POINT = MESSAGE_BUILDER_STEP_PLUGIN_POINT;

  constructor(data: MessageBuilderStepData = {}) {
    this.sequenceNumber = data.sequenceNumber ?? 0;
    this.name = data.name ?? '';
    this.enabled = data.enabled ?? true;
    this.messageSegment = data.messageSegment ?? '';
    this.mapping = data.mapping ?? '';
    this.defaultValue = data.defaultValue ?? '';
    this.replacements = data.replacements ?? [];
  }

  /**
   * Copy constructor for cloning
   */
  static fromStep(step: MessageBuilderStep): MessageBuilderStep {
    return new MessageBuilderStep({
      sequenceNumber: step.sequenceNumber,
      name: step.name,
      enabled: step.enabled,
      messageSegment: step.messageSegment,
      mapping: step.mapping,
      defaultValue: step.defaultValue,
      replacements: step.replacements.map((r) => ({ ...r })),
    });
  }

  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  setSequenceNumber(sequenceNumber: number): void {
    this.sequenceNumber = sequenceNumber;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getMessageSegment(): string {
    return this.messageSegment;
  }

  setMessageSegment(messageSegment: string): void {
    this.messageSegment = messageSegment;
  }

  getMapping(): string {
    return this.mapping;
  }

  setMapping(mapping: string): void {
    this.mapping = mapping;
  }

  getDefaultValue(): string {
    return this.defaultValue;
  }

  setDefaultValue(defaultValue: string): void {
    this.defaultValue = defaultValue;
  }

  getReplacements(): ReplacementPair[] {
    return this.replacements;
  }

  setReplacements(replacements: ReplacementPair[]): void {
    this.replacements = replacements;
  }

  /**
   * Get the step type identifier
   */
  getType(): string {
    return MESSAGE_BUILDER_STEP_PLUGIN_POINT;
  }

  /**
   * Clone this step
   */
  clone(): MessageBuilderStep {
    return MessageBuilderStep.fromStep(this);
  }

  /**
   * Get response variables - Message Builder doesn't set response variables
   */
  getResponseVariables(): string[] {
    return [];
  }

  /**
   * Generate JavaScript code for this message builder step
   */
  getScript(_loadFiles: boolean = false): string {
    const regexArray = this.buildRegexArray();
    const mappingExpr = this.mapping || "''";
    const defaultExpr = this.defaultValue || "''";

    return `${this.messageSegment} = validate(${mappingExpr}, ${defaultExpr}, ${regexArray});`;
  }

  /**
   * Generate pre-script for iterator processing (not needed for Message Builder)
   */
  getPreScript(_loadFiles: boolean = false, _ancestors: IteratorProperties[] = []): string | null {
    return null;
  }

  /**
   * Generate iteration script for batch processing
   * This generates complex segment creation logic for both E4X and regular objects
   */
  getIterationScript(_loadFiles: boolean = false, ancestors: IteratorProperties[] = []): string {
    const lines: string[] = [];
    const exprParts = getExpressionParts(this.messageSegment);

    // Collect all index variables from ancestors
    const indexVariables = new Set<string>();
    for (const ancestor of [...ancestors].reverse()) {
      indexVariables.add(ancestor.indexVariable);
    }

    // Only generate segment creation if there are at least two parts
    if (exprParts.length > 1) {
      // E4X XML handling
      lines.push(`if (typeof(${exprParts[0]?.value}) == 'xml') {`);

      // Add creation steps for each iterator
      for (const ancestor of [...ancestors].reverse()) {
        const indexVar = ancestor.indexVariable;
        const currentIndex = getExprIndex(exprParts, indexVar);

        // Only add E4X createSegment calls if index variable is at least 3rd position
        if (currentIndex > 1) {
          const segmentPart = exprParts[currentIndex - 1];
          if (!segmentPart) continue;

          const segmentName = segmentPart.propertyName;

          if (!segmentPart.isNumberLiteral && !indexVariables.has(segmentName)) {
            // First make sure the base target object exists
            if (currentIndex > 2) {
              const baseSegmentPart = exprParts[currentIndex - 2];
              if (!baseSegmentPart) continue;

              const baseSegmentName = baseSegmentPart.propertyName;

              if (!baseSegmentPart.isNumberLiteral && !indexVariables.has(baseSegmentName)) {
                const baseSegment = exprParts
                  .slice(0, currentIndex - 1)
                  .map((p) => p.value)
                  .join('');
                lines.push(`if (typeof(${baseSegment}[0]) == 'undefined') {`);

                const targetSegment = exprParts
                  .slice(0, currentIndex - 2)
                  .map((p) => p.value)
                  .join('');
                const quotedBaseName = quoteLiteral(baseSegmentName);
                lines.push(`createSegment(${quotedBaseName}, ${targetSegment});`);
                lines.push(`}`);
              }
            }

            // Create the segment at the index position
            const wholeSegment = exprParts
              .slice(0, currentIndex + 1)
              .map((p) => p.value)
              .join('');
            lines.push(`if (typeof(${wholeSegment}) == 'undefined') {`);

            const targetSegment = exprParts
              .slice(0, currentIndex - 1)
              .map((p) => p.value)
              .join('');
            const quotedSegmentName = quoteLiteral(segmentName);
            lines.push(`createSegment(${quotedSegmentName}, ${targetSegment}, ${indexVar});`);
            lines.push(`}`);
          }
        }
      }

      lines.push('} else {');

      // Regular object handling
      let lastIndexChecked = -1;

      for (const ancestor of [...ancestors].reverse()) {
        const indexVar = ancestor.indexVariable;
        const currentIndex = getExprIndex(exprParts, indexVar);

        if (currentIndex > 0) {
          // Iterate from first segment to current index
          for (let i = lastIndexChecked + 1; i <= currentIndex; i++) {
            const targetSegment = exprParts
              .slice(0, i + 1)
              .map((p) => p.value)
              .join('');
            lines.push(`if (typeof(${targetSegment}) == 'undefined') {`);

            // If segment is before index var or number literal, create array
            let value = '{}';
            if (
              i === currentIndex - 1 ||
              (exprParts.length > i + 1 &&
                (exprParts[i + 1]?.isNumberLiteral ||
                  indexVariables.has(exprParts[i + 1]?.propertyName ?? '')))
            ) {
              value = '[]';
            }
            lines.push(`${targetSegment} = ${value};`);
            lines.push('}');
            lastIndexChecked = i;
          }
        }
      }

      // Create remaining segments up to second-to-last
      for (let i = lastIndexChecked + 1; i <= exprParts.length - 2; i++) {
        const targetSegment = exprParts
          .slice(0, i + 1)
          .map((p) => p.value)
          .join('');
        lines.push(`if (typeof(${targetSegment}) == 'undefined') {`);

        let value = '{}';
        if (
          exprParts.length > i + 1 &&
          (exprParts[i + 1]?.isNumberLiteral ||
            indexVariables.has(exprParts[i + 1]?.propertyName ?? ''))
        ) {
          value = '[]';
        }
        lines.push(`${targetSegment} = ${value};`);
        lines.push('}');
      }

      lines.push('}');
    }

    // Add the actual assignment
    lines.push(this.getScript(_loadFiles));

    return lines.join('\n');
  }

  /**
   * Generate post-script for iterator processing (not needed for Message Builder)
   */
  getPostScript(_loadFiles: boolean = false, _ancestors: IteratorProperties[] = []): string | null {
    return null;
  }

  /**
   * Build the regex replacement array for the validate() function
   */
  private buildRegexArray(): string {
    if (!this.replacements || this.replacements.length === 0) {
      return 'new Array()';
    }

    const pairs = this.replacements.map((r) => `new Array(${r.pattern}, ${r.replacement})`);
    return `new Array(${pairs.join(',')})`;
  }

  /**
   * Get purged properties for analytics/logging
   */
  getPurgedProperties(): Record<string, unknown> {
    return {
      sequenceNumber: this.sequenceNumber,
      enabled: this.enabled,
      replacementsCount: this.replacements?.length ?? 0,
    };
  }

  /**
   * Serialize to plain object
   */
  toJSON(): MessageBuilderStepData & { type: string } {
    return {
      sequenceNumber: this.sequenceNumber,
      name: this.name,
      enabled: this.enabled,
      messageSegment: this.messageSegment,
      mapping: this.mapping,
      defaultValue: this.defaultValue,
      replacements: this.replacements,
      type: this.getType(),
    };
  }

  /**
   * Create from XML/JSON data (used in channel imports)
   */
  static fromXML(data: Record<string, unknown>): MessageBuilderStep {
    let replacements: ReplacementPair[] = [];
    if (Array.isArray(data.replacements)) {
      replacements = data.replacements
        .filter(
          (r): r is { pattern: string; replacement: string } =>
            typeof r === 'object' &&
            r !== null &&
            typeof (r as Record<string, unknown>).pattern === 'string' &&
            typeof (r as Record<string, unknown>).replacement === 'string'
        )
        .map((r) => ({
          pattern: r.pattern,
          replacement: r.replacement,
        }));
    }

    return new MessageBuilderStep({
      sequenceNumber: typeof data.sequenceNumber === 'number' ? data.sequenceNumber : 0,
      name: typeof data.name === 'string' ? data.name : '',
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
      messageSegment: typeof data.messageSegment === 'string' ? data.messageSegment : '',
      mapping: typeof data.mapping === 'string' ? data.mapping : '',
      defaultValue: typeof data.defaultValue === 'string' ? data.defaultValue : '',
      replacements,
    });
  }
}

/**
 * Parse an expression into parts
 * e.g., "tmp['OBR'][i]['OBR.1']" -> [{value: "tmp", ...}, {value: "['OBR']", ...}, ...]
 */
function getExpressionParts(expression: string): ExprPart[] {
  if (!expression) return [];

  const parts: ExprPart[] = [];
  let current = '';
  let inBracket = false;
  let bracketContent = '';

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i]!;

    if (char === '[' && !inBracket) {
      // Starting a bracket access
      if (current) {
        parts.push({
          value: current,
          propertyName: current,
          isNumberLiteral: false,
        });
        current = '';
      }
      inBracket = true;
      bracketContent = '';
    } else if (char === ']' && inBracket) {
      // Ending a bracket access
      inBracket = false;
      const propName = extractPropertyName(bracketContent);
      const isNumber = /^\d+$/.test(bracketContent.trim());
      parts.push({
        value: `[${bracketContent}]`,
        propertyName: propName,
        isNumberLiteral: isNumber,
      });
    } else if (char === '.' && !inBracket) {
      // Dot access
      if (current) {
        parts.push({
          value: current,
          propertyName: current,
          isNumberLiteral: false,
        });
        current = '';
      }
      // Don't add the dot to parts, just start new property
    } else if (inBracket) {
      bracketContent += char;
    } else {
      current += char;
    }
  }

  // Don't forget remaining content
  if (current) {
    parts.push({
      value: current,
      propertyName: current,
      isNumberLiteral: false,
    });
  }

  return parts;
}

/**
 * Extract property name from bracket content
 * e.g., "'OBR'" -> "OBR", "i" -> "i"
 */
function extractPropertyName(content: string): string {
  const trimmed = content.trim();
  // Remove quotes if present
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Find the index of a variable in expression parts
 */
function getExprIndex(parts: ExprPart[], indexVar: string): number {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]?.propertyName === indexVar) {
      return i;
    }
  }
  return -1;
}

/**
 * Quote a literal for JavaScript if not already quoted
 */
function quoteLiteral(value: string): string {
  if (value.startsWith("'") || value.startsWith('"')) {
    return value;
  }
  // Escape single quotes and wrap
  return `'${value.replace(/'/g, "\\'")}'`;
}

/**
 * Factory function to create message builder step
 */
export function createMessageBuilderStep(
  name: string,
  messageSegment: string,
  mapping: string = ''
): MessageBuilderStep {
  return new MessageBuilderStep({
    name,
    messageSegment,
    mapping,
    enabled: true,
  });
}

/**
 * Check if a step object is a message builder step
 */
export function isMessageBuilderStep(step: unknown): step is MessageBuilderStep {
  return step instanceof MessageBuilderStep;
}

/**
 * Check if step data represents a message builder step type
 */
export function isMessageBuilderStepType(data: { type?: string }): boolean {
  return data.type === MESSAGE_BUILDER_STEP_PLUGIN_POINT;
}
