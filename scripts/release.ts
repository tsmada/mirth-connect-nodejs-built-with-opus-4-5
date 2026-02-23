#!/usr/bin/env npx tsx
/**
 * Release orchestration script for mirth-connect-nodejs.
 *
 * Usage:
 *   npm run release              # Bump port iteration
 *   npm run release:dry          # Preview without changes
 *   npm run release -- --java 3.10.0   # Upgrade Java version
 *   npm run release -- --skip-tests    # Skip test suite
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Types
interface ReleaseConfig {
  javaVersion: string;
  portIteration: number;
  tagPrefix: string;
  tagFormat: string;
}

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

// Helpers
const ROOT = resolve(import.meta.dirname, '..');
const RELEASE_JSON = resolve(ROOT, '.release.json');
const PACKAGE_JSON = resolve(ROOT, 'package.json');
const MANIFEST_JSON = resolve(ROOT, 'manifest.json');
const CHANGELOG_MD = resolve(ROOT, 'CHANGELOG.md');

function run(cmd: string, opts?: { silent?: boolean }): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: opts?.silent ? 'pipe' : 'inherit' }).trim();
  } catch {
    return '';
  }
}

function runCapture(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function formatTag(config: ReleaseConfig): string {
  return `${config.tagPrefix}${config.javaVersion}-port.${config.portIteration}`;
}

function formatVersion(config: ReleaseConfig): string {
  return `${config.javaVersion}-port.${config.portIteration}`;
}

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipTests = args.includes('--skip-tests');
const javaIdx = args.indexOf('--java');
const newJavaVersion = javaIdx !== -1 ? args[javaIdx + 1] : null;

if (newJavaVersion && !/^\d+\.\d+\.\d+$/.test(newJavaVersion)) {
  console.error(`Error: Invalid Java version format: ${newJavaVersion} (expected X.Y.Z)`);
  process.exit(1);
}

// Main
async function main() {
  console.log(dryRun ? '\nDRY RUN — no changes will be made\n' : '\nStarting release...\n');

  // 1. Validate clean working tree
  const status = runCapture('git status --porcelain');
  if (status && !dryRun) {
    console.error('Error: Working tree is not clean. Commit or stash changes first.');
    console.error(status);
    process.exit(1);
  }

  // 2. Run tests
  if (!skipTests && !dryRun) {
    console.log('Running tests...');
    run('npm test');
    console.log('Tests passed.\n');
  } else if (skipTests) {
    console.log('Skipping tests (--skip-tests)\n');
  }

  // 3. Read current state
  const config = readJson<ReleaseConfig>(RELEASE_JSON);
  const pkg = readJson<PackageJson>(PACKAGE_JSON);
  const previousTag = formatTag(config);
  const previousVersion = formatVersion(config);

  // 4. Bump version
  if (newJavaVersion) {
    config.javaVersion = newJavaVersion;
    config.portIteration = 0;
    console.log(`Java version upgrade: ${previousVersion} -> ${formatVersion(config)}`);
  } else {
    config.portIteration += 1;
    console.log(`Port iteration bump: ${previousVersion} -> ${formatVersion(config)}`);
  }

  const newVersion = formatVersion(config);
  const newTag = formatTag(config);

  console.log(`  Version: ${newVersion}`);
  console.log(`  Tag:     ${newTag}`);
  console.log('');

  if (dryRun) {
    // Generate preview changelog
    const changelogPreview = generateChangelog(previousTag, newTag, newVersion, config);
    console.log('--- CHANGELOG PREVIEW ---');
    console.log(changelogPreview);
    console.log('--- END PREVIEW ---\n');
    console.log(`Dry run complete. Run without --dry-run to apply.`);
    return;
  }

  // 5. Write .release.json
  writeJson(RELEASE_JSON, config);

  // 6. Update package.json version
  pkg.version = newVersion;
  writeJson(PACKAGE_JSON, pkg);

  // 7. Update manifest.json if Java version changed
  if (newJavaVersion) {
    const manifest = readJson<Record<string, unknown>>(MANIFEST_JSON);
    const compat = manifest.mirthCompatibility as Record<string, unknown>;
    compat.current = newJavaVersion;
    writeJson(MANIFEST_JSON, manifest);
    console.log(`Updated manifest.json mirthCompatibility.current -> ${newJavaVersion}`);
  }

  // 8. Generate changelog entry
  const changelogEntry = generateChangelog(previousTag, newTag, newVersion, config);
  prependChangelog(changelogEntry);
  console.log('Updated CHANGELOG.md');

  // 9. Commit
  run('git add .release.json package.json CHANGELOG.md' + (newJavaVersion ? ' manifest.json' : ''));
  run(`git commit -m "chore(release): ${newTag}"`);
  console.log(`Committed: chore(release): ${newTag}`);

  // 10. Tag
  run(`git tag -a ${newTag} -m "Release ${newTag}"`);
  console.log(`Tagged: ${newTag}`);

  // 11. Instructions
  console.log('\nRelease created successfully!\n');
  console.log('To publish:');
  console.log(`  git push origin master --follow-tags`);
  console.log('');
}

function generateChangelog(previousTag: string, newTag: string, version: string, config: ReleaseConfig): string {
  const date = new Date().toISOString().split('T')[0];
  let header = `## [${version}](../../compare/${previousTag}...${newTag}) (${date})\n\n`;
  header += `**Java Mirth Version:** ${config.javaVersion}\n\n`;

  // Try to get commits since last tag
  let commits = '';
  try {
    const tagExists = runCapture(`git tag -l "${previousTag}"`);
    if (tagExists) {
      commits = runCapture(`git log ${previousTag}..HEAD --pretty=format:"%s" --no-merges`);
    } else {
      // No previous tag -- get recent commits
      commits = runCapture('git log --pretty=format:"%s" --no-merges -50');
    }
  } catch {
    commits = '';
  }

  if (!commits) {
    return header + '* Initial release\n\n';
  }

  // Group by conventional commit type
  const groups: Record<string, string[]> = {};
  const typeLabels: Record<string, string> = {
    feat: 'Features',
    fix: 'Bug Fixes',
    perf: 'Performance',
    refactor: 'Refactoring',
    docs: 'Documentation',
    test: 'Tests',
    ci: 'CI/CD',
    chore: 'Chores',
    build: 'Build',
    style: 'Styles',
  };

  for (const line of commits.split('\n')) {
    const match = line.match(/^(\w+)(?:\(([^)]*)\))?:\s*(.+)$/);
    if (match) {
      const [, type, , message] = match;
      const label = typeLabels[type!] || 'Other';
      if (!groups[label]) groups[label] = [];
      groups[label]!.push(`* ${line}`);
    } else {
      if (!groups['Other']) groups['Other'] = [];
      groups['Other']!.push(`* ${line}`);
    }
  }

  let body = '';
  // Features first, then Bug Fixes, then rest alphabetically
  const orderedKeys = ['Features', 'Bug Fixes', 'Performance'];
  const remaining = Object.keys(groups).filter(k => !orderedKeys.includes(k)).sort();

  for (const key of [...orderedKeys, ...remaining]) {
    if (groups[key] && groups[key]!.length > 0) {
      body += `### ${key}\n\n`;
      body += groups[key]!.join('\n') + '\n\n';
    }
  }

  return header + body;
}

function prependChangelog(entry: string): void {
  let existing = '';
  try {
    existing = readFileSync(CHANGELOG_MD, 'utf-8');
  } catch {
    existing = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).\nVersion scheme: `JAVA_VERSION-port.N` where N is the port iteration.\n\n';
  }

  // Insert after the header (first two lines)
  const headerEnd = existing.indexOf('\n\n', existing.indexOf('\n\n') + 2);
  if (headerEnd !== -1) {
    const header = existing.slice(0, headerEnd + 2);
    const rest = existing.slice(headerEnd + 2);
    writeFileSync(CHANGELOG_MD, header + entry + rest, 'utf-8');
  } else {
    writeFileSync(CHANGELOG_MD, existing + '\n' + entry, 'utf-8');
  }
}

main().catch(err => {
  console.error('Release failed:', err);
  process.exit(1);
});
