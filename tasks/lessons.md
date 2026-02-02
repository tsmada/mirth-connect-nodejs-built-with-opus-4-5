# Lessons Learned - Mirth Connect Node.js Port

## Architecture Insights

### Java Mirth Structure
- **Donkey** is the core message engine (singleton)
- **Channel** orchestrates message flow through source → destinations
- **Connectors** are abstract with receiver/dispatcher implementations
- **JavaScript execution** uses Rhino with E4X support (need transpilation)

### Key Java Classes → TypeScript Mapping
| Java Class | TypeScript File | Status |
|------------|-----------------|--------|
| Donkey.java | src/donkey/Donkey.ts | Partial |
| Channel.java | src/donkey/channel/Channel.ts | Partial |
| JavaScriptUtil.java | src/javascript/runtime/JavaScriptExecutor.ts | Implemented |
| JavaScriptScopeUtil.java | src/javascript/runtime/ScopeBuilder.ts | Implemented |
| JavaScriptBuilder.java | src/javascript/runtime/ScriptBuilder.ts | Implemented |

### Message State Machine
```
RECEIVED → FILTERED → TRANSFORMED → SENT
    ↓          ↓           ↓          ↓
  ERROR      ERROR       ERROR      ERROR
    ↓
  QUEUED → PENDING
```

### Map Variables (Critical for Scripts)
- `$c` = channelMap (per-message)
- `$s` = sourceMap (from source connector)
- `$g` = globalMap (shared across channels)
- `$gc` = globalChannelMap (per-channel persistent)
- `$cfg` = configurationMap (server config)
- `$r` = responseMap (response data)
- `$co` = connectorMap (destination-specific)

---

## Porting Patterns

### E4X → Modern JavaScript
```javascript
// E4X (Java Rhino)
var name = msg.PID['PID.5']['PID.5.1'].toString();
msg.@attribute = 'value';

// Transpiled (Node.js)
var name = msg.get('PID').get('PID.5').get('PID.5.1').toString();
msg.attr('attribute', 'value');
```

### XStream XML Serialization
- Java uses XStream for channel XML import/export
- Node.js uses fast-xml-parser with custom mappers
- Must match exact XML structure for Administrator compatibility

### Thread Model → Async/Promise
- Java uses ExecutorService with thread pools
- Node.js uses async/await with Promise.all for parallelism
- Event loop handles concurrency without explicit threads

---

## Gotchas

1. **Password hashing**: Java's mirth-commons Digester algorithm needs reverse-engineering
2. **Database timestamps**: Java uses java.sql.Timestamp, Node uses Date objects
3. **XML namespace handling**: E4X has special namespace support
4. **Response merging**: Complex logic to merge responses from multiple destinations
5. **Script isolation**: Each script execution needs fresh scope but shared globals

---

## Testing Strategy

1. Unit tests for individual components
2. Integration tests against test MySQL database
3. Validation suite comparing Node.js vs Java engine output
4. API contract tests ensuring Administrator compatibility

---

## TypeScript Strict Mode Patterns

### Database Query Patterns (mysql2/promise)

**Always extend RowDataPacket for database row interfaces:**
```typescript
// All row interfaces must extend RowDataPacket for query<T>() to work
interface AlertRow extends RowDataPacket {
  ID: string;
  NAME: string;
  ALERT: string;
}

// For aggregate queries, create specific interfaces
interface CountRow extends RowDataPacket {
  count: number;
}

interface MaxIdRow extends RowDataPacket {
  max_id: number | null;
}
```

**The execute() function returns ResultSetHeader directly:**
```typescript
// ❌ WRONG - execute() has no type parameter
const result = await execute<ResultSetHeader>('INSERT...');

// ✅ CORRECT
const result = await execute('INSERT...');
console.log(result.insertId);  // Works!
```

**Array access after length check still needs assertion:**
```typescript
const rows = await query<MyRow>('SELECT...');
if (rows.length === 0) return null;
// TypeScript doesn't narrow rows[0] to defined after length check
return rows[0]!.NAME;  // Use non-null assertion
```

### Express Route Handler Patterns

**Route params are string | undefined by default:**
```typescript
// With mergeParams: true, params come from parent route
// but TypeScript still considers them possibly undefined

// Create a helper for type-safe param extraction
function getChannelId(req: Request): string {
  return req.params.channelId as string;
}

// Use in handlers
messageRouter.get('/', async (req, res) => {
  const channelId = getChannelId(req);  // Type: string
  // ...
});
```

**Unused declarations cause errors in strict mode:**
```typescript
// ❌ Error: declared but never used
interface UnusedParams { id: string; }

// ✅ Convert to comment if for documentation
// Params: { channelId: string, messageId: string }

// ✅ Or export if might be useful
export interface UsedParams { id: string; }
```

### REST API Servlet Patterns

**Authorization middleware with channel checks:**
```typescript
// For endpoints scoped to a channel
router.get('/:messageId',
  authorize({
    operation: MESSAGE_GET,
    checkAuthorizedChannelId: 'channelId'  // Checks user has channel access
  }),
  async (req, res) => { ... }
);
```

**Response helpers for content negotiation:**
```typescript
// Use res.sendData() instead of res.json() for XML/JSON support
res.sendData(result);  // Automatically formats based on Accept header
```

---

## REST API Implementation Status

### Completed Servlets (14/15)
| Servlet | Endpoints | Notes |
|---------|-----------|-------|
| Channel | 15 | CRUD, import/export |
| Configuration | 5 | Server settings |
| Engine | 8 | Deploy, control |
| User | 10 | Auth, CRUD |
| Code Template | 12 | Libraries |
| **Channel Statistics** | 5 | Get, clear stats |
| **Event** | 8 | Audit log |
| **Alert** | 11 | Full CRUD |
| **Message** | 15 | Search, reprocess |
| **Channel Group** | 3 | Bulk update |
| **Extension** | 5 | Plugin management |
| **Database Task** | 4 | Maintenance |
| **System** | 2 | Info, stats |
| **Usage** | 1 | Reporting |

### Key Infrastructure Added
- `src/api/middleware/permissions.ts` - 37 permission constants
- `src/api/middleware/authorization.ts` - RBAC middleware
- `src/api/middleware/operations.ts` - 80+ operation definitions
- `src/db/EventDao.ts` - Event table operations
- `src/db/AlertDao.ts` - Alert table operations
- `src/db/QueryBuilder.ts` - Dynamic SQL building
- `src/api/services/EventLogger.ts` - Async audit logging
