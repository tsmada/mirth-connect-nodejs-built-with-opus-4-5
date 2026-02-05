/**
 * Branch command - Manage version branches.
 */

import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import { simpleGit, SimpleGit } from 'simple-git';
import { parseVersion, getVersionBranch } from '../models/Version.js';
import { loadManifest, saveManifest, getCurrentVersion } from '../models/Manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'manifest.json');

interface BranchOptions {
  from?: string;
}

export async function branchCommand(
  action: string,
  version: string,
  options: BranchOptions
): Promise<void> {
  try {
    parseVersion(version);
    const git: SimpleGit = simpleGit(PROJECT_ROOT);

    switch (action) {
      case 'create':
        await createVersionBranch(git, version, options.from);
        break;
      case 'status':
        await showBranchStatus(git, version);
        break;
      case 'merge':
        await mergeBranch(git, version);
        break;
      default:
        console.error(chalk.red(`Unknown branch action: ${action}`));
        console.log(chalk.dim('  Available actions: create, status, merge'));
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

async function createVersionBranch(
  git: SimpleGit,
  version: string,
  fromBranch?: string
): Promise<void> {
  const branchName = getVersionBranch(version);
  const sourceBranch = fromBranch || 'master';

  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold(`  Creating Version Branch: ${branchName}`));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════\n'));

  // Check if branch already exists
  const branches = await git.branch();
  if (branches.all.includes(branchName)) {
    console.log(chalk.yellow(`  Branch ${branchName} already exists.`));
    console.log(chalk.dim(`  To switch: git checkout ${branchName}`));
    return;
  }

  // Create branch
  console.log(`  Creating branch from ${chalk.cyan(sourceBranch)}...`);
  await git.checkoutBranch(branchName, sourceBranch);

  console.log(chalk.green(`  ✓ Created and switched to ${branchName}`));
  console.log();

  // Update manifest
  console.log('  Updating manifest.json...');
  const manifest = await loadManifest(MANIFEST_PATH);

  // Add version metadata
  if (!manifest.versionMetadata) {
    manifest.versionMetadata = {};
  }

  manifest.versionMetadata[version] = {
    nodeBranch: branchName,
    javaTag: version,
    status: 'in-progress',
    ported: new Date().toISOString().split('T')[0],
  };

  // Update compatibility
  if (typeof manifest.mirthCompatibility !== 'string') {
    // Add to tested versions if not already there
    if (!manifest.mirthCompatibility.tested) {
      manifest.mirthCompatibility.tested = [];
    }
    if (!manifest.mirthCompatibility.tested.includes(version)) {
      manifest.mirthCompatibility.tested.push(version);
    }
  }

  await saveManifest(MANIFEST_PATH, manifest);
  console.log(chalk.green('  ✓ Updated manifest.json'));

  console.log();
  console.log(chalk.bold('Next Steps:'));
  console.log(
    `  1. Run ${chalk.dim(`mirth-version diff ${getCurrentVersion(manifest)} ${version}`)} to see changes`
  );
  console.log(
    `  2. Run ${chalk.dim(`mirth-version upgrade tasks ${version}`)} to generate tasks`
  );
  console.log(
    `  3. Work through the generated tasks in tasks/upgrade-${version}.md`
  );
  console.log();
}

async function showBranchStatus(git: SimpleGit, version: string): Promise<void> {
  const branchName = getVersionBranch(version);

  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold(`  Branch Status: ${branchName}`));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════\n'));

  const branches = await git.branch();
  const branchExists = branches.all.includes(branchName);

  if (!branchExists) {
    console.log(chalk.yellow(`  Branch ${branchName} does not exist.`));
    console.log(
      chalk.dim(`  Create it with: mirth-version branch create ${version}`)
    );
    return;
  }

  const isCurrentBranch = branches.current === branchName;
  console.log(
    `  Branch:   ${chalk.cyan(branchName)} ${isCurrentBranch ? chalk.green('(current)') : ''}`
  );

  // Get commit counts
  try {
    const masterLog = await git.log(['master', `^${branchName}`]);
    const branchLog = await git.log([branchName, '^master']);

    console.log(`  Behind master: ${masterLog.total} commits`);
    console.log(`  Ahead of master: ${branchLog.total} commits`);
  } catch {
    console.log(chalk.dim('  Unable to compare with master'));
  }

  // Show manifest status
  const manifest = await loadManifest(MANIFEST_PATH);
  const versionMeta = manifest.versionMetadata?.[version];

  if (versionMeta) {
    console.log();
    console.log(chalk.bold('  Version Metadata:'));
    console.log(`    Status: ${getStatusBadge(versionMeta.status)}`);
    if (versionMeta.ported) {
      console.log(`    Started: ${versionMeta.ported}`);
    }
    if (versionMeta.notes) {
      console.log(`    Notes: ${versionMeta.notes}`);
    }
  }

  console.log();
}

async function mergeBranch(git: SimpleGit, version: string): Promise<void> {
  const branchName = getVersionBranch(version);

  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold(`  Merge Branch: ${branchName} → master`));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════\n'));

  const branches = await git.branch();
  if (!branches.all.includes(branchName)) {
    console.log(chalk.red(`  Branch ${branchName} does not exist.`));
    return;
  }

  // Check for uncommitted changes
  const status = await git.status();
  if (!status.isClean()) {
    console.log(chalk.red('  Working directory has uncommitted changes.'));
    console.log(chalk.dim('  Please commit or stash changes before merging.'));
    return;
  }

  console.log(chalk.yellow('  This will merge the feature branch into master.'));
  console.log(chalk.dim(`  Equivalent to: git checkout master && git merge ${branchName}`));
  console.log();
  console.log(chalk.yellow('  Please run this manually for safety:'));
  console.log(chalk.dim(`    git checkout master`));
  console.log(chalk.dim(`    git merge --no-ff ${branchName} -m "Merge ${version} upgrade"`));
  console.log();

  // Update manifest status
  const manifest = await loadManifest(MANIFEST_PATH);
  if (manifest.versionMetadata?.[version]) {
    console.log(chalk.dim('  After merge, update manifest status:'));
    console.log(
      chalk.dim(
        `    manifest.versionMetadata["${version}"].status = "validated"`
      )
    );
  }
  console.log();
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'validated':
      return chalk.green('✓ validated');
    case 'stable':
      return chalk.green('✓ stable');
    case 'in-progress':
      return chalk.yellow('◐ in-progress');
    case 'planned':
      return chalk.dim('○ planned');
    default:
      return status;
  }
}
