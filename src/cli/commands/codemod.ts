/**
 * mirth-cli codemod commands
 *
 * Thin wrapper around the standalone E4X codemod tool (tools/e4x-codemod/).
 * Uses dynamic imports to avoid rootDir constraint (tools/ is outside src/).
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Resolve the tools directory relative to this file's location.
// At runtime: dist/cli/commands/codemod.js → ../../.. → project root → tools/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Dynamically load codemod modules from tools/e4x-codemod/.
 * The dynamic import avoids TS6059 (file outside rootDir).
 */
async function loadCodemod() {
  const toolsBase = path.join(PROJECT_ROOT, 'tools', 'e4x-codemod');
  const [core, sources, output, verify] = await Promise.all([
    import(path.join(toolsBase, 'core', 'CodemodEngine.js')),
    import(path.join(toolsBase, 'sources', 'index.js')),
    import(path.join(toolsBase, 'output', 'index.js')),
    import(path.join(toolsBase, 'verify', 'index.js')),
  ]);
  return {
    CodemodEngine: core.CodemodEngine as new () => { analyze: (s: any[]) => any; transform: (s: any[]) => any; diff: (s: any[]) => any },
    ChannelXmlSource: sources.ChannelXmlSource as new (p: string) => any,
    ArtifactRepoSource: sources.ArtifactRepoSource as new (p: string) => any,
    DiffFormatter: output.DiffFormatter as new (opts?: any) => { formatDiff: (r: any) => string; formatDiffs: (r: any[]) => string },
    ReportFormatter: output.ReportFormatter as new () => { formatAnalysis: (r: any) => string; formatAnalysisJson: (r: any) => string; formatVerification: (r: any) => string; formatVerificationJson: (r: any) => string },
    BackupManager: output.BackupManager as new (dir?: string) => { backup: (p: string) => string },
    ChannelXmlWriter: output.ChannelXmlWriter as new () => { writeChannelXml: (p: string, r: any[]) => void; writeArtifactRepo: (r: any[]) => void },
    VerificationEngine: verify.VerificationEngine as new () => { verify: (r: any[]) => any },
  };
}

function resolveSources(options: { channelXml?: string[]; repo?: string }, classes: any) {
  const sources: any[] = [];
  if (options.channelXml) {
    for (const p of options.channelXml) {
      const resolved = path.resolve(p);
      if (fs.existsSync(resolved)) sources.push(new classes.ChannelXmlSource(resolved));
    }
  }
  if (options.repo) {
    const resolved = path.resolve(options.repo);
    if (fs.existsSync(resolved)) sources.push(new classes.ArtifactRepoSource(resolved));
  }
  return sources;
}

export function registerCodemodCommands(program: Command): void {
  const codemod = program
    .command('codemod')
    .description('Analyze and transform E4X syntax in channel scripts');

  codemod
    .command('analyze')
    .description('Scan channel scripts for E4X patterns')
    .option('--channel-xml <paths...>', 'Channel XML file(s)')
    .option('--repo <path>', 'Decomposed artifact repo directory')
    .option('--json', 'Output as JSON')
    .option('--unsupported-only', 'Show only unsupported patterns')
    .action(async (options) => {
      const mod = await loadCodemod();
      const sources = resolveSources(options, mod);
      if (sources.length === 0) { console.error('Specify --channel-xml or --repo'); return; }
      const report = new mod.CodemodEngine().analyze(sources);
      const formatter = new mod.ReportFormatter();
      console.log(options.json ? formatter.formatAnalysisJson(report) : formatter.formatAnalysis(report));
    });

  codemod
    .command('transform')
    .description('Apply E4X transformations')
    .option('--channel-xml <paths...>', 'Channel XML file(s)')
    .option('--repo <path>', 'Decomposed artifact repo directory')
    .option('--dry-run', 'Show what would change without writing')
    .option('--backup', 'Create .bak files (default: true)', true)
    .option('--no-backup', 'Skip backup')
    .option('--verify', 'Run verification after transform')
    .action(async (options) => {
      const mod = await loadCodemod();
      const sources = resolveSources(options, mod);
      if (sources.length === 0) { console.error('Specify --channel-xml or --repo'); return; }
      const results = new mod.CodemodEngine().transform(sources);
      const changed = results.flatMap((c: any) => c.scripts).filter((r: any) => r.changed);
      if (changed.length === 0) { console.log('No transformations needed.'); return; }

      if (options.dryRun) {
        const diff = new mod.DiffFormatter();
        changed.forEach((r: any) => console.log(diff.formatDiff(r)));
        console.log(`\n${changed.length} script(s) would be transformed.`);
        return;
      }

      if (options.backup !== false) {
        const bm = new mod.BackupManager();
        const seen = new Set<string>();
        for (const r of changed) {
          if (r.location.filePath !== '<inline>' && !seen.has(r.location.filePath)) {
            bm.backup(r.location.filePath); seen.add(r.location.filePath);
          }
        }
      }

      const writer = new mod.ChannelXmlWriter();
      if (sources[0]!.sourceType === 'channel-xml') {
        const byFile = new Map<string, typeof changed>();
        for (const r of changed) {
          if (!byFile.has(r.location.filePath)) byFile.set(r.location.filePath, []);
          byFile.get(r.location.filePath)!.push(r);
        }
        for (const [fp, rs] of byFile) writer.writeChannelXml(fp, rs);
      } else {
        writer.writeArtifactRepo(changed);
      }
      console.log(`Transformed ${changed.length} script(s).`);

      if (options.verify) {
        const report = new mod.VerificationEngine().verify(changed);
        console.log(new mod.ReportFormatter().formatVerification(report));
      }
    });

  codemod
    .command('verify')
    .description('Verify codemod output matches runtime transpiler')
    .option('--channel-xml <paths...>', 'Channel XML file(s)')
    .option('--repo <path>', 'Decomposed artifact repo directory')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const mod = await loadCodemod();
      const sources = resolveSources(options, mod);
      if (sources.length === 0) { console.error('Specify --channel-xml or --repo'); return; }
      const results = new mod.CodemodEngine().transform(sources).flatMap((c: any) => c.scripts).filter((r: any) => r.changed);
      const report = new mod.VerificationEngine().verify(results);
      const formatter = new mod.ReportFormatter();
      console.log(options.json ? formatter.formatVerificationJson(report) : formatter.formatVerification(report));
    });

  codemod
    .command('diff')
    .description('Show before/after diff of transformations')
    .option('--channel-xml <paths...>', 'Channel XML file(s)')
    .option('--repo <path>', 'Decomposed artifact repo directory')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const mod = await loadCodemod();
      const sources = resolveSources(options, mod);
      if (sources.length === 0) { console.error('Specify --channel-xml or --repo'); return; }
      const changed = new mod.CodemodEngine().diff(sources);
      if (changed.length === 0) { console.log('No E4X patterns found.'); return; }
      if (options.json) {
        console.log(JSON.stringify(changed.map((r: any) => ({
          location: r.location, original: r.original, transformed: r.transformed,
          patterns: r.transformedPatterns, warnings: r.warnings,
        })), null, 2));
      } else {
        const diff = new mod.DiffFormatter();
        console.log(diff.formatDiffs(changed));
        console.log(`\n${changed.length} script(s) with E4X transformations.`);
      }
    });
}
