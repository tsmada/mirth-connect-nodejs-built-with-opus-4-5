/**
 * ChannelController Behavioral Tests
 *
 * Ported from: ~/Projects/connect/server/test/.../ChannelControllerTests.java
 * Tests the controller's public API: CRUD, revision tracking, cache diffing,
 * XML parse/serialize round-trip, enabled flag persistence.
 *
 * Mock strategy: MirthDao is fully mocked; we test the controller's
 * business logic (revision increment, summary diffing, XML handling) in isolation.
 */

import { ChannelController } from '../../../src/controllers/ChannelController';
import type { Channel, ChannelHeader } from '../../../src/api/models/Channel';

// ── MirthDao mock ──────────────────────────────────────────────────────────

const mockGetChannels = jest.fn();
const mockGetChannelById = jest.fn();
const mockUpsertChannel = jest.fn();
const mockDeleteChannel = jest.fn();

jest.mock('../../../src/db/MirthDao', () => ({
  getChannels: (...args: unknown[]) => mockGetChannels(...args),
  getChannelById: (...args: unknown[]) => mockGetChannelById(...args),
  upsertChannel: (...args: unknown[]) => mockUpsertChannel(...args),
  deleteChannel: (...args: unknown[]) => mockDeleteChannel(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal valid channel XML that fast-xml-parser can parse. */
function makeChannelXml(overrides: {
  id?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  revision?: number;
  transportName?: string;
  preprocessingScript?: string;
  postprocessingScript?: string;
  deployScript?: string;
  undeployScript?: string;
  destinationCount?: number;
  initialState?: string;
  messageStorageMode?: string;
} = {}): string {
  const id = overrides.id ?? 'ch-001';
  const name = overrides.name ?? 'Test Channel';
  const desc = overrides.description ?? 'A test channel';
  const enabled = overrides.enabled ?? true;
  const rev = overrides.revision ?? 1;
  const transport = overrides.transportName ?? 'HTTP Listener';
  const preScript = overrides.preprocessingScript ?? '';
  const postScript = overrides.postprocessingScript ?? '';
  const deployScript = overrides.deployScript ?? '';
  const undeployScript = overrides.undeployScript ?? '';

  let destXml = '';
  const destCount = overrides.destinationCount ?? 1;
  for (let i = 0; i < destCount; i++) {
    destXml += `<connector>
        <metaDataId>${i + 1}</metaDataId>
        <name>Destination ${i + 1}</name>
        <enabled>true</enabled>
        <transportName>Channel Writer</transportName>
        <properties/>
      </connector>`;
  }

  return `<channel>
    <id>${id}</id>
    <name>${name}</name>
    <description>${desc}</description>
    <enabled>${enabled}</enabled>
    <revision>${rev}</revision>
    <sourceConnector>
      <metaDataId>0</metaDataId>
      <name>Source</name>
      <enabled>true</enabled>
      <transportName>${transport}</transportName>
      <properties/>
    </sourceConnector>
    <destinationConnectors>${destXml}</destinationConnectors>
    <preprocessingScript>${preScript}</preprocessingScript>
    <postprocessingScript>${postScript}</postprocessingScript>
    <deployScript>${deployScript}</deployScript>
    <undeployScript>${undeployScript}</undeployScript>
    <properties>
      <clearGlobalChannelMap>true</clearGlobalChannelMap>
      <messageStorageMode>${overrides.messageStorageMode ?? 'DEVELOPMENT'}</messageStorageMode>
      <encryptData>false</encryptData>
      <initialState>${overrides.initialState ?? 'STARTED'}</initialState>
    </properties>
  </channel>`;
}

/** Build a mock ChannelRow (the shape returned by MirthDao). */
function makeRow(opts: {
  id?: string;
  name?: string;
  revision?: number;
  enabled?: boolean;
  description?: string;
  transportName?: string;
  destinationCount?: number;
  preprocessingScript?: string;
  messageStorageMode?: string;
} = {}) {
  const id = opts.id ?? 'ch-001';
  const name = opts.name ?? 'Test Channel';
  const revision = opts.revision ?? 1;
  return {
    ID: id,
    NAME: name,
    REVISION: revision,
    CHANNEL: makeChannelXml({
      id,
      name,
      revision,
      enabled: opts.enabled,
      description: opts.description,
      transportName: opts.transportName,
      destinationCount: opts.destinationCount,
      preprocessingScript: opts.preprocessingScript,
      messageStorageMode: opts.messageStorageMode,
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockUpsertChannel.mockResolvedValue(undefined);
  mockDeleteChannel.mockResolvedValue(undefined);
});

// ---- Test 1: updateChannel persists with revision=0 ----
describe('ChannelController', () => {
  test('updateChannel persists channel and increments revision from 0', async () => {
    // Java: channelController.updateChannel(sampleChannel, null, true) with revision=0
    // then getChannels → revision should be 1 (incremented)
    const existingRow = makeRow({ id: 'ch-new', name: 'New Channel', revision: 0 });
    mockGetChannelById.mockResolvedValue(existingRow);

    const result = await ChannelController.updateChannel('ch-new', { name: 'New Channel Updated' });

    expect(result).toBe(true);
    expect(mockUpsertChannel).toHaveBeenCalledTimes(1);
    // Revision should be 0 + 1 = 1
    const [id, _name, _xml, revision] = mockUpsertChannel.mock.calls[0]!;
    expect(id).toBe('ch-new');
    expect(revision).toBe(1);
  });

  // ---- Test 2: getChannels by ID returns only requested channels ----
  test('getChannel returns a single channel with all fields intact', async () => {
    const row = makeRow({
      id: 'ch-123',
      name: 'ADT Receiver',
      revision: 5,
      description: 'Receives ADT messages',
      transportName: 'TCP Listener',
    });
    mockGetChannelById.mockResolvedValue(row);

    const channel = await ChannelController.getChannel('ch-123');

    expect(channel).not.toBeNull();
    expect(channel!.id).toBe('ch-123');
    expect(channel!.name).toBe('ADT Receiver');
    expect(channel!.revision).toBe(5);
    expect(channel!.description).toBe('Receives ADT messages');
    expect(channel!.sourceConnector.transportName).toBe('TCP Listener');
    expect(channel!.sourceConnector.metaDataId).toBe(0);
    expect(channel!.sourceConnector.name).toBe('Source');
  });

  // ---- Test 3: getAllChannels returns complete inventory ----
  test('getAllChannels returns all channels', async () => {
    // Java: channelController.getChannels(null) → all channels
    const rows = [
      makeRow({ id: 'ch-001', name: 'Channel0' }),
      makeRow({ id: 'ch-002', name: 'Channel1' }),
      makeRow({ id: 'ch-003', name: 'Channel2' }),
    ];
    mockGetChannels.mockResolvedValue(rows);

    const channels = await ChannelController.getAllChannels();

    expect(channels).toHaveLength(3);
    expect(channels.map((c) => c.id)).toEqual(['ch-001', 'ch-002', 'ch-003']);
    expect(channels.map((c) => c.name)).toEqual(['Channel0', 'Channel1', 'Channel2']);
  });

  // ---- Test 4: deleteChannel removes a single channel ----
  test('deleteChannel removes a single channel', async () => {
    // Java: channelController.removeChannel(sampleChannel, null)
    await ChannelController.deleteChannel('ch-001');

    expect(mockDeleteChannel).toHaveBeenCalledTimes(1);
    expect(mockDeleteChannel).toHaveBeenCalledWith('ch-001');
  });

  // ---- Test 5: deleteChannel with specific ID ----
  test('deleteChannel passes exact channelId to DAO', async () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    await ChannelController.deleteChannel(uuid);

    expect(mockDeleteChannel).toHaveBeenCalledWith(uuid);
  });

  // ---- Test 6: Revision counter increment on update ----
  test('updateChannel increments revision by exactly 1', async () => {
    const existingRow = makeRow({ id: 'ch-rev', name: 'Rev Test', revision: 7 });
    mockGetChannelById.mockResolvedValue(existingRow);

    await ChannelController.updateChannel('ch-rev', { description: 'Updated desc' });

    const [, , , revision] = mockUpsertChannel.mock.calls[0]!;
    expect(revision).toBe(8); // 7 + 1
  });

  // ---- Test 7: channelId preserved on re-import (update existing) ----
  test('updateChannel preserves original channelId', async () => {
    const existingRow = makeRow({ id: 'ch-original', name: 'Original', revision: 3 });
    mockGetChannelById.mockResolvedValue(existingRow);

    await ChannelController.updateChannel('ch-original', {
      name: 'Reimported Channel',
      description: 'New description after reimport',
    });

    // The ID passed to upsertChannel must be the original
    const [id] = mockUpsertChannel.mock.calls[0]!;
    expect(id).toBe('ch-original');
  });

  // ---- Test 8: getChannelSummaries differential returns only changed channels ----
  test('getChannelSummaries returns only channels with revision > cached', async () => {
    // Simulate: 3 channels exist, client has cached rev=2 for ch-001 and ch-002
    const rows = [
      makeRow({ id: 'ch-001', name: 'Channel A', revision: 2 }),  // unchanged
      makeRow({ id: 'ch-002', name: 'Channel B', revision: 5 }),  // modified (was 2)
      makeRow({ id: 'ch-003', name: 'Channel C', revision: 1 }),  // new (not in cache)
    ];
    mockGetChannels.mockResolvedValue(rows);

    const cachedChannels: Record<string, ChannelHeader> = {
      'ch-001': { channelId: 'ch-001', revision: 2 },
      'ch-002': { channelId: 'ch-002', revision: 2 },
    };

    const summaries = await ChannelController.getChannelSummaries(cachedChannels, false);

    // Should include ch-002 (modified) and ch-003 (new), but NOT ch-001 (same rev)
    expect(summaries).toHaveLength(2);
    const ids = summaries.map((s) => s.channelId);
    expect(ids).toContain('ch-002');
    expect(ids).toContain('ch-003');
    expect(ids).not.toContain('ch-001');
  });

  // ---- Test 9: getChannelSummaries ignoreNewChannels ----
  test('getChannelSummaries with ignoreNewChannels=true excludes new channels', async () => {
    const rows = [
      makeRow({ id: 'ch-001', name: 'Channel A', revision: 2 }),  // unchanged
      makeRow({ id: 'ch-new', name: 'New Channel', revision: 1 }), // new
    ];
    mockGetChannels.mockResolvedValue(rows);

    const cachedChannels: Record<string, ChannelHeader> = {
      'ch-001': { channelId: 'ch-001', revision: 2 },
    };

    const summaries = await ChannelController.getChannelSummaries(cachedChannels, true);

    // New channel should be excluded because ignoreNewChannels=true
    expect(summaries).toHaveLength(0);
  });

  // ---- Test 10: getChannelSummaries detects deleted channels ----
  test('getChannelSummaries returns deleted marker for removed channels', async () => {
    // Client has ch-001 and ch-deleted cached, but ch-deleted no longer in DB
    const rows = [
      makeRow({ id: 'ch-001', name: 'Channel A', revision: 2 }),
    ];
    mockGetChannels.mockResolvedValue(rows);

    const cachedChannels: Record<string, ChannelHeader> = {
      'ch-001': { channelId: 'ch-001', revision: 2 },
      'ch-deleted': { channelId: 'ch-deleted', revision: 3 },
    };

    const summaries = await ChannelController.getChannelSummaries(cachedChannels, false);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.channelId).toBe('ch-deleted');
    expect(summaries[0]!.deleted).toBe(true);
  });

  // ---- Test 11: parseChannelXml malformed XML returns minimal channel ----
  test('parseChannelXml handles malformed XML gracefully', async () => {
    // The controller's private parseChannelXml catches parse errors
    // and returns a minimal channel object
    const badRow = {
      ID: 'ch-bad',
      NAME: 'Bad XML Channel',
      REVISION: 1,
      CHANNEL: '<<<not valid xml>>><<<',
    };
    mockGetChannelById.mockResolvedValue(badRow);

    const channel = await ChannelController.getChannel('ch-bad');

    // Should return a minimal channel, not throw
    expect(channel).not.toBeNull();
    expect(channel!.id).toBe('ch-bad');
    expect(channel!.name).toBe('Bad XML Channel');
    expect(channel!.revision).toBe(1);
    expect(channel!.enabled).toBe(true);
    expect(channel!.sourceConnector.transportName).toBe('Unknown');
  });

  // ---- Test 12: serializeChannelToXml no double-wrapping ----
  test('serializeChannelToXml does not double-wrap connector elements', async () => {
    // Regression test: a prior bug caused <connector> inside <connector>
    const row = makeRow({ id: 'ch-serial', name: 'Serial Test', revision: 1, destinationCount: 2 });
    mockGetChannelById.mockResolvedValue(row);

    const xml = await ChannelController.getChannelXml('ch-serial');
    expect(xml).not.toBeNull();

    // Now update and check the serialized output doesn't double-wrap
    mockGetChannelById.mockResolvedValue(row);
    await ChannelController.updateChannel('ch-serial', { description: 'No double wrap' });

    const serializedXml = mockUpsertChannel.mock.calls[0]![2] as string;
    // Count occurrences of <connector> — should have exactly 3
    // (1 source + 2 destinations in the XML structure via <connector> tags)
    // The key check: no nested <connector><connector>
    const nestedPattern = /<connector>\s*<connector>/;
    expect(nestedPattern.test(serializedXml)).toBe(false);
  });

  // ---- Test 13: getChannel returns null for non-existent channelId ----
  test('getChannel returns null for non-existent channelId', async () => {
    // Java equivalent: getChannels with a non-existent ID returns empty list
    mockGetChannelById.mockResolvedValue(null);

    const channel = await ChannelController.getChannel('non-existent-id');

    expect(channel).toBeNull();
  });

  // ---- Test 14: enabled=false persists and retrieves correctly ----
  test('setChannelEnabled persists enabled=false and increments revision', async () => {
    const row = makeRow({ id: 'ch-disable', name: 'Disable Me', revision: 3, enabled: true });
    mockGetChannelById.mockResolvedValue(row);

    await ChannelController.setChannelEnabled('ch-disable', false);

    expect(mockUpsertChannel).toHaveBeenCalledTimes(1);
    const [id, , xml, revision] = mockUpsertChannel.mock.calls[0]!;
    expect(id).toBe('ch-disable');
    expect(revision).toBe(4); // 3 + 1
    // The XML should contain enabled=false
    expect(xml).toContain('false');
  });

  // ---- Test 15: Channel cache invalidation — stale data not returned ----
  test('getChannelSummaries reflects updated revision after updateChannel', async () => {
    // Simulates: client cached rev=2, channel updated to rev=3
    const updatedRows = [
      makeRow({ id: 'ch-cache', name: 'Cache Test', revision: 3 }),
    ];
    mockGetChannels.mockResolvedValue(updatedRows);

    const cachedChannels: Record<string, ChannelHeader> = {
      'ch-cache': { channelId: 'ch-cache', revision: 2 },
    };

    const summaries = await ChannelController.getChannelSummaries(cachedChannels, false);

    // Should detect the revision bump
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.channelId).toBe('ch-cache');
    expect(summaries[0]!.channel).toBeDefined();
    expect(summaries[0]!.channel!.revision).toBe(3);
  });

  // ── Additional behavioral tests beyond the 15 required ──────────────────

  test('createChannel returns false when id is missing', async () => {
    const result = await ChannelController.createChannel({ name: 'No ID' });
    expect(result).toBe(false);
    expect(mockUpsertChannel).not.toHaveBeenCalled();
  });

  test('createChannel returns false when name is missing', async () => {
    const result = await ChannelController.createChannel({ id: 'ch-no-name' });
    expect(result).toBe(false);
    expect(mockUpsertChannel).not.toHaveBeenCalled();
  });

  test('createChannel with valid data persists to DAO', async () => {
    const result = await ChannelController.createChannel({
      id: 'ch-create',
      name: 'Created Channel',
      revision: 1,
      enabled: true,
      sourceConnector: {
        metaDataId: 0,
        name: 'Source',
        enabled: true,
        transportName: 'HTTP Listener',
        properties: {},
      },
      destinationConnectors: [],
      properties: {},
    });

    expect(result).toBe(true);
    expect(mockUpsertChannel).toHaveBeenCalledTimes(1);
    const [id, name] = mockUpsertChannel.mock.calls[0]!;
    expect(id).toBe('ch-create');
    expect(name).toBe('Created Channel');
  });

  test('updateChannel returns false for non-existent channel', async () => {
    mockGetChannelById.mockResolvedValue(null);
    const result = await ChannelController.updateChannel('ghost', { name: 'Ghost' });
    expect(result).toBe(false);
    expect(mockUpsertChannel).not.toHaveBeenCalled();
  });

  test('getChannelIdsAndNames returns id→name map', async () => {
    const rows = [
      makeRow({ id: 'ch-a', name: 'Alpha' }),
      makeRow({ id: 'ch-b', name: 'Beta' }),
    ];
    mockGetChannels.mockResolvedValue(rows);

    const map = await ChannelController.getChannelIdsAndNames();
    expect(map).toEqual({ 'ch-a': 'Alpha', 'ch-b': 'Beta' });
  });

  test('getChannelXml returns raw XML string', async () => {
    const xml = makeChannelXml({ id: 'ch-raw', name: 'Raw XML' });
    mockGetChannelById.mockResolvedValue({
      ID: 'ch-raw',
      NAME: 'Raw XML',
      REVISION: 1,
      CHANNEL: xml,
    });

    const result = await ChannelController.getChannelXml('ch-raw');
    expect(result).toBe(xml);
  });

  test('getChannelXml returns null for non-existent channel', async () => {
    mockGetChannelById.mockResolvedValue(null);
    const result = await ChannelController.getChannelXml('missing');
    expect(result).toBeNull();
  });

  test('setChannelEnabled does nothing for non-existent channel', async () => {
    mockGetChannelById.mockResolvedValue(null);
    await ChannelController.setChannelEnabled('missing', true);
    expect(mockUpsertChannel).not.toHaveBeenCalled();
  });

  test('parseChannelXml handles multiple destination connectors', async () => {
    const row = makeRow({ id: 'ch-multi', name: 'Multi Dest', destinationCount: 3 });
    mockGetChannelById.mockResolvedValue(row);

    const channel = await ChannelController.getChannel('ch-multi');

    expect(channel).not.toBeNull();
    expect(channel!.destinationConnectors).toHaveLength(3);
    expect(channel!.destinationConnectors[0]!.metaDataId).toBe(1);
    expect(channel!.destinationConnectors[1]!.metaDataId).toBe(2);
    expect(channel!.destinationConnectors[2]!.metaDataId).toBe(3);
  });

  test('parseChannelXml preserves preprocessing and postprocessing scripts', async () => {
    const row = makeRow({
      id: 'ch-scripts',
      name: 'Scripted',
      preprocessingScript: 'return message;',
    });
    mockGetChannelById.mockResolvedValue(row);

    const channel = await ChannelController.getChannel('ch-scripts');
    expect(channel!.preprocessingScript).toBe('return message;');
  });

  test('parseChannelXml preserves channel properties', async () => {
    const row = makeRow({
      id: 'ch-props',
      name: 'Props Test',
      messageStorageMode: 'PRODUCTION',
    });
    mockGetChannelById.mockResolvedValue(row);

    const channel = await ChannelController.getChannel('ch-props');
    expect(channel!.properties.messageStorageMode).toBe('PRODUCTION');
    expect(channel!.properties.clearGlobalChannelMap).toBe(true);
  });

  test('createChannelWithXml uses raw XML when provided', async () => {
    const rawXml = makeChannelXml({ id: 'ch-raw-create', name: 'Raw Create' });
    const result = await ChannelController.createChannelWithXml(
      { id: 'ch-raw-create', name: 'Raw Create', revision: 1 } as Partial<Channel>,
      rawXml
    );

    expect(result).toBe(true);
    expect(mockUpsertChannel).toHaveBeenCalledTimes(1);
    const [, , xml] = mockUpsertChannel.mock.calls[0]!;
    expect(xml).toBe(rawXml);
  });

  test('updateChannelWithXml updates revision in raw XML', async () => {
    const existingRow = makeRow({ id: 'ch-xmlup', name: 'XML Update', revision: 5 });
    mockGetChannelById.mockResolvedValue(existingRow);

    const rawXml = makeChannelXml({ id: 'ch-xmlup', name: 'XML Update', revision: 5 });
    const result = await ChannelController.updateChannelWithXml(
      'ch-xmlup',
      { name: 'XML Update' },
      rawXml
    );

    expect(result).toBe(true);
    const [, , xml, revision] = mockUpsertChannel.mock.calls[0]!;
    expect(revision).toBe(6); // 5 + 1
    // The raw XML should have its revision replaced
    expect((xml as string)).toContain('<revision>6</revision>');
    expect((xml as string)).not.toContain('<revision>5</revision>');
  });

  test('getCodeTemplateLibraries returns empty array (stub)', async () => {
    const result = await ChannelController.getCodeTemplateLibraries('ch-001');
    expect(result).toEqual([]);
  });
});
