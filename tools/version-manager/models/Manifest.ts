/**
 * Enhanced manifest types for version-by-version porting management.
 *
 * The manifest tracks:
 * - Which Java version each component was ported from
 * - Version metadata for branch/tag mapping
 * - Validation gaps discovered during testing
 */

/**
 * Version metadata for a specific Mirth version.
 */
export interface VersionMetadata {
  /** Git branch in Node.js repo for this version */
  nodeBranch: string;
  /** Git tag in Java repo for this version */
  javaTag: string;
  /** Status of this version's port */
  status: 'planned' | 'in-progress' | 'validated' | 'stable';
  /** When this version was ported */
  ported?: string;
  /** Notes about this version */
  notes?: string;
}

/**
 * Version history entry for a component.
 */
export interface VersionHistoryEntry {
  /** Java Mirth version */
  javaVersion: string;
  /** Git commit hash from Java repo */
  javaCommit?: string;
  /** When this version was ported */
  portedAt: string;
  /** Changes made in this version */
  changes?: string[];
}

/**
 * Component definition with version tracking.
 */
export interface ComponentDefinition {
  /** Implementation status */
  status: 'pending' | 'in-progress' | 'implemented' | 'validated' | 'partial';
  /** Description of the component */
  description: string;
  /** Path to Java source file(s) */
  javaSource?: string;
  /** TypeScript source file(s) */
  files?: string[];
  /** Test file(s) */
  tests?: string[];
  /** Component dependencies */
  dependencies?: string[];

  // Version tracking (new fields)
  /** Java version this component was ported from */
  javaVersion?: string;
  /** Git commit hash from Java repo */
  javaCommit?: string;
  /** Version history for this component */
  versionHistory?: VersionHistoryEntry[];
  /** Discovery context */
  discoveredIn?: string;
}

/**
 * Category of components (e.g., "connectors", "datatypes").
 */
export type ComponentCategory = Record<string, ComponentDefinition>;

/**
 * Validation gap discovered during testing.
 */
export interface ValidationGap {
  /** ID of the validation scenario that found this gap */
  scenarioId?: string;
  /** Component that has the gap */
  component?: string;
  /** Severity of the gap */
  severity: 'minor' | 'major' | 'critical';
  /** Description of the gap */
  description: string;
  /** Current status */
  status: 'open' | 'investigating' | 'wont-fix' | 'fixed';
  /** Java version where this gap exists */
  javaVersion?: string;
  /** Notes about the gap */
  notes?: string;
}

/**
 * Mirth compatibility information.
 */
export interface MirthCompatibility {
  /** Current target version */
  current: string;
  /** Minimum supported version */
  minimum?: string;
  /** Versions that have been tested */
  tested?: string[];
}

/**
 * Phase progress tracking.
 */
export interface PhaseProgress {
  phase1_foundation?: string;
  phase2_javascript_runtime?: string;
  phase3_message_pipeline?: string;
  phase4_connectors?: string;
  phase5_datatypes?: string;
  phase6_rest_api?: string;
  phase7_plugins?: string;
  [key: string]: string | undefined;
}

/**
 * Enhanced manifest structure with version tracking.
 */
export interface EnhancedManifest {
  /** Manifest schema version */
  version: string;

  /** Mirth compatibility information */
  mirthCompatibility: MirthCompatibility | string;

  /** Version metadata by version number */
  versionMetadata?: Record<string, VersionMetadata>;

  /** Phase progress tracking */
  phaseProgress?: PhaseProgress;

  /** Component definitions by category */
  components: {
    database?: ComponentCategory;
    javascript?: ComponentCategory;
    connectors?: ComponentCategory;
    datatypes?: ComponentCategory;
    api?: ComponentCategory;
    plugins?: ComponentCategory;
    core?: ComponentCategory;
    validation?: ComponentCategory;
    [key: string]: ComponentCategory | undefined;
  };

  /** Validation gaps */
  validationGaps?: Record<string, ValidationGap>;
}

/**
 * Load and parse manifest.json.
 */
export async function loadManifest(path: string): Promise<EnhancedManifest> {
  const fs = await import('fs/promises');
  const content = await fs.readFile(path, 'utf-8');
  return JSON.parse(content) as EnhancedManifest;
}

/**
 * Save manifest.json with pretty formatting.
 */
export async function saveManifest(path: string, manifest: EnhancedManifest): Promise<void> {
  const fs = await import('fs/promises');
  const content = JSON.stringify(manifest, null, 2);
  await fs.writeFile(path, content + '\n', 'utf-8');
}

/**
 * Get the current Mirth compatibility version from manifest.
 */
export function getCurrentVersion(manifest: EnhancedManifest): string {
  if (typeof manifest.mirthCompatibility === 'string') {
    // Legacy format: "3.9.x"
    return manifest.mirthCompatibility.replace('.x', '.1');
  }
  return manifest.mirthCompatibility.current;
}

/**
 * Get all components with their categories.
 */
export function getAllComponents(manifest: EnhancedManifest): Array<{
  category: string;
  name: string;
  component: ComponentDefinition;
}> {
  const results: Array<{
    category: string;
    name: string;
    component: ComponentDefinition;
  }> = [];

  for (const [category, components] of Object.entries(manifest.components)) {
    if (!components) continue;
    for (const [name, component] of Object.entries(components)) {
      results.push({ category, name, component });
    }
  }

  return results;
}

/**
 * Count components by status.
 */
export function countComponentsByStatus(manifest: EnhancedManifest): Record<string, number> {
  const counts: Record<string, number> = {
    pending: 0,
    'in-progress': 0,
    implemented: 0,
    validated: 0,
    partial: 0,
  };

  for (const { component } of getAllComponents(manifest)) {
    const status = component.status || 'pending';
    counts[status] = (counts[status] || 0) + 1;
  }

  return counts;
}

/**
 * Get components that need version updates.
 * These are components where javaVersion differs from the target version.
 */
export function getComponentsNeedingUpdate(
  manifest: EnhancedManifest,
  targetVersion: string
): Array<{
  category: string;
  name: string;
  component: ComponentDefinition;
  currentVersion: string;
}> {
  return getAllComponents(manifest)
    .filter(({ component }) => {
      const currentVersion = component.javaVersion;
      if (!currentVersion) return true; // No version = needs update
      return currentVersion !== targetVersion;
    })
    .map(({ category, name, component }) => ({
      category,
      name,
      component,
      currentVersion: component.javaVersion || 'unknown',
    }));
}

/**
 * Update a component's version information.
 */
export function updateComponentVersion(
  manifest: EnhancedManifest,
  category: string,
  componentName: string,
  javaVersion: string,
  javaCommit?: string
): void {
  const categoryObj = manifest.components[category];
  if (!categoryObj) {
    throw new Error(`Category not found: ${category}`);
  }

  const component = categoryObj[componentName];
  if (!component) {
    throw new Error(`Component not found: ${category}.${componentName}`);
  }

  // Add to version history
  if (!component.versionHistory) {
    component.versionHistory = [];
  }

  // Record previous version in history
  if (component.javaVersion && component.javaVersion !== javaVersion) {
    component.versionHistory.push({
      javaVersion: component.javaVersion,
      javaCommit: component.javaCommit,
      portedAt: new Date().toISOString().split('T')[0]!,
    });
  }

  // Update to new version
  component.javaVersion = javaVersion;
  if (javaCommit) {
    component.javaCommit = javaCommit;
  }
}

/**
 * Migrate manifest from legacy format to enhanced format.
 */
export function migrateManifest(manifest: EnhancedManifest): EnhancedManifest {
  // Upgrade mirthCompatibility from string to object
  if (typeof manifest.mirthCompatibility === 'string') {
    const version = manifest.mirthCompatibility.replace('.x', '.1');
    manifest.mirthCompatibility = {
      current: version,
      minimum: version.replace(/\.\d+$/, '.0'),
      tested: [version],
    };
  }

  // Upgrade version
  if (manifest.version === '0.1.0') {
    manifest.version = '0.2.0';
  }

  // Add versionMetadata if missing
  if (!manifest.versionMetadata) {
    const current = getCurrentVersion(manifest);
    manifest.versionMetadata = {
      [current]: {
        nodeBranch: 'master',
        javaTag: current,
        status: 'validated',
        ported: new Date().toISOString().split('T')[0],
      },
    };
  }

  // Add javaVersion to components that are missing it
  const currentVersion = getCurrentVersion(manifest);
  for (const { component } of getAllComponents(manifest)) {
    if (component.status === 'implemented' || component.status === 'validated') {
      if (!component.javaVersion) {
        component.javaVersion = currentVersion;
      }
    }
  }

  return manifest;
}
