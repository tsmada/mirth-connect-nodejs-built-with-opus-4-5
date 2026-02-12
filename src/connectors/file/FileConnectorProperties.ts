/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FileReceiverProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FileDispatcherProperties.java
 *
 * Purpose: Configuration properties for File source and destination connectors
 *
 * Key behaviors to replicate:
 * - All configuration options from Java implementation
 * - Default values matching Java
 * - Support for multiple file schemes (FILE, FTP, SFTP, S3, SMB)
 */

import { SftpSchemeProperties } from './sftp/SftpSchemeProperties.js';

/**
 * File scheme types
 */
export enum FileScheme {
  FILE = 'FILE',
  FTP = 'FTP',
  SFTP = 'SFTP',
  S3 = 'S3',
  SMB = 'SMB',
}

/**
 * Action to take after processing a file
 */
export enum AfterProcessingAction {
  NONE = 'NONE',
  MOVE = 'MOVE',
  DELETE = 'DELETE',
}

/**
 * File sorting options
 */
export enum FileSortBy {
  NAME = 'NAME',
  SIZE = 'SIZE',
  DATE = 'DATE',
}

/**
 * File Receiver (Source) Properties
 */
export interface FileReceiverProperties {
  /** File scheme (FILE, FTP, SFTP, S3, SMB) */
  scheme: FileScheme;
  /** Host for remote connections */
  host: string;
  /** Port for remote connections */
  port?: number;
  /** Whether to use anonymous FTP login (Java default: true) */
  anonymous: boolean;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;
  /** Directory to read files from */
  directory: string;
  /** File filter pattern (glob or regex) */
  fileFilter: string;
  /** Whether fileFilter is a regex pattern */
  regex: boolean;
  /** Whether to search subdirectories */
  directoryRecursion: boolean;
  /** Whether to ignore hidden files */
  ignoreDot: boolean;
  /** Read files in binary mode */
  binary: boolean;
  /** Character encoding for text files */
  charsetEncoding: string;
  /** Action to take after processing */
  afterProcessingAction: AfterProcessingAction;
  /** Directory to move files to after processing */
  moveToDirectory: string;
  /** Error directory for failed processing */
  errorDirectory: string;
  /** Action to take on error */
  errorAction: AfterProcessingAction;
  /** Whether to check file age before processing (Java default: true) */
  checkFileAge: boolean;
  /** Minimum file age in ms before processing (Java default: 1000) */
  fileAge: number;
  /** Polling interval in milliseconds */
  pollInterval: number;
  /** Sort files by */
  sortBy: FileSortBy;
  /** Sort in descending order */
  sortDescending: boolean;
  /** Maximum files to process per poll */
  batchSize: number;
  /** FTP passive mode */
  passive: boolean;
  /** FTP secure mode */
  secure: boolean;
  /** Validate remote certificates */
  validateConnection: boolean;
  /** Timeout for connections (ms) */
  timeout: number;
  /** Maximum number of connection retry attempts for SFTP/FTP (0 = no retry) */
  maxRetryCount: number;
  /** Delay between retry attempts in ms */
  retryDelay: number;
  /** SFTP-specific scheme properties */
  sftpSchemeProperties?: SftpSchemeProperties;
}

/**
 * File Dispatcher (Destination) Properties
 */
export interface FileDispatcherProperties {
  /** File scheme (FILE, FTP, SFTP, S3, SMB) */
  scheme: FileScheme;
  /** Host for remote connections */
  host: string;
  /** Port for remote connections */
  port?: number;
  /** Whether to use anonymous FTP login (Java default: true) */
  anonymous: boolean;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;
  /** Directory to write files to */
  directory: string;
  /** Output filename pattern */
  outputPattern: string;
  /** Append to existing file (Java default: true) */
  outputAppend: boolean;
  /** File content template */
  template: string;
  /** Write files in binary mode */
  binary: boolean;
  /** Character encoding for text files */
  charsetEncoding: string;
  /** Error if destination file already exists */
  errorOnExists: boolean;
  /** Temporary file extension during write */
  tempFilename: string;
  /** FTP passive mode */
  passive: boolean;
  /** FTP secure mode */
  secure: boolean;
  /** Validate remote certificates */
  validateConnection: boolean;
  /** Timeout for connections (ms) */
  timeout: number;
  /** Keep SFTP/FTP connection open between sends (Java default: true) */
  keepConnectionOpen: boolean;
  /** Max idle time for kept-open connections in ms (0 = no limit, Java default: 0) */
  maxIdleTime: number;
  /** SFTP-specific scheme properties */
  sftpSchemeProperties?: SftpSchemeProperties;
}

/**
 * Default File Receiver properties
 */
export function getDefaultFileReceiverProperties(): FileReceiverProperties {
  return {
    scheme: FileScheme.FILE,
    host: '',
    port: undefined,
    anonymous: true,       // Java default: true
    username: 'anonymous', // Java default: "anonymous"
    password: 'anonymous', // Java default: "anonymous"
    directory: '',
    fileFilter: '*',
    regex: false,
    directoryRecursion: false,
    ignoreDot: true,
    binary: false,
    charsetEncoding: 'UTF-8',
    afterProcessingAction: AfterProcessingAction.NONE,
    moveToDirectory: '',
    errorDirectory: '',
    errorAction: AfterProcessingAction.NONE,
    checkFileAge: true,   // Java default: true
    fileAge: 1000,        // Java default: 1000ms
    pollInterval: 5000,
    sortBy: FileSortBy.DATE,
    sortDescending: false,
    batchSize: 0, // 0 = unlimited
    passive: true,
    secure: true,          // Java default: true (FTPS)
    validateConnection: true,
    timeout: 10000,
    maxRetryCount: 3,
    retryDelay: 5000,
  };
}

/**
 * Default File Dispatcher properties
 */
export function getDefaultFileDispatcherProperties(): FileDispatcherProperties {
  return {
    scheme: FileScheme.FILE,
    host: '',
    port: undefined,
    anonymous: true,       // Java default: true
    username: 'anonymous', // Java default: "anonymous"
    password: 'anonymous', // Java default: "anonymous"
    directory: '',
    outputPattern: 'output_${date:yyyyMMddHHmmss}_${UUID}.txt',
    outputAppend: true,  // Java default: true (was false — CPC-DVM-007)
    template: '',
    binary: false,
    charsetEncoding: 'UTF-8',
    errorOnExists: false,
    tempFilename: '',
    passive: true,
    secure: true,          // Java default: true (FTPS)
    validateConnection: true,
    timeout: 10000,
    keepConnectionOpen: true,  // Java default: true (CPC-RCG-003)
    maxIdleTime: 0,            // Java default: 0 (no eviction)
  };
}

/**
 * Convert glob pattern to regex
 */
export function globToRegex(glob: string): RegExp {
  // Escape regex special characters except * and ?
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check if a filename matches a filter pattern
 */
export function matchesFilter(
  filename: string,
  pattern: string,
  isRegex: boolean
): boolean {
  if (!pattern || pattern === '*') {
    return true;
  }

  try {
    if (isRegex) {
      const regex = new RegExp(pattern);
      return regex.test(filename);
    } else {
      const regex = globToRegex(pattern);
      return regex.test(filename);
    }
  } catch {
    // Invalid pattern, don't match
    return false;
  }
}

/**
 * Generate output filename from pattern
 */
export function generateOutputFilename(
  pattern: string,
  variables: Record<string, string> = {}
): string {
  let filename = pattern;

  // Replace date patterns
  const now = new Date();
  filename = filename.replace(/\$\{date:([^}]+)\}/g, (_match, format) => {
    return formatDate(now, format);
  });

  // Replace UUID
  filename = filename.replace(/\$\{UUID\}/g, generateUUID());

  // Replace custom variables
  for (const [key, value] of Object.entries(variables)) {
    filename = filename.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
  }

  return filename;
}

/**
 * Format date according to pattern
 */
function formatDate(date: Date, pattern: string): string {
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');

  return pattern
    .replace('yyyy', date.getFullYear().toString())
    .replace('MM', pad(date.getMonth() + 1))
    .replace('dd', pad(date.getDate()))
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
    .replace('ss', pad(date.getSeconds()))
    .replace('SSS', pad(date.getMilliseconds(), 3));
}

/**
 * Generate a simple UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * File information structure
 */
export interface FileInfo {
  name: string;
  path: string;
  directory: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
}
