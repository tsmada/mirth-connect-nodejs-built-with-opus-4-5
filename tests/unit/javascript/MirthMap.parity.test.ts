/**
 * Wave 12 parity tests for MirthMap — SourceMap.put() behavior
 */
import { SourceMap } from '../../../src/javascript/userutil/MirthMap';

describe('MirthMap Wave 12 Parity Fixes', () => {
  describe('JRC-TCD-004 — SourceMap.put() no warning', () => {
    it('should not log a warning on put()', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const sourceMap = new SourceMap();

      sourceMap.put('key', 'value');

      // Java SourceMap.put() is a plain delegate — no warning
      expect(warnSpy).not.toHaveBeenCalled();
      expect(sourceMap.get('key')).toBe('value');

      warnSpy.mockRestore();
    });

    it('should allow multiple puts without warnings', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const sourceMap = new SourceMap();

      sourceMap.put('a', 1);
      sourceMap.put('b', 2);
      sourceMap.put('a', 3);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(sourceMap.get('a')).toBe(3);
      expect(sourceMap.get('b')).toBe(2);

      warnSpy.mockRestore();
    });

    it('should return previous value on put() like parent class', () => {
      const sourceMap = new SourceMap();
      sourceMap.put('key', 'old');
      const prev = sourceMap.put('key', 'new');
      expect(prev).toBe('old');
    });
  });
});
