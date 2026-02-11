# JavaScript Runtime Parity Fixes

<!-- Completed: 2026-02-10 | Status: Implemented -->

## Context

The js-runtime-checker agent identified **22 gaps** between the Java Mirth Rhino/E4X runtime and the Node.js port. While all 28 userutil classes are implemented and all major subsystems exist, there are critical wiring gaps (classes not injected into scope), missing ScriptBuilder helper functions, E4X transpilation gaps, and behavioral differences that will cause script failures at runtime.

**Root cause**: The porting focused on implementing each class in isolation but missed the Java-side "glue" — `importPackage()` in sealed scope, helper functions in `appendMiscFunctions()`, and scope variable injection in `JavaScriptScopeUtil`.

## Scope

Fix the **7 CRITICAL** and **10 MAJOR** gaps. Defer 5 MINOR items to backlog.

---

## Phase 1: Script Builder Fixes (ScriptBuilder.ts)

### 1.1 Add missing helper functions to `appendMiscFunctions()`
**File**: `src/javascript/runtime/ScriptBuilder.ts` (~line 389)

Add these functions that Java's `JavaScriptBuilder.appendMiscFunctions()` provides:

```typescript
// createSegmentAfter(name, segment) - Insert HL7 segment after existing one
function createSegmentAfter(name, segment) {
  var newSeg = XMLProxy.create('<' + name + '/>');
  if (segment && typeof segment.insertChildAfter === 'function') {
    segment.parent().insertChildAfter(segment, newSeg);
  }
  return newSeg;
}

// getArrayOrXmlLength(obj) - Handle both XML and array length
function getArrayOrXmlLength(obj) {
  if (obj === undefined || obj === null) return 0;
  if (typeof obj.length === 'function') return obj.length();
  if (typeof obj.length === 'number') return obj.length;
  return 0;
}

// Type coercion functions (used by Mapper plugin)
function newStringOrUndefined(value) {
  if (value === undefined || value === null) return value;
  return String(value);
}
function newBooleanOrUndefined(value) {
  if (value === undefined || value === null) return value;
  return Boolean(value);
}
function newNumberOrUndefined(value) {
  if (value === undefined || value === null) return value;
  return Number(value);
}

// importClass (deprecated, no-op with warning)
function importClass() {
  logger.warn('importClass() is deprecated in Node.js Mirth');
}
```

### 1.2 Fix `$()` function lookup order
**File**: `src/javascript/runtime/ScriptBuilder.ts` (~line 408)

Change the universal `$()` function to match Java's lookup order:
- Java: responseMap → connectorMap → channelMap → sourceMap → globalChannelMap → globalMap → configurationMap
- Current Node.js: localMap → connectorMap → channelMap → sourceMap → globalChannelMap → globalMap

Fix: Replace `localMap` with `responseMap`, add `configurationMap` at end.

### 1.3 Fix `$cfg()` to support put
**File**: `src/javascript/runtime/ScriptBuilder.ts` (~line 373)

Change from:
```typescript
'function $cfg(key) { return configurationMap.get(key); }'
```
To:
```typescript
'function $cfg(key, value) { if (arguments.length === 1) { return configurationMap.get(key); } else { return configurationMap.put(key, value); } }'
```

### 1.4 Fix `phase` variable to be an array
**File**: `src/javascript/runtime/ScriptBuilder.ts` (lines 499, 514, 543, 558)

Change `phase = "filter"` → `phase[0] = "filter"` and `phase = "transform"` → `phase[0] = "transform"` in all doFilter/doTransform generated functions.

### 1.5 Add auto-serialization after doTransform()
**File**: `src/javascript/runtime/ScriptBuilder.ts` (~line 200)

After `doTransform()` call in filter/transformer script, add output coercion:
```javascript
// After: if (doFilter() === true) { doTransform(); return true; }
// Convert msg/tmp back to string for the pipeline
if (typeof tmp !== 'undefined' && tmp !== null) {
  if (typeof tmp === 'xml' || (typeof tmp === 'object' && typeof tmp.toXMLString === 'function')) {
    if (tmp.hasSimpleContent()) { tmp = tmp.toXMLString(); } else { tmp = tmp.toXMLString(); }
  } else if (typeof tmp === 'object') { tmp = JSON.stringify(tmp); }
} else if (typeof msg !== 'undefined' && msg !== null) {
  if (typeof msg === 'xml' || (typeof msg === 'object' && typeof msg.toXMLString === 'function')) {
    if (msg.hasSimpleContent()) { msg = msg.toXMLString(); } else { msg = msg.toXMLString(); }
  } else if (typeof msg === 'object') { msg = JSON.stringify(msg); }
}
```

### 1.6 Replace attachment function stubs
**File**: `src/javascript/runtime/ScriptBuilder.ts` (~line 472)

Replace stubs with real implementations that delegate to `AttachmentUtil`:
- `getAttachmentIds()` → `AttachmentUtil.getMessageAttachmentIds(connectorMessage)`
- `getAttachments(base64Decode)` → `AttachmentUtil.getMessageAttachments(connectorMessage, base64Decode)` (currently missing entirely)
- `getAttachment()` → `AttachmentUtil.getMessageAttachment(...)` with proper overload handling
- `updateAttachment()` → `AttachmentUtil.updateAttachment(...)` (currently missing)
- `addAttachment()` → `AttachmentUtil.createAttachment(connectorMessage, data, type, base64Encode)`

### 1.7 Fix validate() replacement iteration
**File**: `src/javascript/runtime/ScriptBuilder.ts` (~line 391)

Change from single-pair to loop over replacement array:
```javascript
if (replacement !== undefined && replacement !== null) {
  if (Array.isArray(replacement[0])) {
    for (var i = 0; i < replacement.length; i++) {
      result = result.toString().replaceAll(replacement[i][0], replacement[i][1]);
    }
  } else {
    result = result.toString().replaceAll(replacement[0], replacement[1]);
  }
}
```

---

## Phase 2: Scope Variable Injection (ScopeBuilder.ts)

### 2.1 Inject all userutil classes into `buildBasicScope()`
**File**: `src/javascript/runtime/ScopeBuilder.ts` (~line 113)

Import and inject all userutil classes that Java makes available via `importPackage()`:

```typescript
import { DatabaseConnectionFactory } from '../userutil/DatabaseConnectionFactory.js';
import { ContextFactory } from '../userutil/ContextFactory.js';
import { FileUtil } from '../userutil/FileUtil.js';
import { HTTPUtil } from '../userutil/HTTPUtil.js';
import { DateUtil } from '../userutil/DateUtil.js';
import { SMTPConnectionFactory } from '../userutil/SMTPConnectionFactory.js';
import { UUIDGenerator } from '../userutil/UUIDGenerator.js';
import { RawMessage } from '../userutil/RawMessage.js';
import { ResponseFactory } from '../userutil/ResponseFactory.js';
import { NCPDPUtil } from '../userutil/NCPDPUtil.js';
import { DICOMUtil } from '../userutil/DICOMUtil.js';
import { AttachmentUtil } from '../userutil/AttachmentUtil.js';
import { ChannelUtil } from '../userutil/ChannelUtil.js';
import { Attachment } from '../userutil/Attachment.js';
// ... etc
```

Add to `buildBasicScope()`:
```typescript
// Userutil classes (Java: importPackage)
DatabaseConnectionFactory,
ContextFactory,
FileUtil,
HTTPUtil,
DateUtil,
SMTPConnectionFactory,
UUIDGenerator,
RawMessage,
ResponseFactory,
NCPDPUtil,
DICOMUtil,
AttachmentUtil,
ChannelUtil,
Attachment,
```

### 2.2 Inject `destinationSet` in source scope
**File**: `src/javascript/runtime/ScopeBuilder.ts`

In `buildPreprocessorScope()` and `buildFilterTransformerScope()` (when metaDataId === 0), inject:
```typescript
import { DestinationSet } from '../userutil/DestinationSet.js';
// ...
if (context.metaDataId === 0 || context.metaDataId === undefined) {
  scope.destinationSet = new DestinationSet(connectorMessage);
}
```

### 2.3 Fix `phase` initialization to array
**File**: `src/javascript/runtime/ScopeBuilder.ts`

In `buildFilterTransformerScope()`, change:
```typescript
scope.phase = phase;  // string
```
To:
```typescript
scope.phase = [phase];  // array with one element, matching Java's String[] phase
```

### 2.4 Replace placeholder classes with real implementations
**File**: `src/javascript/runtime/ScopeBuilder.ts` (lines 60-92)

The placeholder `VMRouter`, `AlertSender`, and `TemplateValueReplacer` classes should be replaced with imports of the real implementations from `src/javascript/userutil/`:
```typescript
import { VMRouter } from '../userutil/VMRouter.js';
import { AlertSender } from '../userutil/AlertSender.js';
// TemplateValueReplacer from src/utils/ValueReplacer.ts
```

Remove the local placeholder classes (lines 60-92).

---

## Phase 3: E4X Transpiler Fixes (E4XTranspiler.ts)

### 3.1 Add attribute write transpilation
**File**: `src/javascript/e4x/E4XTranspiler.ts`

Add rule BEFORE the read rule (line 318):
```typescript
// Attribute assignment: .@attr = value → .setAttr('attr', value)
// Must not match ==, !=, ===, !== comparisons
code = code.replace(/\.@(\w+)\s*=\s*(?!=)([^;,\n]+)/g, ".setAttr('$1', $2)");
```

### 3.2 Implement named property deletion in XMLProxy
**File**: `src/javascript/e4x/XMLProxy.ts` (~line 121)

Fix `deleteProperty` trap to handle named properties:
```typescript
deleteProperty: (target, prop) => {
  if (typeof prop === 'string' && !isNaN(Number(prop))) {
    target.deleteAt(Number(prop));
  } else if (typeof prop === 'string') {
    target.removeChild(prop);  // New method needed
  }
  return true;
},
```

Add `removeChild(name: string)` method to XMLProxy class.

### 3.3 Add `text()` and `elements()` methods to XMLProxy
**File**: `src/javascript/e4x/XMLProxy.ts`

```typescript
text(): string {
  return this.toString();  // toString already collects text content
}

elements(): XMLProxy {
  // Return only element children (exclude text nodes)
  const elementChildren = this.children().getNodes()
    .filter(node => !('#text' in node));
  return new XMLProxy(elementChildren, this.tagName, this);
}
```

### 3.4 Add E4X append operator transpilation (+=)
**File**: `src/javascript/e4x/E4XTranspiler.ts`

This is context-sensitive — only applies when LHS is XML. Add rule:
```typescript
// xml += <tag/> → xml.append(XMLProxy.create('<tag/>'))
// Only when RHS is XML literal (detected by < prefix)
```

### 3.5 E4X filtering predicates (stretch goal)
**File**: `src/javascript/e4x/E4XTranspiler.ts`

Pattern: `xml.child.(condition)` → filtering by condition. This is complex and rarely used. Implement as a `filter()` method on XMLProxy.

---

## Phase 4: Missing Userutil Classes

### 4.1 Create XmlUtil.ts
**File**: `src/javascript/userutil/XmlUtil.ts` (new)

Methods:
- `prettyPrint(input: string): string` — format XML with indentation (use fast-xml-parser)
- `decode(entity: string): string` — decode XML entities
- `encode(char: string): string` — encode to XML entity
- `toJson(xmlString: string, ...): string` — convert XML to JSON

### 4.2 Create JsonUtil.ts
**File**: `src/javascript/userutil/JsonUtil.ts` (new)

Methods:
- `prettyPrint(input: string): string` — `JSON.stringify(JSON.parse(input), null, 2)`
- `escape(input: string): string` — escape JSON special chars
- `toXml(jsonString: string): string` — convert JSON to XML

### 4.3 Create Lists.ts, Maps.ts, ListBuilder.ts, MapBuilder.ts
**File**: `src/javascript/userutil/Lists.ts`, `Maps.ts`, etc. (new)

Fluent builder wrappers for JavaScript arrays and maps:
```typescript
export class Lists {
  static list(...items: unknown[]): ListBuilder { return new ListBuilder(...items); }
}
export class ListBuilder {
  private items: unknown[];
  constructor(...items: unknown[]) { this.items = [...items]; }
  append(item: unknown): this { this.items.push(item); return this; }
  toArray(): unknown[] { return this.items; }
}
```

---

## Phase 5: Tests

### Test files to create/modify:
1. `tests/unit/javascript/ScriptBuilder.parity.test.ts` — Test all new helper functions
2. `tests/unit/javascript/ScopeBuilder.parity.test.ts` — Test userutil class injection
3. `tests/unit/javascript/E4XTranspiler.parity.test.ts` — Test attribute write, delete, append
4. `tests/unit/javascript/XMLProxy.parity.test.ts` — Test text(), elements(), removeChild()
5. `tests/unit/javascript/userutil/XmlUtil.test.ts` — New
6. `tests/unit/javascript/userutil/JsonUtil.test.ts` — New
7. `tests/unit/javascript/userutil/Lists.test.ts` — New

### Verification checklist:
1. Deploy HL7 channel with transformer — output should be HL7 string, not `[object Object]`
2. Source filter using `destinationSet.remove(1)` — should not throw ReferenceError
3. Script using `DatabaseConnectionFactory.createDatabaseConnection(...)` — should execute
4. Mapper step using `newStringOrUndefined(msg['PID']['PID.5'].toString())` — should execute
5. Script using `$('someKey')` where key exists in responseMap — should find it
6. Script using `msg.MSH.@version = '2.5'` — should set attribute
7. Script using `delete msg.PID['PID.6']` — should remove element
8. Script using `addAttachment(data, 'application/pdf', true)` — should create attachment
9. Script using `XmlUtil.prettyPrint(xmlString)` — should format XML
10. Script using `phase[0]` in error handler — should return phase name

---

## Files Modified

| File | Changes |
|------|---------|
| `src/javascript/runtime/ScriptBuilder.ts` | Add 6 helper functions, fix $()/$cfg(), fix phase, add auto-serialization, wire attachment functions |
| `src/javascript/runtime/ScopeBuilder.ts` | Inject 15+ userutil classes, add destinationSet, fix phase type, replace placeholders |
| `src/javascript/e4x/E4XTranspiler.ts` | Add attribute write rule, += append rule |
| `src/javascript/e4x/XMLProxy.ts` | Fix deleteProperty, add text()/elements()/removeChild() |
| `src/javascript/userutil/XmlUtil.ts` | New file |
| `src/javascript/userutil/JsonUtil.ts` | New file |
| `src/javascript/userutil/Lists.ts` | New file |
| `src/javascript/userutil/Maps.ts` | New file |
| `src/javascript/userutil/index.ts` | Add new exports |
| 7 test files | New/modified |

## Deferred (Minor)

- JRC-ECL-001: Source map support for error line numbers
- JRC-STO-001: Script timeout behavior differences (documented, acceptable)
- JRC-SBE-001: Sandbox prototype chain freezing
- JRC-SBD-008: Code template context type filtering
