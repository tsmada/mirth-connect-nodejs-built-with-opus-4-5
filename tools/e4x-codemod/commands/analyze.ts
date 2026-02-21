/**
 * `analyze` command — scan channel scripts for E4X patterns and report findings.
 */

import * as fs from 'fs';
import { CodemodEngine } from '../core/CodemodEngine.js';
import { ReportFormatter } from '../output/ReportFormatter.js';
import { resolveSource } from './helpers.js';
import type { AnalyzeOptions } from '../types.js';

export async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  const sources = resolveSource(options);
  if (sources.length === 0) {
    console.error('Error: Specify --channel-xml <paths...> or --repo <path>');
    process.exit(1);
  }

  const engine = new CodemodEngine();
  const report = engine.analyze(sources);

  // Filter to specific pattern type if requested
  if (options.pattern) {
    for (const channel of report.channels) {
      for (const script of channel.scripts) {
        script.patterns = script.patterns.filter(p => p.type === options.pattern);
      }
    }
  }

  // Filter to unsupported-only if requested
  if (options.unsupportedOnly) {
    for (const channel of report.channels) {
      for (const script of channel.scripts) {
        script.patterns = script.patterns.filter(p => !p.runtimeHandled);
      }
    }
  }

  const formatter = new ReportFormatter();
  const output = options.json
    ? formatter.formatAnalysisJson(report)
    : formatter.formatAnalysis(report);

  if (options.output) {
    fs.writeFileSync(options.output, output, 'utf-8');
    console.log(`Report written to ${options.output}`);
  } else {
    console.log(output);
  }
}
