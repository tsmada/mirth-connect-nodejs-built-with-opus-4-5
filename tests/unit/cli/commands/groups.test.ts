/**
 * Channel Group CLI Commands — Unit Tests
 *
 * Tests GroupResolver, ApiClient.bulkUpdateChannelGroups, OutputFormatter
 * group helpers, and the group command structure.
 *
 * Note: We mock ora and chalk since they are ESM-only modules that
 * don't work with Jest's CJS transform.
 */

// Mock ESM-only modules before any imports
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  }),
}));

const passthroughFn = (s: string) => s;
const chainable: any = Object.assign(passthroughFn, {
  red: passthroughFn,
  green: passthroughFn,
  yellow: passthroughFn,
  cyan: passthroughFn,
  gray: passthroughFn,
  blue: passthroughFn,
  bold: passthroughFn,
  white: passthroughFn,
});
chainable.red.bold = passthroughFn;
chainable.green.bold = passthroughFn;
chainable.yellow.bold = passthroughFn;

jest.mock('chalk', () => ({
  __esModule: true,
  default: chainable,
}));

jest.mock('conf', () => ({
  __esModule: true,
  default: class MockConf {
    get() {
      return undefined;
    }
    set() {}
    delete() {}
    has() {
      return false;
    }
  },
}));

jest.mock('../../../../src/cli/lib/ConfigManager', () => ({
  ConfigManager: {
    getServerUrl: () => 'http://localhost:8081',
    getSessionToken: () => 'test-token',
  },
}));

jest.mock('../../../../src/cli/lib/ApiClient');

import { Command } from 'commander';
import { GroupResolver } from '../../../../src/cli/lib/GroupResolver.js';
import { ApiClient } from '../../../../src/cli/lib/ApiClient.js';
import { formatGroupTable, formatGroupDetails } from '../../../../src/cli/lib/OutputFormatter.js';
import { registerGroupCommands } from '../../../../src/cli/commands/groups.js';
import { ChannelGroup, ChannelState } from '../../../../src/cli/types/index.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const MOCK_GROUPS: ChannelGroup[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Production',
    description: 'Production channels',
    revision: 3,
    channels: ['aaaa-1111', 'aaaa-2222'],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Development',
    description: 'Dev channels',
    revision: 1,
    channels: ['bbbb-1111'],
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Production Staging',
    description: '',
    revision: 2,
    channels: [],
  },
];

function createMockClient(): jest.Mocked<ApiClient> {
  const mock = new ApiClient() as jest.Mocked<ApiClient>;
  mock.getChannelGroups = jest.fn().mockResolvedValue(MOCK_GROUPS);
  mock.getChannelStatuses = jest.fn().mockResolvedValue([]);
  mock.bulkUpdateChannelGroups = jest.fn().mockResolvedValue(undefined);
  mock.getChannelIdsAndNames = jest.fn().mockResolvedValue({
    'aaaa-1111': 'ADT Receiver',
    'aaaa-2222': 'Lab Orders',
    'bbbb-1111': 'Test Channel',
    'cccc-1111': 'Ungrouped',
  });
  return mock;
}

// =============================================================================
// GroupResolver Tests
// =============================================================================

describe('GroupResolver', () => {
  let client: jest.Mocked<ApiClient>;
  let resolver: GroupResolver;

  beforeEach(() => {
    client = createMockClient();
    resolver = new GroupResolver(client);
  });

  test('resolves by exact UUID', async () => {
    const result = await resolver.resolve('11111111-1111-1111-1111-111111111111');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.group.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(result.group.name).toBe('Production');
    }
  });

  test('returns error for unknown UUID', async () => {
    const result = await resolver.resolve('99999999-9999-9999-9999-999999999999');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not found');
    }
  });

  test('resolves by exact name (case-insensitive)', async () => {
    const result = await resolver.resolve('development');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.group.name).toBe('Development');
    }
  });

  test('resolves by partial name when single match', async () => {
    const result = await resolver.resolve('Devel');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.group.name).toBe('Development');
    }
  });

  test('returns suggestions for multiple partial matches', async () => {
    // "prod" matches both "Production" and "Production Staging"
    const result = await resolver.resolve('prod');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Multiple groups');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBe(2);
    }
  });

  test('exact match wins over partial matches', async () => {
    // "Development" is an exact match — should NOT trigger multi-match
    const result = await resolver.resolve('Development');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.group.name).toBe('Development');
    }
  });

  test('returns error for no match', async () => {
    const result = await resolver.resolve('Nonexistent');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not found');
    }
  });

  test('caches after first load', async () => {
    await resolver.resolve('Development');
    await resolver.resolve('Development');
    // Only one API call despite two resolves
    expect(client.getChannelGroups).toHaveBeenCalledTimes(1);
  });

  test('clearCache forces reload', async () => {
    await resolver.resolve('Development');
    resolver.clearCache();
    await resolver.resolve('Development');
    expect(client.getChannelGroups).toHaveBeenCalledTimes(2);
  });

  test('getName returns name for known ID', async () => {
    const name = await resolver.getName('22222222-2222-2222-2222-222222222222');
    expect(name).toBe('Development');
  });

  test('getName returns null for unknown ID', async () => {
    const name = await resolver.getName('unknown-id');
    expect(name).toBeNull();
  });

  test('getAll returns all groups', async () => {
    const all = await resolver.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((g) => g.name).sort()).toEqual([
      'Development',
      'Production',
      'Production Staging',
    ]);
  });
});

// =============================================================================
// ApiClient.bulkUpdateChannelGroups Tests
// =============================================================================

describe('ApiClient.bulkUpdateChannelGroups', () => {
  test('accepts groups and removedIds', async () => {
    const client = createMockClient();
    await client.bulkUpdateChannelGroups(
      [{ id: 'g1', name: 'Group', channels: ['ch1', 'ch2'], revision: 1 }],
      ['old-group']
    );
    expect(client.bulkUpdateChannelGroups).toHaveBeenCalledWith(
      [{ id: 'g1', name: 'Group', channels: ['ch1', 'ch2'], revision: 1 }],
      ['old-group']
    );
  });

  test('delete-only call passes empty groups array', async () => {
    const client = createMockClient();
    await client.bulkUpdateChannelGroups([], ['removed-id']);
    expect(client.bulkUpdateChannelGroups).toHaveBeenCalledWith([], ['removed-id']);
  });

  test('single group without removedIds', async () => {
    const client = createMockClient();
    await client.bulkUpdateChannelGroups([MOCK_GROUPS[0]!]);
    expect(client.bulkUpdateChannelGroups).toHaveBeenCalledWith([MOCK_GROUPS[0]!]);
  });
});

// =============================================================================
// OutputFormatter Group Helpers Tests
// =============================================================================

describe('formatGroupTable', () => {
  test('renders table with groups and ungrouped count', () => {
    const output = formatGroupTable(MOCK_GROUPS, 5);
    expect(output).toContain('Production');
    expect(output).toContain('Development');
    expect(output).toContain('Production Staging');
    expect(output).toContain('NAME');
    expect(output).toContain('CHANNELS');
    // Should contain channel counts
    expect(output).toContain('2'); // Production has 2 channels
    expect(output).toContain('1'); // Development has 1
    // Should contain ungrouped row
    expect(output).toContain('Ungrouped');
    expect(output).toContain('5'); // 5 ungrouped
  });

  test('renders table without ungrouped row when count is 0', () => {
    const output = formatGroupTable(MOCK_GROUPS, 0);
    expect(output).not.toContain('Ungrouped');
  });

  test('renders table for no groups but with ungrouped', () => {
    const output = formatGroupTable([], 3);
    expect(output).toContain('Ungrouped');
    expect(output).toContain('3');
  });

  test('truncates long descriptions', () => {
    const longDescGroup: ChannelGroup = {
      id: 'x',
      name: 'Test',
      description: 'A'.repeat(50),
      channels: [],
    };
    const output = formatGroupTable([longDescGroup], 0);
    expect(output).toContain('...');
  });

  test('renders table headers', () => {
    const output = formatGroupTable(MOCK_GROUPS, 0);
    expect(output).toContain('NAME');
    expect(output).toContain('ID');
    expect(output).toContain('CHANNELS');
    expect(output).toContain('DESCRIPTION');
  });
});

describe('formatGroupDetails', () => {
  test('renders group details with member channels', () => {
    const channels = [
      { id: 'aaaa-1111', name: 'ADT Receiver', state: 'STARTED' as ChannelState },
      { id: 'aaaa-2222', name: 'Lab Orders', state: 'STOPPED' as ChannelState },
    ];
    const output = formatGroupDetails(MOCK_GROUPS[0]!, channels);
    expect(output).toContain('Production');
    expect(output).toContain('Production channels');
    expect(output).toContain('ADT Receiver');
    expect(output).toContain('Lab Orders');
    expect(output).toContain('STARTED');
    expect(output).toContain('STOPPED');
    expect(output).toContain('Member Channels');
  });

  test('renders group with no channels', () => {
    const output = formatGroupDetails(MOCK_GROUPS[2]!, []);
    expect(output).toContain('Production Staging');
    expect(output).toContain('No channels in this group');
  });

  test('shows UNKNOWN for channels without state', () => {
    const channels = [{ id: 'aaaa-1111', name: 'ADT Receiver', state: undefined }];
    const output = formatGroupDetails(MOCK_GROUPS[0]!, channels);
    expect(output).toContain('UNKNOWN');
  });

  test('shows revision and description', () => {
    const output = formatGroupDetails(MOCK_GROUPS[0]!, []);
    expect(output).toContain('3'); // revision
    expect(output).toContain('Production channels'); // description
  });

  test('shows dash for missing description', () => {
    const group: ChannelGroup = { id: 'x', name: 'Test', channels: [] };
    const output = formatGroupDetails(group, []);
    // Description line should contain '-'
    expect(output).toContain('Description:');
    expect(output).toMatch(/Description:.*-/);
  });

  test('shows channel count', () => {
    const channels = [{ id: 'aaaa-1111', name: 'ADT Receiver', state: 'STARTED' as ChannelState }];
    const output = formatGroupDetails(MOCK_GROUPS[0]!, channels);
    expect(output).toContain('Channels:');
    expect(output).toMatch(/Channels:.*1/);
  });
});

// =============================================================================
// Command Registration Tests
// =============================================================================

describe('registerGroupCommands', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    registerGroupCommands(program);
  });

  test('registers groups command', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    expect(groupsCmd).toBeDefined();
  });

  test('registers list subcommand', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    const listCmd = groupsCmd?.commands.find((c) => c.name() === 'list');
    expect(listCmd).toBeDefined();
  });

  test('registers get subcommand', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    const getCmd = groupsCmd?.commands.find((c) => c.name() === 'get');
    expect(getCmd).toBeDefined();
  });

  test('registers create subcommand with -d option', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    const createCmd = groupsCmd?.commands.find((c) => c.name() === 'create');
    expect(createCmd).toBeDefined();
    const descOption = createCmd?.options.find((o) => o.long === '--description');
    expect(descOption).toBeDefined();
  });

  test('registers rename subcommand', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    const renameCmd = groupsCmd?.commands.find((c) => c.name() === 'rename');
    expect(renameCmd).toBeDefined();
  });

  test('registers delete subcommand with --force option', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    const deleteCmd = groupsCmd?.commands.find((c) => c.name() === 'delete');
    expect(deleteCmd).toBeDefined();
    const forceOption = deleteCmd?.options.find((o) => o.long === '--force');
    expect(forceOption).toBeDefined();
  });

  test('registers add subcommand', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    const addCmd = groupsCmd?.commands.find((c) => c.name() === 'add');
    expect(addCmd).toBeDefined();
  });

  test('registers remove subcommand', () => {
    const groupsCmd = program.commands.find((c) => c.name() === 'groups');
    const removeCmd = groupsCmd?.commands.find((c) => c.name() === 'remove');
    expect(removeCmd).toBeDefined();
  });
});
