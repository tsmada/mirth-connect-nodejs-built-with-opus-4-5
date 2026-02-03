/**
 * Tests for Attachment class
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/Attachment.java
 */

import { Attachment } from '../../../../src/javascript/userutil/Attachment.js';

describe('Attachment', () => {
  describe('constructor', () => {
    it('should create an empty attachment with no-arg constructor', () => {
      const attachment = new Attachment();

      expect(attachment.getId()).toBeUndefined();
      expect(attachment.getContent()).toBeUndefined();
      expect(attachment.getType()).toBeUndefined();
    });

    it('should create an attachment with Buffer content', () => {
      const id = 'test-id-123';
      const content = Buffer.from('Hello, World!');
      const type = 'text/plain';

      const attachment = new Attachment(id, content, type);

      expect(attachment.getId()).toBe(id);
      expect(attachment.getContent()).toEqual(content);
      expect(attachment.getType()).toBe(type);
    });

    it('should create an attachment with string content using UTF-8', () => {
      const id = 'test-id-456';
      const content = 'Hello, World!';
      const type = 'text/plain';

      const attachment = new Attachment(id, content, type);

      expect(attachment.getId()).toBe(id);
      expect(attachment.getContent()).toEqual(Buffer.from(content, 'utf-8'));
      expect(attachment.getType()).toBe(type);
      expect(attachment.getContentString()).toBe(content);
    });

    it('should create an attachment with string content and custom charset', () => {
      const id = 'test-id-789';
      const content = 'Hello, World!';
      const charset = 'latin1';
      const type = 'text/plain';

      const attachment = new Attachment(id, content, charset, type);

      expect(attachment.getId()).toBe(id);
      expect(attachment.getContent()).toEqual(Buffer.from(content, 'latin1'));
      expect(attachment.getType()).toBe(type);
      expect(attachment.getContentString('latin1')).toBe(content);
    });

    it('should handle special characters with UTF-8', () => {
      const id = 'unicode-test';
      const content = 'Hello, \u4e16\u754c! Emoji: \ud83d\ude00';
      const type = 'text/plain';

      const attachment = new Attachment(id, content, type);

      expect(attachment.getContentString()).toBe(content);
    });
  });

  describe('getAttachmentId', () => {
    it('should return the attachment token format', () => {
      const id = 'abc-123-def-456';
      const attachment = new Attachment(id, Buffer.from('test'), 'text/plain');

      expect(attachment.getAttachmentId()).toBe('${ATTACH:abc-123-def-456}');
    });

    it('should return token with undefined id', () => {
      const attachment = new Attachment();

      expect(attachment.getAttachmentId()).toBe('${ATTACH:undefined}');
    });
  });

  describe('getId / setId', () => {
    it('should get and set the ID', () => {
      const attachment = new Attachment();

      expect(attachment.getId()).toBeUndefined();

      attachment.setId('new-id-123');
      expect(attachment.getId()).toBe('new-id-123');

      attachment.setId('updated-id-456');
      expect(attachment.getId()).toBe('updated-id-456');
    });
  });

  describe('getContent / setContent', () => {
    it('should get and set Buffer content', () => {
      const attachment = new Attachment();

      expect(attachment.getContent()).toBeUndefined();

      const content1 = Buffer.from('First content');
      attachment.setContent(content1);
      expect(attachment.getContent()).toEqual(content1);

      const content2 = Buffer.from('Second content');
      attachment.setContent(content2);
      expect(attachment.getContent()).toEqual(content2);
    });
  });

  describe('getContentString / setContentString', () => {
    it('should get content as string with default UTF-8 encoding', () => {
      const content = 'Hello, World!';
      const attachment = new Attachment('id', Buffer.from(content, 'utf-8'), 'text/plain');

      expect(attachment.getContentString()).toBe(content);
    });

    it('should get content as string with specified charset', () => {
      const content = 'Hello, World!';
      const attachment = new Attachment('id', Buffer.from(content, 'latin1'), 'text/plain');

      expect(attachment.getContentString('latin1')).toBe(content);
    });

    it('should return empty string when content is undefined', () => {
      const attachment = new Attachment();

      expect(attachment.getContentString()).toBe('');
    });

    it('should set content from string with default UTF-8 encoding', () => {
      const attachment = new Attachment();
      const content = 'Hello, World!';

      attachment.setContentString(content);

      expect(attachment.getContent()).toEqual(Buffer.from(content, 'utf-8'));
      expect(attachment.getContentString()).toBe(content);
    });

    it('should set content from string with specified charset', () => {
      const attachment = new Attachment();
      const content = 'Hello, World!';

      attachment.setContentString(content, 'latin1');

      expect(attachment.getContent()).toEqual(Buffer.from(content, 'latin1'));
      expect(attachment.getContentString('latin1')).toBe(content);
    });
  });

  describe('getType / setType', () => {
    it('should get and set the MIME type', () => {
      const attachment = new Attachment();

      expect(attachment.getType()).toBeUndefined();

      attachment.setType('application/json');
      expect(attachment.getType()).toBe('application/json');

      attachment.setType('image/png');
      expect(attachment.getType()).toBe('image/png');
    });
  });

  describe('charset handling', () => {
    it('should handle ISO-8859-1 charset name variations', () => {
      const content = 'Test content';
      const attachment = new Attachment();

      // Test various ISO-8859-1 naming conventions
      attachment.setContentString(content, 'ISO-8859-1');
      expect(attachment.getContentString('iso-8859-1')).toBe(content);

      attachment.setContentString(content, 'iso88591');
      expect(attachment.getContentString('latin1')).toBe(content);
    });

    it('should handle UTF-8 charset name variations', () => {
      const content = 'Test \u4e2d\u6587';
      const attachment = new Attachment();

      attachment.setContentString(content, 'UTF-8');
      expect(attachment.getContentString('utf-8')).toBe(content);

      attachment.setContentString(content, 'utf8');
      expect(attachment.getContentString('UTF8')).toBe(content);
    });

    it('should handle ASCII charset', () => {
      const content = 'Simple ASCII text';
      const attachment = new Attachment();

      attachment.setContentString(content, 'ASCII');
      expect(attachment.getContentString('ascii')).toBe(content);

      attachment.setContentString(content, 'US-ASCII');
      expect(attachment.getContentString('us-ascii')).toBe(content);
    });

    it('should handle UTF-16 charset', () => {
      const content = 'UTF-16 test';
      const attachment = new Attachment();

      attachment.setContentString(content, 'UTF-16LE');
      expect(attachment.getContentString('utf-16le')).toBe(content);

      attachment.setContentString(content, 'UTF16LE');
      expect(attachment.getContentString('utf16le')).toBe(content);
    });

    it('should default to UTF-8 for unknown charsets', () => {
      const content = 'Test content';
      const attachment = new Attachment();

      attachment.setContentString(content, 'unknown-charset');
      expect(attachment.getContentString('unknown-charset')).toBe(content);
    });
  });

  describe('binary data handling', () => {
    it('should handle binary data (images, PDFs, etc.)', () => {
      // Create some binary data (simulated PNG header)
      const binaryData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      ]);

      const attachment = new Attachment('binary-id', binaryData, 'image/png');

      expect(attachment.getContent()).toEqual(binaryData);
      expect(attachment.getType()).toBe('image/png');
    });

    it('should handle empty content', () => {
      const emptyBuffer = Buffer.alloc(0);
      const attachment = new Attachment('empty-id', emptyBuffer, 'application/octet-stream');

      expect(attachment.getContent()).toEqual(emptyBuffer);
      expect(attachment.getContent()?.length).toBe(0);
    });

    it('should handle large content', () => {
      // Create 1MB of data
      const largeData = Buffer.alloc(1024 * 1024, 0x42);
      const attachment = new Attachment('large-id', largeData, 'application/octet-stream');

      expect(attachment.getContent()).toEqual(largeData);
      expect(attachment.getContent()?.length).toBe(1024 * 1024);
    });
  });

  describe('common MIME types', () => {
    const mimeTypes = [
      'text/plain',
      'text/html',
      'text/xml',
      'application/json',
      'application/xml',
      'application/pdf',
      'application/octet-stream',
      'image/png',
      'image/jpeg',
      'image/gif',
      'audio/mpeg',
      'video/mp4',
      'multipart/form-data',
      'application/x-hl7-v2+er7',
    ];

    test.each(mimeTypes)('should handle MIME type: %s', (mimeType) => {
      const attachment = new Attachment('id', Buffer.from('test'), mimeType);
      expect(attachment.getType()).toBe(mimeType);
    });
  });
});
