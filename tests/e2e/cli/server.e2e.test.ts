/**
 * CLI Server E2E Tests
 *
 * Tests server status, info, and stats commands.
 */

import {
  runCliExpectSuccess,
  login,
  logout,
  stripAnsi,
} from './helpers/cli-runner.js';

describe('CLI Server Commands', () => {
  beforeEach(async () => {
    await login();
  });

  afterEach(async () => {
    await logout();
  });

  describe('server status command', () => {
    it('should show server online status', async () => {
      const result = await runCliExpectSuccess(['server', 'status']);

      const output = stripAnsi(result.stdout);
      expect(output).toContain('Server Online');
      expect(output).toContain('Latency:');
      expect(output).toContain('Runtime:');
    });

    it('should output JSON when --json flag is used', async () => {
      const result = await runCliExpectSuccess(['--json', 'server', 'status']);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(json.status).toBe('online');
      expect(json.latencyMs).toBeGreaterThanOrEqual(0);
      expect(json.authenticated).toBe(true);
    });
  });

  describe('server info command', () => {
    it('should display server information', async () => {
      const result = await runCliExpectSuccess(['server', 'info']);

      const output = stripAnsi(result.stdout);
      expect(output).toContain('Mirth Connect Server');
      expect(output).toContain('Version:');
      expect(output).toContain('Runtime:');
      expect(output).toContain('OS:');
      expect(output).toContain('Database:');
    });

    it('should output JSON when --json flag is used', async () => {
      const result = await runCliExpectSuccess(['--json', 'server', 'info']);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(json.version).toBeDefined();
      expect(json.system).toBeDefined();
      expect(json.system.jvmVersion).toBeDefined();
      expect(json.system.osName).toBeDefined();
    });
  });

  describe('server stats command', () => {
    it('should display system statistics', async () => {
      const result = await runCliExpectSuccess(['server', 'stats']);

      const output = stripAnsi(result.stdout);
      expect(output).toContain('System Statistics');
      expect(output).toContain('CPU Usage:');
      expect(output).toContain('Memory Used:');
      expect(output).toContain('Memory Free:');
    });

    it('should output JSON when --json flag is used', async () => {
      const result = await runCliExpectSuccess(['--json', 'server', 'stats']);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(json.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(json.allocatedMemoryBytes).toBeGreaterThan(0);
      expect(json.freeMemoryBytes).toBeGreaterThanOrEqual(0);
    });
  });
});
