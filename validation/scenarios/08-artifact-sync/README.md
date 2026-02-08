# Scenario 8: Artifact Sync Integration Tests

Integration tests for `src/artifact/` against a real GitHub remote.

## What It Tests

| Scenario | Description |
|----------|-------------|
| 8.1 | Export channels + push to GitHub, verify decomposed file tree |
| 8.2 | Git status/log via ArtifactController matches independent clone |
| 8.3 | Clone from GitHub + import, verify round-trip fidelity |
| 8.4 | Modify file + delta detection identifies correct channel |
| 8.5 | Multi-branch promotion (dev → staging) |
| 8.6 | Sensitive data masking (${} placeholders) |
| 8.7 | Structural diff between live channel and git version |
| 8.8 | Dependency graph structure |

## Prerequisites

1. **`gh` CLI** installed and authenticated:
   ```bash
   gh auth login
   gh auth setup-git
   ```

2. **Node.js Mirth** running on `localhost:8081`:
   ```bash
   PORT=8081 npm run dev
   ```

3. (Optional) Set GitHub owner if different from `gh` default:
   ```bash
   export GITHUB_OWNER=myusername
   ```

## Running

```bash
cd validation

# All scenarios
npm run validate:artifacts

# With verbose output
npm run validate:artifacts -- --verbose

# Single scenario
npm run validate:artifacts -- --scenario 8.3

# Keep repo after test (for debugging)
ARTIFACT_TEST_KEEP_REPO=true npm run validate:artifacts
```

## How It Works

1. Creates an ephemeral public GitHub repo (`mirth-artifact-test-{timestamp}`)
2. Clones it locally, initializes `ArtifactController`
3. Runs 8 scenarios sequentially (each builds on previous state)
4. Deletes the GitHub repo
5. Saves JSON report to `reports/artifact-integration-{timestamp}.json`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_OWNER` | auto-detected via `gh` | GitHub account for repo creation |
| `NODE_MIRTH_URL` | `http://localhost:8081` | Node.js Mirth API URL |
| `ARTIFACT_TEST_KEEP_REPO` | `false` | Set `true` to skip repo deletion |

## Troubleshooting

- **"gh CLI not authenticated"**: Run `gh auth login` and select HTTPS
- **"Node.js Mirth not reachable"**: Start with `PORT=8081 npm run dev`
- **Stale repos**: List with `gh repo list --json name | grep artifact-test`
- **Delete stale repo**: `gh repo delete OWNER/mirth-artifact-test-TIMESTAMP --yes`
