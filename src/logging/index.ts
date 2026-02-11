/**
 * Logging module stub
 *
 * Minimal stub providing the functions LoggingServlet needs.
 * Replaced by the real logging module when the logging-core branch merges.
 */

import { LogLevel } from '../plugins/serverlog/ServerLogItem.js';

let globalLevel: LogLevel = LogLevel.INFO;

const componentOverrides = new Map<string, { name: string; description: string; levelOverride?: LogLevel }>();

export function getGlobalLevel(): LogLevel {
  return globalLevel;
}

export function setGlobalLevel(level: LogLevel): void {
  globalLevel = level;
}

export function registerComponent(name: string, description: string): void {
  if (!componentOverrides.has(name)) {
    componentOverrides.set(name, { name, description });
  }
}

export function setComponentLevel(name: string, level: LogLevel): void {
  const entry = componentOverrides.get(name);
  if (entry) {
    entry.levelOverride = level;
  } else {
    componentOverrides.set(name, { name, description: '', levelOverride: level });
  }
}

export function clearComponentLevel(name: string): void {
  const entry = componentOverrides.get(name);
  if (entry) {
    delete entry.levelOverride;
  }
}

export function getRegisteredComponents(currentGlobalLevel: LogLevel): Array<{
  name: string;
  description: string;
  effectiveLevel: LogLevel;
  hasOverride: boolean;
}> {
  const result: Array<{ name: string; description: string; effectiveLevel: LogLevel; hasOverride: boolean }> = [];
  for (const [, entry] of componentOverrides) {
    result.push({
      name: entry.name,
      description: entry.description,
      effectiveLevel: entry.levelOverride ?? currentGlobalLevel,
      hasOverride: entry.levelOverride !== undefined,
    });
  }
  return result;
}

export function getLogger(_component: string): { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void } {
  return {
    info: (..._args: unknown[]) => { /* no-op stub */ },
    warn: (..._args: unknown[]) => { /* no-op stub */ },
    error: (..._args: unknown[]) => { /* no-op stub */ },
    debug: (..._args: unknown[]) => { /* no-op stub */ },
  };
}

export function initializeLogging(): void { /* stub */ }
export function shutdownLogging(): Promise<void> { return Promise.resolve(); }
export function resetLogging(): void {
  globalLevel = LogLevel.INFO;
  componentOverrides.clear();
}

export function resetDebugRegistry(): void {
  componentOverrides.clear();
}

export function resetLoggingConfig(): void {
  globalLevel = LogLevel.INFO;
}
