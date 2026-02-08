<!-- Completed: 2026-02-08 | Status: Implemented | Wave 7: 7 agents, 417 tests, ~5,400 lines -->
# Git-Backed Artifact Management System for Node.js Mirth Connect

## Context

Mirth Connect stores all channel configurations, code templates, and scripts as monolithic XML blobs in a database. This makes version control, code review, environment promotion, and selective deployment impossible without external tooling. Java Mirth has no built-in git integration — only integer revision counters and an audit log.

This feature makes the Node.js Mirth engine **git-aware**: able to decompose artifacts into reviewable file trees, sync bidirectionally with git repositories, promote configurations across environments (dev → staging → prod), detect version incompatibilities, and perform delta deploys. It builds on existing infrastructure (ChannelController, ValueReplacer, TraceService dependency graph, ShadowMode) and follows established patterns (Express routes, Commander CLI, TDD).

**Outcome**: Operators manage Mirth configurations as code — reviewable PRs, environment promotion, rollback via git revert, and selective deployment of only what changed.

---

## Phase 1: Core Decomposer/Assembler Engine

**Goal**: Lossless round-trip: Channel XML → decomposed file tree → identical Channel XML

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/types.ts` | 130 | Core types: `DecomposedChannel`, `FileTree`, `ScriptFile`, `ConnectorYaml`, options |
| `src/artifact/ChannelDecomposer.ts` | 450 | XML → file tree using `fast-xml-parser` with `preserveOrder: true` |
| `src/artifact/ChannelAssembler.ts` | 400 | File tree → XML by injecting content back into XML skeleton |
| `src/artifact/SensitiveDataDetector.ts` | 200 | Transport-type-aware credential detection and parameterization |
| `src/artifact/index.ts` | 20 | Barrel exports |
| `tests/unit/artifact/ChannelDecomposer.test.ts` | 300 | Round-trip fidelity with real XML fixtures |
| `tests/unit/artifact/ChannelAssembler.test.ts` | 250 | Assembly, edge cases (empty scripts, no destinations) |
| `tests/unit/artifact/SensitiveDataDetector.test.ts` | 150 | Per-transport detection patterns |

### Decomposed Directory Structure (Per Channel)

```
channels/{channel-name}/
  channel.yaml              # Metadata: id, name, version, revision, enabled, properties
  _skeleton.xml             # XML backbone with placeholders (for lossless reassembly)
  source/
    connector.yaml          # Transport properties (type, host, port, etc.)
    filter.js               # Filter rules (if non-trivial)
    transformer.js          # Transformer steps (extracted from inline XML)
  destinations/
    {dest-name}/            # Sanitized: "Dest 1 - Send" → "dest-1-send"
      connector.yaml
      filter.js
      transformer.js
      response-transformer.js
  scripts/
    preprocess.js           # Only if non-default (not "return message;")
    postprocess.js
    deploy.js
    undeploy.js
```

### XML Fidelity Strategy

The channel XML uses XStream-specific `class` and `version` attributes (e.g., `class="com.mirth.connect.connectors.tcp.TcpReceiverProperties" version="3.9.1"`). The decomposer uses a **custom XML AST** for full structural control:

**Primary approach: Custom XML AST**

Build a lightweight XML AST (Abstract Syntax Tree) that preserves every structural detail:
- Element names, attributes (including `class`, `version`), attribute ordering
- Text content, CDATA sections, comments, processing instructions
- Whitespace and formatting between elements
- Self-closing vs empty element distinction

```typescript
interface XmlNode {
  type: 'element' | 'text' | 'cdata' | 'comment' | 'processing-instruction';
  name?: string;              // Element name
  attributes?: Map<string, string>;  // Preserves order via Map
  children?: XmlNode[];
  value?: string;             // Text/CDATA/comment content
  selfClosing?: boolean;
}
```

The AST is built using a SAX-style streaming parser (e.g., `sax` package or custom parser over `fast-xml-parser`'s callback mode) that emits events for every XML token. This gives us complete control — no information is lost during parsing.

**Decomposer workflow:**
1. Parse channel XML → full AST preserving all structure
2. Walk AST to extract scripts from known paths (transformer steps, filter rules, channel scripts) into `.js` files with metadata headers
3. Walk AST to extract connector properties into `.yaml` files for human readability
4. Serialize the remaining AST (with extraction markers) as `_skeleton.xml`
5. The assembler reads the skeleton AST, injects scripts/config back, and serializes to identical XML

**Fallback**: If the custom AST proves too complex for initial implementation, start with `fast-xml-parser` in `preserveOrder: true` mode + `ignoreAttributes: false`. This preserves element order and attributes but may lose some whitespace formatting. The round-trip fidelity tests will detect any drift. The AST can be swapped in later without changing the file tree format.

**Why AST over preserveOrder?** The `preserveOrder` mode in fast-xml-parser normalizes some whitespace and may reorder attributes. For healthcare integrations where XML is often compared byte-for-byte, the AST approach guarantees identical output. It also makes script extraction/injection more precise since we navigate a typed tree rather than walking nested arrays.

**Script file format** (machine-parseable header + human-readable body):
```javascript
// @mirth-artifact source.transformer.step[0]
// @name Set Source Values
// @sequence 0
// @enabled true
// @type com.mirth.connect.plugins.javascriptstep.JavaScriptStep

$c('sourceValue', 'fromSource');
$c('sourceTime', new Date().toISOString());
```

### Sensitive Data Detection Rules

Transport-type heuristic (from channel-deployer agent spec):
- **Generic** (all transports): `password`, `secret`, `token`, `credential`, `passphrase`, `apiKey`
- **Database**: `username`, `password`, `url`
- **SFTP**: `username`, `password`, `keyFile`, `passPhrase`
- **SMTP**: `smtpHost`, `username`, `password`
- **JMS**: `username`, `password`
- **WebService/HTTP**: `username`, `password`

Detected fields are parameterized as `${CHANNEL_NAME_SFTP_PASSWORD}` (upper-snake convention).

### Reuses

- `fast-xml-parser` — already in dependencies (used by `ChannelController.ts`)
- `Channel` interface from `src/api/models/Channel.ts` — typed model
- Validation fixtures (e.g., `validation/scenarios/07-deep-validation/7.5-cross-connector-maps/multi-destination-channel.xml`) — real channel XML for round-trip tests

### Tests

- Round-trip fidelity: decompose → assemble → deep-compare parsed objects (not string equality)
- Multi-destination channels, empty scripts, channel scripts, data type properties
- Sensitive data detection per transport type
- Edge cases: channels with no destinations, channels with `exportData`

---

## Phase 2: Git Integration Layer

**Goal**: Shell-based git operations + push/pull/sync workflows

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/git/GitClient.ts` | 300 | Shell wrapper: init, add, commit, push, pull, diff, log, status, branch |
| `src/artifact/git/GitSyncService.ts` | 400 | Orchestrates export-to-git and import-from-git workflows |
| `src/artifact/git/GitWatcher.ts` | 150 | `fs.watch()` auto-sync on filesystem changes (debounced) |
| `src/artifact/git/CommitMapper.ts` | 150 | Maps channel revisions ↔ git commits via `D_ARTIFACT_SYNC` |
| `src/artifact/ArtifactDao.ts` | 180 | CRUD for `D_ARTIFACT_SYNC` table |
| `tests/unit/artifact/GitClient.test.ts` | 200 | Git operations (real temp repos, not mocked) |
| `tests/unit/artifact/GitSyncService.test.ts` | 250 | Push/pull workflows |

### Repository Structure

```
mirth-config/                    # Git root
  .mirth-sync.yaml               # Repo-level metadata (see Version Tracking below)
  channels/                      # Decomposed channels (Phase 1 structure)
  code-templates/
    {library-name}/
      library.yaml               # Library metadata + enabledChannelIds
      {template-name}.js         # Code template scripts
  groups/
    {group-name}.yaml            # Channel group membership
  config/
    dependencies.yaml            # Channel dependency graph
    tags.yaml                    # Channel tags
    metadata.yaml                # Per-channel metadata (pruning settings)
    global-scripts.yaml          # Deploy/undeploy/preprocessor/postprocessor global scripts
  environments/                  # Phase 3
    base.yaml
    dev.yaml
    staging.yaml
    prod.yaml
  .gitignore                     # Auto-generated: .env, *.secret, etc.
```

### New Database Table

```sql
CREATE TABLE IF NOT EXISTS D_ARTIFACT_SYNC (
  ID VARCHAR(36) NOT NULL PRIMARY KEY,
  ARTIFACT_TYPE VARCHAR(20) NOT NULL,     -- 'channel', 'code_template', 'group', 'config'
  ARTIFACT_ID VARCHAR(36) NOT NULL,
  ARTIFACT_NAME VARCHAR(255),
  REVISION INT,
  COMMIT_HASH VARCHAR(40),
  SYNC_DIRECTION VARCHAR(10) NOT NULL,    -- 'push', 'pull'
  SYNCED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  SYNCED_BY VARCHAR(255),
  ENVIRONMENT VARCHAR(50),
  INDEX idx_artifact (ARTIFACT_TYPE, ARTIFACT_ID),
  INDEX idx_commit (COMMIT_HASH)
) ENGINE=InnoDB;
```

Registered in `src/db/SchemaManager.ts` → `ensureCoreTables()` (follows `D_SERVERS` pattern).

### Push Workflow (Engine → Git)

1. `ChannelController.getChannelXml(channelId)` for each channel
2. `ChannelDecomposer.decompose(xml, { maskSecrets: true })`
3. Write file tree to `mirth-config/channels/{name}/`
4. Also export: code templates, groups, config (dependencies, tags, metadata)
5. `GitClient.add()` → `commit()` → optionally `push()`
6. `CommitMapper.record(channelId, revision, commitHash, 'push')`

### Pull Workflow (Git → Engine)

1. `GitClient.pull()`
2. For each channel directory: read file tree → resolve env vars → assemble XML
3. `ChannelController.createChannelWithXml()` or `updateChannelWithXml()`
4. `DependencySort.sort(channels)` for deployment ordering
5. `EngineController.deployChannel()` in dependency order
6. Record sync in `D_ARTIFACT_SYNC`

### Sync Modes

| Mode | Trigger | Direction | Use Case |
|------|---------|-----------|----------|
| `push` | CLI / API | Engine → Git | Export after config changes in GUI |
| `pull` | CLI / API | Git → Engine | Deploy from git (CI/CD) |
| `watch` | Filesystem watcher | Git → Engine | Auto-deploy on git pull |
| `sync` | CLI / API | Bidirectional | Merge changes from both sides |

### Version Tracking in Git Repository

Engine and artifact versions are tracked directly alongside the code so that promotions across environments running different Mirth versions can be validated.

**Repo-level** (`.mirth-sync.yaml`):
```yaml
# Repo metadata — tracks what engine exported these artifacts
engine:
  type: nodejs                    # 'nodejs' or 'java'
  mirthVersion: "3.9.1"           # Mirth compatibility version
  nodeVersion: "0.2.0"            # Node.js port version (from manifest.json)
  rhinoEquivalent: "1.7.14"       # Rhino version this E4X transpiler emulates
  e4xSupport: true                # Whether engine supports E4X syntax in scripts
  schemaVersion: "3.9.1"          # Database schema version (SCHEMA_INFO.VERSION)
serverId: "abc-123-..."           # Server that last exported
lastSync: "2026-02-08T12:00:00Z"
gitFlow:
  model: environment-branches
  branches:
    dev: dev
    staging: staging
    prod: main
```

**Per-channel** (`channel.yaml`):
```yaml
id: "71500001-0001-0001-0001-000000000001"
name: "ADT Receiver"
version: "3.9.1"                  # From <channel version="3.9.1"> — the Mirth version this channel was created/last edited in
revision: 5
enabled: true
engineVersion:
  exportedFrom: "3.9.1"          # Engine version when this channel was exported
  exportedEngine: "nodejs"        # 'nodejs' or 'java'
  rhinoFeatures:                  # Script compatibility markers
    usesE4X: true                 # Channel scripts contain E4X syntax (XML literals, @attr, ..)
    usesES6: false                # Channel scripts use ES6+ features (arrow functions, let/const, etc.)
    usesImportPackage: false      # Scripts use importPackage() (Rhino-specific)
# ... rest of channel metadata
```

**Per-script** (metadata header in `.js` files):
```javascript
// @mirth-artifact source.transformer.step[0]
// @name Set Source Values
// @sequence 0
// @enabled true
// @type com.mirth.connect.plugins.javascriptstep.JavaScriptStep
// @mirth-version 3.9.1
// @syntax-features e4x

$c('sourceValue', 'fromSource');
```

**Why this matters**: Different Mirth versions bundle different Rhino engines:

| Mirth Version | Rhino Version | Key Differences |
|---------------|---------------|-----------------|
| 3.8.x | 1.7.7 | Basic E4X, limited ES5 |
| 3.9.x | 1.7.14 | Full E4X, ES5 complete |
| 3.10.x+ | 1.7.14+ | E4X deprecated in some contexts |
| 4.0.x+ | Nashorn/GraalJS | E4X removed, ES6+ supported |

The Node.js engine uses its own E4X transpiler (`src/javascript/e4xTranspiler.ts`) that converts E4X syntax to standard JS. The compatibility check needs to verify:
1. **E4X scripts promoted to 4.0+ Java Mirth**: Will fail if Java engine dropped E4X → block or warn
2. **ES6 scripts promoted to 3.8.x Java Mirth**: Will fail if Rhino doesn't support `let`/`const`/arrow functions → block or warn
3. **Node.js to Node.js promotion**: Always compatible (same transpiler) → allow
4. **Java to Node.js**: Always compatible (transpiler handles E4X) → allow

### Script Syntax Detection

The `ChannelDecomposer` will scan extracted scripts for syntax markers:

```typescript
interface ScriptSyntaxInfo {
  usesE4X: boolean;       // Contains XML literals, @attr access, .., ::
  usesES6: boolean;       // Contains let, const, =>, class, template literals
  usesImportPackage: boolean;  // Contains importPackage() calls
  usesJavaAdapter: boolean;    // Contains JavaAdapter
}

function detectScriptSyntax(script: string): ScriptSyntaxInfo {
  return {
    usesE4X: /(?:<[a-zA-Z][\s\S]*?>|\.@\w+|\.\.\w+|::)/.test(script),
    usesES6: /(?:\blet\b|\bconst\b|=>|\bclass\b|`[^`]*`)/.test(script),
    usesImportPackage: /importPackage\s*\(/.test(script),
    usesJavaAdapter: /JavaAdapter/.test(script),
  };
}
```

This info is stored in `channel.yaml` (`rhinoFeatures`) and in script headers (`@syntax-features`), making it available for version compatibility checks during promotion (Phase 5).

### GitClient Implementation

Uses `child_process.execFile('git', args, { cwd: repoPath })` — no native git library. Key methods:
- `init()`, `clone(url)`, `isRepo()`
- `add(files)`, `commit(message)`, `status()`
- `push(remote?, branch?)`, `pull(remote?, branch?)`, `fetch()`
- `branch()`, `checkout(branch, create?)`, `listBranches()`
- `diff(from, to?)`, `diffStat(from, to?)`
- `log(limit?, path?)`, `getCommitHash()`

### Existing Files to Modify

| File | Change |
|------|--------|
| `src/db/SchemaManager.ts` | Add `D_ARTIFACT_SYNC` to `ensureCoreTables()` |
| `src/server/Mirth.ts` | Add artifact initialization after channel deployment |

---

## Phase 3: Environment Variable Resolution

**Goal**: Same channel config works across dev/staging/prod with per-environment overrides

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/VariableResolver.ts` | 200 | Resolution chain: process.env → env yaml → base yaml → inline defaults |
| `tests/unit/artifact/VariableResolver.test.ts` | 200 | Resolution order, defaults, unresolved reporting |

### Resolution Order (highest priority first)

1. `process.env` — runtime overrides
2. `environments/{env}.yaml` — environment-specific values
3. `environments/base.yaml` — shared defaults
4. Inline defaults `${VAR:default_value}` — fallback

### Environment File Format

```yaml
# environments/base.yaml
MLLP_PORT: "6661"
DB_HOST: "localhost"
DB_PORT: "3306"
LOG_LEVEL: "INFO"

# environments/prod.yaml
MLLP_PORT: "6661"
DB_HOST: "prod-db.internal"
DB_PORT: "3306"
LOG_LEVEL: "WARN"
# Secrets come from process.env, NOT this file
```

### Variable Syntax

Supports both `${VAR}` and `${VAR:default_value}`. Reports unresolved variables as warnings (not errors) so operators know what to set.

**Note**: This is distinct from the existing `ValueReplacer` (`src/utils/ValueReplacer.ts`) which handles runtime message context (`$c`, `$s`, `$g`, etc.). `VariableResolver` is for deploy-time configuration only.

### Sensitive Data Strategy

Secrets are NEVER stored in environment YAML files. Instead:
- Decomposer parameterizes them as `${VAR}` in connector YAML
- Operators set them via `process.env` at runtime
- `.gitignore` excludes `.env` files
- Future: vault references (`{{VAULT:path}}`) for secrets management integration

---

## Phase 4: Promotion Pipeline & Dependency Ordering

**Goal**: Structured promotion (dev → staging → prod) with dependency-aware deployment

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/DependencySort.ts` | 150 | Topological sort (Kahn's algorithm) with cycle detection |
| `src/artifact/promotion/PromotionPipeline.ts` | 350 | Orchestrates dev → staging → prod workflow |
| `src/artifact/promotion/PromotionGate.ts` | 150 | Approval records in CONFIGURATION table |
| `tests/unit/artifact/DependencySort.test.ts` | 150 | Sort, cycles, diamonds, isolated channels |
| `tests/unit/artifact/PromotionPipeline.test.ts` | 200 | Stage transitions, gating |

### Git Flow Models (User-Configurable)

**Model A: Environment Branches** (default)
```
dev branch    →  staging branch  →  prod branch
  (auto-sync)    (gated merge)      (manual merge)
```
Promotion = merge from source to target branch + variable substitution for target env.

**Model B: Trunk-Based with Tags**
```
main branch → tag v1.2.3 → deploy to prod with prod env vars
  feature/* branches merge to main
```
Promotion = create tag → deploy from tag with target env config.

**Model C: Release Branches**
```
main → release/v1.2 → hotfix cherry-picks
  Features merge to main, releases cut from main
```

Configured in `.mirth-sync.yaml`:
```yaml
gitFlow:
  model: environment-branches    # or trunk-based, release-branches
  branches:
    dev: dev
    staging: staging
    prod: main
  autoSync:
    dev: true
    staging: false
    prod: false
```

### Dependency Ordering

Merges two dependency sources (existing infrastructure):
1. **Explicit**: `ConfigurationController.getChannelDependencies()` — stored in CONFIGURATION table
2. **Inferred**: `TraceService.buildChannelDependencyGraph()` — Channel Writer targets

Uses Kahn's algorithm for topological sort. Reports exact cycle paths for operator remediation.

### Promotion Approvals

Stored in `CONFIGURATION` table (no new table):
- Category: `artifact.promotion`
- Name: `{source}->{target}:{timestamp}`
- Value: JSON `{ approvedBy, approvedAt, channelIds, commitHash, status }`

### ShadowMode Integration

For production promotions, optionally leverages existing ShadowMode:
1. Deploy channels in shadow mode (read-only)
2. Operator verifies via `mirth-cli dashboard`
3. Promote individual channels via `mirth-cli shadow promote`
4. Full cutover when ready

---

## Phase 5: Version Compatibility Guards

**Goal**: Prevent deploying artifacts incompatible with the target engine version

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/promotion/VersionCompatibility.ts` | 250 | Version detection, compatibility matrix, guard logic |
| `tests/unit/artifact/VersionCompatibility.test.ts` | 150 | Matrix tests, guard behavior |

### How It Works

**Three layers of version checking:**

**Layer 1: Mirth Version Compatibility**
1. Channel's `version` field from `channel.yaml` (e.g., `3.9.1`)
2. Target engine version from `.mirth-sync.yaml` on the target branch OR from `manifest.json:mirthCompatibility.current`
3. Compatibility matrix (derived from Java migration classes):

```typescript
const COMPAT_RANGES = [
  ['3.9.0', '3.9.1'],
  ['3.10.0', '3.10.1'],
  ['4.0.0', '4.0.1'],
  ['4.5.0', '4.5.2'],
];
```

**Layer 2: Script Syntax Compatibility (Rhino/E4X)**
Uses the `rhinoFeatures` tracked in `channel.yaml` (populated by Phase 1 decomposer):
- If channel `usesE4X: true` and target is Java Mirth 4.0+ (no E4X) → **BLOCK**: "Channel uses E4X syntax incompatible with target engine"
- If channel `usesES6: true` and target is Java Mirth 3.8.x (limited ES5) → **WARN**: "Channel uses ES6 features; verify Rhino compatibility"
- If channel `usesImportPackage: true` and target is Node.js → **WARN**: "importPackage() is Rhino-specific; Node.js transpiler handles this but verify"
- If target is Node.js → E4X always compatible (transpiler handles it) → **ALLOW**

**Layer 3: Engine Type Compatibility**
- `engineVersion.exportedEngine` in `channel.yaml` tracks whether channel was last exported from Java or Node.js
- Java → Node.js: Generally safe (transpiler handles Rhino-isms)
- Node.js → Java: Safe if no Node.js-only features used
- Promote warning if engine types differ

**Promotion behavior:**
- If incompatible: **BLOCK** with clear error message + `--force` override flag
- If potentially incompatible: **WARN** but allow (operator decides)
- If compatible: **ALLOW** silently
- Future: auto-conversion using Java `Migrate*.java` class patterns

### Integration with Version Manager

The existing `tools/version-manager/` tracks Java versions and can analyze migration diffs. The compatibility module reads `manifest.json` to determine the current engine's target version and cross-references with the artifact's `version` attribute.

---

## Phase 6: Delta Deploys & Change Detection

**Goal**: Deploy only what changed between git states

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/git/DeltaDetector.ts` | 250 | Map git file changes to artifact IDs |
| `tests/unit/artifact/DeltaDetector.test.ts` | 200 | File-to-channel mapping, dependency cascades |

### Change Detection

Uses `git diff --name-only <from> <to>` → maps file paths to artifact IDs:
```
channels/adt-receiver/source/transformer.js  →  channel "ADT Receiver"
code-templates/util-lib/format-date.js       →  code template library "util-lib"
environments/prod.yaml                        →  all channels (env change)
```

### Dependency Cascades

If a code template changes, all channels referencing that library need redeployment. The detector traces `CodeTemplateLibrary.enabledChannelIds` to determine cascade scope.

### Selective Deployment

```bash
# Deploy only channels changed since last sync
mirth-cli artifact deploy --delta

# Deploy only channels changed between two commits
mirth-cli artifact deploy --from abc1234 --to def5678

# Deploy specific channels
mirth-cli artifact deploy --channels "ADT Receiver,ORM Router"
```

### Rollback

Rollback = deploy from a previous git commit:
1. `git checkout <commit>` (detached HEAD or temporary worktree)
2. Read file tree → resolve env vars → assemble XML
3. Deploy via existing `EngineController`
4. Return to current branch

---

## Phase 7: REST API & CLI

**Goal**: Expose artifact management through HTTP endpoints and terminal commands

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/ArtifactController.ts` | 450 | Orchestrator: static methods calling decomposer/assembler/git/promotion |
| `src/api/servlets/ArtifactServlet.ts` | 500 | REST endpoints (follows `ShadowServlet.ts` pattern) |
| `src/cli/commands/artifact.ts` | 600 | CLI commands (follows `shadow.ts` pattern) |
| `tests/unit/artifact/ArtifactController.test.ts` | 200 | Controller tests |
| `tests/unit/api/servlets/ArtifactServlet.test.ts` | 250 | API endpoint tests |
| `tests/unit/cli/artifact-commands.test.ts` | 150 | CLI tests |

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/artifacts/export` | POST | Export channels to decomposed file tree |
| `/api/artifacts/export/:channelId` | GET | Export single channel (decomposed JSON) |
| `/api/artifacts/import` | POST | Import from decomposed file tree |
| `/api/artifacts/diff/:channelId` | GET | Diff current vs git version |
| `/api/artifacts/sensitive/:channelId` | GET | Detect sensitive fields in channel |
| `/api/artifacts/git/status` | GET | Git repository status |
| `/api/artifacts/git/push` | POST | Export + commit + push |
| `/api/artifacts/git/pull` | POST | Pull + import + deploy |
| `/api/artifacts/git/log` | GET | Recent commit history |
| `/api/artifacts/promote` | POST | Promote to target environment |
| `/api/artifacts/promote/status` | GET | Promotion pipeline status |
| `/api/artifacts/delta` | GET | Changed artifacts between refs |
| `/api/artifacts/deploy` | POST | Deploy changed artifacts (delta or full) |

### CLI Commands

```bash
# Export / Import
mirth-cli artifact export [channel]         # Export to git directory
mirth-cli artifact export --all             # Export all channels + templates + config
mirth-cli artifact import [channel]         # Import from git directory
mirth-cli artifact import --all --env prod  # Import all with prod env vars

# Git operations
mirth-cli artifact git init [path]          # Initialize artifact repo
mirth-cli artifact git status               # Show sync status
mirth-cli artifact git push                 # Export + commit + push
mirth-cli artifact git pull [--env <env>]   # Pull + import + optionally deploy
mirth-cli artifact git log                  # Show recent sync history

# Analysis
mirth-cli artifact diff <channel>           # Structural diff vs git version
mirth-cli artifact secrets <channel>        # Detect sensitive fields
mirth-cli artifact deps                     # Show dependency graph

# Promotion
mirth-cli artifact promote <target-env>     # Promote to environment
mirth-cli artifact promote status           # Show pipeline status

# Delta deploy
mirth-cli artifact deploy --delta           # Deploy only changed artifacts
mirth-cli artifact deploy --from <ref>      # Deploy from specific commit
mirth-cli artifact rollback <ref>           # Rollback to previous state
```

### Existing Files to Modify

| File | Change |
|------|--------|
| `src/cli/index.ts` | `registerArtifactCommands(program)` |
| `src/api/server.ts` | `app.use('/api/artifacts', artifactRouter)` |
| `src/api/middleware/operations.ts` | Add `ARTIFACT_EXPORT`, `ARTIFACT_IMPORT`, `ARTIFACT_DEPLOY`, `ARTIFACT_PROMOTE` |

### Server Lifecycle Integration

In `src/server/Mirth.ts` after channel deployment:
```typescript
const artifactRepoPath = process.env['MIRTH_ARTIFACT_REPO'];
if (artifactRepoPath) {
  const { ArtifactController } = await import('../artifact/ArtifactController.js');
  await ArtifactController.initialize(artifactRepoPath);
  if (process.env['MIRTH_ARTIFACT_AUTO_SYNC'] === 'true') {
    await ArtifactController.startWatcher();
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_ARTIFACT_REPO` | (none) | Path to git repository for artifact sync |
| `MIRTH_ARTIFACT_ENV` | (none) | Active environment (dev, staging, prod) |
| `MIRTH_ARTIFACT_AUTO_SYNC` | `false` | Enable filesystem watcher for auto-sync |
| `MIRTH_ARTIFACT_REMOTE` | `origin` | Git remote name |

---

## Phase 8: Structural Diff Engine

**Goal**: Human-readable comparison of channel versions at structural level

### Key Files to Create

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/artifact/ChannelDiff.ts` | 350 | Structural diff (YAML paths) + script diff (unified format) |
| `tests/unit/artifact/ChannelDiff.test.ts` | 250 | Config changes, script changes, combined output |

### Diff Approach

Two levels:
1. **Config diff**: Deep object comparison of YAML → list of added/removed/changed paths
2. **Script diff**: Standard unified diff format for `.js` files

### Comparison Sources

- Current database state vs git state (most common)
- Two git commits
- Two environment variants (same channel, different env configs)

### CLI Output

```
$ mirth-cli artifact diff "ADT Receiver"

Channel: ADT Receiver (3 changes)

--- source/connector.yaml ---
  port: 6661 → 6662
  maxConnections: 10 → 20

--- destinations/dest-1/transformer.js ---
@@ -5,3 +5,4 @@
 $c('sourceValue', 'fromSource');
 $c('sourceTime', new Date().toISOString());
+$c('patientDOB', msg['PID']['PID.7']['PID.7.1'].toString());
 $c('patientMRN', msg['PID']['PID.3']['PID.3.1'].toString());
```

Integrates with the revision counter: shows `revision 5 (database) vs revision 4 (git)`.

---

## Implementation Order & Parallelism

```
Wave A (parallel):  Phase 1 (Core)  +  Phase 3 (Env Vars)
Wave B (parallel):  Phase 2 (Git)   +  Phase 8 (Diff)
Wave C (parallel):  Phase 4 (Promo) +  Phase 6 (Delta)
Wave D:             Phase 5 (Version Compat)
Wave E:             Phase 7 (API + CLI)
```

| Wave | Phases | Dependencies | Parallelizable? |
|------|--------|-------------|-----------------|
| A | 1, 3 | None | Yes |
| B | 2, 8 | Phase 1 | Yes |
| C | 4, 6 | Phases 1, 2, 3 | Yes |
| D | 5 | Phase 4 | No |
| E | 7 | All above | No (integration) |
| F | 9 | All above | No (docs after implementation) |

---

## Totals

| Phase | ~Lines | ~Tests | Key Deliverables |
|-------|--------|--------|-----------------|
| 1: Core | 1,900 | 60 | ChannelDecomposer, ChannelAssembler, SensitiveDataDetector |
| 2: Git | 1,630 | 45 | GitClient, GitSyncService, GitWatcher, CommitMapper |
| 3: Environment | 400 | 25 | VariableResolver |
| 4: Promotion | 1,000 | 40 | PromotionPipeline, DependencySort, PromotionGate |
| 5: Version | 400 | 20 | VersionCompatibility |
| 6: Delta | 450 | 25 | DeltaDetector |
| 7: API + CLI | 2,150 | 60 | ArtifactServlet, ArtifactController, CLI commands |
| 8: Diff | 600 | 30 | ChannelDiff |
| 9: Documentation | 300 | — | CLAUDE.md, README.md updates |
| **Total** | **~8,830** | **~305** | |

---

## Verification Plan

### Unit Tests (Per Phase)
Each phase has dedicated test files (305 tests total). Run with:
```bash
npx jest tests/unit/artifact/ --verbose
```

### Integration Test: Round-Trip Fidelity
Use real channel XML from `validation/scenarios/07-deep-validation/`:
1. `multi-destination-channel.xml` — multi-dest, transformer scripts, data types
2. `sftp-orm-to-oru-channel.xml` — SFTP with sensitive fields
3. `full-lifecycle-channel.xml` — all channel scripts
4. `template-function-channel.xml` — code template references

Test: decompose → assemble → parse both → deep-compare parsed objects.

### Integration Test: Push/Pull Cycle
1. Start Node.js Mirth with test channels deployed
2. `mirth-cli artifact export --all` → verify file tree structure
3. Modify a transformer script in the git directory
4. `mirth-cli artifact import "Channel Name"` → verify channel updated
5. `mirth-cli artifact diff "Channel Name"` → verify diff shows the change

### Integration Test: Environment Promotion
1. Export channels to git repo on `dev` branch
2. Create `environments/staging.yaml` with different DB host
3. `mirth-cli artifact promote staging` → verify merge + variable substitution
4. Verify channel XML on staging has correct DB host

### Integration Test: Delta Deploy
1. Export all channels → commit
2. Modify one channel's transformer
3. `mirth-cli artifact deploy --delta` → verify only that channel redeployed

---

## Phase 9: Documentation (CLAUDE.md + README.md)

**Goal**: Update project documentation with full feature details, usage examples, and architectural insights

### CLAUDE.md Updates

Add a new top-level section `### Git-Backed Artifact Management` covering:

1. **Feature overview** — what git sync does, why it exists, how it relates to Java Mirth (which has no equivalent)
2. **Architecture** — `src/artifact/` module structure diagram (Decomposer, Assembler, GitClient, PromotionPipeline, etc.)
3. **Decomposed directory structure** — the `mirth-config/` file tree layout with explanations
4. **XML AST fidelity strategy** — how we preserve XStream-specific attributes and formatting through decompose/assemble round-trips
5. **Environment variables** — `MIRTH_ARTIFACT_REPO`, `MIRTH_ARTIFACT_ENV`, `MIRTH_ARTIFACT_AUTO_SYNC`, `MIRTH_ARTIFACT_REMOTE`
6. **Database table** — `D_ARTIFACT_SYNC` schema and purpose (Node.js-only, safe in shared DB)
7. **CLI commands reference** — full `mirth-cli artifact` command tree with usage examples
8. **REST API endpoints** — `/api/artifacts/*` endpoint table
9. **Sync modes** — push, pull, watch, sync with use cases
10. **Promotion pipeline** — dev → staging → prod workflow, git flow models, ShadowMode integration
11. **Version compatibility** — how artifact version detection works, compatibility matrix, `--force` override
12. **Delta deploys** — change detection, dependency cascades, selective deployment, rollback
13. **Sensitive data handling** — transport-type detection rules, parameterization convention, `.gitignore` strategy
14. **Diff output format** — structural diff for YAML + unified diff for scripts
15. **Takeover mode considerations** — `D_ARTIFACT_SYNC` is Node.js-only, safe in shared Java+Node.js DB

Add to the **CLI Monitor Utility** section:
- New `artifact` command group under Key Commands
- Dependencies: `js-yaml`, `sax` (or whichever XML parser is chosen)

Add to the **Node.js-Only Extensions** table:
| Git Artifact Sync | `GET/POST /api/artifacts/*` | Git-backed config management, promotion, delta deploys |
| Artifact CLI | `mirth-cli artifact export/import/diff/promote/deploy` | Artifact management commands |

### README.md Updates

Add a **Git-Backed Configuration Management** section covering:
1. Quick start guide (init repo, export, commit, push)
2. Environment setup (base.yaml, dev.yaml, prod.yaml)
3. Promotion workflow walkthrough
4. CI/CD integration example (GitHub Actions / GitLab CI)
5. Delta deploy example

### Key Files to Modify

| File | Change |
|------|--------|
| `CLAUDE.md` | Add `### Git-Backed Artifact Management` section (~200 lines), update CLI section, update Extensions table |
| `README.md` | Add configuration management section (~100 lines) |

### Timing

Documentation is written **after all implementation phases complete** (post-Wave D merge), so it reflects the actual implementation rather than the plan. The `api-cli` agent (Wave D) can draft the CLAUDE.md/README.md sections as part of its integration work, or a dedicated documentation pass is done after final merge.

---

## Agent Team Execution Strategy

Implementation uses agent teams with git worktrees for true parallelism (proven pattern from Waves 1-6 of the original port).

### Team Structure

| Agent Name | Type | Phases | Worktree Branch |
|-----------|------|--------|----------------|
| `decomposer` | `channel-deployer` | 1 (Core) | `feature/artifact-decomposer` |
| `env-resolver` | `general-purpose` | 3 (Environment) | `feature/artifact-env-resolver` |
| `git-layer` | `general-purpose` | 2 (Git Integration) | `feature/artifact-git-layer` |
| `diff-engine` | `general-purpose` | 8 (Diff) | `feature/artifact-diff-engine` |
| `promotion` | `general-purpose` | 4, 5 (Promotion + Version) | `feature/artifact-promotion` |
| `delta-deploy` | `general-purpose` | 6 (Delta) | `feature/artifact-delta-deploy` |
| `api-cli` | `general-purpose` | 7 (API + CLI) | `feature/artifact-api-cli` |

### Execution Waves

```
Wave A (3 agents in parallel):
  decomposer  → Phase 1: ChannelDecomposer, ChannelAssembler, SensitiveDataDetector, types
  env-resolver → Phase 3: VariableResolver
  diff-engine  → Phase 8: ChannelDiff (depends on types.ts from Phase 1 — share interface)

Wave B (2 agents in parallel):
  git-layer    → Phase 2: GitClient, GitSyncService, GitWatcher, CommitMapper, ArtifactDao
  delta-deploy → Phase 6: DeltaDetector (depends on GitClient interface — share type)

Wave C (1 agent):
  promotion    → Phases 4 + 5: DependencySort, PromotionPipeline, PromotionGate, VersionCompatibility

Wave D (1 agent):
  api-cli      → Phase 7: ArtifactController, ArtifactServlet, CLI commands, server lifecycle wiring

Merge:
  Lead merges all branches to master, resolves index.ts export conflicts
```

### Worktree Setup Commands

```bash
# Create worktrees for Wave A
git worktree add ../mirth-worktrees/artifact-decomposer -b feature/artifact-decomposer
git worktree add ../mirth-worktrees/artifact-env-resolver -b feature/artifact-env-resolver
git worktree add ../mirth-worktrees/artifact-diff-engine -b feature/artifact-diff-engine

# Wave B
git worktree add ../mirth-worktrees/artifact-git-layer -b feature/artifact-git-layer
git worktree add ../mirth-worktrees/artifact-delta-deploy -b feature/artifact-delta-deploy

# Wave C
git worktree add ../mirth-worktrees/artifact-promotion -b feature/artifact-promotion

# Wave D
git worktree add ../mirth-worktrees/artifact-api-cli -b feature/artifact-api-cli
```

### Shared Interfaces Strategy

The `types.ts` file is the shared contract between agents. To avoid merge conflicts:

1. **Wave A lead** (`decomposer`) creates `src/artifact/types.ts` with all shared types
2. Other Wave A agents import from `types.ts` via relative path
3. Wave B and C agents copy the types file from the decomposer branch before starting
4. Wave D (`api-cli`) merges all prior branches before starting, so all types are available

### Merge Strategy

Following the proven pattern from Waves 1-6:
1. Merge branches in wave order (A → B → C → D)
2. Resolve `src/artifact/index.ts` barrel export conflicts by combining all exports
3. Run full test suite after each merge
4. Final merge to master after all agents complete

### Key Lessons from Previous Waves

- Each agent works in complete isolation (git worktrees) — no conflicts until final merge
- If an agent hits rate limits, commit partial progress and retry
- `index.ts` barrel exports will conflict — trivial to resolve by combining
- Run `npm install` after merging if any agent added dependencies (e.g., `sax`, `js-yaml`)
- Test with `npx jest tests/unit/artifact/ --verbose` after final merge

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| XML round-trip fidelity — AST may lose whitespace or attribute order | HIGH | Custom AST with SAX parser preserves all structure; fallback to `fast-xml-parser` `preserveOrder` + round-trip tests |
| YAML serialization of Java class name keys | MEDIUM | Test with real connector properties containing `com.mirth.connect.*` keys |
| Git merge conflicts during promotion | MEDIUM | Detect unmerged paths, surface for manual resolution rather than auto-resolving |
| Dependency cascades (code template → all channels) | MEDIUM | Trace `enabledChannelIds` in `CodeTemplateLibrary`; warn operator about cascade scope |
| Version compatibility matrix accuracy | LOW | Start conservative (block by default), add `--force` override |
| Agent merge conflicts in `index.ts` | LOW | Proven pattern from Waves 1-6: combine all export statements |
