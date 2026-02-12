/**
 * DatabaseDispatcher replaceConnectorProperties Parity Tests (Wave 18)
 *
 * Verifies that DatabaseDispatcher resolves ${variable} placeholders in
 * url, username, and password before each send(), matching Java
 * DatabaseDispatcher.replaceConnectorProperties() (line 78).
 */

import { DatabaseDispatcher } from '../../../../src/connectors/jdbc/DatabaseDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { ContentType } from '../../../../src/model/ContentType';
import { Status } from '../../../../src/model/Status';

// Mock the DashboardStatusController
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn(),
  },
}));

// Mock mysql2/promise
const mockExecute = jest.fn().mockResolvedValue([{ affectedRows: 1, insertId: 1, warningStatus: 0 }]);
const mockRelease = jest.fn();
const mockGetConnection = jest.fn().mockResolvedValue({
  execute: mockExecute,
  release: mockRelease,
});
jest.mock('mysql2/promise', () => ({
  createPool: jest.fn().mockReturnValue({
    getConnection: () => mockGetConnection(),
    end: jest.fn().mockResolvedValue(undefined),
  }),
}));

function createTestMessage(maps?: {
  channelMap?: Record<string, unknown>;
  sourceMap?: Record<string, unknown>;
  connectorMap?: Record<string, unknown>;
  rawData?: string;
  encodedData?: string;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    channelId: 'test-channel-id',
    messageId: 1,
    metaDataId: 1,
    channelName: 'Test Channel',
    connectorName: 'Database Writer',
    serverId: 'test-server',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (maps?.channelMap) {
    for (const [k, v] of Object.entries(maps.channelMap)) {
      msg.getChannelMap().set(k, v);
    }
  }
  if (maps?.sourceMap) {
    for (const [k, v] of Object.entries(maps.sourceMap)) {
      msg.getSourceMap().set(k, v);
    }
  }
  if (maps?.connectorMap) {
    for (const [k, v] of Object.entries(maps.connectorMap)) {
      msg.getConnectorMap().set(k, v);
    }
  }
  if (maps?.rawData) {
    msg.setRawData(maps.rawData);
  }
  if (maps?.encodedData) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: maps.encodedData,
      dataType: 'HL7V2',
      encrypted: false,
    });
  }

  return msg;
}

describe('DatabaseDispatcher.replaceConnectorProperties()', () => {
  let dispatcher: DatabaseDispatcher;

  beforeEach(() => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        username: 'admin',
        password: 'secret',
        query: 'INSERT INTO t VALUES (?)',
      },
    });
  });

  afterEach(async () => {
    if (dispatcher?.isRunning()) {
      await dispatcher.stop();
    }
  });

  it('should resolve ${variable} in url from channelMap', () => {
    const msg = createTestMessage({
      channelMap: { dbHost: 'prod-db.example.com', dbPort: '3307', dbName: 'patients' },
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://${dbHost}:${dbPort}/${dbName}',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://prod-db.example.com:3307/patients');
  });

  it('should resolve ${variable} in username from channelMap', () => {
    const msg = createTestMessage({
      channelMap: { dbUser: 'readonly_user' },
    });

    const props = {
      ...dispatcher.getProperties(),
      username: '${dbUser}',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.username).toBe('readonly_user');
  });

  it('should resolve ${variable} in password from channelMap', () => {
    const msg = createTestMessage({
      channelMap: { dbPass: 'p@ssw0rd!' },
    });

    const props = {
      ...dispatcher.getProperties(),
      password: '${dbPass}',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.password).toBe('p@ssw0rd!');
  });

  it('should resolve all three fields simultaneously', () => {
    const msg = createTestMessage({
      channelMap: {
        targetUrl: 'jdbc:mysql://staging:3306/hl7',
        targetUser: 'mirth_svc',
        targetPass: 'svc_secret',
      },
    });

    const props = {
      ...dispatcher.getProperties(),
      url: '${targetUrl}',
      username: '${targetUser}',
      password: '${targetPass}',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://staging:3306/hl7');
    expect(resolved.username).toBe('mirth_svc');
    expect(resolved.password).toBe('svc_secret');
  });

  it('should NOT modify the original properties object', () => {
    const msg = createTestMessage({
      channelMap: { dbHost: 'resolved-host' },
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://${dbHost}:3306/db',
    };
    const originalUrl = props.url;

    dispatcher.replaceConnectorProperties(props, msg);
    expect(props.url).toBe(originalUrl);
  });

  it('should leave strings without ${} unchanged', () => {
    const msg = createTestMessage();

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://localhost:3306/testdb',
      username: 'admin',
      password: 'secret',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://localhost:3306/testdb');
    expect(resolved.username).toBe('admin');
    expect(resolved.password).toBe('secret');
  });

  it('should leave unresolved ${variable} as-is when not in any map', () => {
    const msg = createTestMessage();

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://${unknownHost}:3306/db',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://${unknownHost}:3306/db');
  });

  it('should check sourceMap when channelMap has no match', () => {
    const msg = createTestMessage({
      sourceMap: { dbHost: 'source-host' },
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://${dbHost}:3306/db',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://source-host:3306/db');
  });

  it('should check connectorMap when channelMap and sourceMap have no match', () => {
    const msg = createTestMessage({
      connectorMap: { dbHost: 'connector-host' },
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://${dbHost}:3306/db',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://connector-host:3306/db');
  });

  it('should prefer channelMap over sourceMap (priority order)', () => {
    const msg = createTestMessage({
      channelMap: { dbHost: 'channel-host' },
      sourceMap: { dbHost: 'source-host' },
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://${dbHost}:3306/db',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://channel-host:3306/db');
  });

  it('should resolve ${message.encodedData} builtin', () => {
    const msg = createTestMessage({
      encodedData: 'encoded-content-here',
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://localhost:3306/${message.encodedData}',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://localhost:3306/encoded-content-here');
  });

  it('should resolve ${message.rawData} builtin', () => {
    const msg = createTestMessage({
      rawData: 'raw-content-here',
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://localhost:3306/${message.rawData}',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://localhost:3306/raw-content-here');
  });

  it('should handle empty string properties gracefully', () => {
    const msg = createTestMessage();

    const props = {
      ...dispatcher.getProperties(),
      url: '',
      username: '',
      password: '',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('');
    expect(resolved.username).toBe('');
    expect(resolved.password).toBe('');
  });

  it('should resolve multiple variables in a single field', () => {
    const msg = createTestMessage({
      channelMap: { host: 'db.example.com', port: '3307', dbName: 'ehr' },
    });

    const props = {
      ...dispatcher.getProperties(),
      url: 'jdbc:mysql://${host}:${port}/${dbName}?useSSL=true',
    };

    const resolved = dispatcher.replaceConnectorProperties(props, msg);
    expect(resolved.url).toBe('jdbc:mysql://db.example.com:3307/ehr?useSSL=true');
  });
});

describe('DatabaseDispatcher.send() uses resolved properties', () => {
  let dispatcher: DatabaseDispatcher;

  beforeEach(() => {
    mockExecute.mockClear();
    mockRelease.mockClear();
    mockGetConnection.mockClear();
    mockGetConnection.mockResolvedValue({
      execute: mockExecute,
      release: mockRelease,
    });
    mockExecute.mockResolvedValue([{ affectedRows: 1, insertId: 1, warningStatus: 0 }]);
  });

  afterEach(async () => {
    if (dispatcher?.isRunning()) {
      await dispatcher.stop();
    }
  });

  it('should call replaceConnectorProperties before executing query', async () => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      properties: {
        url: 'jdbc:mysql://${dbHost}:3306/testdb',
        username: '${dbUser}',
        password: '${dbPass}',
        query: 'INSERT INTO t VALUES (?)',
      },
    });

    (dispatcher as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await dispatcher.start();

    const spy = jest.spyOn(dispatcher, 'replaceConnectorProperties');

    const msg = createTestMessage({
      channelMap: {
        dbHost: 'resolved-host',
        dbUser: 'resolved-user',
        dbPass: 'resolved-pass',
      },
    });

    await dispatcher.send(msg);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'jdbc:mysql://${dbHost}:3306/testdb',
      }),
      msg
    );
  });
});
