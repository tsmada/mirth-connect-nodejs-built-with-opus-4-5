# Password Hashing Fix Plan

## Problem Statement

The Node.js Mirth implementation cannot verify passwords created by Java Mirth because we were using an incorrect algorithm in our `hashPassword()` and `verifyPassword()` functions.

## Root Cause Analysis

### What We Tried (All Failed)

Previous attempts that did not work:
- SHA256(salt + password) with 1000 iterations
- SHA256(password + salt)
- SHA256 with various iteration counts

### The Actual Algorithm (From Bytecode Analysis)

Decompiled `com.mirth.commons.encryption.Digester` class from the running Mirth Connect Docker container (`/opt/connect/server-lib/mirth-crypto.jar`).

**Configuration Values:**
```
DEFAULT_SALT_SIZE = 8 bytes
DEFAULT_ITERATIONS = 1000
Algorithm = "SHA256" (set by ConfigurationController)
Provider = BouncyCastleProvider
Output = BASE64 (chunked encoding)
```

**The Exact Algorithm:**
```java
// From private byte[] digest(byte[] message, byte[] salt) method:
MessageDigest md = MessageDigest.getInstance("SHA256", bouncyCastleProvider);
md.reset();
md.update(salt);           // Step 1: Update with salt
md.update(message);        // Step 2: Update with message bytes
byte[] digestBytes = md.digest();  // Step 3: Get initial hash (iteration 1)

// Step 4: Loop iterations-1 more times (999 iterations)
for (int i = 0; i < iterations - 1; i++) {
    md.reset();
    digestBytes = md.digest(digestBytes);  // Hash the previous hash
}

// Step 5: Concatenate salt + final hash
return ArrayUtils.addAll(salt, digestBytes);
```

**Critical Insight:**
The loop runs `iterations - 1` times (999), not `iterations` times (1000). The initial `md.digest()` call counts as the first iteration.

**Output Encoding:**
```java
// From public String digest(String message) method:
byte[] combined = digest(message.getBytes(), salt);
return new String(Base64.encodeBase64Chunked(combined));
```
Note: `encodeBase64Chunked()` adds line breaks every 76 characters.

---

## Solution Implementation

### Option 1: Direct Node.js Implementation (Recommended)

Update `/Users/adamstruthers/Projects/mirth-connect-opus-4.5/src/api/middleware/auth.ts`:

```typescript
import * as crypto from 'crypto';

const MIRTH_SALT_SIZE = 8;
const MIRTH_ITERATIONS = 1000;

/**
 * Hash password using Mirth's exact algorithm
 * Ported from: com.mirth.commons.encryption.Digester
 */
export function hashPassword(password: string, existingSalt?: Buffer): string {
  const salt = existingSalt || crypto.randomBytes(MIRTH_SALT_SIZE);

  // Initial hash: SHA256(salt + password)
  const hash = crypto.createHash('sha256');
  hash.update(salt);
  hash.update(password);
  let digestBytes = hash.digest();

  // Apply iterations-1 more times (999 iterations)
  // The initial digest counts as iteration 1
  for (let i = 0; i < MIRTH_ITERATIONS - 1; i++) {
    const iterHash = crypto.createHash('sha256');
    digestBytes = iterHash.digest(digestBytes);
  }

  // Combine salt + hash
  const combined = Buffer.concat([salt, digestBytes]);

  // Use chunked Base64 encoding (adds newlines every 76 chars)
  return chunkBase64(combined.toString('base64'));
}

/**
 * Add newlines every 76 characters to match Java's encodeBase64Chunked
 */
function chunkBase64(base64: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += 76) {
    chunks.push(base64.substring(i, i + 76));
  }
  return chunks.join('\n') + (base64.length > 0 ? '\n' : '');
}

/**
 * Verify password against Mirth's hashed password format
 */
export function verifyPassword(password: string, _salt: string | null, storedHash: string | null): boolean {
  if (!storedHash) {
    return false;
  }

  try {
    // Check for legacy pre-2.2 format (SALT_ prefix)
    if (storedHash.startsWith('SALT_')) {
      return verifyPre22Password(password, storedHash);
    }

    // Modern format: Base64(8-byte-salt + 32-byte-hash)
    // Remove any whitespace/newlines from chunked Base64
    const cleanedHash = storedHash.replace(/\s/g, '');
    const decoded = Buffer.from(cleanedHash, 'base64');

    if (decoded.length !== MIRTH_SALT_SIZE + 32) {
      return false;
    }

    // Extract salt (first 8 bytes)
    const salt = decoded.subarray(0, MIRTH_SALT_SIZE);
    const storedHashBuf = decoded.subarray(MIRTH_SALT_SIZE);

    // Recompute hash with extracted salt
    const computedHashBase64 = hashPassword(password, salt);
    const computedClean = computedHashBase64.replace(/\s/g, '');
    const computedDecoded = Buffer.from(computedClean, 'base64');
    const computedHashBuf = computedDecoded.subarray(MIRTH_SALT_SIZE);

    // Use timing-safe comparison
    return crypto.timingSafeEqual(computedHashBuf, storedHashBuf);
  } catch {
    return false;
  }
}
```

### Option 2: Java Test Harness (For Validation)

Create a Java test program to generate test vectors:

```java
// TestDigester.java
import com.mirth.commons.encryption.Digester;
import com.mirth.commons.encryption.Output;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

public class TestDigester {
    public static void main(String[] args) throws Exception {
        Digester digester = new Digester();
        digester.setProvider(new BouncyCastleProvider());
        digester.setAlgorithm("SHA256");
        digester.setFormat(Output.BASE64);
        digester.initialize();

        // Generate test vectors
        String[] passwords = {"admin", "password123", "Test@1234!"};
        for (String pwd : passwords) {
            String hash = digester.digest(pwd);
            System.out.println("Password: " + pwd);
            System.out.println("Hash: " + hash);
            System.out.println("Matches: " + digester.matches(pwd, hash));
            System.out.println();
        }
    }
}
```

---

## Validation Steps

### Step 1: Generate Test Vectors from Java Mirth

Connect to the running Docker container and create test hashes:

```bash
docker exec -it docker-mirth-connect-1 bash

# Inside container, query existing password from database:
mysql -h mirth-db -u mirth -pmirth mirthdb -e "SELECT PASSWORD FROM PERSON_PASSWORD WHERE PERSON_ID=1;"
```

### Step 2: Test Node.js Implementation

```typescript
// test-password.ts
import { hashPassword, verifyPassword } from './src/api/middleware/auth';

// Test with known Java-generated hash
const javaHash = 'YzKZIAnbQ5m+3llggrZvNtf5fg69yX7pAplfYg0Dngn/fESH93OktQ==';
const password = 'admin';

console.log('Java hash:', javaHash);
console.log('Matches:', verifyPassword(password, null, javaHash));
```

### Step 3: Integration Test

1. Start Java Mirth (Docker)
2. Create a user via Java Mirth Administrator
3. Note the password hash from database
4. Start Node.js Mirth
5. Attempt login with same credentials
6. Verify authentication succeeds

---

## Handling Edge Cases

### Pre-2.2 Password Format

Already implemented correctly in `verifyPre22Password()`:
- Format: `SALT_` + base64(8-byte-salt) + base64(SHA1(salt + password))
- Detection: `storedHash.startsWith('SALT_')`

### Whitespace in Chunked Base64

Java's `encodeBase64Chunked()` adds `\r\n` every 76 characters. Always clean before decoding:

```typescript
const cleanedHash = storedHash.replace(/\s/g, '');
```

---

## Implementation Checklist

- [ ] Update `hashPassword()` to use `iterations - 1` loop
- [ ] Update `hashPassword()` to use chunked Base64 output
- [ ] Update `verifyPassword()` to clean whitespace from stored hash
- [ ] Generate test vectors from Java Mirth
- [ ] Verify Node.js implementation against test vectors
- [ ] Remove development bypass in `verifyPassword()`
- [ ] Add unit tests for password hashing
- [ ] Run integration test with Docker Java Mirth

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/api/middleware/auth.ts` | Update `hashPassword()` and `verifyPassword()` functions |
| `tests/unit/api/middleware/auth.test.ts` | Add test cases with Java-generated vectors |
| `validation/scenarios/auth/password-verification.ts` | Add integration scenario |

---

## References

### Java Source Files
- `/Users/adamstruthers/Projects/connect/server/src/com/mirth/connect/server/controllers/DefaultUserController.java`
- `/Users/adamstruthers/Projects/connect/server/src/com/mirth/connect/server/controllers/DefaultConfigurationController.java`
- `/Users/adamstruthers/Projects/connect/server/src/com/mirth/connect/model/EncryptionSettings.java`
- `/Users/adamstruthers/Projects/connect/server/src/com/mirth/connect/server/util/Pre22PasswordChecker.java`

### JAR File Location
- Docker: `/opt/connect/server-lib/mirth-crypto.jar`
- Contains: `com/mirth/commons/encryption/Digester.class`

### Bytecode Analysis Command
```bash
docker cp docker-mirth-connect-1:/opt/connect/server-lib/mirth-crypto.jar /tmp/
unzip -p /tmp/mirth-crypto.jar com/mirth/commons/encryption/Digester.class > /tmp/Digester.class
javap -c -p /tmp/Digester.class
```
