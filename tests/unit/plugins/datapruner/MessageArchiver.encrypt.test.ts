/**
 * Tests for MessageArchiver AES-256-GCM archive encryption.
 *
 * Verifies:
 * - Encrypted output is not plaintext
 * - Round-trip: archive → finalize → decryptArchiveFile → original content
 * - Compressed + encrypted round-trip
 * - Encrypted only (no compression) round-trip
 * - Missing password throws
 * - Invalid password on decrypt fails
 * - Multiple messages in encrypted archive
 * - XML format with encryption
 * - Auth tag integrity (corrupt byte → decrypt fails)
 * - Filename extensions (.enc suffix)
 */

import { MessageArchiver, ArchiveFormat } from '../../../../src/plugins/datapruner/MessageArchiver.js';
import type { ArchiveMessage } from '../../../../src/plugins/datapruner/MessageArchiver.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function makeArchiveMessage(overrides: Partial<ArchiveMessage> = {}): ArchiveMessage {
  return {
    messageId: 1,
    serverId: 'srv-1',
    channelId: 'ch-enc',
    receivedDate: new Date('2026-01-15T10:00:00Z'),
    processed: true,
    connectorMessages: [
      {
        metaDataId: 0,
        channelId: 'ch-enc',
        channelName: 'Encrypt Test',
        connectorName: 'Source',
        serverId: 'srv-1',
        receivedDate: new Date('2026-01-15T10:00:00Z'),
        status: 'S',
        sendAttempts: 1,
        raw: { contentType: 'RAW', content: 'MSH|^~\\&|TEST|FACILITY|DEST|DEST_FAC|202601151000||ADT^A01|12345|P|2.5.1', encrypted: false },
      },
    ],
    ...overrides,
  };
}

describe('MessageArchiver encryption', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mirth-archive-enc-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('encrypted output file is not plaintext', async () => {
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: false,
      encrypt: true,
      encryptionPassword: 'test-password-123',
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage();
    await archiver.archiveMessages('ch-enc', [msg]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    expect(files).toHaveLength(1);

    const raw = await fs.promises.readFile(files[0]!);
    const asText = raw.toString('utf-8');

    // The raw bytes should NOT contain the plaintext message content
    expect(asText).not.toContain('MSH|');
    expect(asText).not.toContain('messageId');
    expect(asText).not.toContain('Encrypt Test');
  });

  it('round-trip: compressed + encrypted', async () => {
    const password = 'roundtrip-pass';
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: true,
      encrypt: true,
      encryptionPassword: password,
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage({ messageId: 42, serverId: 'srv-rt' });
    await archiver.archiveMessages('ch-enc', [msg]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    expect(files).toHaveLength(1);
    expect(files[0]!).toMatch(/\.json\.gz\.enc$/);

    const decrypted = await MessageArchiver.decryptArchiveFile(files[0]!, password);
    const parsed = JSON.parse(decrypted.toString('utf-8').trim());
    expect(parsed.messageId).toBe(42);
    expect(parsed.serverId).toBe('srv-rt');
    expect(parsed.connectorMessages[0].raw.content).toContain('MSH|');
  });

  it('round-trip: encrypted only (no compression)', async () => {
    const password = 'no-compress';
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: false,
      encrypt: true,
      encryptionPassword: password,
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage({ messageId: 99 });
    await archiver.archiveMessages('ch-enc', [msg]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    expect(files).toHaveLength(1);
    expect(files[0]!).toMatch(/\.json\.enc$/);
    expect(files[0]!).not.toMatch(/\.gz/);

    const decrypted = await MessageArchiver.decryptArchiveFile(files[0]!, password);
    const parsed = JSON.parse(decrypted.toString('utf-8').trim());
    expect(parsed.messageId).toBe(99);
  });

  it('throws when encrypt=true but no password provided', async () => {
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: false,
      encrypt: true,
      // encryptionPassword intentionally omitted
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage();
    await expect(archiver.archiveMessages('ch-enc', [msg])).rejects.toThrow(
      'Encryption password is required when encrypt is true'
    );
  });

  it('invalid password on decrypt throws', async () => {
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: false,
      encrypt: true,
      encryptionPassword: 'correct-password',
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage();
    await archiver.archiveMessages('ch-enc', [msg]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    expect(files).toHaveLength(1);

    // Decrypt with wrong password should throw (GCM auth tag mismatch)
    await expect(MessageArchiver.decryptArchiveFile(files[0]!, 'wrong-password')).rejects.toThrow();
  });

  it('multiple messages in encrypted archive', async () => {
    const password = 'multi-msg';
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: true,
      encrypt: true,
      encryptionPassword: password,
      messagesPerFile: 100,
    });

    const messages = [
      makeArchiveMessage({ messageId: 1 }),
      makeArchiveMessage({ messageId: 2 }),
      makeArchiveMessage({ messageId: 3 }),
    ];
    await archiver.archiveMessages('ch-enc', messages);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    expect(files).toHaveLength(1);

    const decrypted = await MessageArchiver.decryptArchiveFile(files[0]!, password);
    const lines = decrypted.toString('utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const msg1 = JSON.parse(lines[0]!);
    const msg2 = JSON.parse(lines[1]!);
    const msg3 = JSON.parse(lines[2]!);
    expect(msg1.messageId).toBe(1);
    expect(msg2.messageId).toBe(2);
    expect(msg3.messageId).toBe(3);
  });

  it('XML format with encryption round-trip', async () => {
    const password = 'xml-enc';
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.XML,
      compress: false,
      encrypt: true,
      encryptionPassword: password,
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage({ messageId: 77 });
    await archiver.archiveMessages('ch-enc', [msg]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    expect(files).toHaveLength(1);
    expect(files[0]!).toMatch(/\.xml\.enc$/);

    const decrypted = await MessageArchiver.decryptArchiveFile(files[0]!, password);
    const content = decrypted.toString('utf-8');
    expect(content).toContain('<message>');
    expect(content).toContain('<messageId>77</messageId>');
    expect(content).toContain('MSH|');
  });

  it('auth tag integrity: corrupting a byte causes decrypt to fail', async () => {
    const password = 'integrity-test';
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: false,
      encrypt: true,
      encryptionPassword: password,
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage();
    await archiver.archiveMessages('ch-enc', [msg]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    const filePath = files[0]!;

    // Corrupt a byte in the encrypted data (not the header, not the auth tag)
    const data = await fs.promises.readFile(filePath);
    const corruptionIndex = 40; // inside encrypted data region (after 32-byte header)
    data[corruptionIndex] = (data[corruptionIndex]! ^ 0xff) as number;
    await fs.promises.writeFile(filePath, data);

    // Decrypt should fail due to GCM authentication failure
    await expect(MessageArchiver.decryptArchiveFile(filePath, password)).rejects.toThrow();
  });

  it('compressed + encrypted XML round-trip', async () => {
    const password = 'xml-gz-enc';
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.XML,
      compress: true,
      encrypt: true,
      encryptionPassword: password,
      messagesPerFile: 100,
    });

    const msg = makeArchiveMessage({ messageId: 55 });
    await archiver.archiveMessages('ch-enc', [msg]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-enc');
    expect(files).toHaveLength(1);
    expect(files[0]!).toMatch(/\.xml\.gz\.enc$/);

    const decrypted = await MessageArchiver.decryptArchiveFile(files[0]!, password);
    const content = decrypted.toString('utf-8');
    expect(content).toContain('<message>');
    expect(content).toContain('<messageId>55</messageId>');
  });

  it('file too small to be valid encrypted archive throws', async () => {
    const filePath = path.join(tmpDir, 'tiny.json.enc');
    await fs.promises.writeFile(filePath, Buffer.alloc(10)); // too small for header + auth tag

    await expect(MessageArchiver.decryptArchiveFile(filePath, 'any')).rejects.toThrow(
      'too small'
    );
  });
});
