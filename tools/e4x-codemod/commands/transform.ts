/**
 * `transform` command — apply E4X transformations to channel scripts.
 */

import { CodemodEngine } from '../core/CodemodEngine.js';
import { DiffFormatter } from '../output/DiffFormatter.js';
import { BackupManager } from '../output/BackupManager.js';
import { ChannelXmlWriter } from '../output/ChannelXmlWriter.js';
import { VerificationEngine } from '../verify/VerificationEngine.js';
import { ReportFormatter } from '../output/ReportFormatter.js';
import { resolveSource } from './helpers.js';
import type { TransformOptions } from '../types.js';

export async function runTransform(options: TransformOptions): Promise<void> {
  const sources = resolveSource(options);
  if (sources.length === 0) {
    console.error('Error: Specify --channel-xml <paths...> or --repo <path>');
    process.exit(1);
  }

  const engine = new CodemodEngine();
  const channelResults = engine.transform(sources);

  const allResults = channelResults.flatMap(c => c.scripts);
  const changedResults = allResults.filter(r => r.changed);

  if (changedResults.length === 0) {
    console.log('No transformations needed — all scripts are clean.');
    return;
  }

  // Dry run: show diffs without writing
  if (options.dryRun) {
    const diffFormatter = new DiffFormatter();
    for (const result of changedResults) {
      console.log(diffFormatter.formatDiff(result));
    }
    console.log(`\n${changedResults.length} script(s) would be transformed.`);
    return;
  }

  // Backup originals (default: true)
  const shouldBackup = options.backup !== false;
  if (shouldBackup) {
    const backupManager = new BackupManager(options.backupDir);
    const backedUp = new Set<string>();
    for (const result of changedResults) {
      const filePath = result.location.filePath;
      if (filePath !== '<inline>' && !backedUp.has(filePath)) {
        backupManager.backup(filePath);
        backedUp.add(filePath);
      }
    }
    console.log(`Backed up ${backedUp.size} file(s).`);
  }

  // Write transformations
  const writer = new ChannelXmlWriter();
  const sourceType = sources[0]!.sourceType;

  if (sourceType === 'channel-xml') {
    // Group results by source file for XML write-back
    const byFile = new Map<string, typeof changedResults>();
    for (const result of changedResults) {
      const fp = result.location.filePath;
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp)!.push(result);
    }
    for (const [xmlPath, results] of byFile) {
      if (xmlPath !== '<inline>') {
        writer.writeChannelXml(xmlPath, results);
      }
    }
  } else {
    writer.writeArtifactRepo(changedResults);
  }

  console.log(`Transformed ${changedResults.length} script(s) across ${channelResults.filter(c => c.totalChanges > 0).length} channel(s).`);

  // Print warnings
  const totalWarnings = allResults.reduce((sum, r) => sum + r.warnings.length, 0);
  if (totalWarnings > 0) {
    console.log(`\nWarnings (${totalWarnings}):`);
    for (const result of allResults) {
      for (const warning of result.warnings) {
        const loc = [result.location.channelName, result.location.connectorName, result.location.scriptType]
          .filter(Boolean).join(' > ');
        console.log(`  ${warning.severity.toUpperCase()} [${loc}] line ${warning.line}: ${warning.message}`);
      }
    }
  }

  // Verify if requested
  if (options.verify) {
    const verifier = new VerificationEngine();
    const report = verifier.verify(changedResults);
    const formatter = new ReportFormatter();
    console.log('\n' + formatter.formatVerification(report));
  }
}
