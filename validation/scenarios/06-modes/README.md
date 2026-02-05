# Scenario 6: Operational Modes

This scenario validates the dual operational modes for the Node.js Mirth runtime.

## Modes

### Takeover Mode (6.1)
Connect to an existing Java Mirth database without modifying the schema.

**Prerequisites:**
- Java Mirth running with initialized database
- Accessible MySQL connection

**Environment:**
```bash
MIRTH_MODE=takeover
```

### Standalone Mode (6.2)
Create database schema from scratch and operate independently.

**Prerequisites:**
- Empty MySQL database (no Mirth tables)

**Environment:**
```bash
MIRTH_MODE=standalone
```

### Auto Detection (6.3)
Automatically detect mode based on database state.

**Logic:**
1. Check `MIRTH_MODE` environment variable first
2. If not set or `auto`:
   - Query `information_schema.TABLES` for `CHANNEL` table
   - If exists → takeover mode
   - If not exists → standalone mode

## Running Scenarios

### Takeover Mode Test
```bash
# 1. Start Java Mirth
cd validation && docker-compose up -d

# 2. Run validation
MIRTH_MODE=takeover npm test -- --testPathPattern "06-modes/takeover"
```

### Standalone Mode Test
```bash
# 1. Create empty database
docker run -d --name mirth-test-standalone \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=mirthdb_test \
  -p 3307:3306 mysql:8

# 2. Wait for MySQL to initialize
sleep 30

# 3. Run validation
MIRTH_MODE=standalone DB_PORT=3307 DB_NAME=mirthdb_test \
  npm test -- --testPathPattern "06-modes/standalone"
```

### Auto Detection Test
```bash
npm test -- --testPathPattern "06-modes/auto-detect"
```

## Expected Results

| Scenario | Expected Outcome |
|----------|------------------|
| 6.1 Takeover | Schema verification passes, no DDL operations |
| 6.2 Standalone | All tables created, admin login works |
| 6.3 Auto | Correct mode detected based on DB state |
