[← Back to README](../README.md)

# API Reference

The REST API mirrors the Mirth Connect Server API with **14 fully-implemented servlets** plus Node.js-only extensions.

## Channel Operations
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/channels` | GET, POST, PUT, DELETE | Channel CRUD operations |
| `/api/channels/{id}/status` | GET, POST | Channel status and control |
| `/api/channels/_deploy` | POST | Deploy channels |
| `/api/channels/_undeploy` | POST | Undeploy channels |
| `/api/channels/statistics` | GET, POST | Channel statistics |
| `/api/channels/{id}/messages` | GET, POST, DELETE | Message operations |
| `/api/channels/{id}/messages/_search` | POST | Search with filters |
| `/api/channels/{id}/messages/_reprocess` | POST | Reprocess messages |

## Message Tracing (Node.js Extension)
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/messages/trace/{channelId}/{messageId}` | GET | Trace message across VM-connected channels |

Query parameters: `includeContent`, `contentTypes`, `maxContentLength`, `maxDepth`, `maxChildren`, `direction`

## Server & Configuration
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/server/configuration` | GET, PUT | Server configuration |
| `/api/system/info` | GET | System information |
| `/api/system/stats` | GET | System statistics |
| `/api/usageData` | GET | Usage reporting |
| `/api/databaseTasks` | GET, POST | Database maintenance |

## Cluster & Health (Node.js Extension)
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/health` | GET | Readiness probe (no auth, 503 during shutdown) |
| `/api/health/live` | GET | Liveness probe (no auth, always 200) |
| `/api/health/startup` | GET | Startup probe (no auth, 503 until ready) |
| `/api/health/channels/{id}` | GET | Channel health (no auth) |
| `/api/system/cluster/status` | GET | All instances with deployed channels |
| `/api/system/cluster/nodes` | GET | Node list with heartbeat status |
| `/api/system/cluster/statistics` | GET | Cross-instance aggregated statistics |
| `/api/internal/dispatch` | POST | Inter-instance forwarding (cluster secret) |

## Logging (Node.js Extension)
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/system/logging` | GET | Current global level + all component overrides |
| `/api/system/logging/level` | PUT | Set global log level at runtime |
| `/api/system/logging/components/:name` | PUT, DELETE | Set or clear per-component log level override |

## Shadow Mode (Node.js Extension)
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/system/shadow` | GET | Shadow status, promoted channels, deployed/promoted counts |
| `/api/system/shadow/promote` | POST | Promote channel or trigger full cutover |
| `/api/system/shadow/demote` | POST | Demote promoted channel back to shadow |

## Artifact Management (Node.js Extension)
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/artifacts/export` | POST | Export channels to decomposed file tree |
| `/api/artifacts/export/:channelId` | GET | Export single channel |
| `/api/artifacts/import` | POST | Import from file tree (with env var resolution) |
| `/api/artifacts/diff/:channelId` | GET | Structural diff current vs git version |
| `/api/artifacts/sensitive/:channelId` | GET | Detect sensitive fields |
| `/api/artifacts/deps` | GET | Dependency graph |
| `/api/artifacts/git/status` | GET | Git repository status |
| `/api/artifacts/git/push` | POST | Export + commit + push |
| `/api/artifacts/git/pull` | POST | Pull + import + deploy |
| `/api/artifacts/git/log` | GET | Recent commit history |
| `/api/artifacts/promote` | POST | Promote to target environment |
| `/api/artifacts/promote/status` | GET | Promotion pipeline status |
| `/api/artifacts/delta` | GET | Changed artifacts between git refs |
| `/api/artifacts/deploy` | POST | Deploy changed artifacts |

## Administration
| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/users` | GET, POST, PUT, DELETE | User management |
| `/api/events` | GET, POST, DELETE | Audit log |
| `/api/events/_search` | POST | Event search |
| `/api/alerts` | GET, POST, PUT, DELETE | Alert management |
| `/api/extensions` | GET, PUT | Plugin management |
| `/api/extensions/datapruner` | GET, POST, PUT | Data Pruner status, config, start/stop |
| `/api/channelgroups` | GET, POST | Channel groups |
| `/api/codeTemplates` | GET, POST, PUT, DELETE | Code template library |
