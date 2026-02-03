import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileUtil } from '../../../../src/javascript/userutil/FileUtil';

describe('FileUtil', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileutil-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('write', () => {
    it('should write a string to a new file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!';

      FileUtil.write(filePath, false, content);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
    });

    it('should overwrite existing file when append is false', () => {
      const filePath = path.join(tempDir, 'test.txt');
      FileUtil.write(filePath, false, 'First content');
      FileUtil.write(filePath, false, 'Second content');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Second content');
    });

    it('should append to existing file when append is true', () => {
      const filePath = path.join(tempDir, 'test.txt');
      FileUtil.write(filePath, false, 'First');
      FileUtil.write(filePath, true, ' Second');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('First Second');
    });

    it('should create parent directories if they do not exist', () => {
      const filePath = path.join(tempDir, 'subdir', 'nested', 'test.txt');
      const content = 'Nested content';

      FileUtil.write(filePath, false, content);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
    });

    it('should write Buffer data to file', () => {
      const filePath = path.join(tempDir, 'binary.dat');
      const data = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

      FileUtil.write(filePath, false, data);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath)).toEqual(data);
    });
  });

  describe('read', () => {
    it('should read file contents as string', () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!';
      fs.writeFileSync(filePath, content);

      const result = FileUtil.read(filePath);

      expect(result).toBe(content);
    });

    it('should throw error for non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');

      expect(() => FileUtil.read(filePath)).toThrow();
    });

    it('should read UTF-8 encoded content correctly', () => {
      const filePath = path.join(tempDir, 'utf8.txt');
      const content = 'Hello, World! Special chars: \u00e9\u00e8\u00ea\u00eb';
      fs.writeFileSync(filePath, content, 'utf-8');

      const result = FileUtil.read(filePath);

      expect(result).toBe(content);
    });
  });

  describe('readBytes', () => {
    it('should read file contents as Buffer', () => {
      const filePath = path.join(tempDir, 'binary.dat');
      const data = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
      fs.writeFileSync(filePath, data);

      const result = FileUtil.readBytes(filePath);

      expect(result).toEqual(data);
    });

    it('should throw error for non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.dat');

      expect(() => FileUtil.readBytes(filePath)).toThrow();
    });
  });

  describe('encode', () => {
    it('should encode Buffer to Base64 string', () => {
      const data = Buffer.from('Hello, World!');

      const result = FileUtil.encode(data);

      // Should be chunked with CRLF
      expect(result).toContain('SGVsbG8sIFdvcmxkIQ==');
    });

    it('should produce chunked output for long data', () => {
      // Create data that will produce more than 76 chars of base64
      const data = Buffer.alloc(100, 'A');

      const result = FileUtil.encode(data);

      // Should contain line breaks (CRLF)
      expect(result).toContain('\r\n');

      // Each line should be at most 76 chars
      const lines = result.split('\r\n').filter((l) => l.length > 0);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
    });

    it('should encode empty buffer', () => {
      const data = Buffer.from('');

      const result = FileUtil.encode(data);

      expect(result).toBe('');
    });
  });

  describe('decode', () => {
    it('should decode Base64 string to Buffer', () => {
      const base64 = 'SGVsbG8sIFdvcmxkIQ==';

      const result = FileUtil.decode(base64);

      expect(result.toString()).toBe('Hello, World!');
    });

    it('should handle chunked Base64 input', () => {
      const original = Buffer.alloc(100, 'X');
      const encoded = FileUtil.encode(original);

      // Remove line breaks and decode
      const result = FileUtil.decode(encoded.replace(/\r\n/g, ''));

      expect(result).toEqual(original);
    });

    it('should decode empty string', () => {
      const result = FileUtil.decode('');

      expect(result.length).toBe(0);
    });
  });

  describe('encode/decode round trip', () => {
    it('should round-trip binary data correctly', () => {
      const original = Buffer.from([0x00, 0x7f, 0x80, 0xff, 0x42]);

      const encoded = FileUtil.encode(original);
      const decoded = FileUtil.decode(encoded.replace(/\r\n/g, ''));

      expect(decoded).toEqual(original);
    });

    it('should round-trip text data correctly', () => {
      const original = Buffer.from('Hello, World! \u00e9\u00e8\u00ea');

      const encoded = FileUtil.encode(original);
      const decoded = FileUtil.decode(encoded.replace(/\r\n/g, ''));

      expect(decoded).toEqual(original);
    });
  });

  describe('deleteFile', () => {
    it('should delete an existing file and return true', () => {
      const filePath = path.join(tempDir, 'to-delete.txt');
      fs.writeFileSync(filePath, 'content');

      const result = FileUtil.deleteFile(filePath);

      expect(result).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should return false for non-existent file', () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');

      const result = FileUtil.deleteFile(filePath);

      expect(result).toBe(false);
    });

    it('should return false for directory', () => {
      const dirPath = path.join(tempDir, 'subdir');
      fs.mkdirSync(dirPath);

      const result = FileUtil.deleteFile(dirPath);

      // unlinkSync fails for directories, so should return false
      expect(result).toBe(false);
    });
  });

  describe('rtfToPlainText', () => {
    it('should convert simple RTF to plain text', () => {
      const rtf = '{\\rtf1\\ansi Hello World}';

      const result = FileUtil.rtfToPlainText(rtf);

      expect(result).toBe('Hello World');
    });

    it('should handle paragraphs', () => {
      const rtf = '{\\rtf1\\ansi First line\\par Second line}';

      const result = FileUtil.rtfToPlainText(rtf);

      expect(result).toContain('First line');
      expect(result).toContain('Second line');
    });

    it('should replace line breaks when specified', () => {
      const rtf = '{\\rtf1\\ansi First\\par Second}';

      const result = FileUtil.rtfToPlainText(rtf, '<br>');

      expect(result).toBe('First<br>Second');
    });

    it('should handle hex-encoded characters', () => {
      const rtf = "{\\rtf1\\ansi Caf\\'e9}"; // \xe9 = e

      const result = FileUtil.rtfToPlainText(rtf);

      expect(result).toContain('Caf');
    });

    it('should handle unicode characters', () => {
      const rtf = '{\\rtf1\\ansi Hello \\u233?}'; // \u233 = e

      const result = FileUtil.rtfToPlainText(rtf);

      expect(result).toContain('Hello');
    });

    it('should return empty string for empty RTF', () => {
      const rtf = '{\\rtf1}';

      const result = FileUtil.rtfToPlainText(rtf);

      expect(result).toBe('');
    });

    it('should handle null replaceLinebreaksWith parameter', () => {
      const rtf = '{\\rtf1\\ansi Line1\\par Line2}';

      const result = FileUtil.rtfToPlainText(rtf, null);

      expect(result).toContain('\n');
    });
  });
});
