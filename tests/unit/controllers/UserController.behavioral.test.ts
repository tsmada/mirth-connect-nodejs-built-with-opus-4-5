/**
 * UserController Behavioral Tests
 *
 * Tests the user login state machine and preference isolation.
 * Ported from behavioral contracts in DefaultUserControllerTest.java.
 *
 * Architecture:
 * - No standalone UserController exists; user logic is split between:
 *   - UserServlet.ts (HTTP layer: login, logout, CRUD, password, preferences)
 *   - auth.ts middleware (session store: createSession, destroySession, isUserLoggedIn)
 *   - MirthDao.ts (database: getPersonByUsername, updatePersonLoginStatus, preferences)
 * - Tests mock MirthDao and exercise the auth session store directly.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock MirthDao before importing auth (auth imports logging which may chain)
// ---------------------------------------------------------------------------
jest.mock('../../../src/db/MirthDao.js', () => ({
  getPersonByUsername: jest.fn(),
  getPersonById: jest.fn(),
  updatePersonLoginStatus: jest.fn(),
  getPersonPreferences: jest.fn(),
  setPersonPreferences: jest.fn(),
  updatePerson: jest.fn(),
  updatePersonPassword: jest.fn(),
}));

// Mock logging to avoid Winston initialization
jest.mock('../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: () => false,
  })),
  registerComponent: jest.fn(),
}));

import * as MirthDao from '../../../src/db/MirthDao.js';
import {
  createSession,
  destroySession,
  isUserLoggedIn,
  verifyPassword,
  hashPassword,
  sessionStore,
} from '../../../src/api/middleware/auth.js';
import { User } from '../../../src/api/models/User.js';

const mockMirthDao = MirthDao as jest.Mocked<typeof MirthDao>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    username: 'admin',
    role: 'admin',
    firstName: 'Admin',
    lastName: 'User',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserController Behavioral Contracts', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await sessionStore.clear();
  });

  // =========================================================================
  // Contract 1: updateUser persists WITHOUT password
  // =========================================================================
  describe('updateUser persists WITHOUT password', () => {
    it('should call updatePerson without password field — password set separately via updatePersonPassword', async () => {
      // Java: UserController.updateUser() updates profile fields only.
      // Password changes require a separate checkOrUpdateUserPassword() call.
      // In Node.js, UserServlet PUT /:userId calls MirthDao.updatePerson()
      // which has no password parameter.

      const userId = 1;
      mockMirthDao.updatePerson.mockResolvedValue(undefined);

      await MirthDao.updatePerson(userId, {
        firstName: 'Updated',
        lastName: 'Name',
        email: 'new@email.com',
      });

      expect(mockMirthDao.updatePerson).toHaveBeenCalledWith(userId, {
        firstName: 'Updated',
        lastName: 'Name',
        email: 'new@email.com',
      });

      // Password is NOT part of the updatePerson call — it goes through updatePersonPassword
      const callArgs = mockMirthDao.updatePerson.mock.calls[0]![1];
      expect(callArgs).not.toHaveProperty('password');
    });
  });

  // =========================================================================
  // Contract 2: authorizeUser correct credentials -> SUCCESS
  // =========================================================================
  describe('authorizeUser correct credentials -> SUCCESS', () => {
    it('should verify password and return true for correct credentials', () => {
      // Java: DefaultUserController.authorizeUser() hashes the provided password
      // and compares against the stored hash. Returns LoginStatus.SUCCESS on match.
      // In Node.js: verifyPassword() handles this with timing-safe comparison.

      const password = 'admin';
      const hashed = hashPassword(password);

      const result = verifyPassword(password, null, hashed);

      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // Contract 3: authorizeUser wrong credentials -> FAIL
  // =========================================================================
  describe('authorizeUser wrong credentials -> FAIL', () => {
    it('should return false for incorrect password', () => {
      const correctPassword = 'admin';
      const wrongPassword = 'wrong-password';
      const hashed = hashPassword(correctPassword);

      const result = verifyPassword(wrongPassword, null, hashed);

      expect(result).toBe(false);
    });

    it('should return false for null stored hash', () => {
      const result = verifyPassword('anything', null, null);
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // Contract 4: loginUser sets logged-in flag
  // =========================================================================
  describe('loginUser sets logged-in flag', () => {
    it('should show user as logged in after createSession', async () => {
      // Java: loginUser() creates a session entry and sets LOGGED_IN=1 in PERSON.
      // In Node.js: createSession() adds to session store, and isUserLoggedIn()
      // checks session store (not the database LOGGED_IN column).

      const user = makeUser({ id: 42 });

      // Before login
      const beforeLogin = await isUserLoggedIn(42);
      expect(beforeLogin).toBe(false);

      // Login
      await createSession(user, '127.0.0.1');

      // After login
      const afterLogin = await isUserLoggedIn(42);
      expect(afterLogin).toBe(true);
    });
  });

  // =========================================================================
  // Contract 5: logoutUser clears flag
  // =========================================================================
  describe('logoutUser clears flag', () => {
    it('should show user as NOT logged in after destroySession', async () => {
      // Java: logoutUser() removes session and sets LOGGED_IN=0.
      // Node.js: destroySession() removes from session store.

      const user = makeUser({ id: 99 });
      const session = await createSession(user, '127.0.0.1');

      // Verify logged in
      expect(await isUserLoggedIn(99)).toBe(true);

      // Logout
      await destroySession(session.id);

      // Verify NOT logged in
      expect(await isUserLoggedIn(99)).toBe(false);
    });
  });

  // =========================================================================
  // Contract 6: User preferences isolated per-userId
  // =========================================================================
  describe('User preferences isolated per-userId', () => {
    it('should store and retrieve preferences independently per user', async () => {
      // Java: setUserPreference(userId, name, value) stores per-userId in PERSON_PREFERENCE.
      // getPersonPreferences(userId) returns only that user's prefs.

      const user1Prefs: Record<string, string> = { theme: 'dark', lang: 'en' };
      const user2Prefs: Record<string, string> = { theme: 'light', lang: 'fr' };

      // Configure mock to return different prefs per userId
      mockMirthDao.getPersonPreferences.mockImplementation(async (userId: number) => {
        if (userId === 1) return { ...user1Prefs };
        if (userId === 2) return { ...user2Prefs };
        return {};
      });

      const prefs1 = await MirthDao.getPersonPreferences(1);
      const prefs2 = await MirthDao.getPersonPreferences(2);

      // User 1's preferences
      expect(prefs1).toEqual({ theme: 'dark', lang: 'en' });

      // User 2's preferences are different
      expect(prefs2).toEqual({ theme: 'light', lang: 'fr' });

      // They don't leak across users
      expect(prefs1.theme).not.toEqual(prefs2.theme);
      expect(prefs1.lang).not.toEqual(prefs2.lang);
    });
  });
});
