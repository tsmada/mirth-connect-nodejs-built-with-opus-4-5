export interface SecretValue {
  value: string;
  source: string;
  fetchedAt: Date;
  version?: string;
  expiresAt?: Date;
}

export interface SecretsProvider {
  readonly name: string;
  initialize(): Promise<void>;
  get(key: string): Promise<SecretValue | undefined>;
  has(key: string): Promise<boolean>;
  list(): Promise<string[]>;
  set?(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
  shutdown(): Promise<void>;
}
