/**
 * `diff` command — show before/after diff for E4X transformations (dry run).
 */

import { CodemodEngine } from '../core/CodemodEngine.js';
import { DiffFormatter } from '../output/DiffFormatter.js';
import { resolveSource } from './helpers.js';
import type { DiffOptions } from '../types.js';

export async function runDiff(options: DiffOptions): Promise<void> {
  const sources = resolveSource(options);
  if (sources.length === 0) {
    console.error('Error: Specify --channel-xml <paths...> or --repo <path>');
    process.exit(1);
  }

  const engine = new CodemodEngine();
  const changedResults = engine.diff(sources);

  if (changedResults.length === 0) {
    console.log('No E4X patterns found — no transformations needed.');
    return;
  }

  const formatter = new DiffFormatter({ color: !options.json });

  if (options.json) {
    const output = changedResults.map(r => ({
      location: r.location,
      original: r.original,
      transformed: r.transformed,
      patterns: r.transformedPatterns,
      warnings: r.warnings,
    }));
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatter.formatDiffs(changedResults));
    console.log(`\n${changedResults.length} script(s) with E4X transformations.`);
  }
}
