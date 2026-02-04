import {
  type SmtpAttachment,
  getDefaultSmtpDispatcherProperties,
  cloneSmtpDispatcherProperties,
  cloneAttachment,
  formatSmtpProperties,
  parseEmailAddresses,
  isTextMimeType,
  isValidMimeType,
} from '../../../../src/connectors/smtp/SmtpDispatcherProperties';

describe('SmtpDispatcherProperties', () => {
  describe('getDefaultSmtpDispatcherProperties', () => {
    it('should return default property values', () => {
      const props = getDefaultSmtpDispatcherProperties();

      expect(props.smtpHost).toBe('');
      expect(props.smtpPort).toBe('25');
      expect(props.overrideLocalBinding).toBe(false);
      expect(props.localAddress).toBe('0.0.0.0');
      expect(props.localPort).toBe('0');
      expect(props.timeout).toBe('5000');
      expect(props.encryption).toBe('none');
      expect(props.authentication).toBe(false);
      expect(props.username).toBe('');
      expect(props.password).toBe('');
      expect(props.to).toBe('');
      expect(props.from).toBe('');
      expect(props.cc).toBe('');
      expect(props.bcc).toBe('');
      expect(props.replyTo).toBe('');
      expect(props.headers).toBeInstanceOf(Map);
      expect(props.headers.size).toBe(0);
      expect(props.headersVariable).toBe('');
      expect(props.useHeadersVariable).toBe(false);
      expect(props.subject).toBe('');
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.html).toBe(false);
      expect(props.body).toBe('');
      expect(props.attachments).toEqual([]);
      expect(props.attachmentsVariable).toBe('');
      expect(props.useAttachmentsVariable).toBe(false);
    });
  });

  describe('cloneAttachment', () => {
    it('should clone an attachment', () => {
      const original: SmtpAttachment = {
        name: 'report.pdf',
        content: 'base64content',
        mimeType: 'application/pdf',
      };

      const cloned = cloneAttachment(original);

      expect(cloned).not.toBe(original);
      expect(cloned.name).toBe('report.pdf');
      expect(cloned.content).toBe('base64content');
      expect(cloned.mimeType).toBe('application/pdf');
    });
  });

  describe('cloneSmtpDispatcherProperties', () => {
    it('should create a deep clone of properties', () => {
      const original = getDefaultSmtpDispatcherProperties();
      original.smtpHost = 'mail.example.com';
      original.to = 'user@example.com';
      original.headers.set('X-Custom', 'value');
      original.attachments = [
        { name: 'file.txt', content: 'data', mimeType: 'text/plain' },
      ];

      const cloned = cloneSmtpDispatcherProperties(original);

      // Verify values are copied
      expect(cloned.smtpHost).toBe('mail.example.com');
      expect(cloned.to).toBe('user@example.com');
      expect(cloned.headers.get('X-Custom')).toBe('value');
      expect(cloned.attachments).toHaveLength(1);
      expect(cloned.attachments[0]!.name).toBe('file.txt');

      // Verify independence
      original.smtpHost = 'changed.example.com';
      original.headers.set('X-Custom', 'changed');
      original.attachments[0]!.name = 'changed.txt';

      expect(cloned.smtpHost).toBe('mail.example.com');
      expect(cloned.headers.get('X-Custom')).toBe('value');
      expect(cloned.attachments[0]!.name).toBe('file.txt');
    });
  });

  describe('formatSmtpProperties', () => {
    it('should format properties to readable string', () => {
      const props = getDefaultSmtpDispatcherProperties();
      props.smtpHost = 'smtp.example.com';
      props.smtpPort = '587';
      props.to = 'recipient@example.com';
      props.from = 'sender@example.com';
      props.cc = 'cc@example.com';
      props.subject = 'Test Subject';
      props.body = 'Hello World';

      const formatted = formatSmtpProperties(props);

      expect(formatted).toContain('HOST: smtp.example.com:587');
      expect(formatted).toContain('TO: recipient@example.com');
      expect(formatted).toContain('FROM: sender@example.com');
      expect(formatted).toContain('CC: cc@example.com');
      expect(formatted).toContain('SUBJECT: Test Subject');
      expect(formatted).toContain('[HEADERS]');
      expect(formatted).toContain('[ATTACHMENTS]');
      expect(formatted).toContain('[CONTENT]');
      expect(formatted).toContain('Hello World');
    });

    it('should include username when present', () => {
      const props = getDefaultSmtpDispatcherProperties();
      props.smtpHost = 'smtp.example.com';
      props.username = 'myuser';

      const formatted = formatSmtpProperties(props);

      expect(formatted).toContain('USERNAME: myuser');
    });

    it('should show headers from variable when enabled', () => {
      const props = getDefaultSmtpDispatcherProperties();
      props.smtpHost = 'smtp.example.com';
      props.useHeadersVariable = true;
      props.headersVariable = 'customHeaders';

      const formatted = formatSmtpProperties(props);

      expect(formatted).toContain("Using variable 'customHeaders'");
    });

    it('should show attachments from variable when enabled', () => {
      const props = getDefaultSmtpDispatcherProperties();
      props.smtpHost = 'smtp.example.com';
      props.useAttachmentsVariable = true;
      props.attachmentsVariable = 'emailAttachments';

      const formatted = formatSmtpProperties(props);

      expect(formatted).toContain("Using variable 'emailAttachments'");
    });

    it('should list static headers', () => {
      const props = getDefaultSmtpDispatcherProperties();
      props.smtpHost = 'smtp.example.com';
      props.headers.set('X-Priority', '1');
      props.headers.set('X-Custom', 'test');

      const formatted = formatSmtpProperties(props);

      expect(formatted).toContain('X-Priority: 1');
      expect(formatted).toContain('X-Custom: test');
    });

    it('should list static attachments', () => {
      const props = getDefaultSmtpDispatcherProperties();
      props.smtpHost = 'smtp.example.com';
      props.attachments = [
        { name: 'doc.pdf', content: '', mimeType: 'application/pdf' },
        { name: 'image.png', content: '', mimeType: 'image/png' },
      ];

      const formatted = formatSmtpProperties(props);

      expect(formatted).toContain('doc.pdf (application/pdf)');
      expect(formatted).toContain('image.png (image/png)');
    });
  });

  describe('parseEmailAddresses', () => {
    it('should parse single email address', () => {
      const addresses = parseEmailAddresses('user@example.com');
      expect(addresses).toEqual(['user@example.com']);
    });

    it('should parse multiple comma-separated addresses', () => {
      const addresses = parseEmailAddresses(
        'user1@example.com,user2@example.com,user3@example.com'
      );
      expect(addresses).toEqual([
        'user1@example.com',
        'user2@example.com',
        'user3@example.com',
      ]);
    });

    it('should handle spaces around commas', () => {
      const addresses = parseEmailAddresses(
        'user1@example.com, user2@example.com , user3@example.com'
      );
      expect(addresses).toEqual([
        'user1@example.com',
        'user2@example.com',
        'user3@example.com',
      ]);
    });

    it('should handle empty string', () => {
      expect(parseEmailAddresses('')).toEqual([]);
    });

    it('should handle whitespace-only string', () => {
      expect(parseEmailAddresses('   ')).toEqual([]);
    });

    it('should filter out empty segments', () => {
      const addresses = parseEmailAddresses('user1@example.com,,user2@example.com');
      expect(addresses).toEqual(['user1@example.com', 'user2@example.com']);
    });
  });

  describe('isTextMimeType', () => {
    it('should return true for text/* types', () => {
      expect(isTextMimeType('text/plain')).toBe(true);
      expect(isTextMimeType('text/html')).toBe(true);
      expect(isTextMimeType('text/xml')).toBe(true);
      expect(isTextMimeType('text/csv')).toBe(true);
    });

    it('should return true for application/xml', () => {
      expect(isTextMimeType('application/xml')).toBe(true);
      expect(isTextMimeType('APPLICATION/XML')).toBe(true);
    });

    it('should return false for binary types', () => {
      expect(isTextMimeType('application/pdf')).toBe(false);
      expect(isTextMimeType('image/png')).toBe(false);
      expect(isTextMimeType('application/octet-stream')).toBe(false);
    });

    it('should return true for empty or undefined', () => {
      expect(isTextMimeType('')).toBe(true);
    });
  });

  describe('isValidMimeType', () => {
    it('should return true for valid MIME types', () => {
      expect(isValidMimeType('text/plain')).toBe(true);
      expect(isValidMimeType('application/pdf')).toBe(true);
      expect(isValidMimeType('image/png')).toBe(true);
      expect(isValidMimeType('multipart/mixed')).toBe(true);
    });

    it('should return false for invalid MIME types', () => {
      expect(isValidMimeType('plain')).toBe(false);
      expect(isValidMimeType('textplain')).toBe(false);
      expect(isValidMimeType('')).toBe(false);
    });
  });
});
