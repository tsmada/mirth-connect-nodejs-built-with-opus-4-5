/**
 * Upgrade command - Plan and execute version upgrades.
 */

import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { loadManifest, getCurrentVersion } from '../models/Manifest.js';
import { parseVersion, getVersionBranch, getMigrationClass } from '../models/Version.js';
import { JavaDiffAnalyzer } from '../analyzers/JavaDiffAnalyzer.js';
import { ImpactAssessor } from '../analyzers/ImpactAssessor.js';
import { MigrationParser } from '../analyzers/MigrationParser.js';
import { TaskGenerator } from '../generators/TaskGenerator.js';
import { ReportGenerator } from '../generators/ReportGenerator.js';
import {
  createTaskFromImpact,
  assignTasksToWaves,
  generateWorktreeCommands,
  type UpgradePlan,
  type MigrationTask,
} from '../models/MigrationTask.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'manifest.json');

interface UpgradeOptions {
  output?: string;
  parallelAgents?: boolean;
  json?: boolean;
  base?: string;
  dryRun?: boolean;
}

export async function upgradeCommand(
  action: string,
  version: string,
  options: UpgradeOptions
): Promise<void> {
  try {
    parseVersion(version);

    const manifest = await loadManifest(MANIFEST_PATH);
    const currentVersion = getCurrentVersion(manifest);

    switch (action) {
      case 'plan':
        await generatePlan(currentVersion, version, manifest, options);
        break;
      case 'tasks':
        await generateTasks(currentVersion, version, manifest, options);
        break;
      case 'worktrees':
        await createWorktrees(version, options);
        break;
      default:
        console.error(chalk.red(`Unknown upgrade action: ${action}`));
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error:'), error.message);
    } else {
      console.error(chalk.red('Error:'), error);
    }
    process.exit(1);
  }
}

async function generatePlan(
  fromVersion: string,
  toVersion: string,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  options: UpgradeOptions
): Promise<void> {
  console.log(chalk.dim(`\nGenerating upgrade plan: ${fromVersion} → ${toVersion}...\n`));

  // Analyze changes
  const diffAnalyzer = new JavaDiffAnalyzer();
  const impactAssessor = new ImpactAssessor(manifest);
  const migrationParser = new MigrationParser();

  const changedFiles = await diffAnalyzer.getChangedFiles(fromVersion, toVersion);
  const relevantFiles = impactAssessor.filterRelevantFiles(changedFiles);
  const componentImpacts = await impactAssessor.assessImpact(
    relevantFiles,
    fromVersion,
    toVersion
  );

  // Create tasks from impacts
  const tasks: MigrationTask[] = componentImpacts.map((impact) =>
    createTaskFromImpact(impact, toVersion)
  );

  // Assign waves
  const waves = assignTasksToWaves(tasks);

  // Parse migrations
  const migrationClass = getMigrationClass(toVersion);
  const schemaMigrations = migrationClass
    ? await migrationParser.parseMigration(migrationClass)
    : [];

  // Create schema tasks
  const schemaTasks: MigrationTask[] = schemaMigrations.map((m, i) => ({
    id: `${toVersion}-schema-${i}`,
    targetVersion: toVersion,
    priority: 'high',
    status: 'pending',
    category: 'database',
    component: 'schema',
    title: `Run ${m.className} migration`,
    description: `Execute schema migration: ${m.sqlStatements.length} SQL statements`,
    javaChanges: [],
    nodeFiles: ['src/db/SchemaManager.ts'],
    wave: 2, // Schema always wave 2
    dependsOn: [],
    blockedBy: [],
    effort: 'medium',
    severity: 'major',
  }));

  // Build plan
  const plan: UpgradePlan = {
    fromVersion,
    toVersion,
    generatedAt: new Date().toISOString(),
    featureBranch: getVersionBranch(toVersion),
    waves,
    totalTasks: tasks.length + schemaTasks.length,
    estimatedEffort: calculateTotalEffort(waves),
    schemaTasks,
    summary: {
      breaking: tasks.filter((t) => t.severity === 'breaking').length,
      major: tasks.filter((t) => t.severity === 'major').length,
      minor: tasks.filter((t) => t.severity === 'minor').length,
      patch: tasks.filter((t) => t.severity === 'patch').length,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  // Generate markdown report
  const reportGenerator = new ReportGenerator();
  const report = reportGenerator.generatePlanReport(plan);

  if (options.output) {
    await fs.writeFile(options.output, report, 'utf-8');
    console.log(chalk.green(`Plan written to: ${options.output}`));
  } else {
    console.log(report);
  }
}

async function generateTasks(
  fromVersion: string,
  toVersion: string,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  options: UpgradeOptions
): Promise<void> {
  console.log(chalk.dim(`\nGenerating upgrade tasks: ${fromVersion} → ${toVersion}...\n`));

  // Analyze changes
  const diffAnalyzer = new JavaDiffAnalyzer();
  const impactAssessor = new ImpactAssessor(manifest);

  const changedFiles = await diffAnalyzer.getChangedFiles(fromVersion, toVersion);
  const relevantFiles = impactAssessor.filterRelevantFiles(changedFiles);
  const componentImpacts = await impactAssessor.assessImpact(
    relevantFiles,
    fromVersion,
    toVersion
  );

  // Generate tasks
  const taskGenerator = new TaskGenerator();
  const tasks = componentImpacts.map((impact) => createTaskFromImpact(impact, toVersion));
  const waves = assignTasksToWaves(tasks);

  if (options.json) {
    console.log(JSON.stringify({ tasks, waves }, null, 2));
    return;
  }

  // Generate markdown
  const markdown = taskGenerator.generateTaskMarkdown(
    fromVersion,
    toVersion,
    waves,
    options.parallelAgents
  );

  const outputPath =
    options.output || path.join(PROJECT_ROOT, 'tasks', `upgrade-${toVersion}.md`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, 'utf-8');

  console.log(chalk.green(`Tasks written to: ${outputPath}`));
  console.log();
  console.log(chalk.bold('Summary:'));
  console.log(`  Total tasks: ${tasks.length}`);
  console.log(`  Waves: ${waves.length}`);

  if (options.parallelAgents) {
    console.log();
    console.log(chalk.bold('Parallel Agent Setup:'));
    for (const wave of waves) {
      console.log(`  Wave ${wave.number}: ${wave.tasks.length} agents`);
    }
  }
}

async function createWorktrees(version: string, options: UpgradeOptions): Promise<void> {
  const manifest = await loadManifest(MANIFEST_PATH);
  const currentVersion = getCurrentVersion(manifest);

  console.log(chalk.dim(`\nCreating worktrees for upgrade to ${version}...\n`));

  // Get tasks for this version
  const diffAnalyzer = new JavaDiffAnalyzer();
  const impactAssessor = new ImpactAssessor(manifest);

  const changedFiles = await diffAnalyzer.getChangedFiles(currentVersion, version);
  const relevantFiles = impactAssessor.filterRelevantFiles(changedFiles);
  const componentImpacts = await impactAssessor.assessImpact(
    relevantFiles,
    currentVersion,
    version
  );

  const tasks = componentImpacts.map((impact) => createTaskFromImpact(impact, version));
  const waves = assignTasksToWaves(tasks);

  const baseBranch = options.base || getVersionBranch(version);

  console.log(chalk.bold('Worktree Commands:'));
  console.log();

  for (const wave of waves) {
    console.log(chalk.cyan(`# Wave ${wave.number}: ${wave.description}`));
    const commands = generateWorktreeCommands(wave, baseBranch);
    for (const cmd of commands) {
      if (options.dryRun) {
        console.log(chalk.dim(`  ${cmd}`));
      } else {
        console.log(`  ${cmd}`);
      }
    }
    console.log();
  }

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run - no worktrees created.'));
  } else {
    console.log(
      chalk.yellow(
        'Note: Run these commands manually to create worktrees, or use --dry-run to preview.'
      )
    );
  }
}

function calculateTotalEffort(waves: { totalEffort: string }[]): string {
  // Simple aggregation - could be more sophisticated
  const effortMap: Record<string, number> = {
    '< 1 hour': 0.5,
    '1-4 hours': 2,
    '0.5-1 day': 6,
    '1-2 days': 12,
    '2+ days': 24,
  };

  let totalHours = 0;
  for (const wave of waves) {
    totalHours += effortMap[wave.totalEffort] || 8;
  }

  if (totalHours < 8) return '< 1 day';
  if (totalHours < 24) return '1-3 days';
  if (totalHours < 80) return '1-2 weeks';
  return '2+ weeks';
}
