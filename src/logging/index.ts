import { LogLevel } from '../plugins/serverlog/ServerLogItem.js';

// Minimal stub -- replaced by real module after merge with logging-core branch

class StubLogger {
  constructor(private component: string) {}
  trace(message: string, _metadata?: Record<string, unknown>): void { /* no-op */ }
  debug(message: string, _metadata?: Record<string, unknown>): void { /* no-op */ }
  info(message: string, _metadata?: Record<string, unknown>): void {
    process.stdout.write(`INFO  [${this.component}] ${message}\n`);
  }
  warn(message: string, _metadata?: Record<string, unknown>): void {
    process.stdout.write(`WARN  [${this.component}] ${message}\n`);
  }
  error(message: string, error?: Error, _metadata?: Record<string, unknown>): void {
    process.stdout.write(`ERROR [${this.component}] ${message}\n`);
    if (error?.stack) process.stdout.write(error.stack + '\n');
  }
  isDebugEnabled(): boolean { return false; }
  isTraceEnabled(): boolean { return false; }
  child(sub: string): StubLogger { return new StubLogger(`${this.component}:${sub}`); }
}

const loggers = new Map<string, StubLogger>();

export function getLogger(component: string): StubLogger {
  if (!loggers.has(component)) {
    loggers.set(component, new StubLogger(component));
  }
  return loggers.get(component)!;
}

export function initializeLogging(_controller?: unknown, _additionalTransports?: unknown[]): void { /* stub */ }
export function shutdownLogging(): Promise<void> { return Promise.resolve(); }
export function registerComponent(_name: string, _description: string): void { /* stub */ }
export function setGlobalLevel(_level: LogLevel): void { /* stub */ }
export function getGlobalLevel(): LogLevel { return LogLevel.INFO; }
export function resetLogging(): void { loggers.clear(); }
