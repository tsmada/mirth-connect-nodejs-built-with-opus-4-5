/**
 * CodemodEngine integration test.
 *
 * This test validates the output formatters and verification engine
 * independently. Full integration testing (CodemodEngine.analyze/transform)
 * depends on core/ and sources/ modules built by other agents.
 */

// Mock chalk v5 (ESM-only) for Jest CJS environment
jest.mock('chalk', () => {
  const passthrough = (...args: unknown[]) => args[0];
  const makeChain = (): unknown => new Proxy(passthrough, {
    get: (_target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      return makeChain();
    },
    apply: (_target, _thisArg, args) => args[0],
  });
  return { __esModule: true, default: makeChain() };
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiffFormatter } from '../output/DiffFormatter.js';
import { ReportFormatter } from '../output/ReportFormatter.js';
import { BackupManager } from '../output/BackupManager.js';
import { ChannelXmlWriter } from '../output/ChannelXmlWriter.js';
import type {
  TransformResult,
  ScriptLocation,
  AnalysisReport,
  VerificationReport,
  E4XPatternType,
} from '../types.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeLocation(overrides: Partial<ScriptLocation> = {}): ScriptLocation {
  return {
    channelName: 'ADT Receiver',
    connectorName: 'Source',
    scriptType: 'transformer',
    filePath: '/test/transformer.js',
    ...overrides,
  };
}

function makeResult(original: string, transformed: string, overrides: Partial<TransformResult> = {}): TransformResult {
  return {
    location: makeLocation(),
    original,
    transformed,
    changed: original !== transformed,
    transformedPatterns: [],
    warnings: [],
    untransformablePatterns: [],
    ...overrides,
  };
}

// ── DiffFormatter ───────────────────────────────────────────────

describe('DiffFormatter', () => {
  const fmt = new DiffFormatter({ color: false });

  it('returns empty string for unchanged results', () => {
    const result = makeResult('var x = 1;', 'var x = 1;');
    expect(fmt.formatDiff(result)).toBe('');
  });

  it('produces unified diff for changed scripts', () => {
    const result = makeResult(
      'var pid = msg..PID;\nvar mrn = pid.toString();',
      "var pid = msg.descendants('PID');\nvar mrn = pid.toString();",
      { transformedPatterns: ['descendant-access'] }
    );

    const diff = fmt.formatDiff(result);
    expect(diff).toContain('--- ADT Receiver > Source > transformer (original)');
    expect(diff).toContain('+++ ADT Receiver > Source > transformer (transformed)');
    expect(diff).toContain('@@');
    expect(diff).toContain('-var pid = msg..PID;');
    expect(diff).toContain("+var pid = msg.descendants('PID');");
  });

  it('formatDiffs skips unchanged and joins with double newline', () => {
    const changed = makeResult('var x = msg..PID;', "var x = msg.descendants('PID');");
    const unchanged = makeResult('var y = 1;', 'var y = 1;');
    const output = fmt.formatDiffs([changed, unchanged]);
    expect(output).toContain('ADT Receiver');
    expect(output).not.toContain('No changes');
  });

  it('returns "No changes." when nothing changed', () => {
    const unchanged = makeResult('var y = 1;', 'var y = 1;');
    expect(fmt.formatDiffs([unchanged])).toBe('No changes.');
  });
});

// ── ReportFormatter ─────────────────────────────────────────────

describe('ReportFormatter', () => {
  const fmt = new ReportFormatter();

  function makeAnalysisReport(): AnalysisReport {
    const histogram: Record<E4XPatternType, number> = {
      'xml-literal': 10,
      'descendant-access': 8,
      'attribute-read': 5,
      'attribute-write': 3,
      'for-each': 2,
      'xml-constructor': 4,
      'xml-append': 1,
      'default-namespace': 0,
      'filter-predicate': 0,
      'wildcard-attribute': 0,
      'wildcard-element': 0,
      'delete-property': 0,
      'namespace-constructor': 2,
      'qname-constructor': 0,
      'xml-settings': 1,
      'import-class': 1,
      'xmllist-constructor': 0,
    };

    return {
      timestamp: '2026-02-21T00:00:00.000Z',
      sourceType: 'artifact-repo',
      sourcePath: '/path/to/mirth-config',
      channels: [
        {
          channelName: 'ADT Receiver',
          channelId: 'ch-001',
          scripts: [{
            location: makeLocation(),
            patterns: [
              { type: 'descendant-access', line: 3, column: 10, match: 'msg..PID', confidence: 'definite', runtimeHandled: true },
            ],
            hasE4X: true,
            runtimeHandledCount: 1,
            extendedCount: 0,
            manualReviewCount: 0,
          }],
          totalPatterns: 1,
          runtimeHandledTotal: 1,
          extendedTotal: 0,
          manualReviewTotal: 0,
          safeForTakeover: true,
        },
        {
          channelName: 'Lab Orders',
          channelId: 'ch-002',
          scripts: [{
            location: makeLocation({ channelName: 'Lab Orders', scriptType: 'transformer' }),
            patterns: [
              { type: 'namespace-constructor', line: 1, column: 0, match: 'new Namespace', confidence: 'definite', runtimeHandled: false },
            ],
            hasE4X: true,
            runtimeHandledCount: 0,
            extendedCount: 1,
            manualReviewCount: 0,
          }],
          totalPatterns: 1,
          runtimeHandledTotal: 0,
          extendedTotal: 1,
          manualReviewTotal: 0,
          safeForTakeover: false,
        },
      ],
      summary: {
        totalChannels: 2,
        totalScripts: 4,
        scriptsWithE4X: 2,
        totalPatterns: 37,
        runtimeHandledPatterns: 33,
        extendedPatterns: 4,
        manualReviewPatterns: 0,
        channelsSafeForTakeover: 1,
        channelsRequiringCodemod: 1,
      },
      patternHistogram: histogram,
    };
  }

  it('formats analysis as human-readable text', () => {
    const text = fmt.formatAnalysis(makeAnalysisReport());
    expect(text).toContain('E4X Migration Analysis');
    expect(text).toContain('4 scripts across 2 channels');
    expect(text).toContain('Scripts with E4X:');
    expect(text).toContain('Pattern Breakdown:');
    expect(text).toContain('xml-literal');
    expect(text).toContain('ADT Receiver');
    expect(text).toContain('Lab Orders');
  });

  it('formats analysis as JSON', () => {
    const json = fmt.formatAnalysisJson(makeAnalysisReport());
    const parsed = JSON.parse(json);
    expect(parsed.summary.totalChannels).toBe(2);
    expect(parsed.patternHistogram['xml-literal']).toBe(10);
  });

  it('formats verification report as text', () => {
    const report: VerificationReport = {
      timestamp: '2026-02-21T00:00:00.000Z',
      results: [
        {
          location: makeLocation(),
          passed: true,
          codemodOutput: 'transformed',
          runtimeOutput: 'transformed',
          differences: [],
          hasExtendedTransforms: false,
        },
        {
          location: makeLocation({ channelName: 'Lab Orders', scriptType: 'filter' }),
          passed: false,
          codemodOutput: 'wrong',
          runtimeOutput: 'correct',
          differences: ['Line 1: runtime="correct" codemod="wrong"'],
          hasExtendedTransforms: false,
        },
      ],
      summary: { total: 2, passed: 1, failed: 1, extendedDivergences: 0 },
    };

    const text = fmt.formatVerification(report);
    expect(text).toContain('Verification');
    expect(text).toContain('Passed: ');
    expect(text).toContain('Failed: ');
    expect(text).toContain('ADT Receiver');
    expect(text).toContain('Lab Orders');
  });

  it('formats verification report as JSON', () => {
    const report: VerificationReport = {
      timestamp: '2026-02-21T00:00:00.000Z',
      results: [],
      summary: { total: 0, passed: 0, failed: 0, extendedDivergences: 0 },
    };
    const json = fmt.formatVerificationJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.summary.total).toBe(0);
  });
});

// ── BackupManager ───────────────────────────────────────────────

describe('BackupManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e4x-backup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates backup in same directory by default', () => {
    const filePath = path.join(tmpDir, 'test.js');
    fs.writeFileSync(filePath, 'original content');

    const mgr = new BackupManager();
    const backupPath = mgr.backup(filePath);

    expect(fs.existsSync(backupPath)).toBe(true);
    expect(path.dirname(backupPath)).toBe(tmpDir);
    expect(backupPath).toMatch(/test\.js\.\d{8}-\d{6}\.bak$/);
    expect(fs.readFileSync(backupPath, 'utf-8')).toBe('original content');
  });

  it('creates backup in specified directory', () => {
    const filePath = path.join(tmpDir, 'test.js');
    const backupDir = path.join(tmpDir, 'backups');
    fs.writeFileSync(filePath, 'original content');

    const mgr = new BackupManager(backupDir);
    const backupPath = mgr.backup(filePath);

    expect(path.dirname(backupPath)).toBe(backupDir);
    expect(fs.readFileSync(backupPath, 'utf-8')).toBe('original content');
  });

  it('restores from most recent backup', () => {
    const filePath = path.join(tmpDir, 'test.js');
    fs.writeFileSync(filePath, 'version 1');

    const mgr = new BackupManager();
    mgr.backup(filePath);

    // Overwrite the original
    fs.writeFileSync(filePath, 'version 2');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('version 2');

    // Restore
    const restored = mgr.restore(filePath);
    expect(restored).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('version 1');
  });

  it('returns false when no backup exists', () => {
    const mgr = new BackupManager();
    const result = mgr.restore(path.join(tmpDir, 'nonexistent.js'));
    expect(result).toBe(false);
  });
});

// ── ChannelXmlWriter ────────────────────────────────────────────

describe('ChannelXmlWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e4x-xmlwriter-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces script content in channel XML using exact string match', () => {
    const xmlContent = `<channel>
  <script>var pid = msg..PID;
var mrn = pid.toString();</script>
</channel>`;

    const xmlPath = path.join(tmpDir, 'channel.xml');
    fs.writeFileSync(xmlPath, xmlContent);

    const writer = new ChannelXmlWriter();
    writer.writeChannelXml(xmlPath, [
      makeResult(
        'var pid = msg..PID;\nvar mrn = pid.toString();',
        "var pid = msg.descendants('PID');\nvar mrn = pid.toString();",
      ),
    ]);

    const result = fs.readFileSync(xmlPath, 'utf-8');
    expect(result).toContain("msg.descendants('PID')");
    expect(result).not.toContain('msg..PID');
    // Structure preserved
    expect(result).toContain('<channel>');
    expect(result).toContain('</script>');
  });

  it('writes transformed scripts to artifact repo files', () => {
    const filePath = path.join(tmpDir, 'transformer.js');
    fs.writeFileSync(filePath, 'var pid = msg..PID;');

    const writer = new ChannelXmlWriter();
    writer.writeArtifactRepo([
      makeResult(
        'var pid = msg..PID;',
        "var pid = msg.descendants('PID');",
        { location: makeLocation({ filePath }) }
      ),
    ]);

    expect(fs.readFileSync(filePath, 'utf-8')).toBe("var pid = msg.descendants('PID');");
  });

  it('skips unchanged results', () => {
    const filePath = path.join(tmpDir, 'unchanged.js');
    fs.writeFileSync(filePath, 'var x = 1;');

    const writer = new ChannelXmlWriter();
    writer.writeArtifactRepo([
      makeResult('var x = 1;', 'var x = 1;', {
        location: makeLocation({ filePath }),
      }),
    ]);

    // File should be unchanged (not re-written)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('var x = 1;');
  });
});
