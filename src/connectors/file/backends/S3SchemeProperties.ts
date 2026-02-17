/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/S3SchemeProperties.java
 *
 * Purpose: Configuration properties specific to AWS S3 connections.
 *
 * Key behaviors:
 * - Supports default credential provider chain (IAM roles, env vars, profile)
 * - Supports temporary STS credentials with configurable duration
 * - Custom headers on PUT requests (metadata)
 * - Region configuration (Java default: us-east-1)
 */

/**
 * S3 scheme-specific configuration properties.
 */
export interface S3SchemeProperties {
  /** Use AWS default credential provider chain (env vars, IAM role, profile). Java default: true */
  useDefaultCredentialProviderChain: boolean;

  /** Use STS temporary credentials. Java default: false */
  useTemporaryCredentials: boolean;

  /** STS session duration in seconds (min 900, max 129600). Java default: 7200 */
  duration: number;

  /** AWS region identifier. Java default: "us-east-1" */
  region: string;

  /**
   * Custom headers (metadata) to attach to PUT requests.
   * Maps header name to list of values.
   * Java default: empty map
   */
  customHeaders: Record<string, string[]>;
}

/**
 * Returns default S3 scheme properties matching Java defaults.
 */
export function getDefaultS3SchemeProperties(): S3SchemeProperties {
  return {
    useDefaultCredentialProviderChain: true,
    useTemporaryCredentials: false,
    duration: 7200,
    region: 'us-east-1',
    customHeaders: {},
  };
}
