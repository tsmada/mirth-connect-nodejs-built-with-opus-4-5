/**
 * Shared types and report generator for the Progressive Migration Validation Pipeline.
 *
 * Used by ProgressiveMigrationRunner to:
 * 1. Record per-stage test results (StageResult)
 * 2. Generate a cross-stage comparison report (ComparisonReport)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TargetStage = 'java' | 'shadow' | 'takeover' | 'standalone';

export interface StageResult {
  target: TargetStage;
  timestamp: string;
  duration: number; // ms
  checks: Check[];
  messageTests: MessageTestResult[];
  metadata: {
    serverId?: string;
    mode?: string;
    shadowMode?: boolean;
    schemaVersion?: string;
    channelCount: number;
    startedChannelCount: number;
  };
}

export interface Check {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  expected: string;
  actual: string;
}

export interface MessageTestResult {
  name: string;
  protocol: 'mllp' | 'http';
  port: number;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
  responseCode?: string;
  duration: number; // ms
  error?: string;
}

export interface ComparisonReport {
  timestamp: string;
  stages: StageResult[];
  matrix: { test: string; java: string; shadow: string; takeover: string; standalone: string }[];
  confidenceScore: number;
  overallResult: 'PASS' | 'FAIL';
}

// ---------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------

/**
 * Read all stage-*.json files from a directory, build a comparison matrix,
 * and compute a confidence score.
 */
export function generateComparisonReport(reportDir: string): ComparisonReport {
  const stages: StageResult[] = [];
  const stageFiles = fs.readdirSync(reportDir).filter(f => f.startsWith('stage-') && f.endsWith('.json')).sort();

  for (const file of stageFiles) {
    const content = fs.readFileSync(path.join(reportDir, file), 'utf-8');
    stages.push(JSON.parse(content) as StageResult);
  }

  // Collect all unique test names (checks + message tests)
  const testNames = new Set<string>();
  for (const stage of stages) {
    for (const check of stage.checks) testNames.add(check.name);
    for (const mt of stage.messageTests) testNames.add(mt.name);
  }

  // Build comparison matrix
  const matrix: ComparisonReport['matrix'] = [];
  for (const testName of Array.from(testNames)) {
    const row: ComparisonReport['matrix'][0] = {
      test: testName,
      java: '--',
      shadow: '--',
      takeover: '--',
      standalone: '--',
    };
    for (const stage of stages) {
      const check = stage.checks.find(c => c.name === testName);
      const msgTest = stage.messageTests.find(m => m.name === testName);
      const status = check?.status ?? msgTest?.status ?? '--';
      row[stage.target] = status;
    }
    matrix.push(row);
  }

  // Compute confidence score: percentage of non-skip, non-'--' entries that pass
  let totalApplicable = 0;
  let totalPass = 0;
  for (const row of matrix) {
    for (const target of ['java', 'shadow', 'takeover', 'standalone'] as const) {
      const val = row[target];
      if (val !== '--' && val !== 'SKIP') {
        totalApplicable++;
        if (val === 'PASS') totalPass++;
      }
    }
  }
  const confidenceScore = totalApplicable > 0 ? Math.round((totalPass / totalApplicable) * 100) : 0;
  const overallResult: 'PASS' | 'FAIL' = confidenceScore >= 80 ? 'PASS' : 'FAIL';

  return {
    timestamp: new Date().toISOString(),
    stages,
    matrix,
    confidenceScore,
    overallResult,
  };
}
