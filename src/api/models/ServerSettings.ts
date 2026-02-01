/**
 * Server Settings model
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/ServerSettings.java
 */

export interface ServerSettings {
  environmentName?: string;
  serverName?: string;
  clearGlobalMap?: boolean;
  queueBufferSize?: number;
  defaultMetaDataColumns?: MetaDataColumn[];
  smtpHost?: string;
  smtpPort?: string;
  smtpTimeout?: number;
  smtpFrom?: string;
  smtpSecure?: string;
  smtpAuth?: boolean;
  smtpUsername?: string;
  smtpPassword?: string;
}

export interface MetaDataColumn {
  name: string;
  type: MetaDataColumnType;
  mappingName: string;
}

export enum MetaDataColumnType {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  TIMESTAMP = 'TIMESTAMP',
}

export interface EncryptionSettings {
  encryptExport?: boolean;
  encryptProperties?: boolean;
  encryptionKey?: string;
  digestAlgorithm?: string;
  encryptionAlgorithm?: string;
  encryptionKeyLength?: number;
  securityProvider?: string;
}

export interface UpdateSettings {
  statsEnabled?: boolean;
  updateUrl?: string;
  updateEnabled?: boolean;
  lastStatsTime?: number;
}

export interface PasswordRequirements {
  minLength?: number;
  minUpper?: number;
  minLower?: number;
  minNumeric?: number;
  minSpecial?: number;
  retryLimit?: number;
  lockoutPeriod?: number;
  expiration?: number;
  gracePeriod?: number;
  reusePeriod?: number;
  reuseLimit?: number;
}

export interface LicenseInfo {
  activated?: boolean;
  expirationDate?: Date;
  gracePeriodActive?: boolean;
  gracePeriodEnd?: Date;
  company?: string;
  type?: string;
}

export interface DriverInfo {
  name: string;
  className: string;
  template?: string;
  selectLimit?: string;
  alternativeClassNames?: string[];
}

export interface ResourceProperties {
  id: string;
  name: string;
  type: string;
  description?: string;
  includeWithGlobalScripts?: boolean;
}

export interface ChannelDependency {
  dependentId: string;
  dependencyId: string;
}

export interface ChannelTag {
  id: string;
  name: string;
  channelIds: string[];
  backgroundColor?: string;
}

export interface ConfigurationProperty {
  value: string;
  comment?: string;
}

export function getDefaultServerSettings(): ServerSettings {
  return {
    clearGlobalMap: true,
    queueBufferSize: 1000,
    smtpPort: '25',
    smtpTimeout: 5000,
    smtpSecure: 'none',
    smtpAuth: false,
  };
}
