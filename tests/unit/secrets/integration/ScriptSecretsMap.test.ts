import { SecretsMap, createSecretsFunction, createSecretsMap } from '../../../../src/secrets/integration/ScriptSecretsMap.js';
import { SecretsManager } from '../../../../src/secrets/SecretsManager.js';

// Mock SecretsManager
jest.mock('../../../../src/secrets/SecretsManager.js');

const MockSecretsManager = SecretsManager as jest.Mocked<typeof SecretsManager>;

describe('ScriptSecretsMap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SecretsMap', () => {
    it('get() reads from SecretsManager sync cache', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue('vault-secret') } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const map = new SecretsMap();
      expect(map.get('API_KEY')).toBe('vault-secret');
      expect(mockMgr.getSync).toHaveBeenCalledWith('API_KEY');
    });

    it('get() returns undefined when manager not initialized', () => {
      MockSecretsManager.getInstance.mockReturnValue(null);

      const map = new SecretsMap();
      expect(map.get('API_KEY')).toBeUndefined();
    });

    it('containsKey() returns true for existing key', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue('value') } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const map = new SecretsMap();
      expect(map.containsKey('EXISTING')).toBe(true);
    });

    it('containsKey() returns false for missing key', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue(undefined) } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const map = new SecretsMap();
      expect(map.containsKey('MISSING')).toBe(false);
    });

    it('put() throws error', () => {
      const map = new SecretsMap();
      expect(() => map.put('key', 'value')).toThrow('$secrets is read-only');
    });
  });

  describe('createSecretsFunction', () => {
    it('returns a working function', () => {
      const mockMgr = { getSync: jest.fn().mockReturnValue('secret-val') } as any;
      MockSecretsManager.getInstance.mockReturnValue(mockMgr);

      const fn = createSecretsFunction();
      expect(fn('MY_SECRET')).toBe('secret-val');
    });

    it('returns undefined when manager not initialized', () => {
      MockSecretsManager.getInstance.mockReturnValue(null);

      const fn = createSecretsFunction();
      expect(fn('MY_SECRET')).toBeUndefined();
    });
  });

  describe('createSecretsMap', () => {
    it('returns a SecretsMap instance', () => {
      const map = createSecretsMap();
      expect(map).toBeInstanceOf(SecretsMap);
    });
  });
});
