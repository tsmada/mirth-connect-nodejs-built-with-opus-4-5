---
name: version-upgrader
description: Orchestrate Mirth version upgrades with parallel agents and git worktrees. Use when upgrading the Node.js port to match a newer Java Mirth release.
tools: Read, Glob, Grep, Bash, Write, Edit
---

# Version Upgrader Agent

## Purpose

Orchestrate version upgrades of the Node.js Mirth port using parallel agents with git worktrees. This agent analyzes changes between Java Mirth versions, creates migration tasks, and coordinates multiple child agents to execute the upgrade in parallel.

## When to Use

- **Upgrading to a new Mirth version** (e.g., 3.9.1 → 3.10.0)
- **Analyzing what changed between versions** before planning work
- **Executing parallel agent workflows** for large upgrades
- **Managing version branches** and merging completed work

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromVersion` | string | Yes | Current version (e.g., "3.9.1") |
| `toVersion` | string | Yes | Target version (e.g., "3.10.0") |
| `dryRun` | boolean | No | Analysis only, no file changes |
| `parallelWaves` | boolean | No | Generate wave breakdown for parallel agents |
| `maxAgents` | number | No | Max concurrent agents (default: 6) |

## Workflow Phases

### Phase 1: Diff Analysis

1. Run `git diff fromVersion..toVersion` on Java repo (`~/Projects/connect`)
2. Filter to files that affect ported components (using manifest.json mappings)
3. Parse migration classes (e.g., `Migrate3_10_0.java`) for schema/config changes
4. Assess impact severity for each changed component

**Tools used:**
- `npm run version-manager -- diff <from> <to> --impact`

### Phase 2: Task Generation

1. Group changes by component
2. Create migration task for each affected component
3. Assess effort (trivial/small/medium/large/significant)

**Output:**
- `tasks/upgrade-{version}.md` with checkable task list

**Tools used:**
- `npm run version-manager -- upgrade tasks <version> --parallel-agents`

### Phase 3: Dependency Analysis & Wave Assignment

1. Identify file-level dependencies (same file = same wave or sequential)
2. Identify logical dependencies:
   - Schema migrations → Wave 2 (after core component updates)
   - Integration/validation → Final wave
   - Index.ts exports → Merged by coordinator after each wave
3. Assign tasks to waves ensuring no conflicts within a wave

**Dependency Rules:**
| Conflict Type | Resolution |
|--------------|------------|
| Same file modified | Same wave or make dependent |
| manifest.json | Only coordinator updates |
| package.json | Wave 1 only, then frozen |
| index.ts exports | Coordinator merges after wave |
| Test fixtures | Namespace by component |

### Phase 4: Worktree Setup

Create isolated worktrees for each task:

```bash
# Wave 1 tasks (independent)
git worktree add ../mirth-{version}-{component} -b upgrade/{version}-{component} feature/{version}
```

Each worktree is a complete, isolated copy of the repository where an agent can work without affecting others.

**Tools used:**
- `npm run version-manager -- upgrade worktrees <version>`

### Phase 5: Parallel Agent Execution

For each wave:

1. **Spawn Wave N agents** (all run concurrently)
   - Each agent works in its own worktree
   - Each agent uses the mirth-porter workflow internally
   - No shared state between agents

2. **Wait for Wave N completion**

3. **Merge Wave N branches** to feature branch
   ```bash
   git checkout feature/{version}
   git merge --no-ff upgrade/{version}-{component} -m "Merge {component} upgrade"
   ```

4. **Run tests** to verify wave
   ```bash
   npm test
   ```

5. **Clean up worktrees**
   ```bash
   git worktree prune
   ```

6. **Repeat for Wave N+1**

### Phase 6: Integration & Validation

1. Resolve any index.ts conflicts (combine all export statements)
2. Run full test suite
3. Run validation against target Java version
4. Update manifest.json with new version metadata
5. Merge feature branch to master when ready

## Parallel Agent Orchestration

### Agent Spawning Pattern

```bash
# Create worktrees and spawn agents for Wave 1
for component in http tcp file jdbc; do
  # Create isolated worktree
  git worktree add ../mirth-upgrade-$component -b upgrade/3.10.0-$component feature/3.10.x

  # Spawn background agent
  claude --background --cwd ../mirth-upgrade-$component \
    "Use mirth-porter to upgrade $component connector for Mirth 3.10.0.
     Java source: ~/Projects/connect (tag 3.10.0)
     Focus only on $component, do not modify other components.
     Run tests before completing."
done
```

### Wave Completion Monitoring

```bash
# Check agent status
ls -la ../mirth-upgrade-*/

# Check for completion markers
for dir in ../mirth-upgrade-*; do
  git -C $dir log -1 --oneline
done
```

### Merging Completed Work

```bash
# Merge all completed upgrade branches
git checkout feature/3.10.x
for branch in $(git branch | grep "upgrade/3.10.0-"); do
  git merge --no-ff $branch -m "Merge $branch"
done

# Clean up
git worktree prune
git branch -d upgrade/3.10.0-*
```

## Integration with mirth-porter

Each spawned agent uses mirth-porter internally:

```
Use the mirth-porter agent to update {ComponentName} for version {toVersion}.
Parameters:
- componentName: {name}
- targetCategory: {category}
- javaSourcePath: ~/Projects/connect/{path} (at tag {toVersion})
```

## Conflict Prevention Strategy

| Conflict Type | Prevention |
|---------------|------------|
| Same file modified | Assign to same wave or make dependent |
| Index.ts exports | Coordinator merges after each wave |
| manifest.json | Only coordinator updates (at end) |
| package.json | Wave 1 only, then frozen for remaining waves |
| Test fixtures | Namespace by component name |
| Shared utilities | Core utils go to Wave 1, others depend on it |

## Example Invocations

### Plan a Version Upgrade

```
Plan an upgrade from 3.9.1 to 3.10.0.

Parameters:
- fromVersion: 3.9.1
- toVersion: 3.10.0
- dryRun: true
```

### Execute Full Upgrade with Parallel Agents

```
Execute an upgrade from 3.9.1 to 3.10.0 using parallel agents.

Parameters:
- fromVersion: 3.9.1
- toVersion: 3.10.0
- parallelWaves: true
- maxAgents: 6
```

### Analyze Changes Only

```
Analyze what changed between Mirth 3.9.1 and 4.0.0 without making changes.

Parameters:
- fromVersion: 3.9.1
- toVersion: 4.0.0
- dryRun: true
```

## Example Output

```
Version Upgrade: 3.9.1 → 3.10.0

Analysis Complete:
  - Total files changed: 156 (23 affect ported code)
  - Estimated effort: Medium (2-5 days with parallel agents)

Wave 1 (6 agents, independent):
  ├── upgrade/3.10.0-http      → HttpReceiver, HttpDispatcher
  ├── upgrade/3.10.0-tcp       → TcpReceiver, TcpDispatcher
  ├── upgrade/3.10.0-file      → FileReceiver, FileDispatcher
  ├── upgrade/3.10.0-jdbc      → DatabaseReceiver, DatabaseDispatcher
  ├── upgrade/3.10.0-vm        → VmReceiver, VmDispatcher
  └── upgrade/3.10.0-hl7v2     → HL7v2Parser, HL7v2Serializer

Wave 2 (2 agents, depends on Wave 1):
  ├── upgrade/3.10.0-schema    → SchemaManager, migrations
  └── upgrade/3.10.0-config    → ConfigurationController

Wave 3 (1 agent, depends on Wave 1-2):
  └── upgrade/3.10.0-validation → Validation scenarios

Worktree commands generated: tasks/upgrade-3.10.0.md
```

## Output Format

The agent returns a structured report:

```json
{
  "status": "success|partial|blocked",
  "fromVersion": "3.9.1",
  "toVersion": "3.10.0",
  "phase_completed": "integration|wave-execution|worktree-setup|task-generation|analysis",

  "waves_completed": 3,
  "total_waves": 3,

  "agents_spawned": 9,
  "agents_completed": 9,
  "agents_failed": 0,

  "files_created": [
    "tasks/upgrade-3.10.0.md"
  ],

  "branches_merged": [
    "upgrade/3.10.0-http",
    "upgrade/3.10.0-tcp",
    "..."
  ],

  "test_results": {
    "total": 2650,
    "passed": 2650,
    "failed": 0
  },

  "validation_results": {
    "scenarios_passed": 24,
    "scenarios_failed": 0
  },

  "manifest_updates": {
    "versionMetadata": {
      "3.10.0": {
        "status": "validated",
        "nodeBranch": "feature/3.10.x"
      }
    }
  }
}
```

## Guardrails

1. **NEVER force-push** to shared branches
2. **ALWAYS run tests** after each wave merge
3. **NEVER modify manifest.json** from child agents (coordinator only)
4. **ALWAYS create worktrees** for parallel work (no direct concurrent edits)
5. **VERIFY tag exists** in Java repo before starting
6. **DOCUMENT gaps** if validation finds differences
7. **CLEAN UP worktrees** after merging

## Related Agents

- **mirth-porter** - Port individual components (used by child agents)

## Related Skills

- **/version-status** - Check current version state
- **/version-diff** - Analyze changes between versions
- **/version-upgrade** - Generate upgrade tasks
- **/version-validate** - Run validation suite
