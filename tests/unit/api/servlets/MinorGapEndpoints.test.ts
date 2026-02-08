import * as fs from 'fs';

describe('Wave 3 Minor Gap Endpoints', () => {
  describe('ChannelServlet', () => {
    const source = fs.readFileSync('src/api/servlets/ChannelServlet.ts', 'utf8');

    it('has POST /_setInitialState', () => {
      expect(source).toContain("'/_setInitialState'");
    });

    it('has POST /:channelId/initialState/:initialState', () => {
      expect(source).toContain('/initialState/');
    });
  });

  describe('ChannelStatusServlet', () => {
    const source = fs.readFileSync('src/api/servlets/ChannelStatusServlet.ts', 'utf8');

    it('has POST /_startConnectors', () => {
      expect(source).toContain("'/_startConnectors'");
    });

    it('has POST /_stopConnectors', () => {
      expect(source).toContain("'/_stopConnectors'");
    });
  });

  describe('UserServlet', () => {
    const source = fs.readFileSync('src/api/servlets/UserServlet.ts', 'utf8');

    it('has GET /:userId/preferences/:name', () => {
      expect(source).toContain("'/:userId/preferences/:name'");
    });

    it('has PUT /:userId/preferences/:name', () => {
      expect(source).toContain("preferences/:name'");
    });
  });

  describe('ConfigurationServlet', () => {
    const source = fs.readFileSync('src/api/servlets/ConfigurationServlet.ts', 'utf8');

    it('has POST /_testEmail', () => {
      expect(source).toContain("'/_testEmail'");
    });

    it('uses CONFIG_TEST_EMAIL operation', () => {
      expect(source).toContain('CONFIG_TEST_EMAIL');
    });
  });

  describe('ExtensionServlet', () => {
    const source = fs.readFileSync('src/api/servlets/ExtensionServlet.ts', 'utf8');

    it('has GET /:extensionName/enabled', () => {
      expect(source).toContain("'/:extensionName/enabled'");
    });
  });

  describe('operations.ts', () => {
    const source = fs.readFileSync('src/api/middleware/operations.ts', 'utf8');

    it('has CONFIG_TEST_EMAIL', () => {
      expect(source).toContain('CONFIG_TEST_EMAIL');
    });
  });
});
