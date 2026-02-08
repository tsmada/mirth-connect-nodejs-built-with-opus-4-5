# Git-Backed Artifact Management

Manage Mirth Connect configurations as code: decompose channel XML into reviewable file trees, sync with git repositories, promote across environments, and deploy only what changed.

## Overview

Java Mirth stores channel configurations as monolithic XML blobs in the database with integer revision counters. This module decomposes those blobs into a human-readable file tree — YAML for config, `.js` for scripts — making them suitable for code review, diffing, and version control.

**What it does:**
- **Decompose** channel XML into a directory structure (YAML config + JS scripts)
- **Assemble** the directory structure back into valid channel XML (lossless round-trip)
- **Sync** bidirectionally with any git repository (GitHub, GitLab, Bitbucket, self-hosted)
- **Resolve** environment variables (`${VAR}`) at deploy time
- **Detect** sensitive data (passwords, tokens) and parameterize them
- **Diff** channel changes structurally (not raw XML diff)
- **Promote** configurations across environments (dev → staging → prod)
- **Delta deploy** only the channels that actually changed

## Quick Start (5 Minutes)

```bash
# 1. Start Node.js Mirth
PORT=8081 npm start

# 2. Login
mirth-cli login -u admin -p admin

# 3. Initialize an artifact repo
mirth-cli artifact git init ./mirth-config

# 4. Export all channels (parameterize detected secrets)
mirth-cli artifact export --all --mask-secrets

# 5. Commit and push
mirth-cli artifact git push -m "Initial export"

# 6. Inspect the result
ls mirth-config/channels/
# → adt-receiver/  hl7-router/  emr-writer/
```

## Repository Structure

After export, the git repository looks like this:

```
mirth-config/
  .mirth-sync.yaml               # Repo metadata + promotion config
  channels/
    {channel-name}/
      channel.yaml               # Metadata: id, name, version, revision, enabled
      _raw.xml                   # XML backbone (for lossless reassembly)
      source/
        connector.yaml           # Source connector properties
        filter.js                # Filter rules
        transformer.js           # Transformer steps
      destinations/
        {dest-name}/
          connector.yaml         # Destination connector properties
          filter.js
          transformer.js
          response-transformer.js
      scripts/
        deploy.js                # Channel deploy script
        undeploy.js
        preprocess.js
        postprocess.js
  code-templates/
    {library-name}/
      library.yaml
      {template-name}.js
  groups/
    groups.yaml
  config/
    config.yaml
  environments/
    base.yaml                    # Shared defaults
    dev.yaml                     # Dev overrides
    staging.yaml
    prod.yaml
```

### `.mirth-sync.yaml`

This file is auto-generated on the first export and updated on each sync. You can customize the `gitFlow` section to configure your promotion pipeline:

```yaml
engine:
  type: nodejs
  mirthVersion: "3.9.1"
  e4xSupport: true
  schemaVersion: "1"

gitFlow:
  model: environment-branches
  branches:
    dev: dev
    staging: staging
    prod: main
  autoSync:
    dev: true
    staging: false
    prod: false
```

See `examples/mirth-config/.mirth-sync.yaml` for a complete example.

## Git Provider Setup

The artifact module uses the `git` CLI under the hood — any git provider works. The only difference is authentication and remote URL format.

### GitHub

```bash
# HTTPS with personal access token
git remote add origin https://<PAT>@github.com/org/mirth-config.git

# SSH
git remote add origin git@github.com:org/mirth-config.git

# gh CLI auth (simplest)
gh auth login
```

### GitLab

```bash
# HTTPS with deploy token
git remote add origin https://deploy-token:$TOKEN@gitlab.com/org/mirth-config.git

# SSH
git remote add origin git@gitlab.com:org/mirth-config.git

# CI/CD — use CI_JOB_TOKEN
git remote set-url origin https://gitlab-ci-token:$CI_JOB_TOKEN@gitlab.com/org/mirth-config.git
```

### Bitbucket / Self-Hosted

Same git operations — configure your remote URL and auth as usual. The artifact module makes no provider-specific API calls; it only uses `git` CLI commands (init, add, commit, push, pull, diff, log).

## Deployment Strategies by Mode

**Your `MIRTH_MODE` determines your git strategy.** This is the most important architectural decision.

### Standalone Mode (Container-Native — Target State)

`MIRTH_MODE=standalone` — You own the database entirely. The container is disposable.

#### Strategy A: CI/CD Container Rebuild (Recommended)

Git is the source of truth. CI/CD builds a new container image with config baked in on every merge.

```
git merge → CI builds image → push to registry → orchestrator rolls out new containers
```

- Container is fully immutable — never SSH in, never hot-deploy
- Config changes = new container (blue-green or rolling update)
- Secrets injected by orchestrator (K8s Secrets, ECS task def, Vault)
- Rollback = deploy previous image tag

See `examples/ci/github-actions-deploy.yml` (standalone-deploy job) and `examples/ci/gitlab-ci-deploy.yml` (build-image + deploy stages).

#### Strategy B: Startup-Pull

Container starts with `MIRTH_ARTIFACT_REPO` pointing to a git URL. On startup, Mirth clones the repo and imports channels.

```bash
MIRTH_MODE=standalone \
MIRTH_ARTIFACT_REPO=https://github.com/org/mirth-config.git \
MIRTH_ARTIFACT_ENV=prod \
npm start
```

- Simpler than baking config in, but slower startup
- Restart container to pick up git changes
- Env vars injected by orchestrator

#### Strategy C: Hot-Deploy via Pipeline (Hybrid)

Long-running container, but config pushed by CI/CD calling the REST API.

```bash
# CI/CD pipeline calls:
mirth-cli artifact import --all --env prod
mirth-cli artifact deploy --delta
```

- Useful when container restart is expensive (large channel set, slow startup)
- Less "pure" container-native, but practical

### Takeover Mode (Migrating from Java Mirth)

`MIRTH_MODE=takeover` — Sharing database with Java Mirth. Container must stay running.

#### Strategy: Hot-Deploy Individual Channels

```bash
# Coordinate with Java Mirth operator: stop channel on Java, deploy on Node.js
mirth-cli artifact deploy --channels "ADT Receiver"
```

- Container is long-lived (coordinating with Java Mirth)
- CI/CD or operator deploys individual channels via REST API / CLI
- Git tracks which channels are on which engine
- Rollback = redeploy channel on Java Mirth, undeploy on Node.js

See `examples/ci/github-actions-deploy.yml` (takeover-deploy job).

### Shadow Mode (Observation Phase)

`MIRTH_SHADOW_MODE=true` — Read-only observer before cutover.

No git deploys needed — channels load from the shared database. Git is useful for auditing which channels have been promoted.

```bash
# Observe
mirth-cli shadow status

# Promote one channel at a time
mirth-cli shadow promote "ADT Receiver"

# Full cutover when ready
mirth-cli shadow cutover
```

### Migration Path: Shadow → Takeover → Standalone

| Phase | Mode | Git Role | Container Model |
|-------|------|----------|----------------|
| 1. Observe | Shadow | Audit log | Long-lived, read-only |
| 2. Migrate | Takeover | Channel-level deploy | Long-lived, mutable |
| 3. Operate | Standalone | Source of truth | Immutable, replaceable |

### Java Mirth vs Node.js Standalone

| Aspect | Java Mirth | Node.js Standalone |
|--------|------------|-------------------|
| Config storage | MySQL blobs | Git repo (source of truth) |
| Deploy method | GUI push to running server | CI/CD → new container |
| Rollback | Database backup / restore | `git revert` + redeploy |
| Env differences | Manual config per server | YAML files + env vars |
| Secrets | Stored in database | `process.env` (never in git) |
| Container model | Stateful (mutable) | Stateless (immutable) |
| Scaling | Plugin-based clustering | Container orchestrator |

## Environment Configuration

### Variable Resolution

Channel configs can reference `${VAR}` placeholders. These are resolved at deploy time with this priority chain:

1. **`process.env`** — runtime overrides (highest priority)
2. **`environments/{env}.yaml`** — environment-specific values
3. **`environments/base.yaml`** — shared defaults
4. **`${VAR:default_value}`** — inline defaults (lowest priority)

```yaml
# environments/base.yaml
DB_HOST: "localhost"

# environments/prod.yaml
DB_HOST: "prod-db.internal"

# In channel connector.yaml, reference as:
# host: ${DB_HOST}
# password: ${DB_PASSWORD}    ← comes from process.env, not YAML
```

### Secrets Management

**Never commit secrets to git.** Sensitive fields detected by the exporter are parameterized as `${CHANNEL_NAME_FIELD}` (e.g., `${ADT_RECEIVER_PASSWORD}`).

Inject secrets via your orchestrator:
- **Kubernetes**: `Secret` → `env` or `envFrom` in pod spec
- **ECS**: Task definition `secrets` section (from SSM Parameter Store or Secrets Manager)
- **Docker Compose**: `.env` file or `environment` section
- **HashiCorp Vault**: Vault Agent sidecar or CSI driver

## Promotion Workflow

Promotion moves channel configurations from one environment to the next, validating version compatibility along the way.

```bash
# Promote from dev to staging
mirth-cli artifact promote staging --source dev

# Preview changes (dry run)
mirth-cli artifact promote prod --dry-run

# Skip version compatibility checks
mirth-cli artifact promote prod --force
```

### Customizing the Pipeline

Edit the `gitFlow.branches` section in `.mirth-sync.yaml`:

```yaml
gitFlow:
  branches:
    dev: develop           # 'dev' env maps to 'develop' branch
    qa: qa                 # add a QA stage
    staging: release
    prod: main
```

The promotion pipeline validates that the target environment comes after the source in the branch ordering.

### Version Compatibility Guards

When promoting between different engine types (Node.js ↔ Java Mirth):
- **E4X scripts → Java 4.0+**: Blocked (Java 4.0+ removed E4X support)
- **ES6 scripts → Java 3.8.x**: Warning (limited Rhino ES6 support)
- **Node.js → Node.js**: Allowed (transpiler handles E4X)
- **`--force` flag**: Overrides all guards

## CI/CD Pipeline Examples

Ready-to-use pipeline configs are in `examples/ci/`:

| File | Provider | Modes |
|------|----------|-------|
| `github-actions-deploy.yml` | GitHub Actions | Standalone (container rebuild) + Takeover (hot-deploy) |
| `gitlab-ci-deploy.yml` | GitLab CI | Standalone (build + deploy stages) + Takeover (validate + deploy) |

For other CI systems (Jenkins, CircleCI, etc.), the key commands are:

```bash
# Login
mirth-cli login -u "$MIRTH_USER" -p "$MIRTH_PASS"

# Import with environment-specific variables
mirth-cli artifact import --all --env prod

# Deploy only what changed
mirth-cli artifact deploy --delta

# Health check
curl -sf "$MIRTH_URL/api/health"
```

## Troubleshooting

### "ArtifactController not initialized"

The artifact system requires `MIRTH_ARTIFACT_REPO` to be set, or manual initialization via `mirth-cli artifact git init <path>`.

### "Unresolved variables: DB_PASSWORD, SFTP_KEY"

Variables referenced in channel configs but not found in any environment YAML or `process.env`. Either add them to the appropriate environment file or inject them as environment variables.

### "Cannot promote from 'dev' to 'prod': target must come after source"

The promotion pipeline enforces environment ordering from `.mirth-sync.yaml`. Check the `gitFlow.branches` section — the key order defines the pipeline sequence.

### Git push fails with "no remote configured"

Run `git remote add origin <url>` in the artifact repo directory to configure a remote. Push/pull operations silently skip when no remote is set.

### Merge conflicts in channel.yaml

When multiple developers modify the same channel, YAML files may conflict. Resolve like any git conflict — the decomposed format makes conflicts much easier to understand than monolithic XML.

## REST API Reference

All endpoints are prefixed with `/api/artifacts`. Endpoints marked "no init" work without `MIRTH_ARTIFACT_REPO`.

| Endpoint | Method | Init Required | Description |
|----------|--------|---------------|-------------|
| `/export` | POST | Yes | Export channels to decomposed file tree |
| `/export/:channelId` | GET | Yes | Export single channel |
| `/import` | POST | Yes | Import from file tree (with env var resolution) |
| `/diff/:channelId` | GET | Yes | Structural diff current vs git |
| `/sensitive/:channelId` | GET | Yes | Detect sensitive fields |
| `/deps` | GET | No | Dependency graph |
| `/git/status` | GET | Yes | Git repository status |
| `/git/push` | POST | Yes | Export + commit + push |
| `/git/pull` | POST | Yes | Pull + import |
| `/git/log` | GET | Yes | Recent commit history |
| `/promote` | POST | Yes | Promote to target environment |
| `/promote/status` | GET | No | Promotion pipeline status |
| `/delta` | GET | Yes | Changed artifacts between git refs |
| `/deploy` | POST | Yes | Deploy changed artifacts |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_ARTIFACT_REPO` | (none) | Path to git repository for artifact sync |
| `MIRTH_ARTIFACT_ENV` | (none) | Active environment (dev, staging, prod) |
| `MIRTH_ARTIFACT_AUTO_SYNC` | `false` | Enable filesystem watcher for auto-sync |
| `MIRTH_ARTIFACT_REMOTE` | `origin` | Git remote name |
