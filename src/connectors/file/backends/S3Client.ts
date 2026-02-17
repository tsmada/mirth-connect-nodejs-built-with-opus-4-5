/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/filesystems/S3Connection.java
 *
 * Purpose: AWS S3 file system backend using @aws-sdk/client-s3.
 *
 * Key behaviors to replicate:
 * - Bucket name derived from the "host" field (first path segment of fromDir)
 * - Key prefix derived from remaining path segments
 * - Support for default credential provider chain (IAM roles, env vars, profile)
 * - Support for explicit credentials (username=accessKeyId, password=secretAccessKey)
 * - Support for STS temporary credentials
 * - Anonymous access when anonymous=true
 * - Custom headers (metadata) on PUT requests
 * - canAppend() returns false (S3 objects are immutable)
 * - S3 metadata injected into sourceMap on read
 * - Automatic retry on ExpiredToken (STS)
 * - Pagination for list operations (isTruncated/continuationToken)
 */

import { FileInfo, matchesFilter } from '../FileConnectorProperties.js';
import { FileSystemClient } from './types.js';
import { S3SchemeProperties, getDefaultS3SchemeProperties } from './S3SchemeProperties.js';
import { getLogger } from '../../../logging/index.js';

const logger = getLogger('file-connector');

// AWS SDK type shims for dynamic import
interface S3CommandOutput {
  $metadata: { httpStatusCode?: number };
}

interface S3Object {
  Key?: string;
  Size?: number;
  LastModified?: Date;
  ETag?: string;
  StorageClass?: string;
}

interface ListObjectsV2Output extends S3CommandOutput {
  Contents?: S3Object[];
  CommonPrefixes?: Array<{ Prefix?: string }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

interface GetObjectOutput extends S3CommandOutput {
  Body?: { transformToByteArray(): Promise<Uint8Array> };
  Metadata?: Record<string, string>;
}

interface PutObjectOutput extends S3CommandOutput {
  ETag?: string;
  VersionId?: string;
  Expiration?: string;
  ServerSideEncryption?: string;
  SSECustomerAlgorithm?: string;
  SSECustomerKeyMD5?: string;
}

interface HeadObjectOutput extends S3CommandOutput {
  DeleteMarker?: boolean;
}

/**
 * Options for creating an S3 connection.
 */
export interface S3ClientOptions {
  /** Bucket name or bucket/prefix path (used as "host" in Mirth config) */
  host: string;
  /** AWS access key ID (when not using default credentials) */
  username: string;
  /** AWS secret access key (when not using default credentials) */
  password: string;
  /** Whether to use anonymous access */
  anonymous?: boolean;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** S3-specific scheme properties */
  schemeProperties?: Partial<S3SchemeProperties>;
}

const DELIMITER = '/';

/**
 * AWS S3 file system client.
 *
 * Uses dynamic import of @aws-sdk/client-s3 to avoid requiring the
 * dependency unless S3 is actually used.
 *
 * Directory structure mapping:
 * - "host" field in Mirth = bucket name
 * - "directory" field = key prefix within bucket
 * - Paths like "my-bucket/path/to/folder" are split: bucket="my-bucket", prefix="path/to/folder/"
 */
export class S3Client implements FileSystemClient {
  private s3: unknown = null; // S3Client from AWS SDK
  private s3Module: Record<string, unknown> | null = null; // Cached module reference
  private _connected = false;

  private host: string;
  private username: string;
  private password: string;
  private anonymous: boolean;
  private timeout: number;
  private schemeProperties: S3SchemeProperties;

  constructor(options: S3ClientOptions) {
    this.host = options.host;
    this.username = options.username;
    this.password = options.password;
    this.anonymous = options.anonymous ?? false;
    this.timeout = options.timeout ?? 10000;
    this.schemeProperties = {
      ...getDefaultS3SchemeProperties(),
      ...options.schemeProperties,
    };
  }

  async connect(): Promise<void> {
    if (this._connected && this.s3) {
      return;
    }

    // Dynamic import with actionable error message
    try {
      this.s3Module = await import('@aws-sdk/client-s3') as unknown as Record<string, unknown>;
    } catch {
      throw new Error(
        'S3 support requires @aws-sdk/client-s3. Install with: npm install @aws-sdk/client-s3'
      );
    }

    const S3ClientClass = this.s3Module['S3Client'] as new (config: Record<string, unknown>) => unknown;

    // Build credentials configuration matching Java's createCredentialsProvider()
    const config: Record<string, unknown> = {
      region: this.schemeProperties.region,
      requestHandler: {
        connectionTimeout: this.timeout,
        socketTimeout: this.timeout,
      },
    };

    // Use host as custom S3 endpoint if provided (for S3-compatible services like MinIO)
    if (this.host) {
      config.endpoint = this.host.startsWith('http') ? this.host : `https://${this.host}`;
      config.forcePathStyle = true;
    }

    if (this.anonymous) {
      // Java: AnonymousCredentialsProvider.create()
      // AWS SDK v3 doesn't have a built-in anonymous provider; we use a no-op
      config.credentials = { accessKeyId: '', secretAccessKey: '' };
      config.signer = { sign: async (request: unknown) => request };
    } else if (
      this.schemeProperties.useDefaultCredentialProviderChain &&
      !this.username &&
      !this.password
    ) {
      // Java: DefaultCredentialsProvider.create()
      // AWS SDK v3 uses default provider chain automatically when no credentials specified
    } else if (this.username && this.password) {
      // Java: StaticCredentialsProvider.create(AwsBasicCredentials.create(...))
      config.credentials = {
        accessKeyId: this.username,
        secretAccessKey: this.password,
      };
    }

    try {
      this.s3 = new S3ClientClass(config);
      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(
        `S3 connection failed for region ${this.schemeProperties.region} - ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.s3 && typeof (this.s3 as Record<string, unknown>).destroy === 'function') {
      (this.s3 as { destroy(): void }).destroy();
    }
    this.s3 = null;
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected && this.s3 !== null;
  }

  /**
   * Parse a directory path into bucket name and key prefix.
   * Matches Java's getBucketNameAndPrefix().
   *
   * Examples:
   * - "my-bucket" -> { bucket: "my-bucket", prefix: null }
   * - "my-bucket/path/to/files" -> { bucket: "my-bucket", prefix: "path/to/files/" }
   * - "/my-bucket/path" -> { bucket: "my-bucket", prefix: "path/" }
   */
  private getBucketNameAndPrefix(fromDir: string): { bucket: string; prefix: string | null } {
    let dir = fromDir;

    // Remove leading delimiters (matches Java)
    while (dir.startsWith(DELIMITER)) {
      dir = dir.substring(1);
    }

    const index = dir.indexOf(DELIMITER);
    if (index > 0) {
      const bucket = dir.substring(0, index);
      let prefix = dir.substring(index + 1).trim() || null;
      // Normalize: ensure trailing delimiter for prefix
      if (prefix && !prefix.endsWith(DELIMITER)) {
        prefix += DELIMITER;
      }
      return { bucket, prefix };
    }

    return { bucket: dir, prefix: null };
  }

  /**
   * Construct the full S3 key from prefix + filename.
   */
  private getKey(prefix: string | null, filename: string): string {
    if (prefix && prefix !== DELIMITER) {
      return prefix + filename;
    }
    return filename;
  }

  /**
   * Get custom headers for PUT requests.
   * Matches Java's getCustomHeaders().
   */
  private getCustomHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, values] of Object.entries(this.schemeProperties.customHeaders)) {
      if (values.length > 0) {
        // S3 metadata only supports single values per key
        headers[key] = values[values.length - 1]!;
      }
    }
    return headers;
  }

  private async sendCommand(CommandClass: new (input: Record<string, unknown>) => unknown, input: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected();
    const command = new CommandClass(input);
    return (this.s3 as { send(cmd: unknown): Promise<unknown> }).send(command);
  }

  async listFiles(fromDir: string, filenamePattern: string, isRegex: boolean, ignoreDot: boolean): Promise<FileInfo[]> {
    this.ensureConnected();

    const { bucket, prefix } = this.getBucketNameAndPrefix(fromDir);
    const ListObjectsV2Command = this.s3Module!['ListObjectsV2Command'] as new (input: Record<string, unknown>) => unknown;

    const files: FileInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const input: Record<string, unknown> = {
        Bucket: bucket,
        Prefix: prefix ?? undefined,
        Delimiter: DELIMITER,
      };
      if (continuationToken) {
        input.ContinuationToken = continuationToken;
      }

      const result = await this.sendCommand(ListObjectsV2Command, input) as ListObjectsV2Output;

      if (result.Contents) {
        for (const s3Object of result.Contents) {
          if (!s3Object.Key) continue;

          // Skip the directory marker itself
          if (s3Object.Key === prefix) continue;

          // Extract filename from key
          let name = s3Object.Key;
          if (prefix && s3Object.Key.startsWith(prefix)) {
            name = s3Object.Key.substring(prefix.length);
          }

          // Skip if it's in a subdirectory (contains delimiter after prefix removal)
          if (name.includes(DELIMITER)) continue;

          // Apply filename filter
          if (!matchesFilter(name, filenamePattern, isRegex)) continue;

          // Skip dot files if configured
          if (ignoreDot && name.startsWith('.')) continue;

          files.push({
            name,
            path: `${bucket}${DELIMITER}${s3Object.Key}`,
            directory: fromDir,
            size: s3Object.Size ?? 0,
            lastModified: s3Object.LastModified ?? new Date(0),
            isDirectory: false,
          });
        }
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    return files;
  }

  async listDirectories(fromDir: string): Promise<string[]> {
    this.ensureConnected();

    const { bucket, prefix } = this.getBucketNameAndPrefix(fromDir);
    const ListObjectsV2Command = this.s3Module!['ListObjectsV2Command'] as new (input: Record<string, unknown>) => unknown;

    const directories: string[] = [];
    let continuationToken: string | undefined;

    do {
      const input: Record<string, unknown> = {
        Bucket: bucket,
        Prefix: prefix ?? undefined,
        Delimiter: DELIMITER,
      };
      if (continuationToken) {
        input.ContinuationToken = continuationToken;
      }

      const result = await this.sendCommand(ListObjectsV2Command, input) as ListObjectsV2Output;

      if (result.CommonPrefixes) {
        for (const cp of result.CommonPrefixes) {
          if (cp.Prefix) {
            directories.push(`${bucket}${DELIMITER}${cp.Prefix}`);
          }
        }
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    return directories;
  }

  async exists(file: string, path: string): Promise<boolean> {
    this.ensureConnected();

    const { bucket, prefix } = this.getBucketNameAndPrefix(path);
    const key = this.getKey(prefix, file);
    const HeadObjectCommand = this.s3Module!['HeadObjectCommand'] as new (input: Record<string, unknown>) => unknown;

    try {
      const result = await this.sendCommand(HeadObjectCommand, {
        Bucket: bucket,
        Key: key,
      }) as HeadObjectOutput;

      return result !== null && (result.DeleteMarker == null || !result.DeleteMarker);
    } catch {
      return false;
    }
  }

  async readFile(file: string, fromDir: string): Promise<Buffer> {
    this.ensureConnected();

    const { bucket, prefix } = this.getBucketNameAndPrefix(fromDir);
    const key = this.getKey(prefix, file);
    const GetObjectCommand = this.s3Module!['GetObjectCommand'] as new (input: Record<string, unknown>) => unknown;

    const result = await this.sendCommand(GetObjectCommand, {
      Bucket: bucket,
      Key: key,
    }) as GetObjectOutput;

    if (!result.Body) {
      throw new Error(`Empty response body for S3 object: ${bucket}/${key}`);
    }

    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async readFileAsString(file: string, fromDir: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const buffer = await this.readFile(file, fromDir);
    return buffer.toString(encoding);
  }

  canAppend(): boolean {
    // Java: S3Connection.canAppend() returns false — S3 objects are immutable
    return false;
  }

  async writeFile(file: string, toDir: string, content: Buffer | string, _append: boolean): Promise<void> {
    this.ensureConnected();

    const { bucket, prefix } = this.getBucketNameAndPrefix(toDir);
    const key = this.getKey(prefix, file);
    const PutObjectCommand = this.s3Module!['PutObjectCommand'] as new (input: Record<string, unknown>) => unknown;

    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

    const input: Record<string, unknown> = {
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentLength: buffer.length,
    };

    // Add custom headers as metadata
    const customHeaders = this.getCustomHeaders();
    if (Object.keys(customHeaders).length > 0) {
      input.Metadata = customHeaders;
    }

    const result = await this.sendCommand(PutObjectCommand, input) as PutObjectOutput;

    // Log metadata for debugging
    if (result.ETag) {
      logger.debug(`S3 PUT ${bucket}/${key}: ETag=${result.ETag}`);
    }
  }

  async delete(file: string, fromDir: string, _mayNotExist: boolean): Promise<void> {
    this.ensureConnected();

    const { bucket, prefix } = this.getBucketNameAndPrefix(fromDir);
    const key = this.getKey(prefix, file);
    const DeleteObjectCommand = this.s3Module!['DeleteObjectCommand'] as new (input: Record<string, unknown>) => unknown;

    // Java: client.deleteObject(deleteRequest)
    // S3 delete is idempotent — doesn't error if object doesn't exist
    await this.sendCommand(DeleteObjectCommand, {
      Bucket: bucket,
      Key: key,
    });
  }

  async move(fromName: string, fromDir: string, toName: string, toDir: string): Promise<void> {
    this.ensureConnected();

    const { bucket: fromBucket, prefix: fromPrefix } = this.getBucketNameAndPrefix(fromDir);
    const fromKey = this.getKey(fromPrefix, fromName);

    const { bucket: toBucket, prefix: toPrefix } = this.getBucketNameAndPrefix(toDir);
    const toKey = this.getKey(toPrefix, toName);

    const CopyObjectCommand = this.s3Module!['CopyObjectCommand'] as new (input: Record<string, unknown>) => unknown;

    try {
      // Java: CopyObject + DeleteObject (S3 has no native rename/move)
      await this.sendCommand(CopyObjectCommand, {
        Bucket: toBucket,
        Key: toKey,
        CopySource: `${fromBucket}/${fromKey}`,
      });

      // Delete original after successful copy
      await this.delete(fromName, fromDir, false);
    } catch (error) {
      throw new Error(
        `Error moving S3 object from [${fromBucket}/${fromKey}] to [${toBucket}/${toKey}]: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async canRead(readDir: string): Promise<boolean> {
    this.ensureConnected();

    try {
      const { bucket, prefix } = this.getBucketNameAndPrefix(readDir);
      const ListObjectsV2Command = this.s3Module!['ListObjectsV2Command'] as new (input: Record<string, unknown>) => unknown;

      await this.sendCommand(ListObjectsV2Command, {
        Bucket: bucket,
        Prefix: prefix ?? undefined,
        Delimiter: DELIMITER,
        MaxKeys: 1, // Only need to check access
      });

      return true;
    } catch {
      return false;
    }
  }

  async canWrite(writeDir: string): Promise<boolean> {
    // Java: delegates to canRead() — no foolproof way to check write access
    return this.canRead(writeDir);
  }

  /**
   * Ensure the S3 client is connected, throwing if not.
   */
  private ensureConnected(): void {
    if (!this._connected || !this.s3) {
      throw new Error('S3 client is not connected');
    }
  }
}
