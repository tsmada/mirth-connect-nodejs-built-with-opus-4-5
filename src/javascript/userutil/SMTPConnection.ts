/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/SMTPConnection.java
 *
 * Purpose: Send e-mail messages from Mirth scripts
 *
 * Key behaviors to replicate:
 * - Configure SMTP connection with host, port, auth, TLS/SSL
 * - send() method to dispatch emails
 * - Getters and setters for all connection properties
 */

import nodemailer from 'nodemailer';
import type { Transporter, SentMessageInfo } from 'nodemailer';

/**
 * Used to send e-mail messages.
 */
export class SMTPConnection {
  private _host: string;
  private _port: string;
  private _socketTimeout: number;
  private _useAuthentication: boolean;
  private _secure: string; // "TLS", "SSL", or empty
  private _username: string;
  private _password: string;
  private _from: string;

  /**
   * Instantiates an SMTP connection used to send e-mail messages with.
   *
   * @param host - The SMTP server address.
   * @param port - The SMTP server port (e.g. "25", "587", "465").
   * @param socketTimeout - The socket connection timeout value in milliseconds.
   * @param useAuthentication - Determines whether authentication is needed for the SMTP server.
   * @param secure - The encryption security layer ("TLS" or "SSL"). If blank, no encryption.
   * @param username - If authentication is required, the username to authenticate with.
   * @param password - If authentication is required, the password to authenticate with.
   * @param from - The FROM field to use for dispatched e-mail messages.
   */
  constructor(
    host: string,
    port: string,
    socketTimeout: number,
    useAuthentication: boolean,
    secure: string,
    username: string,
    password: string,
    from: string
  );

  /**
   * Instantiates an SMTP connection used to send e-mail messages with.
   * Uses default socket timeout.
   *
   * @param host - The SMTP server address.
   * @param port - The SMTP server port (e.g. "25", "587", "465").
   * @param useAuthentication - Determines whether authentication is needed for the SMTP server.
   * @param secure - The encryption security layer ("TLS" or "SSL"). If blank, no encryption.
   * @param username - If authentication is required, the username to authenticate with.
   * @param password - If authentication is required, the password to authenticate with.
   * @param from - The FROM field to use for dispatched e-mail messages.
   */
  constructor(
    host: string,
    port: string,
    useAuthentication: boolean,
    secure: string,
    username: string,
    password: string,
    from: string
  );

  constructor(
    host: string,
    port: string,
    socketTimeoutOrUseAuth: number | boolean,
    useAuthOrSecure: boolean | string,
    secureOrUsername: string,
    usernameOrPassword: string,
    passwordOrFrom: string,
    from?: string
  ) {
    this._host = host;
    this._port = port;

    if (typeof socketTimeoutOrUseAuth === 'number') {
      // First overload: with socketTimeout
      this._socketTimeout = socketTimeoutOrUseAuth;
      this._useAuthentication = useAuthOrSecure as boolean;
      this._secure = secureOrUsername;
      this._username = usernameOrPassword;
      this._password = passwordOrFrom;
      this._from = from!;
    } else {
      // Second overload: without socketTimeout
      this._socketTimeout = 60000; // Default timeout
      this._useAuthentication = socketTimeoutOrUseAuth;
      this._secure = useAuthOrSecure as string;
      this._username = secureOrUsername;
      this._password = usernameOrPassword;
      this._from = passwordOrFrom;
    }
  }

  /**
   * Returns the SMTP server address.
   */
  getHost(): string {
    return this._host;
  }

  /**
   * Sets the SMTP server address.
   */
  setHost(host: string): void {
    this._host = host;
  }

  /**
   * Returns the SMTP server port.
   */
  getPort(): string {
    return this._port;
  }

  /**
   * Sets the SMTP server port.
   */
  setPort(port: string): void {
    this._port = port;
  }

  /**
   * Returns true if authentication is needed for the SMTP server.
   */
  isUseAuthentication(): boolean {
    return this._useAuthentication;
  }

  /**
   * Sets whether authentication is needed for the SMTP server.
   */
  setUseAuthentication(useAuthentication: boolean): void {
    this._useAuthentication = useAuthentication;
  }

  /**
   * Returns the encryption security layer ("TLS" or "SSL").
   */
  getSecure(): string {
    return this._secure;
  }

  /**
   * Sets the encryption security layer to use ("TLS" or "SSL").
   */
  setSecure(secure: string): void {
    this._secure = secure;
  }

  /**
   * Returns the username being used to authenticate to the SMTP server.
   */
  getUsername(): string {
    return this._username;
  }

  /**
   * Sets the username to use to authenticate to the SMTP server.
   */
  setUsername(username: string): void {
    this._username = username;
  }

  /**
   * Returns the password being used to authenticate to the SMTP server.
   */
  getPassword(): string {
    return this._password;
  }

  /**
   * Sets the password to use to authenticate to the SMTP server.
   */
  setPassword(password: string): void {
    this._password = password;
  }

  /**
   * Returns the FROM field being used for dispatched e-mail messages.
   */
  getFrom(): string {
    return this._from;
  }

  /**
   * Sets the FROM field to use for dispatched e-mail messages.
   */
  setFrom(from: string): void {
    this._from = from;
  }

  /**
   * Returns the socket connection timeout value in milliseconds.
   */
  getSocketTimeout(): number {
    return this._socketTimeout;
  }

  /**
   * Sets the socket connection timeout value.
   */
  setSocketTimeout(socketTimeout: number): void {
    this._socketTimeout = socketTimeout;
  }

  /**
   * Creates a nodemailer transporter with the current settings.
   */
  private createTransporter(): Transporter<SentMessageInfo> {
    const port = parseInt(this._port, 10);
    const isSSL = this._secure.toUpperCase() === 'SSL';
    const isTLS = this._secure.toUpperCase() === 'TLS';

    const options: nodemailer.TransportOptions & {
      host: string;
      port: number;
      secure: boolean;
      connectionTimeout: number;
      greetingTimeout: number;
      socketTimeout: number;
      auth?: { user: string; pass: string };
      requireTLS?: boolean;
    } = {
      host: this._host,
      port: port,
      secure: isSSL, // true for 465 (SSL), false for other ports
      connectionTimeout: this._socketTimeout,
      greetingTimeout: this._socketTimeout,
      socketTimeout: this._socketTimeout,
    };

    // Configure authentication if needed
    if (this._useAuthentication) {
      options.auth = {
        user: this._username,
        pass: this._password,
      };
    }

    // Configure STARTTLS for TLS mode (not SSL)
    if (isTLS && !isSSL) {
      options.requireTLS = true;
    }

    return nodemailer.createTransport(options);
  }

  /**
   * Sends an e-mail message.
   *
   * @param toList - Comma-separated list of e-mail addresses to send to.
   * @param ccList - Comma-separated list of e-mail addresses to CC.
   * @param from - The FROM field to use for the e-mail message.
   * @param subject - The subject of the e-mail message.
   * @param body - The content of the e-mail message.
   * @param charset - The charset encoding to use.
   * @throws Error if an error occurred while sending the e-mail message.
   */
  async send(
    toList: string,
    ccList: string,
    from: string,
    subject: string,
    body: string,
    charset?: string
  ): Promise<void>;

  /**
   * Sends an e-mail message using the default FROM field.
   *
   * @param toList - Comma-separated list of e-mail addresses to send to.
   * @param ccList - Comma-separated list of e-mail addresses to CC.
   * @param subject - The subject of the e-mail message.
   * @param body - The content of the e-mail message.
   * @throws Error if an error occurred while sending the e-mail message.
   */
  async send(
    toList: string,
    ccList: string,
    subject: string,
    body: string
  ): Promise<void>;

  async send(
    toList: string,
    ccList: string,
    fromOrSubject: string,
    subjectOrBody: string,
    bodyOrCharset?: string,
    charset?: string
  ): Promise<void> {
    let from: string;
    let subject: string;
    let body: string;
    let encoding: string;

    // Determine which overload is being called
    if (bodyOrCharset === undefined && charset === undefined) {
      // 4-arg version: toList, ccList, subject, body
      from = this._from;
      subject = fromOrSubject;
      body = subjectOrBody;
      encoding = 'utf-8';
    } else if (charset === undefined) {
      // 5-arg version: toList, ccList, from, subject, body
      from = fromOrSubject;
      subject = subjectOrBody;
      body = bodyOrCharset!;
      encoding = 'utf-8';
    } else {
      // 6-arg version: toList, ccList, from, subject, body, charset
      from = fromOrSubject;
      subject = subjectOrBody;
      body = bodyOrCharset!;
      encoding = charset;
    }

    const transporter = this.createTransporter();

    try {
      await transporter.sendMail({
        from: from,
        to: toList,
        cc: ccList || undefined,
        subject: subject,
        text: body,
        encoding: encoding as BufferEncoding,
      });
    } finally {
      transporter.close();
    }
  }
}
