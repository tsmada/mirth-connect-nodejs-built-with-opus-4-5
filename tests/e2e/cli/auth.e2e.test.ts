/**
 * CLI Authentication E2E Tests
 *
 * Tests login, logout, and whoami commands.
 * Requires a running Mirth server at localhost:8081.
 */

import {
  runCli,
  runCliExpectSuccess,
  runCliExpectFailure,
  login,
  logout,
  stripAnsi,
  isServerAvailable,
} from './helpers/cli-runner.js';

describe('CLI Authentication', () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await isServerAvailable();
    if (!serverUp) {
      console.warn('Skipping E2E auth tests: Mirth server not available at localhost:8081');
    }
  });

  // Clean up after each test
  afterEach(async () => {
    if (serverUp) await logout();
  });

  describe('login command', () => {
    it('should login successfully with valid credentials', async () => {
      if (!serverUp) return;

      const result = await login('admin', 'admin');

      expect(result.success).toBe(true);
      const allOutput = stripAnsi(result.stdout + result.stderr);
      expect(allOutput).toContain('Logged in as admin');
    });

    it('should fail with invalid password', async () => {
      if (!serverUp) return;

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
      if (!serverUp) return;

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
      if (!serverUp) return;

      await login();

      const result = await runCliExpectSuccess(['whoami']);

      expect(stripAnsi(result.stdout)).toContain('Logged in as admin');
      expect(stripAnsi(result.stdout)).toContain('User ID: 1');
    });

    it('should show not logged in when session is cleared', async () => {
      if (!serverUp) return;

      await logout(); // Ensure logged out

      const result = await runCli(['whoami']);

      expect(stripAnsi(result.stdout)).toContain('Not logged in');
    });

    it('should output JSON when --json flag is used', async () => {
      if (!serverUp) return;

      await login();

      const result = await runCliExpectSuccess(['--json', 'whoami']);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(json.loggedIn).toBe(true);
      expect(json.user.username).toBe('admin');
    });
  });

  describe('logout command', () => {
    it('should logout successfully', async () => {
      if (!serverUp) return;

      await login();

      const result = await runCliExpectSuccess(['logout']);

      const allOutput = stripAnsi(result.stdout + result.stderr);
      expect(allOutput).toContain('Logged out');
    });

    it('should handle logout when not logged in', async () => {
      if (!serverUp) return;

      await logout(); // Ensure logged out

      const result = await runCli(['logout']);

      // Should not fail, just indicate no session
      expect(result.success).toBe(true);
    });
  });
});
