// Mock mysql2/promise (MirthMap.ts imports RowDataPacket type)
jest.mock('mysql2/promise', () => ({}));

// Mock cluster MapBackend (MirthMap.ts imports MapBackend type)
jest.mock('../../../../src/cluster/MapBackend.js', () => ({}));

import { createConfigMapFallback } from '../../../../src/secrets/integration/ConfigMapBackend.js';
import { SecretsManager } from '../../../../src/secrets/SecretsManager.js';
import { ConfigurationMap } from '../../../../src/javascript/userutil/MirthMap.js';

// Mock SecretsManager
jest.mock('../../../../src/secrets/SecretsManager.js');

const MockSecretsManager = SecretsManager as jest.Mocked<typeof SecretsManager>;

describe('ConfigMapBackend', () => {
  beforeEach(() => {
    ConfigurationMap.resetInstance();
    jest.clearAllMocks();
  });

  describe('createConfigMapFallback', () => {
    it('returns undefined when SecretsManager is not initialized', () => {
      MockSecretsManager.getInstance.mockReturnValue(null);
      const fallback = createConfigMapFallback();
      expect(fallback('DB_PASSWORD')).toBeUndefined();
    });

    it('returns value from SecretsManager.getSync()', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue('secret-value') } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);
      const fallback = createConfigMapFallback();
      expect(fallback('DB_PASSWORD')).toBe('secret-value');
      expect(mockMgr.getSync).toHaveBeenCalledWith('DB_PASSWORD');
    });

    it('returns undefined for unknown keys', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue(undefined) } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);
      const fallback = createConfigMapFallback();
      expect(fallback('UNKNOWN_KEY')).toBeUndefined();
    });
  });

  describe('ConfigurationMap with fallback', () => {
    it('returns database value first (priority over fallback)', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue('vault-value') } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const cfgMap = ConfigurationMap.getInstance();
      cfgMap.load({ DB_HOST: 'db.example.com' });
      cfgMap.setFallback(createConfigMapFallback());

      expect(cfgMap.get('DB_HOST')).toBe('db.example.com');
      expect(mockMgr.getSync).not.toHaveBeenCalled();
    });

    it('falls back to secrets when key not in database', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue('vault-password') } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const cfgMap = ConfigurationMap.getInstance();
      cfgMap.load({ DB_HOST: 'db.example.com' });
      cfgMap.setFallback(createConfigMapFallback());

      expect(cfgMap.get('DB_PASSWORD')).toBe('vault-password');
      expect(mockMgr.getSync).toHaveBeenCalledWith('DB_PASSWORD');
    });

    it('returns undefined when key not in database and not in secrets', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue(undefined) } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const cfgMap = ConfigurationMap.getInstance();
      cfgMap.setFallback(createConfigMapFallback());

      expect(cfgMap.get('TOTALLY_UNKNOWN')).toBeUndefined();
    });

    it('does not interfere with put()', () => {
      const mockMgr = { getSync: jest.fn() } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const cfgMap = ConfigurationMap.getInstance();
      cfgMap.setFallback(createConfigMapFallback());

      cfgMap.put('NEW_KEY', 'new-value');
      expect(cfgMap.get('NEW_KEY')).toBe('new-value');
      expect(mockMgr.getSync).not.toHaveBeenCalled();
    });

    it('does not interfere with containsKey()', () => {
      const cfgMap = ConfigurationMap.getInstance();
      cfgMap.load({ EXISTING: 'yes' });
      cfgMap.setFallback(createConfigMapFallback());

      expect(cfgMap.containsKey('EXISTING')).toBe(true);
      expect(cfgMap.containsKey('NOT_EXISTING')).toBe(false);
    });

    it('works without a fallback set', () => {
      const cfgMap = ConfigurationMap.getInstance();
      cfgMap.load({ A: '1' });
      expect(cfgMap.get('A')).toBe('1');
      expect(cfgMap.get('B')).toBeUndefined();
    });

    it('handles fallback returning falsy but defined values', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue('') } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const cfgMap = ConfigurationMap.getInstance();
      cfgMap.setFallback(createConfigMapFallback());

      // Empty string is still a defined value
      expect(cfgMap.get('EMPTY_SECRET')).toBe('');
    });
  });
});
