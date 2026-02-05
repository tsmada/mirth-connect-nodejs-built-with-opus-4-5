/**
 * CLI Authentication E2E Tests
 *
 * Tests login, logout, and whoami commands.
 */

import {
  runCli,
  runCliExpectSuccess,
  runCliExpectFailure,
  login,
  logout,
  stripAnsi,
} from './helpers/cli-runner.js';

// Server URL can be configured via environment variable
// const serverUrl = process.env.MIRTH_CLI_URL || 'http://localhost:8081';

describe('CLI Authentication', () => {
  // Clean up after each test
  afterEach(async () => {
    await logout();
  });

  describe('login command', () => {
    it('should login successfully with valid credentials', async () => {
      const result = await login('admin', 'admin');

      expect(result.success).toBe(true);
      const allOutput = stripAnsi(result.stdout + result.stderr);
      expect(allOutput).toContain('Logged in as admin');
    });

    it('should fail with invalid password', async () => {
      const result = await runCliExpectFailure([
        'login',
        '--user',
        'admin',
        '--password',
        'wrongpassword',
      ]);

      expect(result.exitCode).toBe(1);
      // Output may go to stdout or stderr depending on spinner behavior
      const allOutput = stripAnsi(result.stdout + result.stderr);
      expect(allOutput).toContain('Login failed');
    });

    it('should fail with invalid username', async () => {
      const result = await runCliExpectFailure([
        'login',
        '--user',
        'nonexistent',
        '--password',
        'admin',
      ]);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('whoami command', () => {
    it('should show user info when logged in', async () => {
      await login();

      const result = await runCliExpectSuccess(['whoami']);

      expect(stripAnsi(result.stdout)).toContain('Logged in as admin');
      expect(stripAnsi(result.stdout)).toContain('User ID: 1');
    });

    it('should show not logged in when session is cleared', async () => {
      await logout(); // Ensure logged out

      const result = await runCli(['whoami']);

      expect(stripAnsi(result.stdout)).toContain('Not logged in');
    });

    it('should output JSON when --json flag is used', async () => {
      await login();

      const result = await runCliExpectSuccess(['--json', 'whoami']);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(json.loggedIn).toBe(true);
      expect(json.user.username).toBe('admin');
    });
  });

  describe('logout command', () => {
    it('should logout successfully', async () => {
      await login();

      const result = await runCliExpectSuccess(['logout']);

      const allOutput = stripAnsi(result.stdout + result.stderr);
      expect(allOutput).toContain('Logged out');
    });

    it('should handle logout when not logged in', async () => {
      await logout(); // Ensure logged out

      const result = await runCli(['logout']);

      // Should not fail, just indicate no session
      expect(result.success).toBe(true);
    });
  });
});
