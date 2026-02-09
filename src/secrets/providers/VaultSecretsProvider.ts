import axios, { type AxiosInstance } from 'axios';
import { readFile } from 'fs/promises';
import type { SecretValue, SecretsProvider } from '../types.js';

export interface VaultConfig {
  addr: string;
  token?: string;
  path?: string;          // KV v2 mount path, default 'secret/data/mirth'
  auth?: 'token' | 'approle' | 'kubernetes';
  roleId?: string;        // AppRole
  secretId?: string;      // AppRole
  k8sRole?: string;       // Kubernetes auth
}

export class VaultSecretsProvider implements SecretsProvider {
  readonly name = 'vault';
  private http: AxiosInstance | null = null;
  private config: VaultConfig;
  private token: string | null = null;

  constructor(config: VaultConfig) {
    this.config = {
      path: 'secret/data/mirth',
      auth: 'token',
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.addr) throw new Error('Vault address required (MIRTH_SECRETS_VAULT_ADDR)');

    this.http = axios.create({
      baseURL: this.config.addr,
      timeout: 5000,
    });

    // Authenticate based on method
    switch (this.config.auth) {
      case 'token':
        this.token = this.config.token ?? null;
        if (!this.token) throw new Error('Vault token required (MIRTH_SECRETS_VAULT_TOKEN)');
        break;
      case 'approle':
        this.token = await this.loginAppRole();
        break;
      case 'kubernetes':
        this.token = await this.loginKubernetes();
        break;
    }

    // Health check
    try {
      await this.http.get('/v1/sys/health', {
        headers: { 'X-Vault-Token': this.token! },
        validateStatus: (s) => s < 500, // 200 active, 429 standby, 472/473 perf standby
      });
    } catch (err) {
      throw new Error(`Vault health check failed: ${(err as Error).message}`);
    }
  }

  private async loginAppRole(): Promise<string> {
    if (!this.config.roleId || !this.config.secretId) {
      throw new Error('Vault AppRole requires roleId and secretId');
    }
    const resp = await this.http!.post('/v1/auth/approle/login', {
      role_id: this.config.roleId,
      secret_id: this.config.secretId,
    });
    return resp.data.auth.client_token;
  }

  private async loginKubernetes(): Promise<string> {
    if (!this.config.k8sRole) {
      throw new Error('Vault Kubernetes auth requires k8sRole');
    }
    const jwt = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf-8');
    const resp = await this.http!.post('/v1/auth/kubernetes/login', {
      role: this.config.k8sRole,
      jwt,
    });
    return resp.data.auth.client_token;
  }

  private headers() {
    return { 'X-Vault-Token': this.token! };
  }

  async get(key: string): Promise<SecretValue | undefined> {
    if (!this.http || !this.token) throw new Error('VaultSecretsProvider not initialized');
    try {
      const resp = await this.http.get(`/v1/${this.config.path}/${key}`, {
        headers: this.headers(),
      });
      const data = resp.data?.data?.data; // KV v2: { data: { data: { key: value } } }
      if (!data) return undefined;

      // If the secret has a single 'value' key, use it directly
      // Otherwise, JSON-stringify the whole object
      const value = data.value !== undefined ? String(data.value) : JSON.stringify(data);
      const metadata = resp.data?.data?.metadata;
      return {
        value,
        source: this.name,
        fetchedAt: new Date(),
        version: metadata?.version ? String(metadata.version) : undefined,
      };
    } catch (err: any) {
      if (err.response?.status === 404) return undefined;
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async list(): Promise<string[]> {
    if (!this.http || !this.token) throw new Error('VaultSecretsProvider not initialized');
    try {
      // KV v2 list: GET /v1/{mount}/metadata/?list=true
      const metadataPath = this.config.path!.replace('/data/', '/metadata/');
      const resp = await this.http.get(`/v1/${metadataPath}`, {
        headers: this.headers(),
        params: { list: true },
      });
      return resp.data?.data?.keys ?? [];
    } catch (err: any) {
      if (err.response?.status === 404) return [];
      throw err;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.http || !this.token) throw new Error('VaultSecretsProvider not initialized');
    await this.http.post(`/v1/${this.config.path}/${key}`, {
      data: { value },
    }, { headers: this.headers() });
  }

  async delete(key: string): Promise<void> {
    if (!this.http || !this.token) throw new Error('VaultSecretsProvider not initialized');
    const metadataPath = this.config.path!.replace('/data/', '/metadata/');
    await this.http.delete(`/v1/${metadataPath}/${key}`, {
      headers: this.headers(),
    });
  }

  async shutdown(): Promise<void> {
    this.http = null;
    this.token = null;
  }
}
