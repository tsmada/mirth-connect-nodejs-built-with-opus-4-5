/**
 * Authentication Middleware
 *
 * Session-based authentication matching Mirth Connect behavior.
 * Supports pluggable session stores: in-memory (default) or Redis (cluster mode).
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { User } from '../models/User.js';
import { getLogger, registerComponent } from '../../logging/index.js';

let _authLogger: ReturnType<typeof getLogger> | null = null;
function getAuthLogger() {
  if (!_authLogger) {
    try {
      registerComponent('auth', 'Authentication and session management');
      _authLogger = getLogger('auth');
    } catch {
      // Logging not yet initialized — fall back to console
      return null;
    }
  }
  return _authLogger;
}

// Session configuration
const SESSION_COOKIE_NAME = 'JSESSIONID';
const SESSION_HEADER_NAME = 'X-Session-ID';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export { SESSION_TIMEOUT_MS };

export interface Session {
  id: string;
  userId: number;
  user: User;
  createdAt: Date;
  lastAccess: Date;
  ipAddress?: string;
}

export interface SessionStore {
  get(id: string): Promise<Session | undefined>;
  set(id: string, session: Session): Promise<void>;
  delete(id: string): Promise<boolean>;
  has(id: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): Promise<number>;
  values(): Promise<Session[]>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async set(id: string, session: Session): Promise<void> {
    this.sessions.set(id, session);
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async has(id: string): Promise<boolean> {
    return this.sessions.has(id);
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }

  async size(): Promise<number> {
    return this.sessions.size;
  }

  async values(): Promise<Session[]> {
    return Array.from(this.sessions.values());
  }
}

export class RedisSessionStore implements SessionStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redis: any;
  private keyPrefix = 'mirth:session:';
  private ttlSeconds: number;

  constructor(redisUrl: string, ttlMs: number = SESSION_TIMEOUT_MS) {
    // Dynamic require: ioredis is loaded at construction time (optional dependency)
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 200, 2000);
      },
    });
    this.ttlSeconds = Math.ceil(ttlMs / 1000);
  }

  private key(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  private serialize(session: Session): string {
    return JSON.stringify({
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastAccess: session.lastAccess.toISOString(),
    });
  }

  private deserialize(data: string): Session {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      lastAccess: new Date(parsed.lastAccess),
    };
  }

  async get(id: string): Promise<Session | undefined> {
    const data = await this.redis.get(this.key(id));
    if (!data) return undefined;
    return this.deserialize(data);
  }

  async set(id: string, session: Session): Promise<void> {
    await this.redis.set(this.key(id), this.serialize(session), 'EX', this.ttlSeconds);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.redis.del(this.key(id));
    return result > 0;
  }

  async has(id: string): Promise<boolean> {
    const result = await this.redis.exists(this.key(id));
    return result > 0;
  }

  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async size(): Promise<number> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    return keys.length;
  }

  async values(): Promise<Session[]> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    return values
      .filter((v: string | null): v is string => v !== null)
      .map((v: string) => this.deserialize(v));
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

export function createSessionStore(): SessionStore {
  const redisUrl = process.env.MIRTH_CLUSTER_REDIS_URL;
  if (redisUrl) {
    try {
      return new RedisSessionStore(redisUrl);
    } catch (err) {
      const msg = 'Failed to connect to Redis, falling back to in-memory sessions';
      getAuthLogger()?.warn(msg) ?? console.warn(msg + ':', err);
      // Fall through to in-memory with cluster warning below
    }
  }

  const store = new InMemorySessionStore();
  if (process.env['MIRTH_CLUSTER_ENABLED'] === 'true') {
    const msg = 'Cluster mode enabled but using in-memory sessions. Users authenticated on one node will get 403 on other nodes. Set MIRTH_CLUSTER_REDIS_URL to fix.';
    getAuthLogger()?.warn(msg) ?? console.warn(msg);
  }
  return store;
}

// Module-level session store — pluggable via MIRTH_CLUSTER_REDIS_URL
const sessionStore: SessionStore = createSessionStore();

// Export for testing
export { sessionStore };

/**
 * Extend Request type with session info
 */
declare global {
  namespace Express {
    interface Request {
      session?: Session;
      userId?: number;
      user?: User;
    }
  }
}

/**
 * Create a new session for a user
 */
export async function createSession(user: User, ipAddress?: string): Promise<Session> {
  const session: Session = {
    id: uuidv4(),
    userId: user.id,
    user,
    createdAt: new Date(),
    lastAccess: new Date(),
    ipAddress,
  };
  await sessionStore.set(session.id, session);
  return session;
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<Session | undefined> {
  return sessionStore.get(sessionId);
}

/**
 * Destroy a session
 */
export async function destroySession(sessionId: string): Promise<boolean> {
  return sessionStore.delete(sessionId);
}

/**
 * Check if a user is logged in
 */
export async function isUserLoggedIn(userId: number): Promise<boolean> {
  const allSessions = await sessionStore.values();
  return allSessions.some((s) => s.userId === userId);
}

/**
 * Get all sessions for a user
 */
export async function getUserSessions(userId: number): Promise<Session[]> {
  const allSessions = await sessionStore.values();
  return allSessions.filter((s) => s.userId === userId);
}

/**
 * Clean expired sessions (no-op for Redis — TTL handles expiration)
 */
export async function cleanExpiredSessions(): Promise<void> {
  if (sessionStore instanceof RedisSessionStore) return;
  const now = Date.now();
  const allSessions = await sessionStore.values();
  for (const session of allSessions) {
    if (now - session.lastAccess.getTime() > SESSION_TIMEOUT_MS) {
      await sessionStore.delete(session.id);
    }
  }
}

// Run cleanup every 5 minutes — .unref() prevents this timer from blocking process exit
setInterval(() => { cleanExpiredSessions().catch(() => {}); }, 5 * 60 * 1000).unref();

/**
 * Mirth Connect password hashing (v3.x+):
 * Ported from: com.mirth.commons.encryption.Digester
 *
 * Algorithm:
 * - SHA256 with 1000 iterations
 * - 8-byte random salt
 * - Format: Base64(salt_8bytes + hash_32bytes)
 *
 * Legacy (pre-2.2): SALT_ + base64(8-byte-salt) + base64(SHA1(salt+password))
 */

const PRE22_PREFIX = 'SALT_';
const PRE22_SALT_LENGTH = 12; // Base64 length of 8-byte salt
const MIRTH_SALT_SIZE = 8;
const MIRTH_ITERATIONS = 1000;

/**
 * Hash password using Mirth's exact algorithm
 * Ported from: com.mirth.commons.encryption.Digester
 *
 * Algorithm:
 * 1. SHA256(salt + password) - initial digest counts as iteration 1
 * 2. Loop iterations-1 (999) times: hash = SHA256(hash)
 * 3. Result = Base64(salt + final_hash)
 */
export function hashPassword(password: string, existingSalt?: Buffer): string {
  const salt = existingSalt || crypto.randomBytes(MIRTH_SALT_SIZE);

  // Initial hash: SHA256(salt + password) - this is iteration 1
  let hash = crypto.createHash('sha256').update(salt).update(password).digest();

  // Apply iterations-1 more times (999 iterations)
  // The initial digest above counts as the first iteration
  for (let i = 0; i < MIRTH_ITERATIONS - 1; i++) {
    hash = crypto.createHash('sha256').update(hash).digest();
  }

  // Combine salt + hash and base64 encode
  return Buffer.concat([salt, hash]).toString('base64');
}

/**
 * Verify password against Mirth's hashed password format
 * @param password Plain text password to verify
 * @param _salt Unused - kept for interface compatibility (salt is embedded in hash)
 * @param storedHash Base64 encoded password hash from database
 */
export function verifyPassword(password: string, _salt: string | null, storedHash: string | null): boolean {
  if (!storedHash) {
    return false;
  }

  try {
    // Check for legacy pre-2.2 format (SALT_ prefix)
    if (storedHash.startsWith(PRE22_PREFIX)) {
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
    const computedDecoded = Buffer.from(computedHashBase64, 'base64');
    const computedHashBuf = computedDecoded.subarray(MIRTH_SALT_SIZE);

    // Use timing-safe comparison
    return crypto.timingSafeEqual(computedHashBuf, storedHashBuf);
  } catch {
    return false;
  }
}

/**
 * Verify password using legacy pre-2.2 format
 * Format: SALT_ + base64(8-byte-salt) + base64(SHA1(salt + password))
 */
function verifyPre22Password(password: string, storedHash: string): boolean {
  try {
    // Remove SALT_ prefix
    const saltHash = storedHash.substring(PRE22_PREFIX.length);

    // Extract salt (first 12 chars = 8 bytes in base64)
    const encodedSalt = saltHash.substring(0, PRE22_SALT_LENGTH);
    const encodedHash = saltHash.substring(PRE22_SALT_LENGTH);

    const decodedSalt = Buffer.from(encodedSalt, 'base64');
    const decodedHash = Buffer.from(encodedHash, 'base64');

    // Compute SHA1(salt + password) - matching Java: DigestUtils.sha(ArrayUtils.addAll(decodedSalt, plainPassword.getBytes()))
    const computedHash = crypto
      .createHash('sha1')
      .update(Buffer.concat([decodedSalt, Buffer.from(password)]))
      .digest();

    if (computedHash.length !== decodedHash.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedHash, decodedHash);
  } catch {
    return false;
  }
}

/**
 * Extract session ID from request
 */
function getSessionIdFromRequest(req: Request): string | undefined {
  // Check header first (API clients)
  const headerSession = req.get(SESSION_HEADER_NAME);
  if (headerSession) {
    return headerSession;
  }

  // Check cookies (browser clients)
  const cookieHeader = req.get('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, string>
    );
    return cookies[SESSION_COOKIE_NAME];
  }

  return undefined;
}

/**
 * Authentication middleware - validates session
 */
export function authMiddleware(options: { required?: boolean } = { required: true }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = getSessionIdFromRequest(req);

      if (sessionId) {
        const session = await getSession(sessionId);
        if (session) {
          // Check if session is expired
          const now = Date.now();
          if (now - session.lastAccess.getTime() > SESSION_TIMEOUT_MS) {
            await destroySession(sessionId);
          } else {
            // Update last access time
            session.lastAccess = new Date();
            await sessionStore.set(sessionId, session);
            req.session = session;
            req.userId = session.userId;
            req.user = session.user;
          }
        }
      }

      if (options.required && !req.session) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Set session cookie on response
 */
export function setSessionCookie(res: Response, sessionId: string): void {
  const isSecure = process.env.TLS_ENABLED === 'true' || process.env.NODE_ENV === 'production';
  const secureSuffix = isSecure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Strict${secureSuffix}`
  );
  res.setHeader(SESSION_HEADER_NAME, sessionId);
}

/**
 * Clear session cookie on response
 */
export function clearSessionCookie(res: Response): void {
  const isSecure = process.env.TLS_ENABLED === 'true' || process.env.NODE_ENV === 'production';
  const secureSuffix = isSecure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict${secureSuffix}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

/**
 * Get active session count
 */
export async function getActiveSessionCount(): Promise<number> {
  return sessionStore.size();
}

/**
 * Get all active users
 */
export async function getActiveUsers(): Promise<User[]> {
  const allSessions = await sessionStore.values();
  const userMap = new Map<number, User>();
  for (const session of allSessions) {
    if (!userMap.has(session.userId)) {
      userMap.set(session.userId, session.user);
    }
  }
  return Array.from(userMap.values());
}
