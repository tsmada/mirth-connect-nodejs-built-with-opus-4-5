import { MessageEncryptionUtil } from '../../../src/util/MessageEncryptionUtil.js';
import { Message } from '../../../src/model/Message.js';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage.js';
import { ContentType } from '../../../src/model/ContentType.js';
import { Status } from '../../../src/model/Status.js';
import {
  setEncryptor,
  AesEncryptor,
  NoOpEncryptor,
} from '../../../src/db/Encryptor.js';

// AES-256 test key (32 bytes, base64 encoded)
const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function makeConnectorMessage(
  messageId: number,
  metaDataId: number,
  connectorName: string,
): ConnectorMessage {
  return new ConnectorMessage({
    messageId,
    metaDataId,
    channelId: 'test-channel-id',
    channelName: 'Test Channel',
    connectorName,
    serverId: 'test-server',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
}

function makeMessage(messageId = 1): Message {
  return new Message({
    messageId,
    serverId: 'test-server',
    channelId: 'test-channel-id',
    receivedDate: new Date(),
    processed: false,
  });
}

function setContentOnCm(
  cm: ConnectorMessage,
  contentType: ContentType,
  content: string,
  encrypted = false,
): void {
  cm.setContent({
    contentType,
    content,
    dataType: 'HL7V2',
    encrypted,
  });
}

describe('MessageEncryptionUtil', () => {
  beforeEach(() => {
    setEncryptor(new AesEncryptor(TEST_KEY));
  });

  afterEach(() => {
    setEncryptor(new NoOpEncryptor());
  });

  describe('encryptMessage / decryptMessage round-trip', () => {
    it('should encrypt and decrypt a Message with source + 2 destinations', () => {
      const msg = makeMessage();
      const source = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(source, ContentType.RAW, 'MSH|^~\\&|source-raw');
      setContentOnCm(source, ContentType.TRANSFORMED, '<xml>source-transformed</xml>');

      const dest1 = makeConnectorMessage(1, 1, 'HTTP Sender');
      setContentOnCm(dest1, ContentType.ENCODED, 'encoded-payload-d1');
      setContentOnCm(dest1, ContentType.RESPONSE, 'response-d1');

      const dest2 = makeConnectorMessage(1, 2, 'File Writer');
      setContentOnCm(dest2, ContentType.SENT, 'sent-content-d2');

      msg.setConnectorMessage(0, source);
      msg.setConnectorMessage(1, dest1);
      msg.setConnectorMessage(2, dest2);

      // Encrypt
      MessageEncryptionUtil.encryptMessage(msg);

      // Verify encrypted
      expect(source.getContent(ContentType.RAW)!.encrypted).toBe(true);
      expect(source.getContent(ContentType.RAW)!.content).not.toBe('MSH|^~\\&|source-raw');
      expect(source.getContent(ContentType.TRANSFORMED)!.encrypted).toBe(true);
      expect(dest1.getContent(ContentType.ENCODED)!.encrypted).toBe(true);
      expect(dest1.getContent(ContentType.RESPONSE)!.encrypted).toBe(true);
      expect(dest2.getContent(ContentType.SENT)!.encrypted).toBe(true);

      // Decrypt
      MessageEncryptionUtil.decryptMessage(msg);

      // Verify restored
      expect(source.getContent(ContentType.RAW)!.content).toBe('MSH|^~\\&|source-raw');
      expect(source.getContent(ContentType.RAW)!.encrypted).toBe(false);
      expect(source.getContent(ContentType.TRANSFORMED)!.content).toBe('<xml>source-transformed</xml>');
      expect(dest1.getContent(ContentType.ENCODED)!.content).toBe('encoded-payload-d1');
      expect(dest1.getContent(ContentType.RESPONSE)!.content).toBe('response-d1');
      expect(dest2.getContent(ContentType.SENT)!.content).toBe('sent-content-d2');
    });
  });

  describe('NoOpEncryptor (encryption disabled)', () => {
    it('should not modify content when NoOpEncryptor is active', () => {
      setEncryptor(new NoOpEncryptor());

      const msg = makeMessage();
      const source = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(source, ContentType.RAW, 'plain-text');
      msg.setConnectorMessage(0, source);

      MessageEncryptionUtil.encryptMessage(msg);

      // Content unchanged, encrypted flag unchanged
      expect(source.getContent(ContentType.RAW)!.content).toBe('plain-text');
      expect(source.getContent(ContentType.RAW)!.encrypted).toBe(false);
    });
  });

  describe('encryptConnectorMessage', () => {
    it('should encrypt multiple content types on a single ConnectorMessage', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, 'raw-data');
      setContentOnCm(cm, ContentType.TRANSFORMED, 'transformed-data');
      setContentOnCm(cm, ContentType.CONNECTOR_MAP, '{"key":"value"}');

      MessageEncryptionUtil.encryptConnectorMessage(cm);

      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(true);
      expect(cm.getContent(ContentType.RAW)!.content).not.toBe('raw-data');
      expect(cm.getContent(ContentType.TRANSFORMED)!.encrypted).toBe(true);
      expect(cm.getContent(ContentType.CONNECTOR_MAP)!.encrypted).toBe(true);
    });
  });

  describe('decryptConnectorMessage', () => {
    it('should decrypt encrypted content on a single ConnectorMessage', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, 'secret-data');
      setContentOnCm(cm, ContentType.ENCODED, 'encoded-secret');

      // Encrypt first
      MessageEncryptionUtil.encryptConnectorMessage(cm);
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(true);

      // Decrypt
      MessageEncryptionUtil.decryptConnectorMessage(cm);
      expect(cm.getContent(ContentType.RAW)!.content).toBe('secret-data');
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(false);
      expect(cm.getContent(ContentType.ENCODED)!.content).toBe('encoded-secret');
      expect(cm.getContent(ContentType.ENCODED)!.encrypted).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle ConnectorMessage with no content set', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');

      // Should not throw
      expect(() => {
        MessageEncryptionUtil.encryptConnectorMessage(cm);
      }).not.toThrow();
      expect(() => {
        MessageEncryptionUtil.decryptConnectorMessage(cm);
      }).not.toThrow();
    });

    it('should skip empty content strings during encrypt', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, '');

      MessageEncryptionUtil.encryptConnectorMessage(cm);

      // Empty string should not be encrypted
      expect(cm.getContent(ContentType.RAW)!.content).toBe('');
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(false);
    });

    it('should skip already-encrypted content during encrypt', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, 'already-encrypted-cipher', true);

      const cipherBefore = cm.getContent(ContentType.RAW)!.content;
      MessageEncryptionUtil.encryptConnectorMessage(cm);

      // Content should not be double-encrypted
      expect(cm.getContent(ContentType.RAW)!.content).toBe(cipherBefore);
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(true);
    });

    it('should skip already-decrypted content during decrypt', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, 'plain-text', false);

      MessageEncryptionUtil.decryptConnectorMessage(cm);

      // Content should not be modified
      expect(cm.getContent(ContentType.RAW)!.content).toBe('plain-text');
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(false);
    });

    it('should handle Message with no connector messages', () => {
      const msg = makeMessage();

      expect(() => {
        MessageEncryptionUtil.encryptMessage(msg);
      }).not.toThrow();
      expect(() => {
        MessageEncryptionUtil.decryptMessage(msg);
      }).not.toThrow();
    });
  });

  describe('content type coverage', () => {
    it('should process all ContentType enum values', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');

      // Set content for every ContentType
      const allTypes = [
        ContentType.RAW,
        ContentType.PROCESSED_RAW,
        ContentType.TRANSFORMED,
        ContentType.ENCODED,
        ContentType.SENT,
        ContentType.RESPONSE,
        ContentType.RESPONSE_TRANSFORMED,
        ContentType.PROCESSED_RESPONSE,
        ContentType.CONNECTOR_MAP,
        ContentType.CHANNEL_MAP,
        ContentType.RESPONSE_MAP,
        ContentType.PROCESSING_ERROR,
        ContentType.POSTPROCESSOR_ERROR,
        ContentType.RESPONSE_ERROR,
        ContentType.SOURCE_MAP,
      ];

      for (const ct of allTypes) {
        setContentOnCm(cm, ct, `content-for-${ct}`);
      }

      MessageEncryptionUtil.encryptConnectorMessage(cm);

      // Every content type should be encrypted
      for (const ct of allTypes) {
        const content = cm.getContent(ct)!;
        expect(content.encrypted).toBe(true);
        expect(content.content).not.toBe(`content-for-${ct}`);
      }

      MessageEncryptionUtil.decryptConnectorMessage(cm);

      // Every content type should be restored
      for (const ct of allTypes) {
        const content = cm.getContent(ct)!;
        expect(content.encrypted).toBe(false);
        expect(content.content).toBe(`content-for-${ct}`);
      }
    });
  });

  describe('dataType preservation', () => {
    it('should preserve the dataType field through encrypt/decrypt', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');
      cm.setContent({
        contentType: ContentType.RAW,
        content: 'MSH|^~\\&|test',
        dataType: 'HL7V2',
        encrypted: false,
      });
      cm.setContent({
        contentType: ContentType.TRANSFORMED,
        content: '<xml/>',
        dataType: 'XML',
        encrypted: false,
      });

      MessageEncryptionUtil.encryptConnectorMessage(cm);

      expect(cm.getContent(ContentType.RAW)!.dataType).toBe('HL7V2');
      expect(cm.getContent(ContentType.TRANSFORMED)!.dataType).toBe('XML');

      MessageEncryptionUtil.decryptConnectorMessage(cm);

      expect(cm.getContent(ContentType.RAW)!.dataType).toBe('HL7V2');
      expect(cm.getContent(ContentType.TRANSFORMED)!.dataType).toBe('XML');
    });
  });

  describe('mixed encrypted state', () => {
    it('should only encrypt unencrypted content and only decrypt encrypted content', () => {
      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, 'plaintext-raw', false);
      setContentOnCm(cm, ContentType.TRANSFORMED, 'already-cipher', true);

      MessageEncryptionUtil.encryptConnectorMessage(cm);

      // RAW was plaintext -> now encrypted
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(true);
      // TRANSFORMED was already encrypted -> unchanged (still the same string)
      expect(cm.getContent(ContentType.TRANSFORMED)!.content).toBe('already-cipher');
      expect(cm.getContent(ContentType.TRANSFORMED)!.encrypted).toBe(true);
    });
  });

  describe('encryption with NoOpEncryptor on ConnectorMessage methods', () => {
    it('should no-op encryptConnectorMessage when encryption disabled', () => {
      setEncryptor(new NoOpEncryptor());

      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, 'should-not-change');

      MessageEncryptionUtil.encryptConnectorMessage(cm);

      expect(cm.getContent(ContentType.RAW)!.content).toBe('should-not-change');
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(false);
    });

    it('should no-op decryptConnectorMessage when encryption disabled', () => {
      setEncryptor(new NoOpEncryptor());

      const cm = makeConnectorMessage(1, 0, 'Source');
      setContentOnCm(cm, ContentType.RAW, 'cipher-text', true);

      MessageEncryptionUtil.decryptConnectorMessage(cm);

      // Should not attempt to decrypt
      expect(cm.getContent(ContentType.RAW)!.content).toBe('cipher-text');
      expect(cm.getContent(ContentType.RAW)!.encrypted).toBe(true);
    });
  });
});
