/**
 * Debug Mode Registry
 *
 * Per-component log level override management.
 * Follows ShadowMode.ts pattern: module-scoped state, exported functions, reset for testing.
 *
 * Components register themselves at startup (e.g., "donkey-engine", "mllp-connector").
 * Operators can then selectively enable DEBUG/TRACE logging for specific components
 * without flooding the entire log output.
 */

import { LogLevel, shouldDisplayLogLevel } from '../plugins/serverlog/ServerLogItem.js';

interface ComponentRegistration {
  name: string;
  description: string;
  levelOverride?: LogLevel;
}

const registry = new Map<string, ComponentRegistration>();

/**
 * Register a loggable component.
 * Called at module initialization to declare a component's existence.
 */
export function registerComponent(name: string, description: string, defaultLevel?: LogLevel): void {
  registry.set(name, {
    name,
    description,
    levelOverride: defaultLevel,
  });
}

/**
 * Set a log level override for a specific component.
 * This overrides the global level for this component only.
 */
export function setComponentLevel(name: string, level: LogLevel): void {
  const existing = registry.get(name);
  if (existing) {
    existing.levelOverride = level;
  } else {
    // Auto-register if not yet known
    registry.set(name, { name, description: name, levelOverride: level });
  }
}

/**
 * Clear a component's level override, reverting to global level.
 */
export function clearComponentLevel(name: string): void {
  const existing = registry.get(name);
  if (existing) {
    existing.levelOverride = undefined;
  }
}

/**
 * Get the effective log level for a component.
 * Returns the component's override if set, otherwise the global level.
 */
export function getEffectiveLevel(name: string, globalLevel: LogLevel): LogLevel {
  const registration = registry.get(name);
  if (registration?.levelOverride) {
    return registration.levelOverride;
  }
  return globalLevel;
}

/**
 * Check if a log message at the given level should be emitted for a component.
 */
export function shouldLog(name: string, messageLevel: LogLevel, globalLevel: LogLevel): boolean {
  const effectiveLevel = getEffectiveLevel(name, globalLevel);
  return shouldDisplayLogLevel(messageLevel, effectiveLevel);
}

/**
 * Get all registered components with their effective levels.
 */
export function getRegisteredComponents(globalLevel: LogLevel): Array<{
  name: string;
  description: string;
  effectiveLevel: LogLevel;
  hasOverride: boolean;
}> {
  const result: Array<{
    name: string;
    description: string;
    effectiveLevel: LogLevel;
    hasOverride: boolean;
  }> = [];

  for (const [, reg] of registry) {
    result.push({
      name: reg.name,
      description: reg.description,
      effectiveLevel: reg.levelOverride ?? globalLevel,
      hasOverride: reg.levelOverride !== undefined,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Initialize component debug overrides from environment config.
 * Parses entries like: ["donkey-engine", "mllp-connector:TRACE", "http-connector:DEBUG"]
 * Components without a level suffix get DEBUG by default.
 */
export function initFromEnv(debugComponents: string[]): void {
  for (const entry of debugComponents) {
    const colonIndex = entry.lastIndexOf(':');
    if (colonIndex > 0) {
      const name = entry.substring(0, colonIndex);
      const levelStr = entry.substring(colonIndex + 1).toUpperCase();
      const level = parseLevel(levelStr);
      setComponentLevel(name, level);
    } else {
      // No level specified — default to DEBUG
      setComponentLevel(entry, LogLevel.DEBUG);
    }
  }
}

function parseLevel(str: string): LogLevel {
  switch (str) {
    case 'TRACE': return LogLevel.TRACE;
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO': return LogLevel.INFO;
    case 'WARN': return LogLevel.WARN;
    case 'ERROR': return LogLevel.ERROR;
    default: return LogLevel.DEBUG;
  }
}

/**
 * Reset all registry state (for testing)
 */
export function resetDebugRegistry(): void {
  registry.clear();
}
