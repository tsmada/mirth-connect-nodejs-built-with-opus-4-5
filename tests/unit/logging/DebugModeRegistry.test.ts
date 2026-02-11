import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  registerComponent,
  setComponentLevel,
  clearComponentLevel,
  getEffectiveLevel,
  shouldLog,
  getRegisteredComponents,
  initFromEnv,
  resetDebugRegistry,
} from '../../../src/logging/DebugModeRegistry.js';
import { LogLevel } from '../../../src/plugins/serverlog/ServerLogItem.js';

describe('DebugModeRegistry', () => {
  beforeEach(() => {
    resetDebugRegistry();
  });

  describe('registerComponent', () => {
    it('should register a component', () => {
      registerComponent('donkey-engine', 'Donkey message processing engine');
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components).toHaveLength(1);
      expect(components[0]!.name).toBe('donkey-engine');
      expect(components[0]!.description).toBe('Donkey message processing engine');
    });

    it('should register multiple components', () => {
      registerComponent('donkey-engine', 'Engine');
      registerComponent('mllp-connector', 'MLLP connector');
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components).toHaveLength(2);
    });

    it('should register with a default level override', () => {
      registerComponent('debug-component', 'Always debug', LogLevel.DEBUG);
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components[0]!.effectiveLevel).toBe(LogLevel.DEBUG);
      expect(components[0]!.hasOverride).toBe(true);
    });

    it('should overwrite existing registration', () => {
      registerComponent('engine', 'Old desc');
      registerComponent('engine', 'New desc');
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components).toHaveLength(1);
      expect(components[0]!.description).toBe('New desc');
    });
  });

  describe('setComponentLevel', () => {
    it('should set level override for registered component', () => {
      registerComponent('engine', 'Engine');
      setComponentLevel('engine', LogLevel.TRACE);
      expect(getEffectiveLevel('engine', LogLevel.INFO)).toBe(LogLevel.TRACE);
    });

    it('should auto-register unknown component', () => {
      setComponentLevel('new-component', LogLevel.DEBUG);
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components).toHaveLength(1);
      expect(components[0]!.name).toBe('new-component');
      expect(components[0]!.effectiveLevel).toBe(LogLevel.DEBUG);
    });
  });

  describe('clearComponentLevel', () => {
    it('should remove level override, reverting to global', () => {
      registerComponent('engine', 'Engine');
      setComponentLevel('engine', LogLevel.TRACE);
      expect(getEffectiveLevel('engine', LogLevel.INFO)).toBe(LogLevel.TRACE);

      clearComponentLevel('engine');
      expect(getEffectiveLevel('engine', LogLevel.INFO)).toBe(LogLevel.INFO);
    });

    it('should be a no-op for unregistered component', () => {
      clearComponentLevel('nonexistent');
      // Should not throw
      expect(getEffectiveLevel('nonexistent', LogLevel.INFO)).toBe(LogLevel.INFO);
    });
  });

  describe('getEffectiveLevel', () => {
    it('should return global level when no override', () => {
      registerComponent('engine', 'Engine');
      expect(getEffectiveLevel('engine', LogLevel.WARN)).toBe(LogLevel.WARN);
    });

    it('should return override when set', () => {
      registerComponent('engine', 'Engine');
      setComponentLevel('engine', LogLevel.DEBUG);
      expect(getEffectiveLevel('engine', LogLevel.WARN)).toBe(LogLevel.DEBUG);
    });

    it('should return global level for unregistered component', () => {
      expect(getEffectiveLevel('unknown', LogLevel.ERROR)).toBe(LogLevel.ERROR);
    });
  });

  describe('shouldLog', () => {
    it('should allow ERROR when global is INFO', () => {
      expect(shouldLog('comp', LogLevel.ERROR, LogLevel.INFO)).toBe(true);
    });

    it('should allow INFO when global is INFO', () => {
      expect(shouldLog('comp', LogLevel.INFO, LogLevel.INFO)).toBe(true);
    });

    it('should reject DEBUG when global is INFO', () => {
      expect(shouldLog('comp', LogLevel.DEBUG, LogLevel.INFO)).toBe(false);
    });

    it('should reject TRACE when global is INFO', () => {
      expect(shouldLog('comp', LogLevel.TRACE, LogLevel.INFO)).toBe(false);
    });

    it('should allow DEBUG when component override is DEBUG', () => {
      setComponentLevel('comp', LogLevel.DEBUG);
      expect(shouldLog('comp', LogLevel.DEBUG, LogLevel.INFO)).toBe(true);
    });

    it('should allow TRACE when component override is TRACE', () => {
      setComponentLevel('comp', LogLevel.TRACE);
      expect(shouldLog('comp', LogLevel.TRACE, LogLevel.ERROR)).toBe(true);
    });

    it('should reject DEBUG when component override is WARN', () => {
      setComponentLevel('comp', LogLevel.WARN);
      expect(shouldLog('comp', LogLevel.DEBUG, LogLevel.INFO)).toBe(false);
    });
  });

  describe('getRegisteredComponents', () => {
    it('should return empty array when no components registered', () => {
      expect(getRegisteredComponents(LogLevel.INFO)).toEqual([]);
    });

    it('should return components sorted by name', () => {
      registerComponent('z-component', 'Z');
      registerComponent('a-component', 'A');
      registerComponent('m-component', 'M');
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components.map((c) => c.name)).toEqual([
        'a-component',
        'm-component',
        'z-component',
      ]);
    });

    it('should show hasOverride=false when using global level', () => {
      registerComponent('engine', 'Engine');
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components[0]!.hasOverride).toBe(false);
      expect(components[0]!.effectiveLevel).toBe(LogLevel.INFO);
    });

    it('should show hasOverride=true when override is set', () => {
      registerComponent('engine', 'Engine');
      setComponentLevel('engine', LogLevel.TRACE);
      const components = getRegisteredComponents(LogLevel.INFO);
      expect(components[0]!.hasOverride).toBe(true);
      expect(components[0]!.effectiveLevel).toBe(LogLevel.TRACE);
    });

    it('should reflect global level for non-overridden components', () => {
      registerComponent('engine', 'Engine');
      expect(getRegisteredComponents(LogLevel.WARN)[0]!.effectiveLevel).toBe(LogLevel.WARN);
      expect(getRegisteredComponents(LogLevel.DEBUG)[0]!.effectiveLevel).toBe(LogLevel.DEBUG);
    });
  });

  describe('initFromEnv', () => {
    it('should set DEBUG by default for component without level suffix', () => {
      initFromEnv(['donkey-engine']);
      expect(getEffectiveLevel('donkey-engine', LogLevel.INFO)).toBe(LogLevel.DEBUG);
    });

    it('should parse component:LEVEL format', () => {
      initFromEnv(['donkey-engine:TRACE']);
      expect(getEffectiveLevel('donkey-engine', LogLevel.INFO)).toBe(LogLevel.TRACE);
    });

    it('should parse multiple entries', () => {
      initFromEnv(['donkey-engine:TRACE', 'mllp-connector:DEBUG', 'http-connector']);
      expect(getEffectiveLevel('donkey-engine', LogLevel.INFO)).toBe(LogLevel.TRACE);
      expect(getEffectiveLevel('mllp-connector', LogLevel.INFO)).toBe(LogLevel.DEBUG);
      expect(getEffectiveLevel('http-connector', LogLevel.INFO)).toBe(LogLevel.DEBUG);
    });

    it('should handle WARN level suffix', () => {
      initFromEnv(['noisy-component:WARN']);
      expect(getEffectiveLevel('noisy-component', LogLevel.INFO)).toBe(LogLevel.WARN);
    });

    it('should handle ERROR level suffix', () => {
      initFromEnv(['quiet-component:ERROR']);
      expect(getEffectiveLevel('quiet-component', LogLevel.INFO)).toBe(LogLevel.ERROR);
    });

    it('should default to DEBUG for invalid level suffix', () => {
      initFromEnv(['component:INVALID']);
      expect(getEffectiveLevel('component', LogLevel.INFO)).toBe(LogLevel.DEBUG);
    });

    it('should handle empty array', () => {
      initFromEnv([]);
      expect(getRegisteredComponents(LogLevel.INFO)).toEqual([]);
    });
  });

  describe('resetDebugRegistry', () => {
    it('should clear all registrations', () => {
      registerComponent('a', 'A');
      registerComponent('b', 'B');
      setComponentLevel('a', LogLevel.TRACE);
      resetDebugRegistry();
      expect(getRegisteredComponents(LogLevel.INFO)).toEqual([]);
    });
  });
});
