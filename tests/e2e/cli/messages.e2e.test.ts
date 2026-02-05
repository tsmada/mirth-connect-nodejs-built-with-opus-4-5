/**
 * CLI Messages E2E Tests
 *
 * Tests message sending and retrieval commands.
 */

import {
  runCli,
  runCliExpectSuccess,
  runCliExpectFailure,
  login,
  logout,
  stripAnsi,
} from './helpers/cli-runner.js';

describe('CLI Message Commands', () => {
  beforeEach(async () => {
    await login();
  });

  afterEach(async () => {
    await logout();
  });

  describe('send hl7 command', () => {
    it('should send default HL7 message', async () => {
      const result = await runCliExpectSuccess(['send', 'hl7', 'localhost:6662']);

      const output = stripAnsi(result.stdout);
      expect(output).toContain('HL7 message sent successfully');
      expect(output).toContain('ACK: AA');
    });

    it('should show raw response with --raw flag', async () => {
      const result = await runCliExpectSuccess([
        'send',
        'hl7',
        'localhost:6662',
        '--raw',
      ]);

      const output = stripAnsi(result.stdout);
      expect(output).toContain('MSH|');
      expect(output).toContain('MSA|AA');
    });

    it('should fail when sending to invalid port', async () => {
      const result = await runCliExpectFailure([
        'send',
        'hl7',
        'localhost:9999',
        '--timeout',
        '5000',
      ]);

      expect(result.exitCode).toBe(1);
    });

    it('should output JSON when --json flag is used', async () => {
      const result = await runCliExpectSuccess([
        '--json',
        'send',
        'hl7',
        'localhost:6662',
      ]);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(json.success).toBe(true);
      expect(json.message).toContain('ACK');
    });
  });

  describe('send mllp command', () => {
    it('should send MLLP message from inline content', async () => {
      const message =
        'MSH|^~\\&|TEST|FAC|RCV|FAC|20240101120000||ADT^A01|123|P|2.5\rPID|1||PAT123';
      const result = await runCliExpectSuccess([
        'send',
        'mllp',
        'localhost:6662',
        message,
      ]);

      const output = stripAnsi(result.stdout);
      expect(output).toContain('Message sent successfully');
    });
  });

  describe('messages command', () => {
    it('should list messages for a channel', async () => {
      // Use a known channel ID directly
      const channelId = 'e83d81d5-bc81-4554-8ef1-99ea67000002';
      const result = await runCli(['messages', channelId]);

      // Should either show messages or "No messages found"
      expect(result.success).toBe(true);
      const output = stripAnsi(result.stdout + result.stderr);
      expect(
        output.includes('message(s)') || output.includes('No messages found')
      ).toBe(true);
    });

    it('should output JSON when --json flag is used', async () => {
      const channelId = 'e83d81d5-bc81-4554-8ef1-99ea67000002';
      const result = await runCliExpectSuccess([
        '--json',
        'messages',
        channelId,
      ]);

      const json = JSON.parse(stripAnsi(result.stdout));
      expect(Array.isArray(json)).toBe(true);
    });
  });
});
