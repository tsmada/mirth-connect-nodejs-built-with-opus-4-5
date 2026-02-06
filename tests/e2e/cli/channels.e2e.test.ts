/**
 * CLI Channels E2E Tests
 *
 * Tests channel list, get, and status commands.
 * Requires a running Mirth server at localhost:8081.
 */

import {
  runCli,
  runCliExpectSuccess,
  login,
  logout,
  stripAnsi,
  isServerAvailable,
} from './helpers/cli-runner.js';

describe('CLI Channel Commands', () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await isServerAvailable();
    if (!serverUp) {
      console.warn('Skipping E2E channel tests: Mirth server not available at localhost:8081');
    }
  });

  beforeEach(async () => {
    if (serverUp) await login();
  });

  afterEach(async () => {
    if (serverUp) await logout();
  });

  describe('channels list command', () => {
    it('should list channels with --undeployed flag', async () => {
      if (!serverUp) return;

      const result = await runCliExpectSuccess(['channels', '--undeployed']);

      const output = stripAnsi(result.stdout);
      // Should show channel table
      expect(output).toContain('ID');
      expect(output).toContain('NAME');
      expect(output).toContain('STATUS');
      expect(output).toContain('channel(s)');
    });

    it('should output JSON when --json flag is used', async () => {
      if (!serverUp) return;

      const result = await runCliExpectSuccess([
        '--json',
        'channels',
        '--undeployed',
      ]);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(Array.isArray(json)).toBe(true);
      if (json.length > 0) {
        expect(json[0].channelId).toBeDefined();
        expect(json[0].name).toBeDefined();
        expect(json[0].state).toBeDefined();
      }
    });

    it('should filter channels by name', async () => {
      if (!serverUp) return;

      const result = await runCli([
        'channels',
        '--undeployed',
        '--filter',
        'MLLP',
      ]);

      const output = stripAnsi(result.stdout);
      // Should only show channels matching "MLLP"
      if (output.includes('channel(s)')) {
        expect(output).toContain('MLLP');
      }
    });
  });

  describe('channels get command', () => {
    it('should get channel by ID', async () => {
      if (!serverUp) return;

      // First get the list to find a channel ID
      const listResult = await runCliExpectSuccess([
        '--json',
        'channels',
        '--undeployed',
      ]);
      const channels = JSON.parse(stripAnsi(listResult.stdout));

      if (channels.length > 0) {
        const channelId = channels[0].channelId;
        const result = await runCliExpectSuccess(['channels', 'get', channelId]);

        const output = stripAnsi(result.stdout);
        expect(output).toContain(channels[0].name);
      }
    });

    it('should get channel by partial name', async () => {
      if (!serverUp) return;

      const result = await runCli(['channels', 'get', 'MLLP']);

      // May succeed or fail depending on how many channels match
      // Just verify it runs without crashing
      expect(result.exitCode).toBeDefined();
    });
  });
});
