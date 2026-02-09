import type { SecretValue, SecretsProvider } from '../types.js';

export class GcpSecretsProvider implements SecretsProvider {
  readonly name = 'gcp';
  private client: any = null;
  private project: string;

  constructor(project?: string) {
    this.project = project ?? process.env['GCP_PROJECT_ID'] ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? '';
  }

  async initialize(): Promise<void> {
    if (!this.project) throw new Error('GCP project ID required (MIRTH_SECRETS_GCP_PROJECT or GCP_PROJECT_ID)');
    try {
      // @ts-expect-error -- optional peer dependency, installed by user
      const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
      this.client = new SecretManagerServiceClient();
    } catch {
      throw new Error('GCP Secret Manager SDK not installed. Run: npm install @google-cloud/secret-manager');
    }
  }

  async get(key: string): Promise<SecretValue | undefined> {
    if (!this.client) throw new Error('GcpSecretsProvider not initialized');
    try {
      const name = `projects/${this.project}/secrets/${key}/versions/latest`;
      const [version] = await this.client.accessSecretVersion({ name });
      const payload = version.payload?.data;
      if (!payload) return undefined;

      const value = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf-8');
      return {
        value,
        source: this.name,
        fetchedAt: new Date(),
        version: version.name?.split('/').pop(),
      };
    } catch (err: any) {
      if (err.code === 5) return undefined; // NOT_FOUND
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async list(): Promise<string[]> {
    if (!this.client) throw new Error('GcpSecretsProvider not initialized');
    const parent = `projects/${this.project}`;
    const [secrets] = await this.client.listSecrets({ parent });
    return (secrets ?? []).map((s: any) => s.name?.split('/').pop() ?? '').filter(Boolean);
  }

  async shutdown(): Promise<void> {
    if (this.client?.close) await this.client.close();
    this.client = null;
  }
}
