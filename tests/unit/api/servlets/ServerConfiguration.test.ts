import * as fs from 'fs';

describe('Server Configuration Backup/Restore', () => {
  const configSource = fs.readFileSync('src/api/servlets/ConfigurationServlet.ts', 'utf8');
  const opsSource = fs.readFileSync('src/api/middleware/operations.ts', 'utf8');

  it('has GET /configuration endpoint', () => {
    expect(configSource).toContain("'/configuration'");
    expect(configSource).toContain('CONFIG_GET_SERVER_CONFIGURATION');
  });

  it('has PUT /configuration endpoint', () => {
    expect(configSource).toContain('CONFIG_SET_SERVER_CONFIGURATION');
  });

  it('backup aggregates all server state', () => {
    expect(configSource).toContain('getServerSettings');
    expect(configSource).toContain('getGlobalScripts');
    expect(configSource).toContain('getConfigurationMap');
    expect(configSource).toContain('getAllChannels');
  });

  it('restore handles each configuration section conditionally', () => {
    expect(configSource).toContain('configuration.serverSettings');
    expect(configSource).toContain('configuration.globalScripts');
    expect(configSource).toContain('configuration.configurationMap');
    expect(configSource).toContain('configuration.channelTags');
    expect(configSource).toContain('configuration.channelMetadata');
    expect(configSource).toContain('configuration.channelDependencies');
    expect(configSource).toContain('configuration.resources');
    expect(configSource).toContain('configuration.channels');
  });

  it('operations are defined with correct permissions', () => {
    expect(opsSource).toContain('CONFIG_GET_SERVER_CONFIGURATION');
    expect(opsSource).toContain('CONFIG_SET_SERVER_CONFIGURATION');
    expect(opsSource).toContain('P.SERVER_BACKUP');
    expect(opsSource).toContain('P.SERVER_RESTORE');
  });

  it('operations are registered in allOperations array', () => {
    // Both operations should appear in the allOperations array
    const allOpsMatch = opsSource.match(/const allOperations[\s\S]*?\];/);
    expect(allOpsMatch).not.toBeNull();
    const allOpsBlock = allOpsMatch![0];
    expect(allOpsBlock).toContain('CONFIG_GET_SERVER_CONFIGURATION');
    expect(allOpsBlock).toContain('CONFIG_SET_SERVER_CONFIGURATION');
  });
});
