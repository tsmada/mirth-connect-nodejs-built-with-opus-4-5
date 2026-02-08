import * as fs from 'fs';

describe('Message Removal Endpoints', () => {
  describe('MessageServlet', () => {
    const source = fs.readFileSync('src/api/servlets/MessageServlet.ts', 'utf8');

    it('has POST /_remove endpoint', () => {
      expect(source).toContain("'/_remove'");
      expect(source).toContain('authorize({ operation: MESSAGE_REMOVE');
    });
  });

  describe('ChannelServlet cross-channel removal', () => {
    const source = fs.readFileSync('src/api/servlets/ChannelServlet.ts', 'utf8');

    it('has DELETE /_removeAllMessages endpoint', () => {
      expect(source).toContain("'/_removeAllMessages'");
    });

    it('has POST /_removeAllMessagesPost endpoint', () => {
      expect(source).toContain("'/_removeAllMessagesPost'");
    });

    it('uses MESSAGE_REMOVE_ALL operation', () => {
      expect(source).toContain('MESSAGE_REMOVE_ALL');
    });

    it('truncates message tables', () => {
      expect(source).toContain('TRUNCATE TABLE D_MC');
      expect(source).toContain('TRUNCATE TABLE D_MA');
      expect(source).toContain('TRUNCATE TABLE D_MM');
    });
  });
});
