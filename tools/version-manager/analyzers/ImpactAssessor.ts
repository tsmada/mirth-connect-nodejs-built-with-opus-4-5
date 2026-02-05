/**
 * ImpactAssessor - Assess the severity and effort of changes.
 *
 * Analyzes changed Java files to determine:
 * - Which ported components are affected
 * - Severity of the changes (breaking, major, minor, patch)
 * - Estimated effort to update the Node.js port
 */

import { ComponentMatcher, type MatchedComponent } from './ComponentMatcher.js';
import type { ChangedFile } from './JavaDiffAnalyzer.js';
import type { EnhancedManifest } from '../models/Manifest.js';
import type {
  ComponentImpact,
  VersionChange,
  ChangeSeverity,
  ChangeType,
} from '../models/ChangeImpact.js';

export class ImpactAssessor {
  private matcher: ComponentMatcher;

  constructor(manifest: EnhancedManifest) {
    this.matcher = new ComponentMatcher(manifest);
  }

  /**
   * Filter changed files to only those relevant to ported components.
   */
  filterRelevantFiles(changedFiles: ChangedFile[]): ChangedFile[] {
    // Filter to Java source files in relevant directories
    return changedFiles.filter((file) => {
      const isJava = file.path.endsWith('.java');
      const isSourceDir =
        file.path.startsWith('server/src/') ||
        file.path.startsWith('donkey/src/');
      const isNotTest = !file.path.includes('/test/');

      return isJava && isSourceDir && isNotTest;
    });
  }

  /**
   * Assess the impact of changes on ported components.
   */
  async assessImpact(
    changedFiles: ChangedFile[],
    fromVersion: string,
    toVersion: string
  ): Promise<ComponentImpact[]> {
    // Match files to components
    const matched = await this.matcher.matchComponents(
      changedFiles.map((f) => f.path)
    );

    // Build impact assessments
    const impacts: ComponentImpact[] = [];

    for (const match of matched) {
      // Find the changed files for this component
      const componentChangedFiles = changedFiles.filter((f) =>
        match.matchedJavaFiles.includes(f.path)
      );

      // Assess changes
      const changes = await this.assessChanges(componentChangedFiles);

      // Calculate severity and effort
      const severity = this.calculateSeverity(changes, componentChangedFiles);
      const effort = this.calculateEffort(changes, componentChangedFiles);

      impacts.push({
        category: match.category,
        component: match.name,
        javaFiles: match.matchedJavaFiles,
        nodeFiles: match.nodeFiles,
        changes,
        severity,
        effort,
      });
    }

    // Sort by severity (most severe first)
    return impacts.sort((a, b) => {
      const severityOrder: Record<ChangeSeverity, number> = {
        breaking: 0,
        major: 1,
        minor: 2,
        patch: 3,
      };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Assess changes for a set of files.
   */
  private async assessChanges(files: ChangedFile[]): Promise<VersionChange[]> {
    const changes: VersionChange[] = [];

    for (const file of files) {
      // Determine change type based on file status and content
      const changeType = this.inferChangeType(file);
      const severity = this.inferSeverity(file, changeType);

      changes.push({
        type: changeType,
        severity,
        javaFile: file.path,
        description: this.generateDescription(file, changeType),
      });
    }

    return changes;
  }

  /**
   * Infer the type of change from file metadata.
   */
  private inferChangeType(file: ChangedFile): ChangeType {
    const fileName = file.path.split('/').pop() || '';

    // New files
    if (file.status === 'A') {
      if (fileName.includes('Properties')) return 'field-added';
      return 'class-added';
    }

    // Deleted files
    if (file.status === 'D') {
      return 'class-removed';
    }

    // Renamed files
    if (file.status === 'R') {
      return 'class-renamed';
    }

    // Modified files - infer from additions/deletions ratio
    const additions = file.additions || 0;
    const deletions = file.deletions || 0;

    // Large deletions suggest method/field removal
    if (deletions > additions * 2) {
      return 'method-removed';
    }

    // Large additions suggest new features
    if (additions > deletions * 3) {
      return 'method-added';
    }

    // Signature or behavior changes based on file type
    if (fileName.includes('Properties')) {
      return 'field-added'; // Properties files usually add fields
    }

    if (fileName.includes('Servlet') || fileName.includes('Interface')) {
      return 'api-change';
    }

    // Default to behavior change for moderate modifications
    return 'method-behavior-changed';
  }

  /**
   * Infer severity from change type and file.
   */
  private inferSeverity(file: ChangedFile, changeType: ChangeType): ChangeSeverity {
    // Breaking changes
    if (
      changeType === 'method-removed' ||
      changeType === 'class-removed' ||
      changeType === 'method-signature-changed'
    ) {
      return 'breaking';
    }

    // Major changes
    if (
      changeType === 'class-renamed' ||
      changeType === 'api-change' ||
      changeType === 'schema-change'
    ) {
      return 'major';
    }

    // Minor changes
    if (
      changeType === 'method-added' ||
      changeType === 'class-added' ||
      changeType === 'field-added'
    ) {
      return 'minor';
    }

    // Patch changes
    if (
      changeType === 'method-behavior-changed' ||
      changeType === 'internal-refactor'
    ) {
      // Large behavior changes might be major
      const totalChanges = (file.additions || 0) + (file.deletions || 0);
      if (totalChanges > 100) {
        return 'major';
      }
      if (totalChanges > 30) {
        return 'minor';
      }
      return 'patch';
    }

    return 'patch';
  }

  /**
   * Generate a human-readable description of the change.
   */
  private generateDescription(file: ChangedFile, changeType: ChangeType): string {
    const fileName = file.path.split('/').pop() || '';
    const additions = file.additions || 0;
    const deletions = file.deletions || 0;

    switch (changeType) {
      case 'class-added':
        return `New class ${fileName} added (+${additions} lines)`;
      case 'class-removed':
        return `Class ${fileName} removed (-${deletions} lines)`;
      case 'class-renamed':
        return `Class ${fileName} renamed`;
      case 'method-added':
        return `New methods added to ${fileName} (+${additions}/-${deletions})`;
      case 'method-removed':
        return `Methods removed from ${fileName} (+${additions}/-${deletions})`;
      case 'method-signature-changed':
        return `Method signatures changed in ${fileName}`;
      case 'method-behavior-changed':
        return `Behavior changes in ${fileName} (+${additions}/-${deletions})`;
      case 'field-added':
        return `New fields/properties in ${fileName} (+${additions})`;
      case 'field-removed':
        return `Fields removed from ${fileName} (-${deletions})`;
      case 'api-change':
        return `API changes in ${fileName} (+${additions}/-${deletions})`;
      case 'schema-change':
        return `Schema changes in ${fileName}`;
      case 'config-change':
        return `Configuration changes in ${fileName}`;
      default:
        return `Changes in ${fileName} (+${additions}/-${deletions})`;
    }
  }

  /**
   * Calculate overall severity for a component.
   */
  private calculateSeverity(
    changes: VersionChange[],
    files: ChangedFile[]
  ): ChangeSeverity {
    if (changes.some((c) => c.severity === 'breaking')) return 'breaking';
    if (changes.some((c) => c.severity === 'major')) return 'major';
    if (changes.some((c) => c.severity === 'minor')) return 'minor';
    return 'patch';
  }

  /**
   * Calculate effort estimate based on changes.
   */
  private calculateEffort(
    changes: VersionChange[],
    files: ChangedFile[]
  ): 'trivial' | 'small' | 'medium' | 'large' | 'significant' {
    // Count total lines changed
    const totalLines = files.reduce(
      (sum, f) => sum + (f.additions || 0) + (f.deletions || 0),
      0
    );

    // Factor in severity
    const hasBreaking = changes.some((c) => c.severity === 'breaking');
    const hasMajor = changes.some((c) => c.severity === 'major');

    if (hasBreaking || totalLines > 500) {
      return 'significant';
    }

    if (hasMajor || totalLines > 200) {
      return 'large';
    }

    if (totalLines > 50) {
      return 'medium';
    }

    if (totalLines > 10) {
      return 'small';
    }

    return 'trivial';
  }
}
