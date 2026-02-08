import * as fs from 'fs';

describe('Extension Servlet new endpoints', () => {
  const source = fs.readFileSync('src/api/servlets/ExtensionServlet.ts', 'utf8');

  it('has GET /connectors endpoint', () => {
    expect(source).toContain("'/connectors'");
  });

  it('has GET /plugins endpoint', () => {
    expect(source).toContain("'/plugins'");
  });

  it('filters connectors by type property', () => {
    expect(source).toContain("'type' in ext");
    expect(source).toContain("'transportName' in ext");
  });

  it('has POST /_setEnabled endpoint', () => {
    expect(source).toContain("'/:extensionName/_setEnabled'");
  });

  it('has GET /:extensionName/enabled endpoint', () => {
    expect(source).toContain("'/:extensionName/enabled'");
  });

  it('connectors route appears before extensionName route', () => {
    const connectorsPos = source.indexOf("'/connectors'");
    const extensionNamePos = source.indexOf("'/:extensionName'");
    expect(connectorsPos).toBeLessThan(extensionNamePos);
  });

  it('plugins route appears before extensionName route', () => {
    const pluginsPos = source.indexOf("'/plugins'");
    const extensionNamePos = source.indexOf("'/:extensionName'");
    expect(pluginsPos).toBeLessThan(extensionNamePos);
  });
});
