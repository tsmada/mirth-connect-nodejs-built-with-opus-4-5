/**
 * Authentication Middleware
 *
 * Session-based authentication matching Mirth Connect behavior.
 * Uses simple in-memory session store (replace with Redis in production).
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { User } from '../models/User.js';

// Session store (in-memory for now)
interface Session {
  id: string;
  userId: number;
  user: User;
  createdAt: Date;
  lastAccess: Date;
  ipAddress?: string;
}

const sessions = new Map<string, Session>();

// Session configuration
const SESSION_COOKIE_NAME = 'JSESSIONID';
const SESSION_HEADER_NAME = 'X-Session-ID';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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
export function createSession(user: User, ipAddress?: string): Session {
  const session: Session = {
    id: uuidv4(),
    userId: user.id,
    user,
    createdAt: new Date(),
    lastAccess: new Date(),
    ipAddress,
  };
  sessions.set(session.id, session);
  return session;
}

/**
 * Get session by ID
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/**
 * Destroy a session
 */
export function destroySession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/**
 * Check if a user is logged in
 */
export function isUserLoggedIn(userId: number): boolean {
  for (const session of sessions.values()) {
    if (session.userId === userId) {
      return true;
    }
  }
  return false;
}

/**
 * Get all sessions for a user
 */
export function getUserSessions(userId: number): Session[] {
  return Array.from(sessions.values()).filter((s) => s.userId === userId);
}

/**
 * Clean expired sessions
 */
export function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccess.getTime() > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanExpiredSessions, 5 * 60 * 1000);

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
  return (req: Request, res: Response, next: NextFunction) => {
    const sessionId = getSessionIdFromRequest(req);

    if (sessionId) {
      const session = getSession(sessionId);
      if (session) {
        // Check if session is expired
        const now = Date.now();
        if (now - session.lastAccess.getTime() > SESSION_TIMEOUT_MS) {
          destroySession(sessionId);
        } else {
          // Update last access time
          session.lastAccess = new Date();
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
  };
}

/**
 * Set session cookie on response
 */
export function setSessionCookie(res: Response, sessionId: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly`);
  res.setHeader(SESSION_HEADER_NAME, sessionId);
}

/**
 * Clear session cookie on response
 */
export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Get all active users
 */
export function getActiveUsers(): User[] {
  const userMap = new Map<number, User>();
  for (const session of sessions.values()) {
    if (!userMap.has(session.userId)) {
      userMap.set(session.userId, session.user);
    }
  }
  return Array.from(userMap.values());
}
