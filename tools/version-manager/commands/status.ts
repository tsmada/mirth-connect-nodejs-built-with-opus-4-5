/**
 * Status command - Show current version status and component breakdown.
 */

import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadManifest,
  getCurrentVersion,
  getAllComponents,
  countComponentsByStatus,
  type EnhancedManifest,
} from '../models/Manifest.js';
import { KNOWN_VERSIONS, getNextVersion } from '../models/Version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'manifest.json');

interface StatusOptions {
  verbose?: boolean;
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  try {
    const manifest = await loadManifest(MANIFEST_PATH);
    const currentVersion = getCurrentVersion(manifest);

    if (options.json) {
      outputJson(manifest, currentVersion);
      return;
    }

    outputText(manifest, currentVersion, options.verbose);
  } catch (error) {
    console.error(chalk.red('Error loading manifest:'), error);
    process.exit(1);
  }
}

function outputJson(manifest: EnhancedManifest, currentVersion: string): void {
  const components = getAllComponents(manifest);
  const statusCounts = countComponentsByStatus(manifest);

  const output = {
    currentVersion,
    compatibility:
      typeof manifest.mirthCompatibility === 'string'
        ? { current: manifest.mirthCompatibility }
        : manifest.mirthCompatibility,
    versionMetadata: manifest.versionMetadata,
    componentCounts: statusCounts,
    totalComponents: components.length,
    componentsByCategory: {} as Record<string, number>,
    phaseProgress: manifest.phaseProgress,
  };

  // Count by category
  for (const { category } of components) {
    output.componentsByCategory[category] =
      (output.componentsByCategory[category] || 0) + 1;
  }

  console.log(JSON.stringify(output, null, 2));
}

function outputText(
  manifest: EnhancedManifest,
  currentVersion: string,
  verbose?: boolean
): void {
  console.log();
  console.log(chalk.bold.cyan('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           Mirth Connect Node.js Port - Status              ║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════╝'));
  console.log();

  // Version information
  console.log(chalk.bold('Version Information:'));
  console.log(`  Current Target:    ${chalk.green(currentVersion)}`);

  const versionInfo = KNOWN_VERSIONS[currentVersion];
  if (versionInfo) {
    console.log(`  Java Tag:          ${chalk.yellow(versionInfo.tag)}`);
    if (versionInfo.releaseDate) {
      console.log(`  Release Date:      ${versionInfo.releaseDate}`);
    }
    if (versionInfo.notes) {
      console.log(`  Notes:             ${versionInfo.notes}`);
    }
  }

  const nextVersion = getNextVersion(currentVersion);
  if (nextVersion) {
    console.log(`  Next Version:      ${chalk.dim(nextVersion)}`);
  }

  console.log();

  // Compatibility
  if (typeof manifest.mirthCompatibility !== 'string') {
    console.log(chalk.bold('Compatibility:'));
    console.log(`  Minimum Version:   ${manifest.mirthCompatibility.minimum || 'N/A'}`);
    console.log(`  Tested Versions:   ${(manifest.mirthCompatibility.tested || []).join(', ') || 'N/A'}`);
    console.log();
  }

  // Version metadata
  if (manifest.versionMetadata) {
    console.log(chalk.bold('Version Metadata:'));
    for (const [version, meta] of Object.entries(manifest.versionMetadata)) {
      const statusColor =
        meta.status === 'validated'
          ? chalk.green
          : meta.status === 'in-progress'
          ? chalk.yellow
          : chalk.dim;
      console.log(`  ${version}:`);
      console.log(`    Branch:   ${chalk.cyan(meta.nodeBranch)}`);
      console.log(`    Status:   ${statusColor(meta.status)}`);
      if (meta.ported) {
        console.log(`    Ported:   ${meta.ported}`);
      }
    }
    console.log();
  }

  // Component status counts
  const statusCounts = countComponentsByStatus(manifest);
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  console.log(chalk.bold('Component Status:'));
  console.log(`  ${chalk.green('✓')} Validated:    ${statusCounts.validated || 0}`);
  console.log(`  ${chalk.green('✓')} Implemented:  ${statusCounts.implemented || 0}`);
  console.log(`  ${chalk.yellow('◐')} In Progress:  ${statusCounts['in-progress'] || 0}`);
  console.log(`  ${chalk.dim('○')} Pending:      ${statusCounts.pending || 0}`);
  console.log(`  ${chalk.cyan('◑')} Partial:      ${statusCounts.partial || 0}`);
  console.log(`  ${chalk.bold('Total:')}         ${total}`);
  console.log();

  // Category breakdown
  const components = getAllComponents(manifest);
  const byCategory = new Map<string, { count: number; implemented: number }>();

  for (const { category, component } of components) {
    const entry = byCategory.get(category) || { count: 0, implemented: 0 };
    entry.count++;
    if (component.status === 'implemented' || component.status === 'validated') {
      entry.implemented++;
    }
    byCategory.set(category, entry);
  }

  console.log(chalk.bold('Components by Category:'));
  for (const [category, stats] of byCategory) {
    const pct = Math.round((stats.implemented / stats.count) * 100);
    const bar = getProgressBar(pct);
    console.log(`  ${category.padEnd(15)} ${bar} ${stats.implemented}/${stats.count} (${pct}%)`);
  }
  console.log();

  // Verbose: show all components
  if (verbose) {
    console.log(chalk.bold('All Components:'));
    for (const [category, comps] of Object.entries(manifest.components)) {
      if (!comps) continue;
      console.log(`\n  ${chalk.bold.cyan(category)}:`);
      for (const [name, comp] of Object.entries(comps)) {
        const statusIcon = getStatusIcon(comp.status);
        const version = comp.javaVersion ? chalk.dim(` (${comp.javaVersion})`) : '';
        console.log(`    ${statusIcon} ${name}${version}`);
        if (comp.description) {
          console.log(`      ${chalk.dim(comp.description)}`);
        }
      }
    }
    console.log();
  }

  // Phase progress
  if (manifest.phaseProgress) {
    console.log(chalk.bold('Phase Progress:'));
    for (const [phase, status] of Object.entries(manifest.phaseProgress)) {
      const phaseName = phase.replace(/_/g, ' ').replace(/phase\d+\s+/, '');
      const statusIcon = status === 'implemented' ? chalk.green('✓') : chalk.yellow('◐');
      console.log(`  ${statusIcon} ${phaseName}: ${status}`);
    }
    console.log();
  }

  // Quick actions
  console.log(chalk.bold('Quick Actions:'));
  console.log(`  ${chalk.dim('mirth-version diff 3.9.1 3.10.0')}  - See changes in next version`);
  console.log(`  ${chalk.dim('mirth-version upgrade plan 3.10.0')}  - Plan upgrade`);
  console.log();
}

function getProgressBar(pct: number): string {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'validated':
      return chalk.green('✓');
    case 'implemented':
      return chalk.green('✓');
    case 'in-progress':
      return chalk.yellow('◐');
    case 'partial':
      return chalk.cyan('◑');
    case 'pending':
    default:
      return chalk.dim('○');
  }
}
