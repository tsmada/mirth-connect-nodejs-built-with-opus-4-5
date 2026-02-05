<!-- Completed: 2026-02-04 | Status: Implemented -->

# Mirth Connect Port Completion: Dual Operational Modes

## Overview

Add two operational modes to the Node.js Mirth runtime:
1. **Takeover Mode**: Connect to existing Java Mirth database (default)
2. **Standalone Mode**: Create database schema from scratch

This completes the port validation by ensuring the Node.js engine can operate independently or alongside existing Java Mirth deployments.

---

## Current State Assessment

### What's Complete ✅
- **95+ components** ported (connectors, data types, plugins, userutil)
- **2,521 tests** passing
- **14 REST API servlets** - 100% compatible with Java Mirth Administrator
- **Database layer** exists with full CRUD operations
- **All Priority 0-5 validation scenarios** documented as passing

### Critical Gap ❌
The system currently:
- Assumes all database tables already exist
- Does NOT create core schema on startup
- Does NOT auto-create per-channel tables on deploy (methods exist in `DonkeyDao.ts:82-170` but aren't called)
- Has no "mode" configuration

---

## Implementation Plan

### Phase 1: Create SchemaManager (New File)

**File**: `src/db/SchemaManager.ts`

**Purpose**: Centralized schema creation, mode detection, and initialization logic.

**Key Functions**:
```typescript
detectMode(): Promise<'takeover' | 'standalone'>
  - Check MIRTH_MODE env var first
  - Auto-detect: query information_schema for CHANNEL table

verifySchema(): Promise<{compatible: boolean; version: string; errors: string[]}>
  - Check SCHEMA_INFO version table
  - Verify required tables exist (CHANNEL, CONFIGURATION, PERSON, etc.)

ensureCoreTables(): Promise<void>
  - Create all core tables with IF NOT EXISTS
  - Based on Java Mirth's mysql-database.sql

seedDefaults(): Promise<void>
  - Create admin user (admin/admin)
  - Set server ID, default configuration values
  - Initialize empty global scripts

ensureChannelTables(channelId: string): Promise<void>
  - Register in D_CHANNELS
  - Call DonkeyDao.createChannelTables()
```

**Core Tables to Create**:
| Table | Purpose |
|-------|---------|
| SCHEMA_INFO | Version tracking |
| CHANNEL | Channel definitions |
| CONFIGURATION | Key-value settings |
| PERSON / PERSON_PASSWORD | Users |
| EVENT | Audit log |
| ALERT | Alert definitions |
| CODE_TEMPLATE / CODE_TEMPLATE_LIBRARY | Templates |
| CHANNEL_GROUP | Groupings |
| D_CHANNELS | Donkey channel registry |

---

### Phase 2: Modify Mirth.ts

**File**: `src/server/Mirth.ts`

**Changes**:
1. Add `mode` to `MirthConfig` interface
2. Read `MIRTH_MODE` environment variable (default: `auto`)
3. Call SchemaManager after database connection:

```typescript
// After initPool()
const mode = await SchemaManager.detectMode();
console.warn(`Operational mode: ${mode}`);

if (mode === 'standalone') {
  await SchemaManager.ensureCoreTables();
  await SchemaManager.seedDefaults();
} else {
  const result = await SchemaManager.verifySchema();
  if (!result.compatible) {
    throw new Error('Schema incompatible: ' + result.errors.join(', '));
  }
}
```

---

### Phase 3: Wire Channel Table Creation

**File**: `src/controllers/EngineController.ts`

**Changes to `deployChannel()` (line ~154)**:
```typescript
// Before building runtime channel
await SchemaManager.ensureChannelTables(channelId);
console.log(`Channel tables verified for ${channelConfig.name}`);
```

**Optional: Update `undeployChannel()`** to accept `dropTables` parameter for cleanup.

---

### Phase 4: Enhance DonkeyDao.ts

**File**: `src/db/DonkeyDao.ts`

**Minor Updates**:
1. Add `D_MCM{channelId}` (custom metadata) table to `createChannelTables()`
2. Add foreign key constraints matching Java schema
3. Add indexes for query performance
4. Update `dropChannelTables()` to include D_MCM

---

### Phase 5: Tests

**Unit Tests**: `tests/unit/db/SchemaManager.test.ts`
- Mode detection from environment
- Schema verification logic

**Integration Tests**: `tests/integration/db/SchemaManager.integration.test.ts`
- Fresh DB + standalone mode creates all tables
- Default seeding creates admin user
- Channel table creation on deploy

---

### Phase 6: Validation Scenarios

Add to `validation/scenarios/`:

**Scenario 6.1: Takeover Mode**
1. Start with Java Mirth database (docker-compose)
2. Start Node.js with `MIRTH_MODE=takeover`
3. Verify schema verification passes
4. Deploy channels, process messages

**Scenario 6.2: Standalone Mode**
1. Start with empty MySQL database
2. Start Node.js with `MIRTH_MODE=standalone`
3. Verify tables created
4. Import channel, deploy, process messages

**Scenario 6.3: Mode Auto-Detection**
1. Empty DB → detects standalone
2. Restart → detects takeover (tables exist)

---

## Files to Modify/Create

| File | Action | Lines Est. |
|------|--------|------------|
| `src/db/SchemaManager.ts` | **CREATE** | ~250 |
| `src/server/Mirth.ts` | Modify | +30 |
| `src/controllers/EngineController.ts` | Modify | +10 |
| `src/db/DonkeyDao.ts` | Modify | +40 |
| `tests/unit/db/SchemaManager.test.ts` | **CREATE** | ~100 |
| `tests/integration/db/SchemaManager.integration.test.ts` | **CREATE** | ~150 |
| `validation/scenarios/06-modes/` | **CREATE** | ~50 |

---

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `MIRTH_MODE` | `takeover`, `standalone`, `auto` | `auto` | Operational mode |
| `DB_HOST` | hostname | `localhost` | MySQL host |
| `DB_PORT` | number | `3306` | MySQL port |
| `DB_NAME` | string | `mirthdb` | Database name |
| `DB_USER` | string | `mirth` | Database user |
| `DB_PASSWORD` | string | `mirth` | Database password |

---

## Verification Plan

### Takeover Mode Verification
```bash
# 1. Start Java Mirth via Docker (creates schema)
cd validation && docker-compose up -d

# 2. Start Node.js Mirth in takeover mode
MIRTH_MODE=takeover PORT=8081 npm start

# 3. Verify existing channels deploy
curl http://localhost:8081/api/channels

# 4. Send test message
cd validation && npx ts-node quick-validate.ts
```

### Standalone Mode Verification
```bash
# 1. Create fresh MySQL database
docker run -d --name mirth-test-db -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=mirthdb_standalone -p 3307:3306 mysql:8

# 2. Start Node.js Mirth in standalone mode
MIRTH_MODE=standalone DB_PORT=3307 DB_NAME=mirthdb_standalone PORT=8082 npm start

# 3. Verify tables created
mysql -h localhost -P 3307 -u root -proot mirthdb_standalone -e "SHOW TABLES"

# 4. Login with admin/admin
curl -X POST http://localhost:8082/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Schema version mismatch | Log warning, don't fail for minor differences |
| Password hash compatibility | Use exact Java Mirth hash format |
| Foreign key issues | Test against actual Java Mirth 3.9 schema |
| Transaction isolation | Use IF NOT EXISTS for idempotency |

---

## Success Criteria

1. ✅ Node.js Mirth starts with `MIRTH_MODE=takeover` against Java Mirth DB
2. ✅ Node.js Mirth starts with `MIRTH_MODE=standalone` and creates all tables
3. ✅ Admin login works with default credentials in standalone mode
4. ✅ Channels can be imported, deployed, and process messages in both modes
5. ✅ All existing tests continue to pass
6. ✅ New integration tests verify both operational modes

---

## Parallel Agent Execution Strategy

### Architecture

Using git worktrees to enable true parallel execution (same pattern as successful Waves 1-5):

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PARENT SHELL (Coordinator)                       │
│  - Creates worktrees and branches                                   │
│  - Spawns child Claude agents in parallel                           │
│  - Monitors progress                                                │
│  - Merges branches in dependency order                              │
└─────────────────────────────────────────────────────────────────────┘
         │
         ├──► [Worktree 1: feature/schema-manager]      → Agent A
         ├──► [Worktree 2: feature/donkey-dao]          → Agent B
         ├──► [Worktree 3: feature/validation-modes]    → Agent C
         └──► [Worktree 4: feature/mode-integration]    → Agent D
```

### Agent Assignments

| Agent | Branch | Files (Isolated) | Dependencies |
|-------|--------|------------------|--------------|
| **A** | `feature/schema-manager` | `src/db/SchemaManager.ts` (NEW), `tests/unit/db/SchemaManager.test.ts` (NEW) | None - starts immediately |
| **B** | `feature/donkey-dao` | `src/db/DonkeyDao.ts` (MODIFY) | None - starts immediately |
| **C** | `feature/validation-modes` | `validation/scenarios/06-modes/*` (NEW) | None - starts immediately |
| **D** | `feature/mode-integration` | `src/server/Mirth.ts` (MODIFY), `src/controllers/EngineController.ts` (MODIFY), `tests/integration/db/SchemaManager.integration.test.ts` (NEW) | SchemaManager interface (provided in prompt) |

### Why This Avoids Conflicts

- **Agent A**: Creates NEW files only - no merge conflicts possible
- **Agent B**: Modifies `DonkeyDao.ts` only - isolated from other agents
- **Agent C**: Creates NEW files in `validation/` - no merge conflicts possible
- **Agent D**: Modifies `Mirth.ts` and `EngineController.ts` - no overlap with other agents

### Git Worktree Setup Commands

```bash
# Create worktrees from master
cd /Users/adamstruthers/Projects/mirth-connect-opus-4.5
git worktree add ../mirth-worktrees/schema-manager -b feature/schema-manager
git worktree add ../mirth-worktrees/donkey-dao -b feature/donkey-dao
git worktree add ../mirth-worktrees/validation-modes -b feature/validation-modes
git worktree add ../mirth-worktrees/mode-integration -b feature/mode-integration
```

### Merge Order (Dependency-Aware)

```
1. feature/donkey-dao       (independent - safe first)
2. feature/schema-manager   (adds new SchemaManager export)
3. feature/mode-integration (imports SchemaManager - must come after #2)
4. feature/validation-modes (independent - can merge anytime)
```

### Agent D Interface Contract

Agent D will import SchemaManager before it exists. Provide this interface in the prompt:

```typescript
// Expected interface from src/db/SchemaManager.ts
export type OperationalMode = 'takeover' | 'standalone';

export function detectMode(): Promise<OperationalMode>;
export function verifySchema(): Promise<{compatible: boolean; version: string | null; errors: string[]}>;
export function ensureCoreTables(): Promise<void>;
export function seedDefaults(): Promise<void>;
export function ensureChannelTables(channelId: string): Promise<void>;
export function channelTablesExist(channelId: string): Promise<boolean>;
```

### Cleanup After Merge

```bash
# Remove worktrees after successful merge
git worktree remove ../mirth-worktrees/schema-manager
git worktree remove ../mirth-worktrees/donkey-dao
git worktree remove ../mirth-worktrees/validation-modes
git worktree remove ../mirth-worktrees/mode-integration
```

---

## Reference Files

- `/Users/adamstruthers/Projects/mirth-connect-opus-4.5/src/server/Mirth.ts` - Main server lifecycle
- `/Users/adamstruthers/Projects/mirth-connect-opus-4.5/src/controllers/EngineController.ts` - Channel deployment
- `/Users/adamstruthers/Projects/mirth-connect-opus-4.5/src/db/DonkeyDao.ts` - Per-channel tables
- `/Users/adamstruthers/Projects/mirth-connect-opus-4.5/src/db/MirthDao.ts` - Core table operations
- `/Users/adamstruthers/Projects/connect/server/dbconf/mysql/mysql-database.sql` - Java schema reference
