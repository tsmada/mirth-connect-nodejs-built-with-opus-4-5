# Mirth Connect Java Porting Skill

Use this skill when porting functionality from Java Mirth Connect to Node.js.

## Quick Start Commands

### /port-feature <java-class-path>
Analyze a Java class and create porting plan:
1. Read the Java source file
2. Identify all public methods and their signatures
3. Map dependencies to existing Node.js implementations or flag as missing
4. Create TypeScript skeleton with JSDoc from Java comments
5. Register in manifest.json

### /compare-output <channel-xml>
Compare channel output between Java and Node.js engines:
1. Load channel from XML
2. Send test message to both engines
3. Compare: transformed data, status, maps, errors
4. Report differences

### /find-java-impl <feature-name>
Search Java codebase for implementation:
- Search patterns: class names, method names, constants
- Report file locations and line numbers
- Show relevant code snippets

## Porting Checklist

For each feature, verify:
- [ ] All public methods ported
- [ ] Same exception types thrown
- [ ] Same return values
- [ ] Same side effects (database, maps, logs)
- [ ] Thread safety maintained
- [ ] E4X patterns transpiled correctly

## Key Java Files Reference

**Core Engine:**
- `~/Projects/connect/server/src/com/mirth/connect/server/Mirth.java`
- `~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/Donkey.java`

**JavaScript Runtime:**
- `~/Projects/connect/server/src/com/mirth/connect/server/builders/JavaScriptBuilder.java`
- `~/Projects/connect/server/src/com/mirth/connect/server/util/javascript/JavaScriptScopeUtil.java`
- `~/Projects/connect/server/src/com/mirth/connect/server/util/javascript/JavaScriptUtil.java`
- `~/Projects/connect/server/src/org/mozilla/javascript/` (Rhino engine)

**Connectors:**
- `~/Projects/connect/server/src/com/mirth/connect/connectors/http/`
- `~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/`
- `~/Projects/connect/server/src/com/mirth/connect/connectors/file/`
- `~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/`

**Data Types:**
- `~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/`
- `~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/xml/`
- `~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/json/`

**REST API:**
- `~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/`

**Database:**
- `~/Projects/connect/server/dbconf/mysql/mysql-database.sql`
- `~/Projects/connect/donkey/donkeydbconf/mysql.xml`

## Porting Mindset

1. **Fidelity First**: Match Java behavior exactly before optimizing
2. **Test Driven**: Write comparison tests before implementing
3. **Incremental**: Port one method at a time, validate, commit
4. **Document Differences**: If Node.js requires different approach, document why
5. **E4X Awareness**: Always check for E4X patterns in scripts
