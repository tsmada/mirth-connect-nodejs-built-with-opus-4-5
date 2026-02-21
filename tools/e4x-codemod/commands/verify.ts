/**
 * `verify` command — verify that codemod transformations match runtime transpiler output.
 */

import { CodemodEngine } from '../core/CodemodEngine.js';
import { VerificationEngine } from '../verify/VerificationEngine.js';
import { ReportFormatter } from '../output/ReportFormatter.js';
import { resolveSource } from './helpers.js';
import type { VerifyOptions } from '../types.js';

export async function runVerify(options: VerifyOptions): Promise<void> {
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
    console.log('No transformations to verify — all scripts are clean.');
    return;
  }

  const verifier = new VerificationEngine();
  const report = verifier.verify(changedResults);

  const formatter = new ReportFormatter();
  const output = options.json
    ? formatter.formatVerificationJson(report)
    : formatter.formatVerification(report);

  console.log(output);

  // Exit with error code if any verification failures
  if (report.summary.failed > 0) {
    process.exit(1);
  }
}
