import type { SecretValue, SecretsProvider } from '../types.js';

export class AwsSecretsProvider implements SecretsProvider {
  readonly name = 'aws';
  private client: any = null;
  private commands: any = null; // Stores SDK command constructors
  private region: string;
  private prefix: string;

  constructor(region?: string, prefix: string = 'mirth/') {
    this.region =
      region ?? process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1';
    this.prefix = prefix;
  }

  async initialize(): Promise<void> {
    try {
      // @ts-expect-error -- optional peer dependency, installed by user
      const sdk = await import('@aws-sdk/client-secrets-manager');
      this.client = new sdk.SecretsManagerClient({ region: this.region });
      this.commands = {
        GetSecretValueCommand: sdk.GetSecretValueCommand,
        ListSecretsCommand: sdk.ListSecretsCommand,
        PutSecretValueCommand: sdk.PutSecretValueCommand,
        CreateSecretCommand: sdk.CreateSecretCommand,
        DeleteSecretCommand: sdk.DeleteSecretCommand,
      };
    } catch {
      throw new Error(
        'AWS Secrets Manager SDK not installed. Run: npm install @aws-sdk/client-secrets-manager'
      );
    }
  }

  async get(key: string): Promise<SecretValue | undefined> {
    if (!this.client) throw new Error('AwsSecretsProvider not initialized');
    try {
      const response = await this.client.send(
        new this.commands.GetSecretValueCommand({
          SecretId: this.prefix + key,
        })
      );

      let value: string;
      if (response.SecretString) {
        // Try to parse as JSON and extract the key
        try {
          const parsed = JSON.parse(response.SecretString);
          value =
            typeof parsed === 'object' && parsed[key] !== undefined
              ? String(parsed[key])
              : response.SecretString;
        } catch {
          value = response.SecretString;
        }
      } else if (response.SecretBinary) {
        value = Buffer.from(response.SecretBinary).toString('utf-8');
      } else {
        return undefined;
      }

      return {
        value,
        source: this.name,
        fetchedAt: new Date(),
        version: response.VersionId,
      };
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException') return undefined;
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async list(): Promise<string[]> {
    if (!this.client) throw new Error('AwsSecretsProvider not initialized');
    const keys: string[] = [];
    let nextToken: string | undefined;
    do {
      const response = await this.client.send(
        new this.commands.ListSecretsCommand({
          NextToken: nextToken,
          Filters: [{ Key: 'name', Values: [this.prefix] }],
        })
      );
      for (const secret of response.SecretList ?? []) {
        if (secret.Name?.startsWith(this.prefix)) {
          keys.push(secret.Name.slice(this.prefix.length));
        }
      }
      nextToken = response.NextToken;
    } while (nextToken);
    return keys;
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.client) throw new Error('AwsSecretsProvider not initialized');
    try {
      await this.client.send(
        new this.commands.PutSecretValueCommand({
          SecretId: this.prefix + key,
          SecretString: value,
        })
      );
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException') {
        await this.client.send(
          new this.commands.CreateSecretCommand({
            Name: this.prefix + key,
            SecretString: value,
          })
        );
      } else {
        throw err;
      }
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.client) throw new Error('AwsSecretsProvider not initialized');
    await this.client.send(
      new this.commands.DeleteSecretCommand({
        SecretId: this.prefix + key,
        ForceDeleteWithoutRecovery: true,
      })
    );
  }

  async shutdown(): Promise<void> {
    this.client = null;
    this.commands = null;
  }
}
