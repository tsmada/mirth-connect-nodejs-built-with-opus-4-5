/**
 * Models for assessing the impact of changes between Java Mirth versions.
 */

/**
 * Severity of a change's impact on the Node.js port.
 */
export type ChangeSeverity = 'breaking' | 'major' | 'minor' | 'patch';

/**
 * Type of change detected.
 */
export type ChangeType =
  | 'method-added'
  | 'method-removed'
  | 'method-signature-changed'
  | 'method-behavior-changed'
  | 'field-added'
  | 'field-removed'
  | 'class-added'
  | 'class-removed'
  | 'class-renamed'
  | 'dependency-added'
  | 'dependency-removed'
  | 'schema-change'
  | 'config-change'
  | 'api-change'
  | 'internal-refactor';

/**
 * A single change detected between versions.
 */
export interface VersionChange {
  /** Type of change */
  type: ChangeType;
  /** Severity of the change */
  severity: ChangeSeverity;
  /** File path in Java repo */
  javaFile: string;
  /** Brief description of the change */
  description: string;
  /** Detailed diff or context */
  details?: string;
  /** Line numbers affected */
  lines?: { from: number; to: number };
  /** Related method or class name */
  symbol?: string;
}

/**
 * Impact assessment for a ported component.
 */
export interface ComponentImpact {
  /** Category in manifest (e.g., "connectors") */
  category: string;
  /** Component name (e.g., "http") */
  component: string;
  /** Java source file(s) that changed */
  javaFiles: string[];
  /** TypeScript file(s) that need updating */
  nodeFiles: string[];
  /** Changes affecting this component */
  changes: VersionChange[];
  /** Overall severity for this component */
  severity: ChangeSeverity;
  /** Estimated effort level */
  effort: 'trivial' | 'small' | 'medium' | 'large' | 'significant';
}

/**
 * Schema migration detected from Migrate*.java files.
 */
export interface SchemaMigration {
  /** Migration class name (e.g., "Migrate3_10_0") */
  className: string;
  /** SQL statements to execute */
  sqlStatements: string[];
  /** Configuration properties to add */
  configProperties: Array<{
    name: string;
    value: string;
    description?: string;
  }>;
  /** Configuration properties to remove */
  removedConfigProperties: string[];
  /** Data migrations (method descriptions) */
  dataMigrations: string[];
}

/**
 * Full impact assessment between two versions.
 */
export interface VersionDiff {
  /** Source version */
  fromVersion: string;
  /** Target version */
  toVersion: string;
  /** Type of version change */
  rangeType: 'major' | 'minor' | 'patch';
  /** When this diff was generated */
  generatedAt: string;

  /** Total files changed in Java repo */
  totalFilesChanged: number;
  /** Files changed that affect ported components */
  relevantFilesChanged: number;

  /** Components impacted */
  componentImpacts: ComponentImpact[];

  /** Schema migrations */
  schemaMigrations: SchemaMigration[];

  /** New features added (not yet ported) */
  newFeatures: Array<{
    name: string;
    javaFiles: string[];
    description?: string;
  }>;

  /** Overall effort estimate */
  estimatedEffort: {
    days: string;
    description: string;
  };

  /** Summary statistics */
  summary: {
    breaking: number;
    major: number;
    minor: number;
    patch: number;
    totalComponents: number;
  };
}

/**
 * Calculate the overall severity from a list of changes.
 */
export function calculateOverallSeverity(changes: VersionChange[]): ChangeSeverity {
  if (changes.some((c) => c.severity === 'breaking')) return 'breaking';
  if (changes.some((c) => c.severity === 'major')) return 'major';
  if (changes.some((c) => c.severity === 'minor')) return 'minor';
  return 'patch';
}

/**
 * Estimate effort based on component impacts.
 */
export function estimateEffort(impacts: ComponentImpact[]): {
  days: string;
  description: string;
} {
  let score = 0;

  for (const impact of impacts) {
    switch (impact.effort) {
      case 'trivial':
        score += 0.1;
        break;
      case 'small':
        score += 0.5;
        break;
      case 'medium':
        score += 1;
        break;
      case 'large':
        score += 3;
        break;
      case 'significant':
        score += 5;
        break;
    }
  }

  if (score < 0.5) {
    return { days: '< 1 day', description: 'Quick update' };
  } else if (score < 2) {
    return { days: '1-2 days', description: 'Small update' };
  } else if (score < 5) {
    return { days: '2-5 days', description: 'Medium update' };
  } else if (score < 10) {
    return { days: '1-2 weeks', description: 'Large update with parallel agents' };
  } else {
    return { days: '2+ weeks', description: 'Significant update, consider multiple waves' };
  }
}

/**
 * Get a human-readable description of a change type.
 */
export function getChangeTypeDescription(type: ChangeType): string {
  const descriptions: Record<ChangeType, string> = {
    'method-added': 'New method added',
    'method-removed': 'Method removed',
    'method-signature-changed': 'Method signature changed',
    'method-behavior-changed': 'Method behavior changed',
    'field-added': 'New field added',
    'field-removed': 'Field removed',
    'class-added': 'New class added',
    'class-removed': 'Class removed',
    'class-renamed': 'Class renamed',
    'dependency-added': 'New dependency added',
    'dependency-removed': 'Dependency removed',
    'schema-change': 'Database schema change',
    'config-change': 'Configuration change',
    'api-change': 'REST API change',
    'internal-refactor': 'Internal refactoring',
  };
  return descriptions[type] || type;
}

/**
 * Get a color for severity (for CLI output).
 */
export function getSeverityColor(severity: ChangeSeverity): string {
  switch (severity) {
    case 'breaking':
      return 'red';
    case 'major':
      return 'yellow';
    case 'minor':
      return 'cyan';
    case 'patch':
      return 'green';
  }
}
