import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { parseSecretsConfig } from '../../../src/secrets/types.js';

describe('parseSecretsConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return defaults when no env vars set', () => {
    delete process.env['MIRTH_SECRETS_PROVIDERS'];
    delete process.env['MIRTH_SECRETS_CACHE_TTL'];
    delete process.env['MIRTH_SECRETS_FILE_PATH'];
    delete process.env['MIRTH_CONFIG_FILE'];
    delete process.env['MIRTH_SECRETS_AWS_REGION'];
    delete process.env['MIRTH_SECRETS_AWS_PREFIX'];
    delete process.env['MIRTH_SECRETS_GCP_PROJECT'];
    delete process.env['MIRTH_SECRETS_AZURE_VAULT_URL'];
    delete process.env['MIRTH_SECRETS_VAULT_ADDR'];
    delete process.env['MIRTH_SECRETS_VAULT_TOKEN'];
    delete process.env['MIRTH_SECRETS_VAULT_PATH'];
    delete process.env['MIRTH_SECRETS_VAULT_AUTH'];
    delete process.env['MIRTH_SECRETS_VAULT_ROLE_ID'];
    delete process.env['MIRTH_SECRETS_VAULT_SECRET_ID'];
    delete process.env['MIRTH_SECRETS_VAULT_K8S_ROLE'];
    delete process.env['MIRTH_SECRETS_ENCRYPT_CACHE'];
    delete process.env['MIRTH_SECRETS_CFG_KEYS'];

    const config = parseSecretsConfig();

    expect(config.providers).toEqual(['env']);
    expect(config.cacheTtlSeconds).toBe(300);
    expect(config.filePath).toBe('/run/secrets');
    expect(config.configFile).toBeUndefined();
    expect(config.awsRegion).toBeUndefined();
    expect(config.awsPrefix).toBe('mirth/');
    expect(config.gcpProject).toBeUndefined();
    expect(config.azureVaultUrl).toBeUndefined();
    expect(config.vaultAddr).toBeUndefined();
    expect(config.vaultToken).toBeUndefined();
    expect(config.vaultPath).toBe('secret/data/mirth');
    expect(config.vaultAuth).toBe('token');
    expect(config.vaultRoleId).toBeUndefined();
    expect(config.vaultSecretId).toBeUndefined();
    expect(config.vaultK8sRole).toBeUndefined();
    expect(config.encryptCache).toBe(false);
    expect(config.preloadKeys).toBeUndefined();
  });

  it('should parse a single provider', () => {
    process.env['MIRTH_SECRETS_PROVIDERS'] = 'vault';

    const config = parseSecretsConfig();

    expect(config.providers).toEqual(['vault']);
  });

  it('should parse multiple comma-separated providers', () => {
    process.env['MIRTH_SECRETS_PROVIDERS'] = 'env,file,aws';

    const config = parseSecretsConfig();

    expect(config.providers).toEqual(['env', 'file', 'aws']);
  });

  it('should trim whitespace in provider list', () => {
    process.env['MIRTH_SECRETS_PROVIDERS'] = ' env , file , aws ';

    const config = parseSecretsConfig();

    expect(config.providers).toEqual(['env', 'file', 'aws']);
  });

  it('should filter empty entries in provider list', () => {
    process.env['MIRTH_SECRETS_PROVIDERS'] = 'env,,file,';

    const config = parseSecretsConfig();

    expect(config.providers).toEqual(['env', 'file']);
  });

  it('should parse custom cache TTL', () => {
    process.env['MIRTH_SECRETS_CACHE_TTL'] = '60';

    const config = parseSecretsConfig();

    expect(config.cacheTtlSeconds).toBe(60);
  });

  it('should return NaN for non-numeric cache TTL', () => {
    process.env['MIRTH_SECRETS_CACHE_TTL'] = 'abc';

    const config = parseSecretsConfig();

    expect(config.cacheTtlSeconds).toBeNaN();
  });

  it('should parse custom file path', () => {
    process.env['MIRTH_SECRETS_FILE_PATH'] = '/etc/mirth/secrets';

    const config = parseSecretsConfig();

    expect(config.filePath).toBe('/etc/mirth/secrets');
  });

  it('should parse encryptCache as true', () => {
    process.env['MIRTH_SECRETS_ENCRYPT_CACHE'] = 'true';

    const config = parseSecretsConfig();

    expect(config.encryptCache).toBe(true);
  });

  it('should parse encryptCache as false for non-true values', () => {
    process.env['MIRTH_SECRETS_ENCRYPT_CACHE'] = 'yes';

    const config = parseSecretsConfig();

    expect(config.encryptCache).toBe(false);
  });

  it('should parse comma-separated preloadKeys', () => {
    process.env['MIRTH_SECRETS_CFG_KEYS'] = 'db.password,api.key,smtp.password';

    const config = parseSecretsConfig();

    expect(config.preloadKeys).toEqual(['db.password', 'api.key', 'smtp.password']);
  });

  it('should trim whitespace in preloadKeys', () => {
    process.env['MIRTH_SECRETS_CFG_KEYS'] = ' db.password , api.key ';

    const config = parseSecretsConfig();

    expect(config.preloadKeys).toEqual(['db.password', 'api.key']);
  });

  it('should filter empty entries in preloadKeys', () => {
    process.env['MIRTH_SECRETS_CFG_KEYS'] = 'key1,,key2,';

    const config = parseSecretsConfig();

    expect(config.preloadKeys).toEqual(['key1', 'key2']);
  });

  it('should parse all AWS-related env vars', () => {
    process.env['MIRTH_SECRETS_AWS_REGION'] = 'us-west-2';
    process.env['MIRTH_SECRETS_AWS_PREFIX'] = 'myapp/';

    const config = parseSecretsConfig();

    expect(config.awsRegion).toBe('us-west-2');
    expect(config.awsPrefix).toBe('myapp/');
  });

  it('should parse all Vault-related env vars', () => {
    process.env['MIRTH_SECRETS_VAULT_ADDR'] = 'https://vault.example.com:8200';
    process.env['MIRTH_SECRETS_VAULT_TOKEN'] = 'hvs.secret-token';
    process.env['MIRTH_SECRETS_VAULT_PATH'] = 'secret/data/myapp';
    process.env['MIRTH_SECRETS_VAULT_AUTH'] = 'kubernetes';
    process.env['MIRTH_SECRETS_VAULT_ROLE_ID'] = 'role-123';
    process.env['MIRTH_SECRETS_VAULT_SECRET_ID'] = 'secret-456';
    process.env['MIRTH_SECRETS_VAULT_K8S_ROLE'] = 'mirth-role';

    const config = parseSecretsConfig();

    expect(config.vaultAddr).toBe('https://vault.example.com:8200');
    expect(config.vaultToken).toBe('hvs.secret-token');
    expect(config.vaultPath).toBe('secret/data/myapp');
    expect(config.vaultAuth).toBe('kubernetes');
    expect(config.vaultRoleId).toBe('role-123');
    expect(config.vaultSecretId).toBe('secret-456');
    expect(config.vaultK8sRole).toBe('mirth-role');
  });

  it('should parse Azure and GCP env vars', () => {
    process.env['MIRTH_SECRETS_AZURE_VAULT_URL'] = 'https://myvault.vault.azure.net';
    process.env['MIRTH_SECRETS_GCP_PROJECT'] = 'my-gcp-project';

    const config = parseSecretsConfig();

    expect(config.azureVaultUrl).toBe('https://myvault.vault.azure.net');
    expect(config.gcpProject).toBe('my-gcp-project');
  });
});
