/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/mapper/MapperStep.java
 *
 * Purpose: Variable mapping transformer step
 *
 * Key behaviors to replicate:
 * - Maps a value from message to a map variable
 * - Supports default values when mapping fails
 * - Supports regex replacements
 * - Can map to different scopes (channel, global, response, etc.)
 */

export const MAPPER_STEP_PLUGIN_POINT = 'Mapper';

/**
 * Scope determines which map the variable is stored in
 */
export enum MapperScope {
  CONNECTOR = 'CONNECTOR',
  CHANNEL = 'CHANNEL',
  GLOBAL_CHANNEL = 'GLOBAL_CHANNEL',
  GLOBAL = 'GLOBAL',
  RESPONSE = 'RESPONSE',
}

/**
 * Map names for each scope (used in generated JavaScript)
 */
export const SCOPE_MAP_NAMES: Record<MapperScope, string> = {
  [MapperScope.CONNECTOR]: 'connectorMap',
  [MapperScope.CHANNEL]: 'channelMap',
  [MapperScope.GLOBAL_CHANNEL]: 'globalChannelMap',
  [MapperScope.GLOBAL]: 'globalMap',
  [MapperScope.RESPONSE]: 'responseMap',
};

/**
 * Scope labels for display
 */
export const SCOPE_LABELS: Record<MapperScope, string> = {
  [MapperScope.CONNECTOR]: 'Connector Map',
  [MapperScope.CHANNEL]: 'Channel Map',
  [MapperScope.GLOBAL_CHANNEL]: 'Global Channel Map',
  [MapperScope.GLOBAL]: 'Global Map',
  [MapperScope.RESPONSE]: 'Response Map',
};

/**
 * Replacement pair for regex substitutions
 */
export interface ReplacementPair {
  pattern: string;
  replacement: string;
}

/**
 * Interface for mapper step data
 */
export interface MapperStepData {
  sequenceNumber?: number;
  name?: string;
  enabled?: boolean;
  variable?: string;
  mapping?: string;
  defaultValue?: string;
  replacements?: ReplacementPair[];
  scope?: MapperScope;
}

/**
 * Iterator properties for batch processing
 */
export interface IteratorProperties {
  indexVariable: string;
}

/**
 * Mapper transformer step
 *
 * The Mapper step extracts a value from the message (using the mapping expression),
 * applies optional replacements, and stores it in a map variable.
 */
export class MapperStep {
  private sequenceNumber: number;
  private name: string;
  private enabled: boolean;
  private variable: string;
  private mapping: string;
  private defaultValue: string;
  private replacements: ReplacementPair[];
  private scope: MapperScope;

  /**
   * Plugin point identifier
   */
  static readonly PLUGIN_POINT = MAPPER_STEP_PLUGIN_POINT;

  constructor(data: MapperStepData = {}) {
    this.sequenceNumber = data.sequenceNumber ?? 0;
    this.name = data.name ?? '';
    this.enabled = data.enabled ?? true;
    this.variable = data.variable ?? '';
    this.mapping = data.mapping ?? '';
    this.defaultValue = data.defaultValue ?? '';
    this.replacements = data.replacements ?? [];
    this.scope = data.scope ?? MapperScope.CHANNEL;
  }

  /**
   * Copy constructor for cloning
   */
  static fromStep(step: MapperStep): MapperStep {
    return new MapperStep({
      sequenceNumber: step.sequenceNumber,
      name: step.name,
      enabled: step.enabled,
      variable: step.variable,
      mapping: step.mapping,
      defaultValue: step.defaultValue,
      replacements: step.replacements.map((r) => ({ ...r })),
      scope: step.scope,
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

  getVariable(): string {
    return this.variable;
  }

  setVariable(variable: string): void {
    this.variable = variable;
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

  getScope(): MapperScope {
    return this.scope;
  }

  setScope(scope: MapperScope): void {
    this.scope = scope;
  }

  /**
   * Get the step type identifier
   */
  getType(): string {
    return MAPPER_STEP_PLUGIN_POINT;
  }

  /**
   * Clone this step
   */
  clone(): MapperStep {
    return MapperStep.fromStep(this);
  }

  /**
   * Get response variables set by this step
   */
  getResponseVariables(): string[] {
    if (this.scope === MapperScope.RESPONSE) {
      return [this.variable];
    }
    return [];
  }

  /**
   * Generate JavaScript code for this mapping step
   */
  getScript(_loadFiles: boolean = false): string {
    const regexArray = this.buildRegexArray();
    const mapName = SCOPE_MAP_NAMES[this.scope] ?? SCOPE_MAP_NAMES[MapperScope.CHANNEL];
    const mappingExpr = this.mapping || "''";
    const defaultExpr = this.defaultValue || "''";

    const lines: string[] = [
      'var mapping;',
      '',
      'try {',
      `\tmapping = ${mappingExpr};`,
      '} catch (e) {',
      "\tmapping = '';",
      '}',
      '',
      `${mapName}.put('${this.variable}', validate(mapping, ${defaultExpr}, ${regexArray}));`,
    ];

    return lines.join('\n');
  }

  /**
   * Generate pre-script for iterator processing
   */
  getPreScript(
    _loadFiles: boolean = false,
    _ancestors: IteratorProperties[] = []
  ): string {
    const identifier = convertIdentifier(this.variable);
    return `var _${identifier} = Lists.list();`;
  }

  /**
   * Generate iteration script for batch processing
   */
  getIterationScript(
    _loadFiles: boolean = false,
    _ancestors: IteratorProperties[] = []
  ): string {
    const regexArray = this.buildRegexArray();
    const mappingExpr = this.mapping || "''";
    const defaultExpr = this.defaultValue || "''";
    const identifier = convertIdentifier(this.variable);

    const lines: string[] = [
      'var mapping;',
      '',
      'try {',
      `\tmapping = ${mappingExpr};`,
      '} catch (e) {',
      "\tmapping = '';",
      '}',
      '',
      `_${identifier}.add(validate(mapping, ${defaultExpr}, ${regexArray}));`,
    ];

    return lines.join('\n');
  }

  /**
   * Generate post-script for iterator processing
   */
  getPostScript(
    _loadFiles: boolean = false,
    _ancestors: IteratorProperties[] = []
  ): string {
    const mapName = SCOPE_MAP_NAMES[this.scope] ?? SCOPE_MAP_NAMES[MapperScope.CHANNEL];
    const identifier = convertIdentifier(this.variable);
    return `${mapName}.put('${this.variable}', _${identifier}.toArray());`;
  }

  /**
   * Build the regex replacement array for the validate() function
   */
  private buildRegexArray(): string {
    if (!this.replacements || this.replacements.length === 0) {
      return 'new Array()';
    }

    const pairs = this.replacements.map(
      (r) => `new Array(${r.pattern}, ${r.replacement})`
    );
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
      scope: this.scope,
    };
  }

  /**
   * Serialize to plain object
   */
  toJSON(): MapperStepData & { type: string } {
    return {
      sequenceNumber: this.sequenceNumber,
      name: this.name,
      enabled: this.enabled,
      variable: this.variable,
      mapping: this.mapping,
      defaultValue: this.defaultValue,
      replacements: this.replacements,
      scope: this.scope,
      type: this.getType(),
    };
  }

  /**
   * Create from XML/JSON data (used in channel imports)
   */
  static fromXML(data: Record<string, unknown>): MapperStep {
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

    return new MapperStep({
      sequenceNumber: typeof data.sequenceNumber === 'number' ? data.sequenceNumber : 0,
      name: typeof data.name === 'string' ? data.name : '',
      enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
      variable: typeof data.variable === 'string' ? data.variable : '',
      mapping: typeof data.mapping === 'string' ? data.mapping : '',
      defaultValue: typeof data.defaultValue === 'string' ? data.defaultValue : '',
      replacements,
      scope: isValidScope(data.scope) ? data.scope : MapperScope.CHANNEL,
    });
  }
}

/**
 * Helper: Check if value is a valid scope
 */
function isValidScope(value: unknown): value is MapperScope {
  return Object.values(MapperScope).includes(value as MapperScope);
}

/**
 * Helper: Convert identifier to valid JavaScript variable name
 * Replaces invalid characters with underscores
 */
function convertIdentifier(name: string): string {
  if (!name) return '_unnamed';
  // Replace any non-alphanumeric characters (except underscore) with underscore
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Factory function to create mapper step
 */
export function createMapperStep(
  name: string,
  variable: string,
  mapping: string = '',
  scope: MapperScope = MapperScope.CHANNEL
): MapperStep {
  return new MapperStep({
    name,
    variable,
    mapping,
    scope,
    enabled: true,
  });
}

/**
 * Check if a step object is a mapper step
 */
export function isMapperStep(step: unknown): step is MapperStep {
  return step instanceof MapperStep;
}

/**
 * Check if step data represents a mapper step type
 */
export function isMapperStepType(data: { type?: string }): boolean {
  return data.type === MAPPER_STEP_PLUGIN_POINT;
}

/**
 * Get scope from string value
 */
export function getScopeFromString(value: string): MapperScope {
  const upperValue = value.toUpperCase().replace(/\s+/g, '_');
  if (Object.values(MapperScope).includes(upperValue as MapperScope)) {
    return upperValue as MapperScope;
  }
  return MapperScope.CHANNEL;
}

/**
 * Get scope label for display
 */
export function getScopeLabel(scope: MapperScope): string {
  return SCOPE_LABELS[scope] ?? 'Channel Map';
}
