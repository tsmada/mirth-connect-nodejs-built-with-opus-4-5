/**
 * Tests for minor parity fixes bundle:
 * - Fix 1: dataType hardcoding (SourceConnector.getInboundDataType)
 * - Fix 3: Connector lifecycle hooks (onStart/onStop)
 * - Fix 4: DAO overloads (deleteMessage, getMessages)
 *
 * Fix 2 (stats timing) is implicitly tested by Channel.test.ts
 */

import { SourceConnector, SourceConnectorConfig } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector, DestinationConnectorConfig } from '../../../../src/donkey/channel/DestinationConnector';
import { Channel } from '../../../../src/donkey/channel/Channel';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// ============================================================================
// Test subclasses
// ============================================================================

class TestSourceConnector extends SourceConnector {
  startHookCalled = false;
  stopHookCalled = false;

  constructor(config?: Partial<SourceConnectorConfig>) {
    super({
      name: config?.name ?? 'Test Source',
      transportName: config?.transportName ?? 'TEST',
      respondAfterProcessing: config?.respondAfterProcessing,
    });
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  protected async onStart(): Promise<void> {
    this.startHookCalled = true;
  }

  protected async onStop(): Promise<void> {
    this.stopHookCalled = true;
  }
}

class TestDestConnector extends DestinationConnector {
  startHookCalled = false;
  stopHookCalled = false;

  constructor(config?: Partial<DestinationConnectorConfig>) {
    super({
      name: config?.name ?? 'Test Dest',
      metaDataId: config?.metaDataId ?? 1,
      transportName: config?.transportName ?? 'TEST',
      enabled: config?.enabled,
    });
  }

  async send(_msg: ConnectorMessage): Promise<void> {}
  async getResponse(_msg: ConnectorMessage): Promise<string | null> { return null; }

  protected async onStart(): Promise<void> {
    this.startHookCalled = true;
  }

  protected async onStop(): Promise<void> {
    this.stopHookCalled = true;
  }
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  GlobalMap.resetInstance();
  ConfigurationMap.resetInstance();
  GlobalChannelMapStore.resetInstance();
  resetDefaultExecutor();
});

describe('Fix 1: SourceConnector inbound dataType', () => {
  it('should default to RAW', () => {
    const src = new TestSourceConnector();
    expect(src.getInboundDataType()).toBe('RAW');
  });

  it('should allow setting inbound data type', () => {
    const src = new TestSourceConnector();
    src.setInboundDataType('HL7V2');
    expect(src.getInboundDataType()).toBe('HL7V2');
  });

  it('should allow setting to XML', () => {
    const src = new TestSourceConnector();
    src.setInboundDataType('XML');
    expect(src.getInboundDataType()).toBe('XML');
  });
});

describe('Fix 3: DestinationConnector lifecycle hooks', () => {
  it('should call onStart() during start()', async () => {
    const dest = new TestDestConnector();
    expect(dest.startHookCalled).toBe(false);

    await dest.start();

    expect(dest.startHookCalled).toBe(true);
    expect(dest.isRunning()).toBe(true);
  });

  it('should call onStop() during stop()', async () => {
    const dest = new TestDestConnector();
    await dest.start();

    expect(dest.stopHookCalled).toBe(false);

    await dest.stop();

    expect(dest.stopHookCalled).toBe(true);
    expect(dest.isRunning()).toBe(false);
  });

  it('should dispatch state events during start()', async () => {
    const channel = new Channel({
      id: 'test-channel',
      name: 'Test Channel',
      enabled: true,
    });

    const dest = new TestDestConnector();
    dest.setChannel(channel);

    const states: DeployedState[] = [];
    channel.on('connectorStateChange', (event: { state: DeployedState }) => {
      states.push(event.state);
    });

    await dest.start();

    expect(states).toEqual([DeployedState.STARTING, DeployedState.STARTED]);
  });

  it('should dispatch state events during stop()', async () => {
    const channel = new Channel({
      id: 'test-channel',
      name: 'Test Channel',
      enabled: true,
    });

    const dest = new TestDestConnector();
    dest.setChannel(channel);

    await dest.start();

    const states: DeployedState[] = [];
    channel.on('connectorStateChange', (event: { state: DeployedState }) => {
      states.push(event.state);
    });

    await dest.stop();

    expect(states).toEqual([DeployedState.STOPPING, DeployedState.STOPPED]);
  });

  it('should work without a channel (no-op state dispatch)', async () => {
    const dest = new TestDestConnector();

    // Should not throw even without a channel attached
    await dest.start();
    expect(dest.isRunning()).toBe(true);
    expect(dest.getCurrentState()).toBe(DeployedState.STARTED);

    await dest.stop();
    expect(dest.isRunning()).toBe(false);
    expect(dest.getCurrentState()).toBe(DeployedState.STOPPED);
  });
});

describe('Fix 4: DAO overloads', () => {
  // These are mock-based tests since we don't have a real database in unit tests

  it('deleteMessage is exported from DonkeyDao', async () => {
    const { deleteMessage } = await import('../../../../src/db/DonkeyDao');
    expect(typeof deleteMessage).toBe('function');
  });

  it('getMessages is exported from DonkeyDao', async () => {
    const { getMessages } = await import('../../../../src/db/DonkeyDao');
    expect(typeof getMessages).toBe('function');
  });

  it('getMessages returns empty array for empty input', async () => {
    const { getMessages } = await import('../../../../src/db/DonkeyDao');
    // getMessages short-circuits on empty array without touching the DB
    const result = await getMessages('test-channel', []);
    expect(result).toEqual([]);
  });
});
