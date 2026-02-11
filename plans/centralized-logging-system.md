<!-- Completed: 2026-02-10 | Status: Implemented -->

# Centralized Logging System with Transport-Pluggable Architecture

## Summary

Replaced 1,347+ direct `console.*` calls with a centralized, transport-pluggable logging system built on Winston 3.x. Phase 1 implements the core module, REST API, and migrates ~37 console calls in the two highest-value files (Mirth.ts, EngineController.ts).

## What Was Built

### Core Module (`src/logging/`)
- **config.ts** — Env var parsing (LOG_LEVEL, MIRTH_DEBUG_COMPONENTS, LOG_FORMAT, LOG_FILE, LOG_TIMESTAMP_FORMAT)
- **DebugModeRegistry.ts** — Per-component debug toggle with runtime override
- **transports.ts** — LogTransport interface + ConsoleTransport + FileTransport
- **Logger.ts** — Dual-output logger (Winston + ServerLogController)
- **LoggerFactory.ts** — Named logger creation + Winston root setup
- **index.ts** — Barrel exports

### REST API (`src/api/servlets/LoggingServlet.ts`)
- GET /api/system/logging — Current global level + all component overrides
- PUT /api/system/logging/level — Set global level at runtime
- PUT /api/system/logging/components/:name — Set per-component override
- DELETE /api/system/logging/components/:name — Clear override

### Wiring
- `Mirth.ts` — initializeLogging() at startup, shutdownLogging() at stop, 25 console calls migrated
- `EngineController.ts` — 12 console calls migrated

## Architecture

```
getLogger('engine')  →  Logger  →  Winston (console/file/cloud)
                              ↘  ServerLogController (WebSocket streaming)
```

Level hierarchy: Per-component override > Global LOG_LEVEL
hookConsole() remains as backward-compatibility bridge for unmigrated console.* calls.

## Test Results

112 tests passing across 5 test suites:
- config.test.ts: 24 tests
- DebugModeRegistry.test.ts: 31 tests
- Logger.test.ts: 26 tests
- LoggerFactory.test.ts: 18 tests
- LoggingServlet.test.ts: 13 tests

## Agents Used

3 parallel agents across git worktrees, merged in dependency order:
1. logging-core (foundation) — 1,574 lines added
2. logging-api (REST API) — LoggingServlet + server.ts mount
3. logging-wiring (migration) — Mirth.ts + EngineController.ts

## Future Phases

| Phase | Scope | Est. Console Calls |
|-------|-------|-------------------|
| 2 | Donkey engine | ~16 |
| 3 | Connectors | ~60 |
| 4 | API servlets | ~150 |
| 5 | Plugins/cluster | ~80 |
| 6 | CLI (internal only) | ~15 |
