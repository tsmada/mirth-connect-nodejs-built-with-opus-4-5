/**
 * Crypto Pattern Integration Tests — VM Sandbox Execution
 *
 * These tests execute Java crypto API calls inside a real vm.createContext()
 * sandbox, verifying that the crypto shims work correctly in the exact
 * same execution environment as production Mirth user scripts.
 *
 * Patterns sourced from real-world Mirth channels that use:
 *   - java.security.MessageDigest for message deduplication
 *   - java.util.Base64 for encoding attachments
 *   - javax.crypto.Cipher for PHI encryption
 *   - javax.crypto.Mac for webhook HMAC verification
 *   - javax.crypto.KeyGenerator for key generation
 *   - java.security.SecureRandom for nonce generation
 */

import * as vm from 'vm';
import * as crypto from 'crypto';
import { createJavaNamespace, createPackagesNamespace } from '../../../src/javascript/shims/JavaInterop.js';

/** Helper: execute a script string in a VM context with full Java namespace */
function runInVM(script: string, extraScope: Record<string, unknown> = {}): unknown {
  const java = createJavaNamespace();
  const Packages = createPackagesNamespace(java);
  const scope = { java, Packages, Buffer, parseInt, parseFloat, ...extraScope };
  const context = vm.createContext(scope);
  return new vm.Script(script, { filename: 'crypto-test.js' }).runInContext(context);
}

describe('Crypto Pattern Integration Tests (VM Sandbox)', () => {

  // ========================================================================
  // Category 1: MessageDigest — Hashing
  // ========================================================================

  describe('MessageDigest in VM', () => {
    it('should hash an HL7 message for deduplication (SHA-256)', () => {
      const result = runInVM(`
        var md = java.security.MessageDigest.getInstance("SHA-256");
        var hash = md.digest("MSH|^~\\\\&|SEND|FAC|RCV|FAC|202601010000||ADT^A01|MSG001|P|2.5.1");
        // Convert to hex string
        var hex = '';
        for (var i = 0; i < hash.length; i++) {
          var b = hash[i] & 0xff;
          hex += (b < 16 ? '0' : '') + b.toString(16);
        }
        hex;
      `);
      expect(typeof result).toBe('string');
      expect((result as string).length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
    });

    it('should compute MD5 for legacy deduplication', () => {
      const result = runInVM(`
        var md = java.security.MessageDigest.getInstance("MD5");
        md.update("test message");
        var hash = md.digest();
        java.util.Base64.getEncoder().encodeToString(hash);
      `);
      expect(typeof result).toBe('string');
      expect((result as string).length).toBeGreaterThan(0);
    });

    it('should use java.security.MessageDigest via full Packages path', () => {
      const result = runInVM(`
        var MessageDigest = Packages.java.security.MessageDigest;
        var md = MessageDigest.getInstance("SHA-256");
        var hash = md.digest("abc");
        // Convert to hex
        var hex = '';
        for (var i = 0; i < hash.length; i++) {
          var b = hash[i] & 0xff;
          hex += (b < 16 ? '0' : '') + b.toString(16);
        }
        hex;
      `);
      expect(result).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
  });

  // ========================================================================
  // Category 2: Base64 — Encoding/Decoding
  // ========================================================================

  describe('Base64 in VM', () => {
    it('should encode and decode a string', () => {
      const result = runInVM(`
        var encoded = java.util.Base64.getEncoder().encodeToString(Buffer.from("Hello PHI"));
        var decoded = java.util.Base64.getDecoder().decode(encoded);
        decoded.toString("utf-8");
      `);
      expect(result).toBe('Hello PHI');
    });

    it('should combine Base64 encode + SHA-256 hash (common pattern)', () => {
      const result = runInVM(`
        var data = Buffer.from("patient-record-12345");
        var encoded = java.util.Base64.getEncoder().encodeToString(data);

        var md = java.security.MessageDigest.getInstance("SHA-256");
        var hash = md.digest(encoded);
        java.util.Base64.getEncoder().encodeToString(hash);
      `);
      expect(typeof result).toBe('string');
      expect((result as string).length).toBeGreaterThan(0);
    });

    it('should use URL-safe Base64 for JWT-like tokens', () => {
      const result = runInVM(`
        var header = Buffer.from('{"alg":"HS256","typ":"JWT"}');
        var encoded = java.util.Base64.getUrlEncoder().encodeToString(header);
        encoded;
      `);
      const encoded = result as string;
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('should handle Java-style getBytes("UTF-8") -> digest -> Base64 round-trip', () => {
      const result = runInVM(`
        var input = "patient MRN: 123456";
        var bytes = Buffer.from(input, "utf-8");
        var md = java.security.MessageDigest.getInstance("SHA-256");
        var hash = md.digest(bytes);
        java.util.Base64.getEncoder().encodeToString(hash);
      `);
      // Verify against Node.js crypto
      const expected = crypto.createHash('sha256')
        .update('patient MRN: 123456').digest().toString('base64');
      expect(result).toBe(expected);
    });
  });

  // ========================================================================
  // Category 3: Cipher — AES Encryption/Decryption
  // ========================================================================

  describe('Cipher in VM', () => {
    it('should encrypt/decrypt PHI field with AES-256-CBC', () => {
      const result = runInVM(`
        var Cipher = Packages.javax.crypto.Cipher;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;
        var IvParameterSpec = Packages.javax.crypto.spec.IvParameterSpec;

        var key = Buffer.alloc(32, 0x42);
        var iv = Buffer.alloc(16, 0x00);
        var phi = "SSN: 123-45-6789";

        // Encrypt
        var cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(1, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var encrypted = cipher.doFinal(phi);

        // Decrypt
        var decipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        decipher.init(2, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var decrypted = decipher.doFinal(encrypted);

        decrypted.toString("utf-8");
      `);
      expect(result).toBe('SSN: 123-45-6789');
    });

    it('should encrypt with AES/GCM/NoPadding (authenticated encryption)', () => {
      const result = runInVM(`
        var Cipher = Packages.javax.crypto.Cipher;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;
        var IvParameterSpec = Packages.javax.crypto.spec.IvParameterSpec;

        var key = Buffer.alloc(32, 0xAB);
        var iv = Buffer.alloc(12, 0x01);
        var plaintext = "HIPAA-protected data";

        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(1, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var encrypted = cipher.doFinal(plaintext);

        var decipher = Cipher.getInstance("AES/GCM/NoPadding");
        decipher.init(2, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var decrypted = decipher.doFinal(encrypted);

        decrypted.toString("utf-8");
      `);
      expect(result).toBe('HIPAA-protected data');
    });

    it('should support Cipher.ENCRYPT_MODE / DECRYPT_MODE constants', () => {
      // In Java: Cipher.ENCRYPT_MODE = 1, Cipher.DECRYPT_MODE = 2
      // Verify that using numeric literals 1 and 2 works (as in real channels)
      const result = runInVM(`
        var Cipher = Packages.javax.crypto.Cipher;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;
        var IvParameterSpec = Packages.javax.crypto.spec.IvParameterSpec;

        var key = Buffer.alloc(16, 0x33);
        var iv = Buffer.alloc(16, 0x44);

        var c = Cipher.getInstance("AES/CBC/PKCS5Padding");
        c.init(1, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var enc = c.doFinal("test");

        var d = Cipher.getInstance("AES/CBC/PKCS5Padding");
        d.init(2, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        d.doFinal(enc).toString("utf-8");
      `);
      expect(result).toBe('test');
    });
  });

  // ========================================================================
  // Category 4: Mac — HMAC Signatures
  // ========================================================================

  describe('Mac in VM', () => {
    it('should verify HMAC-SHA256 webhook signature', () => {
      const webhookSecret = 'whsec_test123456';
      const payload = '{"event":"patient.created","id":"pat-001"}';
      const expectedSig = crypto.createHmac('sha256', webhookSecret)
        .update(payload).digest('hex');

      const result = runInVM(`
        var Mac = Packages.javax.crypto.Mac;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;

        var secret = "${webhookSecret}";
        var payload = '${payload}';

        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Buffer.from(secret), "HmacSHA256"));
        var sig = mac.doFinal(payload);

        // Convert to hex
        var hex = '';
        for (var i = 0; i < sig.length; i++) {
          var b = sig[i] & 0xff;
          hex += (b < 16 ? '0' : '') + b.toString(16);
        }
        hex;
      `);
      expect(result).toBe(expectedSig);
    });

    it('should support Mac chained update() calls', () => {
      const result = runInVM(`
        var Mac = Packages.javax.crypto.Mac;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;

        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Buffer.from("key"), "HmacSHA256"));
        mac.update("part1");
        mac.update("part2");
        var result = mac.doFinal();

        java.util.Base64.getEncoder().encodeToString(result);
      `);
      // Verify against Node.js crypto
      const expected = crypto.createHmac('sha256', 'key')
        .update('part1part2').digest().toString('base64');
      expect(result).toBe(expected);
    });

    it('should compute HMAC-SHA1 for legacy integrations', () => {
      const result = runInVM(`
        var Mac = Packages.javax.crypto.Mac;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;

        var mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(Buffer.from("secret"), "HmacSHA1"));
        var sig = mac.doFinal("message");
        sig.length;
      `);
      expect(result).toBe(20); // SHA-1 = 20 bytes
    });
  });

  // ========================================================================
  // Category 5: KeyGenerator
  // ========================================================================

  describe('KeyGenerator in VM', () => {
    it('should generate key -> encrypt -> decrypt round-trip', () => {
      const result = runInVM(`
        var KeyGenerator = Packages.javax.crypto.KeyGenerator;
        var Cipher = Packages.javax.crypto.Cipher;
        var IvParameterSpec = Packages.javax.crypto.spec.IvParameterSpec;

        // Generate a 256-bit AES key
        var kg = KeyGenerator.getInstance("AES");
        kg.init(256);
        var secretKey = kg.generateKey();

        var iv = Buffer.alloc(16, 0x00);
        var plaintext = "Generated-key encryption test";

        // Encrypt
        var cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(1, secretKey, new IvParameterSpec(iv));
        var encrypted = cipher.doFinal(plaintext);

        // Decrypt
        var decipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        decipher.init(2, secretKey, new IvParameterSpec(iv));
        var decrypted = decipher.doFinal(encrypted);

        decrypted.toString("utf-8");
      `);
      expect(result).toBe('Generated-key encryption test');
    });
  });

  // ========================================================================
  // Category 6: SecureRandom
  // ========================================================================

  describe('SecureRandom in VM', () => {
    it('should generate nonce for encryption', () => {
      const result = runInVM(`
        var SecureRandom = Packages.java.security.SecureRandom;
        var sr = SecureRandom.getInstance("SHA1PRNG");
        var nonce = Buffer.alloc(16);
        sr.nextBytes(nonce);
        nonce.length;
      `);
      expect(result).toBe(16);
    });

    it('should generate random values within bounds', () => {
      const result = runInVM(`
        var sr = java.security.SecureRandom.getInstance("SHA1PRNG");
        var values = [];
        for (var i = 0; i < 50; i++) {
          values.push(sr.nextInt(100));
        }
        // All should be in [0, 100)
        var allValid = values.every(function(v) { return v >= 0 && v < 100; });
        allValid;
      `);
      expect(result).toBe(true);
    });
  });

  // ========================================================================
  // Category 7: Error Handling
  // ========================================================================

  describe('Error handling in VM', () => {
    it('should throw for invalid MessageDigest algorithm', () => {
      expect(() => runInVM(`
        java.security.MessageDigest.getInstance("INVALID-ALGO");
      `)).toThrow('NoSuchAlgorithmException');
    });

    it('should throw for uninitialized Mac', () => {
      expect(() => runInVM(`
        var mac = Packages.javax.crypto.Mac.getInstance("HmacSHA256");
        mac.doFinal("data");
      `)).toThrow('Mac not initialized');
    });

    it('should throw for GCM decryption with corrupted ciphertext', () => {
      expect(() => runInVM(`
        var Cipher = Packages.javax.crypto.Cipher;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;
        var IvParameterSpec = Packages.javax.crypto.spec.IvParameterSpec;

        var key = Buffer.alloc(32, 0x42);
        var iv = Buffer.alloc(12, 0x00);

        var c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(1, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var encrypted = c.doFinal("secret data");

        // Corrupt the ciphertext
        encrypted[0] = encrypted[0] ^ 0xff;

        var d = Cipher.getInstance("AES/GCM/NoPadding");
        d.init(2, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        d.doFinal(encrypted);
      `)).toThrow();
    });
  });

  // ========================================================================
  // Category 8: Combined Patterns (Real-World Workflow)
  // ========================================================================

  describe('Combined crypto workflows in VM', () => {
    it('should implement HMAC + Base64 for API auth header', () => {
      const result = runInVM(`
        var Mac = Packages.javax.crypto.Mac;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;

        var apiKey = "api-key-12345";
        var timestamp = "20260220T120000Z";
        var body = '{"patientId":"P001"}';

        var signingString = timestamp + "\\n" + body;

        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Buffer.from(apiKey), "HmacSHA256"));
        var signature = mac.doFinal(signingString);

        "HMAC " + java.util.Base64.getEncoder().encodeToString(signature);
      `);
      expect((result as string).startsWith('HMAC ')).toBe(true);
      // HMAC + space + base64 (44 chars for SHA-256)
      expect((result as string).length).toBe(5 + 44);
    });

    it('should implement hash-then-encrypt for PHI deidentification', () => {
      const result = runInVM(`
        var MessageDigest = java.security.MessageDigest;
        var Cipher = Packages.javax.crypto.Cipher;
        var SecretKeySpec = Packages.javax.crypto.spec.SecretKeySpec;
        var IvParameterSpec = Packages.javax.crypto.spec.IvParameterSpec;

        // Step 1: Hash the MRN for deduplication token
        var mrn = "MRN-2026-001234";
        var md = MessageDigest.getInstance("SHA-256");
        var mrnHash = md.digest(mrn);
        var dedupeToken = java.util.Base64.getEncoder().encodeToString(mrnHash);

        // Step 2: Encrypt the SSN
        var key = Buffer.alloc(32, 0xAA);
        var iv = Buffer.alloc(16, 0xBB);
        var cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(1, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var encryptedSSN = cipher.doFinal("123-45-6789");
        var encryptedBase64 = java.util.Base64.getEncoder().encodeToString(encryptedSSN);

        // Step 3: Decrypt to verify
        var decipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        decipher.init(2, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        var decrypted = decipher.doFinal(java.util.Base64.getDecoder().decode(encryptedBase64));

        ({
          dedupeToken: dedupeToken,
          encryptedSSN: encryptedBase64,
          decryptedSSN: decrypted.toString("utf-8"),
          verified: decrypted.toString("utf-8") === "123-45-6789"
        });
      `) as { dedupeToken: string; encryptedSSN: string; decryptedSSN: string; verified: boolean };

      expect(result.verified).toBe(true);
      expect(result.decryptedSSN).toBe('123-45-6789');
      expect(result.dedupeToken.length).toBe(44); // Base64 of 32-byte hash
      expect(result.encryptedSSN.length).toBeGreaterThan(0);
    });
  });
});
