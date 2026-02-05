/**
 * Diff command - Compare changes between Java Mirth versions.
 */

import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadManifest, getCurrentVersion } from '../models/Manifest.js';
import { parseVersion, getVersionRangeType, getMigrationClass } from '../models/Version.js';
import { JavaDiffAnalyzer } from '../analyzers/JavaDiffAnalyzer.js';
import { ImpactAssessor } from '../analyzers/ImpactAssessor.js';
import { MigrationParser } from '../analyzers/MigrationParser.js';
import type { VersionDiff, ComponentImpact } from '../models/ChangeImpact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'manifest.json');

interface DiffOptions {
  impact?: boolean;
  component?: string;
  category?: string;
  json?: boolean;
}

export async function diffCommand(
  fromVersion: string,
  toVersion: string,
  options: DiffOptions
): Promise<void> {
  try {
    // Validate versions
    parseVersion(fromVersion);
    parseVersion(toVersion);

    console.log(chalk.dim(`\nAnalyzing changes from ${fromVersion} to ${toVersion}...\n`));

    const manifest = await loadManifest(MANIFEST_PATH);

    // Initialize analyzers
    const diffAnalyzer = new JavaDiffAnalyzer();
    const impactAssessor = new ImpactAssessor(manifest);
    const migrationParser = new MigrationParser();

    // Get changed files
    const changedFiles = await diffAnalyzer.getChangedFiles(fromVersion, toVersion);

    // Filter to relevant files
    const relevantFiles = impactAssessor.filterRelevantFiles(changedFiles);

    // Assess impact
    const componentImpacts = await impactAssessor.assessImpact(
      relevantFiles,
      fromVersion,
      toVersion
    );

    // Filter by component/category if specified
    let filteredImpacts = componentImpacts;
    if (options.component) {
      filteredImpacts = filteredImpacts.filter(
        (i) => i.component.toLowerCase() === options.component!.toLowerCase()
      );
    }
    if (options.category) {
      filteredImpacts = filteredImpacts.filter(
        (i) => i.category.toLowerCase() === options.category!.toLowerCase()
      );
    }

    // Parse migrations
    const migrationClass = getMigrationClass(toVersion);
    const schemaMigrations = migrationClass
      ? await migrationParser.parseMigration(migrationClass)
      : [];

    // Build diff result
    const diff: VersionDiff = {
      fromVersion,
      toVersion,
      rangeType: getVersionRangeType(fromVersion, toVersion),
      generatedAt: new Date().toISOString(),
      totalFilesChanged: changedFiles.length,
      relevantFilesChanged: relevantFiles.length,
      componentImpacts: filteredImpacts,
      schemaMigrations,
      newFeatures: [], // TODO: detect new features
      estimatedEffort: calculateEstimatedEffort(filteredImpacts),
      summary: {
        breaking: filteredImpacts.filter((i) => i.severity === 'breaking').length,
        major: filteredImpacts.filter((i) => i.severity === 'major').length,
        minor: filteredImpacts.filter((i) => i.severity === 'minor').length,
        patch: filteredImpacts.filter((i) => i.severity === 'patch').length,
        totalComponents: filteredImpacts.length,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(diff, null, 2));
      return;
    }

    outputText(diff, options);
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error:'), error.message);
    } else {
      console.error(chalk.red('Error:'), error);
    }
    process.exit(1);
  }
}

function outputText(diff: VersionDiff, options: DiffOptions): void {
  const { fromVersion, toVersion, rangeType, summary, componentImpacts } = diff;

  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log(
    chalk.bold(`  Version Diff: ${chalk.yellow(fromVersion)} → ${chalk.green(toVersion)}`)
  );
  console.log(
    chalk.bold.cyan('═══════════════════════════════════════════════════════════')
  );
  console.log();

  // Range type
  const rangeColor =
    rangeType === 'major' ? chalk.red : rangeType === 'minor' ? chalk.yellow : chalk.green;
  console.log(`  Range Type: ${rangeColor(rangeType.toUpperCase())}`);
  console.log();

  // File counts
  console.log(chalk.bold('  Files Changed:'));
  console.log(`    Total in Java repo:     ${diff.totalFilesChanged}`);
  console.log(`    Affecting ported code:  ${diff.relevantFilesChanged}`);
  console.log();

  // Summary
  console.log(chalk.bold('  Change Summary:'));
  if (summary.breaking > 0) {
    console.log(`    ${chalk.red('●')} Breaking:  ${summary.breaking}`);
  }
  if (summary.major > 0) {
    console.log(`    ${chalk.yellow('●')} Major:     ${summary.major}`);
  }
  if (summary.minor > 0) {
    console.log(`    ${chalk.cyan('●')} Minor:     ${summary.minor}`);
  }
  if (summary.patch > 0) {
    console.log(`    ${chalk.green('●')} Patch:     ${summary.patch}`);
  }
  console.log(`    ${chalk.bold('Total:')}       ${summary.totalComponents} components`);
  console.log();

  // Estimated effort
  console.log(chalk.bold('  Estimated Effort:'));
  console.log(`    ${diff.estimatedEffort.days} - ${diff.estimatedEffort.description}`);
  console.log();

  // Component impacts
  if (componentImpacts.length > 0) {
    console.log(chalk.bold('  Affected Components:'));
    console.log();

    // Group by severity
    const bySeverity = {
      breaking: componentImpacts.filter((i) => i.severity === 'breaking'),
      major: componentImpacts.filter((i) => i.severity === 'major'),
      minor: componentImpacts.filter((i) => i.severity === 'minor'),
      patch: componentImpacts.filter((i) => i.severity === 'patch'),
    };

    if (bySeverity.breaking.length > 0) {
      console.log(chalk.red.bold('    Breaking Changes:'));
      for (const impact of bySeverity.breaking) {
        outputComponentImpact(impact, options.impact);
      }
      console.log();
    }

    if (bySeverity.major.length > 0) {
      console.log(chalk.yellow.bold('    Major Changes:'));
      for (const impact of bySeverity.major) {
        outputComponentImpact(impact, options.impact);
      }
      console.log();
    }

    if (bySeverity.minor.length > 0) {
      console.log(chalk.cyan.bold('    Minor Changes:'));
      for (const impact of bySeverity.minor) {
        outputComponentImpact(impact, options.impact);
      }
      console.log();
    }

    if (bySeverity.patch.length > 0) {
      console.log(chalk.green.bold('    Patch Changes:'));
      for (const impact of bySeverity.patch) {
        outputComponentImpact(impact, options.impact);
      }
      console.log();
    }
  } else {
    console.log(chalk.dim('  No ported components affected.'));
    console.log();
  }

  // Schema migrations
  if (diff.schemaMigrations.length > 0) {
    console.log(chalk.bold('  Schema Migrations:'));
    for (const migration of diff.schemaMigrations) {
      console.log(`    ${chalk.yellow(migration.className)}:`);
      if (migration.sqlStatements.length > 0) {
        console.log(`      SQL Statements: ${migration.sqlStatements.length}`);
      }
      if (migration.configProperties.length > 0) {
        console.log(`      Config Properties Added: ${migration.configProperties.length}`);
      }
      if (migration.dataMigrations.length > 0) {
        console.log(`      Data Migrations: ${migration.dataMigrations.length}`);
      }
    }
    console.log();
  }

  // Quick actions
  console.log(chalk.bold('  Next Steps:'));
  console.log(
    `    ${chalk.dim(`mirth-version upgrade tasks ${toVersion}`)}  - Generate task list`
  );
  console.log(
    `    ${chalk.dim(`mirth-version upgrade plan ${toVersion}`)}  - Create full upgrade plan`
  );
  console.log();
}

function outputComponentImpact(impact: ComponentImpact, detailed?: boolean): void {
  const effortBadge = getEffortBadge(impact.effort);
  console.log(
    `      ${impact.category}/${impact.component} ${effortBadge}`
  );
  console.log(`        Java files: ${impact.javaFiles.length}`);
  console.log(`        Node files: ${impact.nodeFiles.length}`);

  if (detailed && impact.changes.length > 0) {
    console.log(`        Changes:`);
    for (const change of impact.changes.slice(0, 5)) {
      console.log(`          - ${change.description}`);
    }
    if (impact.changes.length > 5) {
      console.log(`          ... and ${impact.changes.length - 5} more`);
    }
  }
}

function getEffortBadge(effort: string): string {
  switch (effort) {
    case 'trivial':
      return chalk.dim('[trivial]');
    case 'small':
      return chalk.green('[small]');
    case 'medium':
      return chalk.yellow('[medium]');
    case 'large':
      return chalk.red('[large]');
    case 'significant':
      return chalk.red.bold('[significant]');
    default:
      return '';
  }
}

function calculateEstimatedEffort(impacts: ComponentImpact[]): {
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
