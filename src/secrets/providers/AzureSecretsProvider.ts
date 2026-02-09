import type { SecretValue, SecretsProvider } from '../types.js';

export class AzureSecretsProvider implements SecretsProvider {
  readonly name = 'azure';
  private client: any = null;
  private vaultUrl: string;

  constructor(vaultUrl?: string) {
    this.vaultUrl = vaultUrl ?? process.env['MIRTH_SECRETS_AZURE_VAULT_URL'] ?? '';
  }

  async initialize(): Promise<void> {
    if (!this.vaultUrl) throw new Error('Azure Key Vault URL required (MIRTH_SECRETS_AZURE_VAULT_URL)');
    try {
      // @ts-expect-error -- optional peer dependency, installed by user
      const { SecretClient } = await import('@azure/keyvault-secrets');
      // @ts-expect-error -- optional peer dependency, installed by user
      const { DefaultAzureCredential } = await import('@azure/identity');
      this.client = new SecretClient(this.vaultUrl, new DefaultAzureCredential());
    } catch {
      throw new Error('Azure SDK not installed. Run: npm install @azure/keyvault-secrets @azure/identity');
    }
  }

  // Azure Key Vault doesn't allow underscores in secret names - convert to dashes
  private normalizeKey(key: string): string {
    return key.replace(/_/g, '-');
  }

  async get(key: string): Promise<SecretValue | undefined> {
    if (!this.client) throw new Error('AzureSecretsProvider not initialized');
    try {
      const secret = await this.client.getSecret(this.normalizeKey(key));
      if (secret.value === undefined) return undefined;
      return {
        value: secret.value,
        source: this.name,
        fetchedAt: new Date(),
        version: secret.properties?.version,
        expiresAt: secret.properties?.expiresOn ? new Date(secret.properties.expiresOn) : undefined,
      };
    } catch (err: any) {
      if (err.statusCode === 404 || err.code === 'SecretNotFound') return undefined;
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async list(): Promise<string[]> {
    if (!this.client) throw new Error('AzureSecretsProvider not initialized');
    const keys: string[] = [];
    for await (const secretProperties of this.client.listPropertiesOfSecrets()) {
      keys.push(secretProperties.name);
    }
    return keys;
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.client) throw new Error('AzureSecretsProvider not initialized');
    await this.client.setSecret(this.normalizeKey(key), value);
  }

  async delete(key: string): Promise<void> {
    if (!this.client) throw new Error('AzureSecretsProvider not initialized');
    const poller = await this.client.beginDeleteSecret(this.normalizeKey(key));
    await poller.pollUntilDone();
  }

  async shutdown(): Promise<void> {
    this.client = null;
  }
}
