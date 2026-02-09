# Secrets & ConfigurationMap Interactive Validation

End-to-end test that validates the full secrets pipeline through an actual Mirth channel:

```
.env.secrets → PropertiesFileProvider → SecretsManager → ConfigMapBackend → $cfg()/$secrets() → channelMap → HTTP response
```

## What This Tests

| Test | Description |
|------|-------------|
| Provider priority | `API_TOKEN` in both env and file — env wins |
| Env-only key | `ENV_ONLY_SECRET` only in `process.env`, not in file |
| `MIRTH_CFG_` prefix | `PREFIXED_SECRET` resolved via `MIRTH_CFG_PREFIXED_SECRET` |
| Missing key | `TOTALLY_MISSING_KEY` returns `undefined` → `NOT_FOUND` |
| Empty string | `EMPTY_SECRET=""` is a valid value, not `undefined` |
| `$cfg` vs `$secrets` | Both resolve from provider chain, but `$cfg` checks DB first |
| Preload API | `POST /api/secrets/preload` adds keys to sync cache at runtime |
| Individual key API | `GET /api/secrets/:key?showValue=true` |

## Quick Start

```bash
# Terminal 1: Start server with secrets
chmod +x *.sh
./start-with-secrets.sh

# Terminal 2: Deploy and test
./deploy-channel.sh
./verify-secrets.sh

# Cleanup
./cleanup.sh
```

## Manual Testing

```bash
# Quick curl test (after deploy)
curl -s -X POST http://localhost:8090/ -d "hello" | python3 -m json.tool

# Check secrets API status
curl -s http://localhost:8081/api/secrets/status -u admin:admin | python3 -m json.tool

# Look up a specific secret
curl -s http://localhost:8081/api/secrets/API_TOKEN?showValue=true -u admin:admin | python3 -m json.tool

# Preload additional keys
curl -s -X POST http://localhost:8081/api/secrets/preload \
  -u admin:admin -H "Content-Type: application/json" \
  -d '{"keys": ["DB_CONNECTION_STRING"]}' | python3 -m json.tool
```

## Expected Results

### `$cfg()` (DB first, then SecretsManager fallback)

| Key | Expected Value | Source |
|-----|---------------|--------|
| `DB_CONNECTION_STRING` | `mysql://testuser:s3cret@db.example.com:3306/mydb` | `.env.secrets` via PropertiesFileProvider |
| `API_TOKEN` | `env-override-token-789` | `process.env` (EnvProvider wins over file) |
| `WEBHOOK_URL` | `https://hooks.example.com/notify` | `.env.secrets` via PropertiesFileProvider |
| `ENV_ONLY_SECRET` | `only-in-env-not-in-file` | `process.env` (not in file) |
| `PREFIXED_SECRET` | `via-mirth-cfg-prefix` | `MIRTH_CFG_PREFIXED_SECRET` env var |
| `TOTALLY_MISSING_KEY` | `NOT_FOUND` | Not in any provider |
| `EMPTY_SECRET` | `EMPTY_STRING` | `.env.secrets` (empty string is valid) |

### `$secrets()` (SecretsManager direct, bypasses DB)

| Key | Expected Value | Source |
|-----|---------------|--------|
| `DB_CONNECTION_STRING` | `mysql://testuser:s3cret@db.example.com:3306/mydb` | Provider chain |
| `API_TOKEN` | `env-override-token-789` | EnvProvider wins |
| `TOTALLY_MISSING_KEY` | `NOT_FOUND` | Not in any provider |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  start-with-secrets.sh                                       │
│  Sets env vars + MIRTH_SECRETS_PROVIDERS=env,props           │
│  Starts Node.js Mirth in takeover mode                       │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Mirth.ts startup                                            │
│  1. SecretsManager.initialize()                              │
│     - EnvProvider (checks process.env 3 ways)                │
│     - PropertiesFileProvider (parses .env.secrets)            │
│  2. ConfigMapBackend → ConfigurationMap.setFallback()        │
│  3. ScriptSecretsMap → setSecretsFunction()                  │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Secrets Validation Channel (HTTP Listener on :8090)         │
│                                                              │
│  Source Transformer (JavaScriptStep):                         │
│    $cfg('API_TOKEN')  → configMap.get() → DB miss → fallback │
│    $secrets('API_TOKEN') → secretsMap.get() → getSync()      │
│    → channelMap.put('responseBody', JSON.stringify(result))   │
│                                                              │
│  Destination Transformer:                                    │
│    responseMap.put('d1', ResponseFactory.getSuccessResponse(  │
│      $c('responseBody')                                      │
│    ))                                                        │
│                                                              │
│  HTTP Response ← d1 response body ← JSON with all values    │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `.env.secrets` | Test secret values for PropertiesFileProvider |
| `start-with-secrets.sh` | Launch Node.js Mirth with secrets env config |
| `Secrets-Validation-Channel.xml` | Channel XML with `$cfg()`/`$secrets()` transformer |
| `deploy-channel.sh` | Create + deploy channel via REST API |
| `verify-secrets.sh` | Send test message + validate all expected values |
| `cleanup.sh` | Undeploy + delete the test channel |

## Troubleshooting

**Channel not responding on port 8090:**
- Check server logs for deployment errors
- Verify with `curl -s http://localhost:8081/api/channels/statuses -u admin:admin`
- Make sure no other process uses port 8090: `lsof -i :8090`

**Secrets returning NOT_FOUND:**
- Check provider status: `curl -s http://localhost:8081/api/secrets/status -u admin:admin`
- Verify `MIRTH_SECRETS_PROVIDERS` is set in the server process
- Check that `.env.secrets` file path is correct in `MIRTH_CONFIG_FILE`

**$cfg() returns DB value instead of secret:**
- This is correct behavior! `$cfg()` checks database first, then falls back to SecretsManager
- Use `$secrets()` for direct vault access that bypasses the database
