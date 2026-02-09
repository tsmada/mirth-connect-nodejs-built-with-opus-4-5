import { resolveSecretReferences } from '../../../../src/secrets/integration/VariableResolverPlugin.js';
import { SecretsManager } from '../../../../src/secrets/SecretsManager.js';

// Mock SecretsManager
jest.mock('../../../../src/secrets/SecretsManager.js');

const MockSecretsManager = SecretsManager as jest.Mocked<typeof SecretsManager>;

describe('VariableResolverPlugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves ${secret:KEY} to provider value', async () => {
    const mockMgr = {
      resolve: jest.fn().mockResolvedValue({ value: 'my-password', source: 'vault', fetchedAt: new Date() }),
    } as any;
    MockSecretsManager.getInstance.mockReturnValue(mockMgr);

    const result = await resolveSecretReferences('host=${secret:DB_PASSWORD}');
    expect(result.resolved).toBe('host=my-password');
    expect(result.resolvedKeys).toContain('DB_PASSWORD');
    expect(result.unresolvedKeys).toHaveLength(0);
  });

  it('leaves unresolved references intact', async () => {
    const mockMgr = {
      resolve: jest.fn().mockResolvedValue(undefined),
    } as any;
    MockSecretsManager.getInstance.mockReturnValue(mockMgr);

    const result = await resolveSecretReferences('host=${secret:UNKNOWN}');
    expect(result.resolved).toBe('host=${secret:UNKNOWN}');
    expect(result.resolvedKeys).toHaveLength(0);
    expect(result.unresolvedKeys).toContain('UNKNOWN');
  });

  it('handles multiple references in same string', async () => {
    const mockMgr = {
      resolve: jest.fn().mockImplementation(async (key: string) => {
        const values: Record<string, string> = { USER: 'admin', PASS: 's3cret' };
        const v = values[key];
        return v ? { value: v, source: 'env', fetchedAt: new Date() } : undefined;
      }),
    } as any;
    MockSecretsManager.getInstance.mockReturnValue(mockMgr);

    const input = 'jdbc:mysql://${secret:USER}:${secret:PASS}@db:3306';
    const result = await resolveSecretReferences(input);
    expect(result.resolved).toBe('jdbc:mysql://admin:s3cret@db:3306');
    expect(result.resolvedKeys).toEqual(expect.arrayContaining(['USER', 'PASS']));
  });

  it('works with no SecretsManager (returns unchanged)', async () => {
    MockSecretsManager.getInstance.mockReturnValue(null);

    const input = 'pw=${secret:DB_PASSWORD}';
    const result = await resolveSecretReferences(input);
    expect(result.resolved).toBe(input);
    expect(result.unresolvedKeys).toContain('DB_PASSWORD');
  });

  it('resolves unique keys in parallel (deduplicates)', async () => {
    const mockMgr = {
      resolve: jest.fn().mockResolvedValue({ value: 'val', source: 'env', fetchedAt: new Date() }),
    } as any;
    MockSecretsManager.getInstance.mockReturnValue(mockMgr);

    const input = '${secret:KEY1} and ${secret:KEY1} and ${secret:KEY2}';
    const result = await resolveSecretReferences(input);
    expect(result.resolved).toBe('val and val and val');
    // KEY1 should only be resolved once despite appearing twice
    expect(mockMgr.resolve).toHaveBeenCalledTimes(2); // KEY1, KEY2
  });

  it('returns unchanged text when no secret references exist', async () => {
    MockSecretsManager.getInstance.mockReturnValue(null);

    const input = 'plain text with ${env:FOO} but no secret refs';
    const result = await resolveSecretReferences(input);
    expect(result.resolved).toBe(input);
    expect(result.resolvedKeys).toHaveLength(0);
    expect(result.unresolvedKeys).toHaveLength(0);
  });

  it('handles mixed resolved and unresolved keys', async () => {
    const mockMgr = {
      resolve: jest.fn().mockImplementation(async (key: string) => {
        if (key === 'KNOWN') return { value: 'found', source: 'env', fetchedAt: new Date() };
        return undefined;
      }),
    } as any;
    MockSecretsManager.getInstance.mockReturnValue(mockMgr);

    const input = '${secret:KNOWN}:${secret:MISSING}';
    const result = await resolveSecretReferences(input);
    expect(result.resolved).toBe('found:${secret:MISSING}');
    expect(result.resolvedKeys).toContain('KNOWN');
    expect(result.unresolvedKeys).toContain('MISSING');
  });

  it('handles empty input', async () => {
    MockSecretsManager.getInstance.mockReturnValue(null);

    const result = await resolveSecretReferences('');
    expect(result.resolved).toBe('');
    expect(result.resolvedKeys).toHaveLength(0);
    expect(result.unresolvedKeys).toHaveLength(0);
  });
});
