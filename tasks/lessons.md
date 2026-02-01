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
