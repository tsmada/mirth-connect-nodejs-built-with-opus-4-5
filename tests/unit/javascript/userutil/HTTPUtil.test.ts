import { HTTPUtil } from '../../../../src/javascript/userutil/HTTPUtil';

describe('HTTPUtil', () => {
  describe('parseHeaders', () => {
    it('should parse simple headers', () => {
      const headers = 'Content-Type: application/json\r\nAccept: text/html';

      const result = HTTPUtil.parseHeaders(headers);

      expect(result.get('Content-Type')).toBe('application/json');
      expect(result.get('Accept')).toBe('text/html');
    });

    it('should handle LF line endings', () => {
      const headers = 'Content-Type: text/plain\nContent-Length: 100';

      const result = HTTPUtil.parseHeaders(headers);

      expect(result.get('Content-Type')).toBe('text/plain');
      expect(result.get('Content-Length')).toBe('100');
    });

    it('should trim whitespace from names and values', () => {
      const headers = '  Content-Type  :  application/json  ';

      const result = HTTPUtil.parseHeaders(headers);

      expect(result.get('Content-Type')).toBe('application/json');
    });

    it('should return empty map for empty string', () => {
      const result = HTTPUtil.parseHeaders('');

      expect(result.size).toBe(0);
    });

    it('should return empty map for null-like input', () => {
      const result = HTTPUtil.parseHeaders('   ');

      expect(result.size).toBe(0);
    });

    it('should skip invalid header lines without colon', () => {
      const headers = 'Valid-Header: value\nInvalidLine\nAnother: header';

      const result = HTTPUtil.parseHeaders(headers);

      expect(result.size).toBe(2);
      expect(result.get('Valid-Header')).toBe('value');
      expect(result.get('Another')).toBe('header');
    });

    it('should handle header values with colons', () => {
      const headers = 'Date: Mon, 01 Jan 2024 12:00:00 GMT';

      const result = HTTPUtil.parseHeaders(headers);

      expect(result.get('Date')).toBe('Mon, 01 Jan 2024 12:00:00 GMT');
    });

    it('should skip empty lines', () => {
      const headers = 'First: one\r\n\r\nSecond: two';

      const result = HTTPUtil.parseHeaders(headers);

      expect(result.size).toBe(2);
    });

    it('should handle multiple headers', () => {
      const headers = [
        'Host: example.com',
        'User-Agent: Mozilla/5.0',
        'Accept: */*',
        'Accept-Language: en-US',
        'Accept-Encoding: gzip, deflate',
        'Connection: keep-alive',
      ].join('\r\n');

      const result = HTTPUtil.parseHeaders(headers);

      expect(result.size).toBe(6);
      expect(result.get('Host')).toBe('example.com');
      expect(result.get('User-Agent')).toBe('Mozilla/5.0');
      expect(result.get('Accept-Encoding')).toBe('gzip, deflate');
    });
  });

  describe('httpBodyToXml', () => {
    it('should wrap plain text in HttpBody element', () => {
      const body = 'Hello, World!';
      const contentType = 'text/plain';

      const result = HTTPUtil.httpBodyToXml(body, contentType);

      expect(result).toContain('<HttpBody>');
      expect(result).toContain('Hello, World!');
      expect(result).toContain('</HttpBody>');
    });

    it('should handle JSON content', () => {
      const body = '{"key": "value"}';
      const contentType = 'application/json';

      const result = HTTPUtil.httpBodyToXml(body, contentType);

      expect(result).toContain('<HttpBody>');
      // XML escapes quotes - either raw or escaped is acceptable
      expect(result).toMatch(/key.*value/);
    });

    it('should handle XML content', () => {
      const body = '<root><element>value</element></root>';
      const contentType = 'application/xml';

      const result = HTTPUtil.httpBodyToXml(body, contentType);

      expect(result).toContain('<HttpBody>');
    });

    it('should handle Buffer input', () => {
      const body = Buffer.from('Binary content');
      const contentType = 'application/octet-stream';

      const result = HTTPUtil.httpBodyToXml(body, contentType);

      expect(result).toContain('<HttpBody>');
      expect(result).toContain('Binary content');
    });

    it('should handle multipart form data', () => {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const body = [
        `------${boundary}`,
        'Content-Disposition: form-data; name="field1"',
        '',
        'value1',
        `------${boundary}`,
        'Content-Disposition: form-data; name="field2"',
        '',
        'value2',
        `------${boundary}--`,
      ].join('\r\n');
      const contentType = `multipart/form-data; boundary=----${boundary}`;

      const result = HTTPUtil.httpBodyToXml(body, contentType);

      expect(result).toContain('<HttpBody>');
      expect(result).toContain('<Parts>');
      expect(result).toContain('<Part');
    });

    it('should handle multipart with file upload', () => {
      const boundary = 'boundary123';
      const body = [
        '--boundary123',
        'Content-Disposition: form-data; name="file"; filename="test.txt"',
        'Content-Type: text/plain',
        '',
        'File content here',
        '--boundary123--',
      ].join('\r\n');
      const contentType = `multipart/form-data; boundary=${boundary}`;

      const result = HTTPUtil.httpBodyToXml(body, contentType);

      expect(result).toContain('<Part');
      expect(result).toContain('filename="test.txt"');
    });

    it('should handle empty body', () => {
      const result = HTTPUtil.httpBodyToXml('', 'text/plain');

      expect(result).toContain('<HttpBody>');
    });

    it('should handle content type with charset', () => {
      const body = 'UTF-8 content: \u00e9\u00e8';
      const contentType = 'text/plain; charset=utf-8';

      const result = HTTPUtil.httpBodyToXml(body, contentType);

      expect(result).toContain('<HttpBody>');
    });

    it('should handle missing content type', () => {
      const body = 'Some content';

      const result = HTTPUtil.httpBodyToXml(body, '');

      expect(result).toContain('<HttpBody>');
    });
  });
});
