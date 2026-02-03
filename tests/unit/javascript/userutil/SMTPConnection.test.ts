import { SMTPConnection } from '../../../../src/javascript/userutil/SMTPConnection';

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
    close: jest.fn(),
  })),
}));

import * as nodemailer from 'nodemailer';

describe('SMTPConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create connection with all parameters including timeout', () => {
      const conn = new SMTPConnection(
        'smtp.example.com',
        '587',
        30000, // socket timeout
        true, // use auth
        'TLS', // secure
        'user@example.com',
        'password123',
        'from@example.com'
      );

      expect(conn.getHost()).toBe('smtp.example.com');
      expect(conn.getPort()).toBe('587');
      expect(conn.getSocketTimeout()).toBe(30000);
      expect(conn.isUseAuthentication()).toBe(true);
      expect(conn.getSecure()).toBe('TLS');
      expect(conn.getUsername()).toBe('user@example.com');
      expect(conn.getPassword()).toBe('password123');
      expect(conn.getFrom()).toBe('from@example.com');
    });

    it('should create connection without timeout (using default)', () => {
      const conn = new SMTPConnection(
        'smtp.example.com',
        '25',
        false, // use auth
        '', // no encryption
        '',
        '',
        'from@example.com'
      );

      expect(conn.getHost()).toBe('smtp.example.com');
      expect(conn.getPort()).toBe('25');
      expect(conn.getSocketTimeout()).toBe(60000); // default
      expect(conn.isUseAuthentication()).toBe(false);
      expect(conn.getSecure()).toBe('');
    });
  });

  describe('setters and getters', () => {
    let conn: SMTPConnection;

    beforeEach(() => {
      conn = new SMTPConnection(
        'smtp.example.com',
        '587',
        true,
        'TLS',
        'user',
        'pass',
        'from@example.com'
      );
    });

    it('should get and set host', () => {
      conn.setHost('newhost.example.com');
      expect(conn.getHost()).toBe('newhost.example.com');
    });

    it('should get and set port', () => {
      conn.setPort('465');
      expect(conn.getPort()).toBe('465');
    });

    it('should get and set useAuthentication', () => {
      conn.setUseAuthentication(false);
      expect(conn.isUseAuthentication()).toBe(false);
    });

    it('should get and set secure', () => {
      conn.setSecure('SSL');
      expect(conn.getSecure()).toBe('SSL');
    });

    it('should get and set username', () => {
      conn.setUsername('newuser');
      expect(conn.getUsername()).toBe('newuser');
    });

    it('should get and set password', () => {
      conn.setPassword('newpass');
      expect(conn.getPassword()).toBe('newpass');
    });

    it('should get and set from', () => {
      conn.setFrom('newfrom@example.com');
      expect(conn.getFrom()).toBe('newfrom@example.com');
    });

    it('should get and set socketTimeout', () => {
      conn.setSocketTimeout(120000);
      expect(conn.getSocketTimeout()).toBe(120000);
    });
  });

  describe('send', () => {
    let conn: SMTPConnection;
    let mockTransporter: {
      sendMail: jest.Mock;
      close: jest.Mock;
    };

    beforeEach(() => {
      mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
        close: jest.fn(),
      };
      (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

      conn = new SMTPConnection(
        'smtp.example.com',
        '587',
        30000,
        true,
        'TLS',
        'user@example.com',
        'password123',
        'default@example.com'
      );
    });

    it('should send email with all parameters', async () => {
      await conn.send(
        'to@example.com',
        'cc@example.com',
        'from@example.com',
        'Test Subject',
        'Test body content',
        'utf-8'
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: 'from@example.com',
        to: 'to@example.com',
        cc: 'cc@example.com',
        subject: 'Test Subject',
        text: 'Test body content',
        encoding: 'utf-8',
      });
      expect(mockTransporter.close).toHaveBeenCalled();
    });

    it('should send email with 5 parameters (no charset)', async () => {
      await conn.send(
        'to@example.com',
        'cc@example.com',
        'from@example.com',
        'Test Subject',
        'Test body'
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: 'from@example.com',
        to: 'to@example.com',
        cc: 'cc@example.com',
        subject: 'Test Subject',
        text: 'Test body',
        encoding: 'utf-8',
      });
    });

    it('should send email with 4 parameters (using default from)', async () => {
      await conn.send(
        'to@example.com',
        'cc@example.com',
        'Test Subject',
        'Test body'
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: 'default@example.com',
        to: 'to@example.com',
        cc: 'cc@example.com',
        subject: 'Test Subject',
        text: 'Test body',
        encoding: 'utf-8',
      });
    });

    it('should handle empty CC list', async () => {
      await conn.send('to@example.com', '', 'Subject', 'Body');

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          cc: undefined,
        })
      );
    });

    it('should handle multiple recipients', async () => {
      await conn.send(
        'to1@example.com,to2@example.com',
        'cc1@example.com,cc2@example.com',
        'Subject',
        'Body'
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'to1@example.com,to2@example.com',
          cc: 'cc1@example.com,cc2@example.com',
        })
      );
    });

    it('should close transporter even on error', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('Send failed'));

      await expect(
        conn.send('to@example.com', '', 'Subject', 'Body')
      ).rejects.toThrow('Send failed');

      expect(mockTransporter.close).toHaveBeenCalled();
    });

    it('should configure SSL when secure is SSL', async () => {
      const sslConn = new SMTPConnection(
        'smtp.example.com',
        '465',
        30000,
        true,
        'SSL',
        'user',
        'pass',
        'from@example.com'
      );

      await sslConn.send('to@example.com', '', 'Subject', 'Body');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: true,
          port: 465,
        })
      );
    });

    it('should configure STARTTLS when secure is TLS', async () => {
      const tlsConn = new SMTPConnection(
        'smtp.example.com',
        '587',
        30000,
        true,
        'TLS',
        'user',
        'pass',
        'from@example.com'
      );

      await tlsConn.send('to@example.com', '', 'Subject', 'Body');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: false,
          requireTLS: true,
          port: 587,
        })
      );
    });

    it('should configure no encryption when secure is empty', async () => {
      const plainConn = new SMTPConnection(
        'smtp.example.com',
        '25',
        30000,
        false,
        '',
        '',
        '',
        'from@example.com'
      );

      await plainConn.send('to@example.com', '', 'Subject', 'Body');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: false,
        })
      );

      // requireTLS should not be set
      const callArgs = (nodemailer.createTransport as jest.Mock).mock.calls[0][0];
      expect(callArgs.requireTLS).toBeUndefined();
    });

    it('should configure authentication when useAuthentication is true', async () => {
      await conn.send('to@example.com', '', 'Subject', 'Body');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: {
            user: 'user@example.com',
            pass: 'password123',
          },
        })
      );
    });

    it('should not configure authentication when useAuthentication is false', async () => {
      const noAuthConn = new SMTPConnection(
        'smtp.example.com',
        '25',
        false,
        '',
        '',
        '',
        'from@example.com'
      );

      await noAuthConn.send('to@example.com', '', 'Subject', 'Body');

      const callArgs = (nodemailer.createTransport as jest.Mock).mock.calls[0][0];
      expect(callArgs.auth).toBeUndefined();
    });

    it('should set timeout values', async () => {
      await conn.send('to@example.com', '', 'Subject', 'Body');

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: 30000,
          greetingTimeout: 30000,
          socketTimeout: 30000,
        })
      );
    });
  });
});
