import { Status, isFinalStatus, parseStatus, STATUS_DESCRIPTIONS } from '../../../src/model/Status';

describe('Status', () => {
  describe('Status enum values', () => {
    it('should have correct single-character values', () => {
      expect(Status.RECEIVED).toBe('R');
      expect(Status.FILTERED).toBe('F');
      expect(Status.TRANSFORMED).toBe('T');
      expect(Status.SENT).toBe('S');
      expect(Status.QUEUED).toBe('Q');
      expect(Status.ERROR).toBe('E');
      expect(Status.PENDING).toBe('P');
    });

    it('should have all 7 status values', () => {
      expect(Object.values(Status).length).toBe(7);
    });
  });

  describe('STATUS_DESCRIPTIONS', () => {
    it('should have descriptions for all statuses', () => {
      for (const status of Object.values(Status)) {
        expect(STATUS_DESCRIPTIONS[status]).toBeDefined();
        expect(typeof STATUS_DESCRIPTIONS[status]).toBe('string');
      }
    });
  });

  describe('isFinalStatus', () => {
    it('should return true for SENT', () => {
      expect(isFinalStatus(Status.SENT)).toBe(true);
    });

    it('should return true for FILTERED', () => {
      expect(isFinalStatus(Status.FILTERED)).toBe(true);
    });

    it('should return true for ERROR', () => {
      expect(isFinalStatus(Status.ERROR)).toBe(true);
    });

    it('should return false for RECEIVED', () => {
      expect(isFinalStatus(Status.RECEIVED)).toBe(false);
    });

    it('should return false for TRANSFORMED', () => {
      expect(isFinalStatus(Status.TRANSFORMED)).toBe(false);
    });

    it('should return false for QUEUED', () => {
      expect(isFinalStatus(Status.QUEUED)).toBe(false);
    });

    it('should return false for PENDING', () => {
      expect(isFinalStatus(Status.PENDING)).toBe(false);
    });
  });

  describe('parseStatus', () => {
    it('should parse valid status characters', () => {
      expect(parseStatus('R')).toBe(Status.RECEIVED);
      expect(parseStatus('F')).toBe(Status.FILTERED);
      expect(parseStatus('T')).toBe(Status.TRANSFORMED);
      expect(parseStatus('S')).toBe(Status.SENT);
      expect(parseStatus('Q')).toBe(Status.QUEUED);
      expect(parseStatus('E')).toBe(Status.ERROR);
      expect(parseStatus('P')).toBe(Status.PENDING);
    });

    it('should throw for invalid status characters', () => {
      expect(() => parseStatus('X')).toThrow('Unknown status character: X');
      expect(() => parseStatus('')).toThrow('Unknown status character: ');
      expect(() => parseStatus('r')).toThrow('Unknown status character: r');
    });
  });
});
