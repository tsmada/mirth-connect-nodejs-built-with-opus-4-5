import {
  ChannelDiff,
  type DecomposedChannelFlat,
  type DiffResult,
} from '../../../src/artifact/ChannelDiff.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyChannel(name = 'Test Channel'): DecomposedChannelFlat {
  return {
    metadata: { name },
    scripts: {},
    sourceConnector: {},
    sourceScripts: {},
    destinations: {},
  };
}

function channelWith(overrides: Partial<DecomposedChannelFlat>): DecomposedChannelFlat {
  return { ...emptyChannel(), ...overrides };
}

// ---------------------------------------------------------------------------
// diffObjects
// ---------------------------------------------------------------------------

describe('ChannelDiff.diffObjects', () => {
  it('returns empty array for identical objects', () => {
    const obj = { port: 6661, host: 'localhost' };
    const changes = ChannelDiff.diffObjects(obj, obj);
    expect(changes).toEqual([]);
  });

  it('detects changed values', () => {
    const changes = ChannelDiff.diffObjects(
      { port: 6661, host: 'localhost' },
      { port: 6662, host: 'localhost' }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: 'port',
      type: 'changed',
      oldValue: 6661,
      newValue: 6662,
    });
  });

  it('detects added keys', () => {
    const changes = ChannelDiff.diffObjects(
      { port: 6661 },
      { port: 6661, timeout: 30000 }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: 'timeout',
      type: 'added',
      newValue: 30000,
    });
  });

  it('detects removed keys', () => {
    const changes = ChannelDiff.diffObjects(
      { port: 6661, timeout: 30000 },
      { port: 6661 }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      path: 'timeout',
      type: 'removed',
      oldValue: 30000,
    });
  });

  it('handles nested object changes with dot-path', () => {
    const changes = ChannelDiff.diffObjects(
      { source: { connector: { port: 6661, host: 'localhost' } } },
      { source: { connector: { port: 6662, host: 'localhost' } } }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('source.connector.port');
    expect(changes[0]!.type).toBe('changed');
    expect(changes[0]!.oldValue).toBe(6661);
    expect(changes[0]!.newValue).toBe(6662);
  });

  it('handles deeply nested objects (3+ levels)', () => {
    const changes = ChannelDiff.diffObjects(
      { a: { b: { c: { d: 'old' } } } },
      { a: { b: { c: { d: 'new' } } } }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('a.b.c.d');
  });

  it('uses prefix when provided', () => {
    const changes = ChannelDiff.diffObjects(
      { port: 6661 },
      { port: 6662 },
      'source.connector'
    );
    expect(changes[0]!.path).toBe('source.connector.port');
  });

  it('handles array element-by-element comparison', () => {
    const changes = ChannelDiff.diffObjects(
      { tags: ['adt', 'hl7', 'prod'] },
      { tags: ['adt', 'fhir', 'prod'] }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('tags[1]');
    expect(changes[0]!.oldValue).toBe('hl7');
    expect(changes[0]!.newValue).toBe('fhir');
  });

  it('handles array element additions', () => {
    const changes = ChannelDiff.diffObjects(
      { tags: ['a', 'b'] },
      { tags: ['a', 'b', 'c'] }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('tags[2]');
    expect(changes[0]!.type).toBe('added');
    expect(changes[0]!.newValue).toBe('c');
  });

  it('handles array element removals', () => {
    const changes = ChannelDiff.diffObjects(
      { tags: ['a', 'b', 'c'] },
      { tags: ['a', 'b'] }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('tags[2]');
    expect(changes[0]!.type).toBe('removed');
    expect(changes[0]!.oldValue).toBe('c');
  });

  it('handles arrays of objects', () => {
    const changes = ChannelDiff.diffObjects(
      { items: [{ id: 1, name: 'old' }] },
      { items: [{ id: 1, name: 'new' }] }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('items[0].name');
  });

  it('handles type changes (string to number)', () => {
    const changes = ChannelDiff.diffObjects(
      { port: '6661' },
      { port: 6661 }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe('changed');
  });

  it('handles boolean changes', () => {
    const changes = ChannelDiff.diffObjects(
      { enabled: true },
      { enabled: false }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.oldValue).toBe(true);
    expect(changes[0]!.newValue).toBe(false);
  });

  it('handles null values', () => {
    const changes = ChannelDiff.diffObjects(
      { val: null },
      { val: 'something' }
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.oldValue).toBeNull();
  });

  it('handles both objects empty', () => {
    const changes = ChannelDiff.diffObjects({}, {});
    expect(changes).toEqual([]);
  });

  it('handles mixed changes (add, remove, change simultaneously)', () => {
    const changes = ChannelDiff.diffObjects(
      { a: 1, b: 2, c: 3 },
      { a: 1, b: 99, d: 4 }
    );
    const types = changes.map(c => c.type).sort();
    expect(types).toEqual(['added', 'changed', 'removed']);
  });
});

// ---------------------------------------------------------------------------
// unifiedDiff
// ---------------------------------------------------------------------------

describe('ChannelDiff.unifiedDiff', () => {
  it('returns empty string for identical content', () => {
    const result = ChannelDiff.unifiedDiff('hello\nworld', 'hello\nworld');
    expect(result).toBe('');
  });

  it('produces correct unified diff for single line change', () => {
    const old = 'line1\nline2\nline3';
    const now = 'line1\nchanged\nline3';
    const diff = ChannelDiff.unifiedDiff(old, now);
    expect(diff).toContain('@@');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+changed');
    expect(diff).toContain(' line1');
    expect(diff).toContain(' line3');
  });

  it('produces correct hunk headers', () => {
    const old = 'a\nb\nc';
    const now = 'a\nx\nc';
    const diff = ChannelDiff.unifiedDiff(old, now, { context: 1 });
    // Should have @@ -N,N +N,N @@ header
    expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('includes file headers with custom header option', () => {
    const diff = ChannelDiff.unifiedDiff('old', 'new', { header: 'source/transformer.js' });
    expect(diff).toContain('--- old/source/transformer.js');
    expect(diff).toContain('+++ new/source/transformer.js');
  });

  it('uses default headers when no header provided', () => {
    const diff = ChannelDiff.unifiedDiff('old', 'new');
    expect(diff).toContain('--- a');
    expect(diff).toContain('+++ b');
  });

  it('handles added lines', () => {
    const old = 'line1\nline3';
    const now = 'line1\nline2\nline3';
    const diff = ChannelDiff.unifiedDiff(old, now);
    expect(diff).toContain('+line2');
  });

  it('handles removed lines', () => {
    const old = 'line1\nline2\nline3';
    const now = 'line1\nline3';
    const diff = ChannelDiff.unifiedDiff(old, now);
    expect(diff).toContain('-line2');
  });

  it('handles empty old content (all additions)', () => {
    const diff = ChannelDiff.unifiedDiff('', 'new\ncontent');
    expect(diff).toContain('+new');
    expect(diff).toContain('+content');
  });

  it('handles empty new content (all removals)', () => {
    const diff = ChannelDiff.unifiedDiff('old\ncontent', '');
    expect(diff).toContain('-old');
    expect(diff).toContain('-content');
  });

  it('respects context lines parameter', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const oldContent = lines.join('\n');
    const newLines = [...lines];
    newLines[10] = 'CHANGED';
    const newContent = newLines.join('\n');

    // With 1 line of context, we should see fewer context lines
    const diff1 = ChannelDiff.unifiedDiff(oldContent, newContent, { context: 1 });
    const contextLines1 = diff1.split('\n').filter(l => l.startsWith(' '));

    // With 5 lines of context, we should see more
    const diff5 = ChannelDiff.unifiedDiff(oldContent, newContent, { context: 5 });
    const contextLines5 = diff5.split('\n').filter(l => l.startsWith(' '));

    expect(contextLines5.length).toBeGreaterThan(contextLines1.length);
  });

  it('handles multiple separate hunks', () => {
    // Create content where changes are far apart (more than 2*context apart)
    const lines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
    const oldContent = lines.join('\n');
    const newLines = [...lines];
    newLines[2] = 'CHANGED_EARLY';
    newLines[27] = 'CHANGED_LATE';
    const newContent = newLines.join('\n');

    const diff = ChannelDiff.unifiedDiff(oldContent, newContent, { context: 2 });
    const hunkHeaders = diff.split('\n').filter(l => l.startsWith('@@'));
    // Changes are 25 lines apart with context=2, should produce 2 hunks
    expect(hunkHeaders.length).toBe(2);
  });

  it('handles large script diff with many changes', () => {
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (let i = 0; i < 100; i++) {
      oldLines.push(`original line ${i}`);
      newLines.push(i % 10 === 0 ? `modified line ${i}` : `original line ${i}`);
    }
    const diff = ChannelDiff.unifiedDiff(oldLines.join('\n'), newLines.join('\n'));
    expect(diff).toContain('@@');
    expect(diff).toContain('-original line 0');
    expect(diff).toContain('+modified line 0');
  });
});

// ---------------------------------------------------------------------------
// diff (full channel comparison)
// ---------------------------------------------------------------------------

describe('ChannelDiff.diff', () => {
  it('returns zero changes for identical channels', () => {
    const ch = channelWith({
      metadata: { name: 'ADT Receiver', port: 6661 },
      sourceConnector: { type: 'TCP', port: 6661 },
      sourceScripts: { 'transformer.js': 'msg = msg;' },
    });
    const result = ChannelDiff.diff(ch, ch);
    expect(result.changeCount).toBe(0);
    expect(result.configChanges).toEqual([]);
    expect(result.scriptChanges).toEqual([]);
    expect(result.summary).toContain('no changes');
  });

  it('detects metadata config changes', () => {
    const old = channelWith({ metadata: { name: 'ADT', enabled: true } });
    const now = channelWith({ metadata: { name: 'ADT', enabled: false } });
    const result = ChannelDiff.diff(old, now);
    expect(result.configChanges).toHaveLength(1);
    expect(result.configChanges[0]!.path).toBe('metadata.enabled');
  });

  it('detects source connector config changes', () => {
    const old = channelWith({ sourceConnector: { port: 6661, maxConnections: 10 } });
    const now = channelWith({ sourceConnector: { port: 6662, maxConnections: 20 } });
    const result = ChannelDiff.diff(old, now);
    expect(result.configChanges).toHaveLength(2);
    const paths = result.configChanges.map(c => c.path);
    expect(paths).toContain('source.connector.port');
    expect(paths).toContain('source.connector.maxConnections');
  });

  it('detects source script changes', () => {
    const old = channelWith({
      sourceScripts: { 'transformer.js': "var x = 'old';" },
    });
    const now = channelWith({
      sourceScripts: { 'transformer.js': "var x = 'new';" },
    });
    const result = ChannelDiff.diff(old, now);
    expect(result.scriptChanges).toHaveLength(1);
    expect(result.scriptChanges[0]!.path).toBe('source/transformer.js');
    expect(result.scriptChanges[0]!.type).toBe('changed');
    expect(result.scriptChanges[0]!.unifiedDiff).toContain("+var x = 'new';");
  });

  it('detects added source script', () => {
    const old = channelWith({ sourceScripts: {} });
    const now = channelWith({ sourceScripts: { 'filter.js': 'return true;' } });
    const result = ChannelDiff.diff(old, now);
    expect(result.scriptChanges).toHaveLength(1);
    expect(result.scriptChanges[0]!.type).toBe('added');
  });

  it('detects removed source script', () => {
    const old = channelWith({ sourceScripts: { 'filter.js': 'return true;' } });
    const now = channelWith({ sourceScripts: {} });
    const result = ChannelDiff.diff(old, now);
    expect(result.scriptChanges).toHaveLength(1);
    expect(result.scriptChanges[0]!.type).toBe('removed');
  });

  it('detects channel-level script changes', () => {
    const old = channelWith({ scripts: { 'deploy.js': 'logger.info("v1");' } });
    const now = channelWith({ scripts: { 'deploy.js': 'logger.info("v2");' } });
    const result = ChannelDiff.diff(old, now);
    expect(result.scriptChanges).toHaveLength(1);
    expect(result.scriptChanges[0]!.path).toBe('scripts/deploy.js');
  });

  it('detects added destination', () => {
    const old = emptyChannel();
    const now = channelWith({
      destinations: {
        'dest-1': {
          connector: { type: 'HTTP', url: 'http://example.com' },
          scripts: { 'transformer.js': 'return msg;' },
        },
      },
    });
    const result = ChannelDiff.diff(old, now);
    // Should have config change for the new destination + script change
    expect(result.configChanges.some(c => c.path === 'destinations.dest-1')).toBe(true);
    expect(result.scriptChanges.some(c => c.path === 'destinations/dest-1/transformer.js')).toBe(true);
  });

  it('detects removed destination', () => {
    const old = channelWith({
      destinations: {
        'dest-1': {
          connector: { type: 'HTTP' },
          scripts: { 'transformer.js': 'return msg;' },
        },
      },
    });
    const now = emptyChannel();
    const result = ChannelDiff.diff(old, now);
    expect(result.configChanges.some(c => c.path === 'destinations.dest-1' && c.type === 'removed')).toBe(true);
    expect(result.scriptChanges.some(c => c.type === 'removed')).toBe(true);
  });

  it('detects destination connector config changes', () => {
    const old = channelWith({
      destinations: {
        'dest-1': {
          connector: { type: 'HTTP', url: 'http://old.com' },
          scripts: {},
        },
      },
    });
    const now = channelWith({
      destinations: {
        'dest-1': {
          connector: { type: 'HTTP', url: 'http://new.com' },
          scripts: {},
        },
      },
    });
    const result = ChannelDiff.diff(old, now);
    expect(result.configChanges).toHaveLength(1);
    expect(result.configChanges[0]!.path).toBe('destinations.dest-1.connector.url');
  });

  it('detects destination script changes', () => {
    const old = channelWith({
      destinations: {
        'dest-1': {
          connector: {},
          scripts: { 'transformer.js': 'var a = 1;' },
        },
      },
    });
    const now = channelWith({
      destinations: {
        'dest-1': {
          connector: {},
          scripts: { 'transformer.js': 'var a = 2;' },
        },
      },
    });
    const result = ChannelDiff.diff(old, now);
    expect(result.scriptChanges).toHaveLength(1);
    expect(result.scriptChanges[0]!.path).toBe('destinations/dest-1/transformer.js');
  });

  it('handles mixed config and script changes', () => {
    const old = channelWith({
      metadata: { name: 'Test', version: '1' },
      sourceConnector: { port: 6661 },
      sourceScripts: { 'filter.js': 'return true;' },
      destinations: {
        'd1': { connector: { url: 'http://a.com' }, scripts: { 'transformer.js': 'a;' } },
      },
    });
    const now = channelWith({
      metadata: { name: 'Test', version: '2' },
      sourceConnector: { port: 6662 },
      sourceScripts: { 'filter.js': 'return false;' },
      destinations: {
        'd1': { connector: { url: 'http://b.com' }, scripts: { 'transformer.js': 'b;' } },
      },
    });
    const result = ChannelDiff.diff(old, now);
    expect(result.configChanges.length).toBeGreaterThanOrEqual(3);
    expect(result.scriptChanges.length).toBeGreaterThanOrEqual(2);
    expect(result.changeCount).toBe(result.configChanges.length + result.scriptChanges.length);
  });

  it('uses channel name from new channel metadata', () => {
    const old = channelWith({ metadata: { name: 'Old Name' } });
    const now = channelWith({ metadata: { name: 'New Name' } });
    const result = ChannelDiff.diff(old, now);
    expect(result.channelName).toBe('New Name');
  });

  it('falls back to old channel name when new is missing', () => {
    const old = channelWith({ metadata: { name: 'Old Name' } });
    const now = channelWith({ metadata: {} });
    const result = ChannelDiff.diff(old, now);
    expect(result.channelName).toBe('Old Name');
  });

  it('builds human-readable summary', () => {
    const old = channelWith({
      metadata: { name: 'ADT Receiver' },
      sourceConnector: { port: 6661 },
      sourceScripts: { 'transformer.js': 'old;' },
    });
    const now = channelWith({
      metadata: { name: 'ADT Receiver' },
      sourceConnector: { port: 6662 },
      sourceScripts: { 'transformer.js': 'new;' },
    });
    const result = ChannelDiff.diff(old, now);
    expect(result.summary).toContain('ADT Receiver');
    expect(result.summary).toContain('config');
    expect(result.summary).toContain('script');
  });
});

// ---------------------------------------------------------------------------
// ignoreWhitespace option
// ---------------------------------------------------------------------------

describe('ChannelDiff with ignoreWhitespace', () => {
  it('treats whitespace-only differences as equal in config', () => {
    const old = channelWith({ metadata: { desc: 'hello  world' } });
    const now = channelWith({ metadata: { desc: 'hello world' } });
    const result = ChannelDiff.diff(old, now, { ignoreWhitespace: true });
    expect(result.changeCount).toBe(0);
  });

  it('still detects real changes when ignoring whitespace', () => {
    const old = channelWith({ metadata: { desc: 'hello  world' } });
    const now = channelWith({ metadata: { desc: 'goodbye world' } });
    const result = ChannelDiff.diff(old, now, { ignoreWhitespace: true });
    expect(result.configChanges).toHaveLength(1);
  });

  it('ignores whitespace in script comparison', () => {
    const old = channelWith({ sourceScripts: { 'filter.js': 'return  true;' } });
    const now = channelWith({ sourceScripts: { 'filter.js': 'return true;' } });
    const result = ChannelDiff.diff(old, now, { ignoreWhitespace: true });
    expect(result.scriptChanges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatForCli
// ---------------------------------------------------------------------------

describe('ChannelDiff.formatForCli', () => {
  it('shows "no changes" for empty diff', () => {
    const result: DiffResult = {
      channelName: 'ADT Receiver',
      changeCount: 0,
      configChanges: [],
      scriptChanges: [],
      summary: 'ADT Receiver: no changes',
    };
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('no changes');
  });

  it('shows channel name and change count', () => {
    const result = ChannelDiff.diff(
      channelWith({ sourceConnector: { port: 6661 } }),
      channelWith({ sourceConnector: { port: 6662 } })
    );
    const output = ChannelDiff.formatForCli(result);
    expect(output).toMatch(/Channel: .+ \(\d+ change/);
  });

  it('formats config changes with arrow notation', () => {
    const result = ChannelDiff.diff(
      channelWith({ sourceConnector: { port: 6661 } }),
      channelWith({ sourceConnector: { port: 6662 } })
    );
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('6661');
    expect(output).toContain('->');
    expect(output).toContain('6662');
  });

  it('formats added config with + prefix', () => {
    const result = ChannelDiff.diff(
      channelWith({ sourceConnector: {} }),
      channelWith({ sourceConnector: { port: 6661 } })
    );
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('+ ');
    expect(output).toContain('6661');
  });

  it('formats removed config with - prefix', () => {
    const result = ChannelDiff.diff(
      channelWith({ sourceConnector: { port: 6661 } }),
      channelWith({ sourceConnector: {} })
    );
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('- ');
    expect(output).toContain('6661');
  });

  it('formats script diffs with section headers and hunk headers', () => {
    const old = channelWith({
      sourceScripts: {
        'transformer.js': "$c('sourceValue', 'fromSource');\n$c('patientMRN', msg['PID']['PID.3']['PID.3.1'].toString());",
      },
    });
    const now = channelWith({
      sourceScripts: {
        'transformer.js': "$c('sourceValue', 'fromSource');\n$c('patientDOB', msg['PID']['PID.7']['PID.7.1'].toString());\n$c('patientMRN', msg['PID']['PID.3']['PID.3.1'].toString());",
      },
    });
    const result = ChannelDiff.diff(old, now);
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('--- source/transformer.js ---');
    expect(output).toContain('@@');
  });

  it('shows "(new file)" for added scripts', () => {
    const result = ChannelDiff.diff(
      emptyChannel(),
      channelWith({ sourceScripts: { 'filter.js': 'return true;' } })
    );
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('(new file)');
  });

  it('shows "(deleted)" for removed scripts', () => {
    const result = ChannelDiff.diff(
      channelWith({ sourceScripts: { 'filter.js': 'return true;' } }),
      emptyChannel()
    );
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('(deleted)');
  });

  it('truncates long string values in config output', () => {
    const longString = 'a'.repeat(100);
    const result = ChannelDiff.diff(
      channelWith({ metadata: { desc: 'short' } }),
      channelWith({ metadata: { desc: longString } })
    );
    const output = ChannelDiff.formatForCli(result);
    expect(output).toContain('...');
    // Should not contain the full 100 char string
    expect(output).not.toContain(longString);
  });

  it('handles complex result with multiple sections', () => {
    const old = channelWith({
      metadata: { name: 'ADT', version: '1' },
      sourceConnector: { port: 6661 },
      sourceScripts: { 'transformer.js': 'old code;' },
      destinations: {
        'd1': {
          connector: { url: 'http://a.com' },
          scripts: { 'transformer.js': 'dest old;' },
        },
      },
    });
    const now = channelWith({
      metadata: { name: 'ADT', version: '2' },
      sourceConnector: { port: 6662 },
      sourceScripts: { 'transformer.js': 'new code;' },
      destinations: {
        'd1': {
          connector: { url: 'http://b.com' },
          scripts: { 'transformer.js': 'dest new;' },
        },
      },
    });
    const result = ChannelDiff.diff(old, now);
    const output = ChannelDiff.formatForCli(result);

    // Should contain config changes
    expect(output).toContain('version');
    expect(output).toContain('port');
    // Should contain script section headers
    expect(output).toContain('--- source/transformer.js ---');
    expect(output).toContain('--- destinations/d1/transformer.js ---');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('ChannelDiff edge cases', () => {
  it('handles both channels completely empty', () => {
    const result = ChannelDiff.diff(emptyChannel(), emptyChannel());
    expect(result.changeCount).toBe(0);
  });

  it('handles one channel with everything, other empty', () => {
    const empty: DecomposedChannelFlat = {
      metadata: {},
      scripts: {},
      sourceConnector: {},
      sourceScripts: {},
      destinations: {},
    };
    const full = channelWith({
      metadata: { name: 'Full', enabled: true, revision: 5 },
      sourceConnector: { type: 'TCP', port: 6661 },
      sourceScripts: { 'filter.js': 'return true;', 'transformer.js': 'msg = msg;' },
      scripts: { 'deploy.js': 'logger.info("deploy");' },
      destinations: {
        'd1': {
          connector: { type: 'HTTP', url: 'http://example.com' },
          scripts: { 'transformer.js': 'return msg;' },
        },
      },
    });
    const result = ChannelDiff.diff(empty, full);
    expect(result.changeCount).toBeGreaterThan(0);
    // All changes should be additions
    expect(result.configChanges.every(c => c.type === 'added')).toBe(true);
    expect(result.scriptChanges.every(c => c.type === 'added')).toBe(true);
  });

  it('handles all removals (full channel to empty)', () => {
    const full = channelWith({
      metadata: { name: 'Full', enabled: true },
      sourceConnector: { type: 'TCP' },
      sourceScripts: { 'filter.js': 'return true;' },
    });
    const result = ChannelDiff.diff(full, emptyChannel());
    // metadata.name is in both (emptyChannel has name), so it's changed not removed
    expect(result.configChanges.some(c => c.type === 'removed')).toBe(true);
  });

  it('handles custom context lines option', () => {
    const old = channelWith({
      sourceScripts: { 'transformer.js': 'line1\nline2\nline3\nline4\nline5\nline6\nline7' },
    });
    const now = channelWith({
      sourceScripts: { 'transformer.js': 'line1\nline2\nline3\nCHANGED\nline5\nline6\nline7' },
    });
    const result1 = ChannelDiff.diff(old, now, { contextLines: 1 });
    const result3 = ChannelDiff.diff(old, now, { contextLines: 3 });

    // More context lines = more content in the unified diff
    expect(result3.scriptChanges[0]!.unifiedDiff!.length)
      .toBeGreaterThan(result1.scriptChanges[0]!.unifiedDiff!.length);
  });

  it('handles scripts with empty content', () => {
    const old = channelWith({ sourceScripts: { 'filter.js': '' } });
    const now = channelWith({ sourceScripts: { 'filter.js': 'return true;' } });
    const result = ChannelDiff.diff(old, now);
    expect(result.scriptChanges).toHaveLength(1);
    expect(result.scriptChanges[0]!.type).toBe('changed');
  });

  it('handles multiline script with additions in the middle', () => {
    const old = [
      "$c('sourceValue', 'fromSource');",
      "$c('sourceTime', new Date().toISOString());",
      "$c('patientMRN', msg['PID']['PID.3']['PID.3.1'].toString());",
    ].join('\n');
    const now = [
      "$c('sourceValue', 'fromSource');",
      "$c('sourceTime', new Date().toISOString());",
      "$c('patientDOB', msg['PID']['PID.7']['PID.7.1'].toString());",
      "$c('patientMRN', msg['PID']['PID.3']['PID.3.1'].toString());",
    ].join('\n');
    const diff = ChannelDiff.unifiedDiff(old, now);
    expect(diff).toContain("+$c('patientDOB'");
    expect(diff).toContain(" $c('sourceValue'");
  });

  it('handles multiple destinations with independent changes', () => {
    const old = channelWith({
      destinations: {
        'd1': { connector: { url: 'http://a.com' }, scripts: {} },
        'd2': { connector: { url: 'http://b.com' }, scripts: {} },
        'd3': { connector: { url: 'http://c.com' }, scripts: {} },
      },
    });
    const now = channelWith({
      destinations: {
        'd1': { connector: { url: 'http://a-new.com' }, scripts: {} },
        'd2': { connector: { url: 'http://b.com' }, scripts: {} },
        // d3 removed, d4 added
        'd4': { connector: { url: 'http://d.com' }, scripts: {} },
      },
    });
    const result = ChannelDiff.diff(old, now);
    expect(result.configChanges.some(c => c.path.includes('d1') && c.type === 'changed')).toBe(true);
    expect(result.configChanges.some(c => c.path.includes('d3') && c.type === 'removed')).toBe(true);
    expect(result.configChanges.some(c => c.path.includes('d4') && c.type === 'added')).toBe(true);
    // d2 should not appear in changes
    expect(result.configChanges.some(c => c.path.includes('d2'))).toBe(false);
  });
});
