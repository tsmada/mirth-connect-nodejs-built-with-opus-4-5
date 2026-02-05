# Version Manager Skill

<command-name>version-status</command-name>
<command-name>version-diff</command-name>
<command-name>version-upgrade</command-name>
<command-name>version-validate</command-name>

Use this skill when managing Mirth Connect version upgrades or tracking porting progress across Java Mirth versions.

## Overview

The version-manager tool helps track which Java Mirth version components were ported from, analyze changes between versions, and generate upgrade tasks for parallel agent execution.

---

## Commands

### /version-status

Show current version status and component breakdown.

**Usage:**
```
/version-status
```

**What it shows:**
- Current Node.js port target version (e.g., 3.9.1)
- Component status counts (implemented, validated, pending)
- Category breakdown with progress bars
- Version metadata for tracked versions
- Quick action suggestions

**Options:**
- `--verbose` - Show detailed component information
- `--json` - Output as JSON for automation

**Example output:**
```
╔════════════════════════════════════════════════════════════╗
║           Mirth Connect Node.js Port - Status              ║
╚════════════════════════════════════════════════════════════╝

Version Information:
  Current Target:    3.9.1
  Java Tag:          3.9.1
  Next Version:      3.10.0

Component Status:
  ✓ Validated:    0
  ✓ Implemented:  45
  ◐ In Progress:  0
  ○ Pending:      3
  Total:          48

Components by Category:
  connectors      ████████████████████ 9/9 (100%)
  datatypes       ████████████████████ 9/9 (100%)
  plugins         ████████████████████ 9/9 (100%)
  ...
```

---

### /version-diff

Compare changes between two Java Mirth versions and assess impact.

**Usage:**
```
/version-diff <from-version> <to-version>
```

**Examples:**
```
/version-diff 3.9.1 3.10.0
/version-diff 3.9.1 4.0.0 --impact
```

**What it shows:**
- Range type (major/minor/patch)
- Total files changed in Java repo
- Files affecting ported components
- Component impacts grouped by severity
- Schema migrations if any
- Estimated upgrade effort

**Options:**
- `--impact` - Include detailed impact assessment per component
- `--component <name>` - Filter to specific component
- `--category <name>` - Filter to specific category
- `--json` - Output as JSON

**Example output:**
```
═══════════════════════════════════════════════════════════
  Version Diff: 3.9.1 → 3.10.0
═══════════════════════════════════════════════════════════

  Range Type: MINOR

  Files Changed:
    Total in Java repo:     156
    Affecting ported code:  23

  Change Summary:
    ● Major:     3
    ● Minor:     12
    ● Patch:     8
    Total:       23 components

  Estimated Effort:
    2-5 days - Medium update

  Major Changes:
    connectors/http [medium]
      - Behavior changes in HttpReceiver.java (+25/-10)
    ...
```

---

### /version-upgrade

Plan and execute version upgrades with parallel agent support.

**Subcommands:**

#### /version-upgrade plan <version>

Generate a comprehensive upgrade plan with wave breakdown.

```
/version-upgrade plan 3.10.0
```

**Output:** Detailed markdown report with:
- Executive summary
- Risk assessment
- Wave breakdown for parallel execution
- Worktree commands
- Validation checklist

#### /version-upgrade tasks <version>

Generate a task list for `tasks/upgrade-{version}.md`.

```
/version-upgrade tasks 3.10.0
/version-upgrade tasks 3.10.0 --parallel-agents
```

**Options:**
- `--parallel-agents` - Include wave breakdown and agent commands
- `--output <file>` - Custom output path
- `--json` - Output as JSON

#### /version-upgrade worktrees <version>

Generate git worktree commands for parallel agent execution.

```
/version-upgrade worktrees 3.10.0
/version-upgrade worktrees 3.10.0 --dry-run
```

---

### /version-validate

Run validation against a specific Java Mirth version.

**Usage:**
```
/version-validate <version>
```

**Examples:**
```
/version-validate 3.9.1
/version-validate 3.10.0 --deploy-java
/version-validate 3.10.0 --priority 1
```

**Options:**
- `--deploy-java` - Start Java Mirth Docker container for this version
- `--scenarios <ids>` - Run specific scenarios (comma-separated)
- `--priority <level>` - Run scenarios up to priority level

---

## Quick Workflows

### Check What Changed in Next Version

```
/version-diff 3.9.1 3.10.0
```

### Plan a Version Upgrade

```
/version-upgrade plan 3.10.0
```

This generates a detailed plan you can review before starting work.

### Generate Parallel Agent Tasks

```
/version-upgrade tasks 3.10.0 --parallel-agents
```

This creates `tasks/upgrade-3.10.0.md` with:
- Tasks grouped by severity
- Wave breakdown for parallel execution
- Git worktree commands
- Agent spawn commands

### Create Version Branch

Use the CLI directly:
```bash
npm run version-manager -- branch create 3.10.0
```

---

## Version Reference

| Java Version | Node.js Branch | Status | Notes |
|--------------|----------------|--------|-------|
| 3.9.1 | master | ✅ validated | Initial port |
| 3.10.0 | feature/3.10.x | 📋 planned | |
| 4.0.0 | feature/4.0.x | 📋 planned | Major version |
| 4.5.2 | feature/4.5.x | 📋 planned | Latest |

---

## Related Tools

- **mirth-porter agent** - Port individual components
- **version-upgrader agent** - Full version upgrade workflow with parallel agents
- **validation suite** - Side-by-side Java/Node.js comparison
