/**
 * Core types for the secrets management system.
 *
 * Providers implement the SecretsProvider interface to fetch secrets from
 * various backends (env vars, files, AWS, Azure, GCP, HashiCorp Vault).
 */

export interface SecretValue {
  value: string;
  source: string;       // provider name (e.g., 'env', 'aws', 'vault')
  fetchedAt: Date;
  version?: string;     // provider-specific version/revision
  expiresAt?: Date;     // rotation hint from provider
}

export interface SecretsProvider {
  readonly name: string;
  initialize(): Promise<void>;
  get(key: string): Promise<SecretValue | undefined>;
  has(key: string): Promise<boolean>;
  list(): Promise<string[]>;
  set?(key: string, value: string): Promise<void>;     // optional (Vault, AWS support writes)
  delete?(key: string): Promise<void>;                  // optional
  shutdown(): Promise<void>;
}

export interface SecretsManagerConfig {
  providers: string[];           // e.g., ['env', 'file', 'aws']
  cacheTtlSeconds: number;       // default 300
  filePath: string;              // default '/run/secrets'
  configFile?: string;           // path to .properties or .env file
  awsRegion?: string;
  awsPrefix?: string;            // default 'mirth/'
  gcpProject?: string;
  azureVaultUrl?: string;
  vaultAddr?: string;
  vaultToken?: string;
  vaultPath?: string;            // default 'secret/data/mirth'
  vaultAuth?: 'token' | 'approle' | 'kubernetes';
  vaultRoleId?: string;
  vaultSecretId?: string;
  vaultK8sRole?: string;
  encryptCache?: boolean;        // encrypt local cache with MIRTH_ENCRYPTION_KEY
  preloadKeys?: string[];        // keys to eagerly load at startup
}

/**
 * Parse secrets configuration from environment variables.
 * Follows the same pattern as getClusterConfig() in src/cluster/ClusterConfig.ts.
 */
export function parseSecretsConfig(): SecretsManagerConfig {
  return {
    providers: (process.env['MIRTH_SECRETS_PROVIDERS'] ?? 'env').split(',').map(s => s.trim()).filter(Boolean),
    cacheTtlSeconds: parseInt(process.env['MIRTH_SECRETS_CACHE_TTL'] ?? '300', 10),
    filePath: process.env['MIRTH_SECRETS_FILE_PATH'] ?? '/run/secrets',
    configFile: process.env['MIRTH_CONFIG_FILE'],
    awsRegion: process.env['MIRTH_SECRETS_AWS_REGION'],
    awsPrefix: process.env['MIRTH_SECRETS_AWS_PREFIX'] ?? 'mirth/',
    gcpProject: process.env['MIRTH_SECRETS_GCP_PROJECT'],
    azureVaultUrl: process.env['MIRTH_SECRETS_AZURE_VAULT_URL'],
    vaultAddr: process.env['MIRTH_SECRETS_VAULT_ADDR'],
    vaultToken: process.env['MIRTH_SECRETS_VAULT_TOKEN'],
    vaultPath: process.env['MIRTH_SECRETS_VAULT_PATH'] ?? 'secret/data/mirth',
    vaultAuth: (process.env['MIRTH_SECRETS_VAULT_AUTH'] as SecretsManagerConfig['vaultAuth']) ?? 'token',
    vaultRoleId: process.env['MIRTH_SECRETS_VAULT_ROLE_ID'],
    vaultSecretId: process.env['MIRTH_SECRETS_VAULT_SECRET_ID'],
    vaultK8sRole: process.env['MIRTH_SECRETS_VAULT_K8S_ROLE'],
    encryptCache: process.env['MIRTH_SECRETS_ENCRYPT_CACHE'] === 'true',
    preloadKeys: process.env['MIRTH_SECRETS_CFG_KEYS']?.split(',').map(s => s.trim()).filter(Boolean),
  };
}
