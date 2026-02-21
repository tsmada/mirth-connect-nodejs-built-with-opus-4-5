import chalk from 'chalk';
import type { AnalysisReport, VerificationReport } from '../types.js';

export class ReportFormatter {
  formatAnalysis(report: AnalysisReport): string {
    const s = report.summary;
    const lines: string[] = [];

    lines.push(chalk.bold('E4X Migration Analysis'));
    lines.push('======================');
    lines.push(`Source: ${report.sourcePath} (${report.sourceType})`);
    lines.push(`Scanned: ${s.totalScripts} scripts across ${s.totalChannels} channels`);
    lines.push('');

    const e4xPct = s.totalScripts > 0
      ? Math.round((s.scriptsWithE4X / s.totalScripts) * 100) : 0;

    lines.push(`Scripts with E4X:     ${s.scriptsWithE4X} (${e4xPct}%)`);

    const runtimeOnly = s.scriptsWithE4X - report.channels.reduce(
      (n, c) => n + c.scripts.filter(sc => sc.extendedCount > 0 || sc.manualReviewCount > 0).length, 0
    );
    const unsupported = s.scriptsWithE4X - runtimeOnly;
    lines.push(`  Supported (runtime): ${runtimeOnly} (will work as-is on Node.js)`);
    lines.push(`  Unsupported:         ${unsupported} (require codemod transformation)`);
    lines.push('');

    // Pattern histogram
    lines.push(chalk.bold('Pattern Breakdown:'));
    const entries = Object.entries(report.patternHistogram)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a);

    if (entries.length > 0) {
      const maxCount = entries[0]![1];
      const maxBarWidth = 20;

      for (const [patternType, count] of entries) {
        const pct = s.totalPatterns > 0
          ? Math.round((count / s.totalPatterns) * 100) : 0;
        const barLen = maxCount > 0
          ? Math.max(1, Math.round((count / maxCount) * maxBarWidth)) : 0;
        const bar = '\u2588'.repeat(barLen);
        const label = patternType.padEnd(24);
        const countStr = String(count).padStart(4);
        lines.push(`  ${label}${countStr}  ${bar}  (${pct}%)`);
      }
    } else {
      lines.push('  (none)');
    }
    lines.push('');

    // Channels requiring codemod
    const needCodemod = report.channels.filter(c => !c.safeForTakeover);
    if (needCodemod.length > 0) {
      lines.push(chalk.bold('Channels Requiring Codemod:'));
      for (const ch of needCodemod) {
        const scripts = ch.scripts.filter(sc => sc.extendedCount > 0 || sc.manualReviewCount > 0);
        for (const sc of scripts) {
          const patterns = sc.patterns
            .filter(p => !p.runtimeHandled)
            .map(p => p.type);
          const unique = [...new Set(patterns)].join(', ');
          const loc = sc.location.connectorName
            ? `${sc.location.connectorName} > ${sc.location.scriptType}`
            : sc.location.scriptType;
          lines.push(`  ${chalk.yellow('\u26A0')} ${ch.channelName}  \u2192 ${loc} (${unique})`);
        }
      }
      lines.push('');
    }

    // Channels safe for takeover
    const safe = report.channels.filter(c => c.safeForTakeover);
    if (safe.length > 0) {
      lines.push(chalk.bold('Channels Safe for Takeover:'));
      for (const ch of safe) {
        lines.push(`  ${chalk.green('\u2713')} ${ch.channelName}  (${ch.totalPatterns} patterns, all runtime-supported)`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  formatAnalysisJson(report: AnalysisReport): string {
    return JSON.stringify(report, null, 2);
  }

  formatVerification(report: VerificationReport): string {
    const s = report.summary;
    const lines: string[] = [];

    lines.push(chalk.bold('E4X Codemod Verification'));
    lines.push('========================');
    lines.push(`Total: ${s.total}  Passed: ${chalk.green(String(s.passed))}  Failed: ${chalk.red(String(s.failed))}  Extended divergences: ${s.extendedDivergences}`);
    lines.push('');

    for (const r of report.results) {
      const loc = this.formatLocation(r.location);
      if (r.passed) {
        if (r.hasExtendedTransforms) {
          lines.push(`  ${chalk.yellow('~')} ${loc} (passed with expected extended divergences)`);
        } else {
          lines.push(`  ${chalk.green('\u2713')} ${loc}`);
        }
      } else {
        lines.push(`  ${chalk.red('\u2717')} ${loc}`);
        for (const diff of r.differences) {
          lines.push(`    ${chalk.gray(diff)}`);
        }
      }
    }

    return lines.join('\n');
  }

  formatVerificationJson(report: VerificationReport): string {
    return JSON.stringify(report, null, 2);
  }

  private formatLocation(location: { channelName: string; connectorName?: string; scriptType: string }): string {
    const parts = [location.channelName];
    if (location.connectorName) parts.push(location.connectorName);
    parts.push(location.scriptType);
    return parts.join(' > ');
  }
}
