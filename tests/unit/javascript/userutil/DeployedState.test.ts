/**
 * Unit tests for DeployedState enum and utilities
 */

import {
  DeployedState,
  DEPLOYED_STATE_DESCRIPTIONS,
  parseDeployedState,
  isActiveState,
  isTransitionalState,
} from '../../../../src/javascript/userutil/DeployedState.js';

describe('DeployedState', () => {
  describe('enum values', () => {
    it('should have all expected states', () => {
      expect(DeployedState.STARTED).toBe('STARTED');
      expect(DeployedState.STOPPED).toBe('STOPPED');
      expect(DeployedState.PAUSED).toBe('PAUSED');
      expect(DeployedState.STARTING).toBe('STARTING');
      expect(DeployedState.STOPPING).toBe('STOPPING');
      expect(DeployedState.UNKNOWN).toBe('UNKNOWN');
    });
  });

  describe('DEPLOYED_STATE_DESCRIPTIONS', () => {
    it('should have descriptions for all states', () => {
      expect(DEPLOYED_STATE_DESCRIPTIONS[DeployedState.STARTED]).toBe('Started');
      expect(DEPLOYED_STATE_DESCRIPTIONS[DeployedState.STOPPED]).toBe('Stopped');
      expect(DEPLOYED_STATE_DESCRIPTIONS[DeployedState.PAUSED]).toBe('Paused');
      expect(DEPLOYED_STATE_DESCRIPTIONS[DeployedState.STARTING]).toBe('Starting');
      expect(DEPLOYED_STATE_DESCRIPTIONS[DeployedState.STOPPING]).toBe('Stopping');
      expect(DEPLOYED_STATE_DESCRIPTIONS[DeployedState.UNKNOWN]).toBe('Unknown');
    });
  });

  describe('parseDeployedState', () => {
    it('should parse valid state strings', () => {
      expect(parseDeployedState('STARTED')).toBe(DeployedState.STARTED);
      expect(parseDeployedState('STOPPED')).toBe(DeployedState.STOPPED);
      expect(parseDeployedState('PAUSED')).toBe(DeployedState.PAUSED);
      expect(parseDeployedState('STARTING')).toBe(DeployedState.STARTING);
      expect(parseDeployedState('STOPPING')).toBe(DeployedState.STOPPING);
      expect(parseDeployedState('UNKNOWN')).toBe(DeployedState.UNKNOWN);
    });

    it('should be case-insensitive', () => {
      expect(parseDeployedState('started')).toBe(DeployedState.STARTED);
      expect(parseDeployedState('Started')).toBe(DeployedState.STARTED);
      expect(parseDeployedState('STARTED')).toBe(DeployedState.STARTED);
    });

    it('should return UNKNOWN for invalid strings', () => {
      expect(parseDeployedState('INVALID')).toBe(DeployedState.UNKNOWN);
      expect(parseDeployedState('')).toBe(DeployedState.UNKNOWN);
      expect(parseDeployedState('foo')).toBe(DeployedState.UNKNOWN);
    });
  });

  describe('isActiveState', () => {
    it('should return true for STARTED', () => {
      expect(isActiveState(DeployedState.STARTED)).toBe(true);
    });

    it('should return false for non-active states', () => {
      expect(isActiveState(DeployedState.STOPPED)).toBe(false);
      expect(isActiveState(DeployedState.PAUSED)).toBe(false);
      expect(isActiveState(DeployedState.STARTING)).toBe(false);
      expect(isActiveState(DeployedState.STOPPING)).toBe(false);
      expect(isActiveState(DeployedState.UNKNOWN)).toBe(false);
    });
  });

  describe('isTransitionalState', () => {
    it('should return true for STARTING and STOPPING', () => {
      expect(isTransitionalState(DeployedState.STARTING)).toBe(true);
      expect(isTransitionalState(DeployedState.STOPPING)).toBe(true);
    });

    it('should return false for non-transitional states', () => {
      expect(isTransitionalState(DeployedState.STARTED)).toBe(false);
      expect(isTransitionalState(DeployedState.STOPPED)).toBe(false);
      expect(isTransitionalState(DeployedState.PAUSED)).toBe(false);
      expect(isTransitionalState(DeployedState.UNKNOWN)).toBe(false);
    });
  });
});
