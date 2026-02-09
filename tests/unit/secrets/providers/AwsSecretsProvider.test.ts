import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AwsSecretsProvider } from '../../../../src/secrets/providers/AwsSecretsProvider.js';

describe('AwsSecretsProvider', () => {
  let provider: AwsSecretsProvider;
  let mockSend: jest.Mock<(...args: any[]) => Promise<any>>;
  // Mock command constructors that pass through their args
  const MockCommand = jest.fn((args: any) => args);
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    mockSend = jest.fn<(...args: any[]) => Promise<any>>();
    provider = new AwsSecretsProvider('us-west-2', 'mirth/');
    // Bypass dynamic import by injecting mock client and commands directly
    (provider as any).client = { send: mockSend };
    (provider as any).commands = {
      GetSecretValueCommand: MockCommand,
      ListSecretsCommand: MockCommand,
      PutSecretValueCommand: MockCommand,
      CreateSecretCommand: MockCommand,
      DeleteSecretCommand: MockCommand,
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await provider.shutdown();
  });

  it('should have name "aws"', () => {
    expect(provider.name).toBe('aws');
  });

  it('should use AWS_REGION env var when no region specified', () => {
    process.env['AWS_REGION'] = 'eu-west-1';
    const envProvider = new AwsSecretsProvider();
    expect((envProvider as any).region).toBe('eu-west-1');
  });

  it('should default to us-east-1 when no region env vars set', () => {
    delete process.env['AWS_REGION'];
    delete process.env['AWS_DEFAULT_REGION'];
    const defaultProvider = new AwsSecretsProvider();
    expect((defaultProvider as any).region).toBe('us-east-1');
  });

  it('should use AWS_DEFAULT_REGION as fallback', () => {
    delete process.env['AWS_REGION'];
    process.env['AWS_DEFAULT_REGION'] = 'ap-southeast-1';
    const defaultProvider = new AwsSecretsProvider();
    expect((defaultProvider as any).region).toBe('ap-southeast-1');
  });

  describe('get()', () => {
    it('should return plain string secret', async () => {
      mockSend.mockResolvedValueOnce({
        SecretString: 'my-password',
        VersionId: 'v1',
      });

      const result = await provider.get('db_password');
      expect(result).toBeDefined();
      expect(result!.value).toBe('my-password');
      expect(result!.source).toBe('aws');
      expect(result!.version).toBe('v1');
      expect(result!.fetchedAt).toBeInstanceOf(Date);
    });

    it('should use prefix in SecretId', async () => {
      mockSend.mockResolvedValueOnce({
        SecretString: 'value',
      });

      await provider.get('my_key');
      // MockCommand receives { SecretId: 'mirth/my_key' }
      expect(MockCommand).toHaveBeenCalledWith({
        SecretId: 'mirth/my_key',
      });
    });

    it('should parse JSON secret and extract the key', async () => {
      mockSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({ db_password: 'json-value', other: 'stuff' }),
        VersionId: 'v2',
      });

      const result = await provider.get('db_password');
      expect(result).toBeDefined();
      expect(result!.value).toBe('json-value');
    });

    it('should return full JSON string when key not found in JSON', async () => {
      const jsonStr = JSON.stringify({ user: 'admin', pass: 'secret' });
      mockSend.mockResolvedValueOnce({
        SecretString: jsonStr,
        VersionId: 'v3',
      });

      const result = await provider.get('missing_key');
      expect(result).toBeDefined();
      expect(result!.value).toBe(jsonStr);
    });

    it('should handle binary secrets', async () => {
      mockSend.mockResolvedValueOnce({
        SecretBinary: Buffer.from('binary-secret'),
        VersionId: 'v4',
      });

      const result = await provider.get('binary_key');
      expect(result).toBeDefined();
      expect(result!.value).toBe('binary-secret');
    });

    it('should return undefined for ResourceNotFoundException', async () => {
      const err = new Error('Not found');
      (err as any).name = 'ResourceNotFoundException';
      mockSend.mockRejectedValueOnce(err);

      const result = await provider.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined when no SecretString or SecretBinary', async () => {
      mockSend.mockResolvedValueOnce({
        VersionId: 'v5',
      });

      const result = await provider.get('empty');
      expect(result).toBeUndefined();
    });

    it('should rethrow non-404 errors', async () => {
      const err = new Error('Access denied');
      (err as any).name = 'AccessDeniedException';
      mockSend.mockRejectedValueOnce(err);

      await expect(provider.get('forbidden')).rejects.toThrow('Access denied');
    });

    it('should throw if not initialized', async () => {
      const uninit = new AwsSecretsProvider();
      await expect(uninit.get('key')).rejects.toThrow('not initialized');
    });
  });

  describe('has()', () => {
    it('should return true when secret exists', async () => {
      mockSend.mockResolvedValueOnce({ SecretString: 'value' });
      expect(await provider.has('exists')).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      const err = new Error('Not found');
      (err as any).name = 'ResourceNotFoundException';
      mockSend.mockRejectedValueOnce(err);
      expect(await provider.has('missing')).toBe(false);
    });
  });

  describe('list()', () => {
    it('should list secrets with prefix filtering', async () => {
      mockSend.mockResolvedValueOnce({
        SecretList: [
          { Name: 'mirth/db_password' },
          { Name: 'mirth/api_key' },
          { Name: 'other/secret' },
        ],
        NextToken: undefined,
      });

      const keys = await provider.list();
      expect(keys).toEqual(['db_password', 'api_key']);
    });

    it('should handle pagination', async () => {
      mockSend
        .mockResolvedValueOnce({
          SecretList: [{ Name: 'mirth/secret1' }],
          NextToken: 'page2',
        })
        .mockResolvedValueOnce({
          SecretList: [{ Name: 'mirth/secret2' }],
          NextToken: undefined,
        });

      const keys = await provider.list();
      expect(keys).toEqual(['secret1', 'secret2']);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle empty SecretList', async () => {
      mockSend.mockResolvedValueOnce({
        SecretList: [],
        NextToken: undefined,
      });

      const keys = await provider.list();
      expect(keys).toEqual([]);
    });

    it('should throw if not initialized', async () => {
      const uninit = new AwsSecretsProvider();
      await expect(uninit.list()).rejects.toThrow('not initialized');
    });
  });

  describe('set()', () => {
    it('should update existing secret', async () => {
      mockSend.mockResolvedValueOnce({});

      await provider.set!('db_password', 'new-value');
      expect(mockSend).toHaveBeenCalledTimes(1);
      // Verify PutSecretValueCommand was constructed with correct args
      expect(MockCommand).toHaveBeenCalledWith({
        SecretId: 'mirth/db_password',
        SecretString: 'new-value',
      });
    });

    it('should create new secret on ResourceNotFoundException', async () => {
      const err = new Error('Not found');
      (err as any).name = 'ResourceNotFoundException';
      mockSend.mockRejectedValueOnce(err).mockResolvedValueOnce({});

      await provider.set!('new_secret', 'value');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should rethrow non-404 errors on set', async () => {
      const err = new Error('Limit exceeded');
      (err as any).name = 'LimitExceededException';
      mockSend.mockRejectedValueOnce(err);

      await expect(provider.set!('key', 'value')).rejects.toThrow('Limit exceeded');
    });

    it('should throw if not initialized', async () => {
      const uninit = new AwsSecretsProvider();
      await expect(uninit.set!('key', 'val')).rejects.toThrow('not initialized');
    });
  });

  describe('delete()', () => {
    it('should delete secret with force flag', async () => {
      mockSend.mockResolvedValueOnce({});

      await provider.delete!('old_secret');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(MockCommand).toHaveBeenCalledWith({
        SecretId: 'mirth/old_secret',
        ForceDeleteWithoutRecovery: true,
      });
    });

    it('should throw if not initialized', async () => {
      const uninit = new AwsSecretsProvider();
      await expect(uninit.delete!('key')).rejects.toThrow('not initialized');
    });
  });

  describe('shutdown()', () => {
    it('should clear client and commands on shutdown', async () => {
      await provider.shutdown();
      expect((provider as any).client).toBeNull();
      expect((provider as any).commands).toBeNull();
      await expect(provider.get('key')).rejects.toThrow('not initialized');
    });
  });
});
