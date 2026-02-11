[← Back to README](../README.md)

# Git-Backed Artifact Management

> **Node.js-only feature** — Java Mirth has no built-in git integration.

Manage Mirth configurations as code: decompose channel XML into reviewable file trees, sync with git repositories, promote across environments, and deploy only what changed.

## Quick Start

```bash
# 1. Initialize an artifact repository
mirth-cli artifact git init ./mirth-config

# 2. Export all channels to decomposed file trees
mirth-cli artifact export --all --mask-secrets

# 3. Commit and push
mirth-cli artifact git push -m "Initial export"

# 4. View the decomposed structure
ls mirth-config/channels/
# → adt-receiver/  hl7-router/  emr-writer/
ls mirth-config/channels/adt-receiver/
# → channel.yaml  _raw.xml  source/  destinations/  scripts/
```

## Environment Setup

```yaml
# mirth-config/environments/base.yaml (shared defaults)
MLLP_PORT: "6661"
DB_HOST: "localhost"
LOG_LEVEL: "INFO"

# mirth-config/environments/prod.yaml (production overrides)
MLLP_PORT: "6661"
DB_HOST: "prod-db.internal"
LOG_LEVEL: "WARN"
# Secrets come from process.env, NOT this file
```

## Promotion Workflow

```bash
# Promote from dev to staging (validates version compatibility)
mirth-cli artifact promote staging --source dev

# Preview what would change (dry run)
mirth-cli artifact promote prod --dry-run

# Force promotion past version guards
mirth-cli artifact promote prod --force
```

## Delta Deploy

```bash
# Deploy only channels changed since last sync
mirth-cli artifact deploy --delta

# Deploy from a specific git commit
mirth-cli artifact deploy --from abc1234

# Deploy specific channels only
mirth-cli artifact deploy --channels "ADT Receiver,HL7 Router"

# Rollback to a previous state
mirth-cli artifact rollback abc1234
```

## CI/CD Integration Example

```yaml
# .github/workflows/deploy.yml
name: Deploy Mirth Config
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to production
        run: |
          mirth-cli login -u ${{ secrets.MIRTH_USER }} -p ${{ secrets.MIRTH_PASS }}
          mirth-cli artifact import --all --env prod
          mirth-cli artifact deploy --delta
        env:
          MIRTH_CLI_URL: ${{ secrets.MIRTH_URL }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
          SFTP_PASSWORD: ${{ secrets.SFTP_PASSWORD }}
```

## Structural Diff

```bash
$ mirth-cli artifact diff "ADT Receiver"

Channel: ADT Receiver (3 changes)

--- source/connector.yaml ---
  port: 6661 → 6662
  maxConnections: 10 → 20

--- destinations/dest-1/transformer.js ---
@@ -5,3 +5,4 @@
 $c('sourceValue', 'fromSource');
+$c('patientDOB', msg['PID']['PID.7']['PID.7.1'].toString());
 $c('patientMRN', msg['PID']['PID.3']['PID.3.1'].toString());
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_ARTIFACT_REPO` | (none) | Path to git repository for artifact sync |
| `MIRTH_ARTIFACT_ENV` | (none) | Active environment (dev, staging, prod) |
| `MIRTH_ARTIFACT_AUTO_SYNC` | `false` | Enable filesystem watcher for auto-sync |
| `MIRTH_ARTIFACT_REMOTE` | `origin` | Git remote name |
