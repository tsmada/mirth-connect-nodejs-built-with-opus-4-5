/**
 * UserServlet Unit Tests
 *
 * Tests for user management endpoints including:
 * - Login / logout
 * - User CRUD (get all, get by ID or username, create, update, delete)
 * - Password update with min-length validation
 * - Check password requirements
 * - Logged-in status check
 * - Preference get/set (single and bulk)
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock auth.js BEFORE importing anything else — prevents sessionStore init
// and the setInterval timer from starting.
// ---------------------------------------------------------------------------
jest.mock('../../../../src/api/middleware/auth.js', () => ({
  authMiddleware: jest.fn(() => (_req: any, _res: any, next: any) => {
    _req.session = { id: 'test-session', userId: 1, user: { id: 1, username: 'admin' } };
    _req.userId = 1;
    _req.user = { id: 1, username: 'admin' };
    next();
  }),
  createSession: jest.fn(() => Promise.resolve({ id: 'new-session-id', userId: 1 })),
  destroySession: jest.fn(() => Promise.resolve(true)),
  setSessionCookie: jest.fn(),
  clearSessionCookie: jest.fn(),
  verifyPassword: jest.fn(),
  isUserLoggedIn: jest.fn(),
  hashPassword: jest.fn(() => 'hashed-password'),
}));

// ---------------------------------------------------------------------------
// Mock authorization — pass-through to actual route handlers
// ---------------------------------------------------------------------------
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// ---------------------------------------------------------------------------
// Mock operations
// ---------------------------------------------------------------------------
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  USER_GET: { name: 'getUser' },
  USER_GET_ALL: { name: 'getAllUsers' },
  USER_CREATE: { name: 'createUser' },
  USER_UPDATE: { name: 'updateUser' },
  USER_REMOVE: { name: 'removeUser' },
  USER_CHECK_PASSWORD: { name: 'checkPassword' },
  USER_UPDATE_PASSWORD: { name: 'updatePassword' },
  USER_GET_PREFERENCES: { name: 'getPreferences' },
  USER_SET_PREFERENCES: { name: 'setPreferences' },
  USER_IS_LOGGED_IN: { name: 'isUserLoggedIn' },
}));

// ---------------------------------------------------------------------------
// Mock MirthDao — all Person-related functions
// ---------------------------------------------------------------------------
jest.mock('../../../../src/db/MirthDao.js', () => ({
  getPersonByUsername: jest.fn(),
  getPersonById: jest.fn(),
  getAllPersons: jest.fn(),
  createPerson: jest.fn(),
  updatePerson: jest.fn(),
  deletePerson: jest.fn(),
  updatePersonLoginStatus: jest.fn(),
  updatePersonPassword: jest.fn(),
  getPersonPreferences: jest.fn(),
  setPersonPreferences: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock logging
// ---------------------------------------------------------------------------
jest.mock('../../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn(() => false),
    child: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  })),
  registerComponent: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock express-rate-limit — return a plain pass-through middleware
// ---------------------------------------------------------------------------
jest.mock('express-rate-limit', () => jest.fn(() => (_req: any, _res: any, next: any) => next()));

// ---------------------------------------------------------------------------
// Imports — must come AFTER all jest.mock() calls
// ---------------------------------------------------------------------------
import express, { Express } from 'express';
import { userRouter } from '../../../../src/api/servlets/UserServlet.js';
import * as MirthDao from '../../../../src/db/MirthDao.js';
import * as auth from '../../../../src/api/middleware/auth.js';

// ---------------------------------------------------------------------------
// Typed mock aliases for IntelliSense and casting convenience
// ---------------------------------------------------------------------------
const mockGetPersonByUsername = MirthDao.getPersonByUsername as jest.Mock;
const mockGetPersonById = MirthDao.getPersonById as jest.Mock;
const mockGetAllPersons = MirthDao.getAllPersons as jest.Mock;
const mockCreatePerson = MirthDao.createPerson as jest.Mock;
const mockUpdatePerson = MirthDao.updatePerson as jest.Mock;
const mockDeletePerson = MirthDao.deletePerson as jest.Mock;
const mockUpdatePersonLoginStatus = MirthDao.updatePersonLoginStatus as jest.Mock;
const mockUpdatePersonPassword = MirthDao.updatePersonPassword as jest.Mock;
const mockGetPersonPreferences = MirthDao.getPersonPreferences as jest.Mock;
const mockSetPersonPreferences = MirthDao.setPersonPreferences as jest.Mock;

const mockVerifyPassword = auth.verifyPassword as jest.Mock;
const mockCreateSession = auth.createSession as jest.Mock;
const mockDestroySession = auth.destroySession as jest.Mock;
const mockIsUserLoggedIn = auth.isUserLoggedIn as jest.Mock;
const mockHashPassword = auth.hashPassword as jest.Mock;
const mockSetSessionCookie = auth.setSessionCookie as jest.Mock;
const mockClearSessionCookie = auth.clearSessionCookie as jest.Mock;

// ---------------------------------------------------------------------------
// Reusable fixture: a fully populated PersonRow
// ---------------------------------------------------------------------------
function makePersonRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ID: 1,
    USERNAME: 'admin',
    PASSWORD: 'hashed-password',
    SALT: null,
    FIRSTNAME: 'Admin',
    LASTNAME: 'User',
    ORGANIZATION: 'Acme',
    EMAIL: 'admin@example.com',
    PHONENUMBER: '555-1234',
    DESCRIPTION: 'System administrator',
    INDUSTRY: 'Healthcare',
    LOGGED_IN: 0,
    LAST_LOGIN: new Date('2024-01-01T00:00:00Z'),
    GRACE_PERIOD_START: null,
    STRIKE_COUNT: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test application factory
// ---------------------------------------------------------------------------
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.text());

  // Attach sendData helper — mirrors what the real app's contentNegotiation middleware does
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown, statusCode?: number) {
      if (statusCode !== undefined) {
        this.status(statusCode).json(data);
      } else {
        this.json(data);
      }
    };
    next();
  });

  app.use('/users', userRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('UserServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: all DAO writes succeed
    mockCreatePerson.mockResolvedValue(undefined);
    mockUpdatePerson.mockResolvedValue(undefined);
    mockDeletePerson.mockResolvedValue(undefined);
    mockUpdatePersonLoginStatus.mockResolvedValue(undefined);
    mockUpdatePersonPassword.mockResolvedValue(undefined);
    mockSetPersonPreferences.mockResolvedValue(undefined);
    mockHashPassword.mockReturnValue('hashed-password');
  });

  // ==========================================================================
  // POST /_login
  // ==========================================================================

  describe('POST /users/_login', () => {
    it('returns SUCCESS status and sets session cookie on valid credentials', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(makePersonRow());
      mockVerifyPassword.mockReturnValueOnce(true);
      mockCreateSession.mockResolvedValueOnce({ id: 'sess-abc', userId: 1 });

      const res = await request(app)
        .post('/users/_login')
        .send({ username: 'admin', password: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SUCCESS');
      expect(res.body.updatedUsername).toBe('admin');
      expect(mockUpdatePersonLoginStatus).toHaveBeenCalledWith(1, true);
      expect(mockSetSessionCookie).toHaveBeenCalledWith(expect.anything(), 'sess-abc');
    });

    it('returns SUCCESS_GRACE_PERIOD when gracePeriodStart is set', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(
        makePersonRow({ GRACE_PERIOD_START: new Date('2024-06-01') })
      );
      mockVerifyPassword.mockReturnValueOnce(true);
      mockCreateSession.mockResolvedValueOnce({ id: 'sess-grace', userId: 1 });

      const res = await request(app)
        .post('/users/_login')
        .send({ username: 'admin', password: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SUCCESS_GRACE_PERIOD');
    });

    it('returns 401 FAIL when username is missing', async () => {
      const res = await request(app)
        .post('/users/_login')
        .send({ password: 'admin' });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('FAIL');
    });

    it('returns 401 FAIL when password is missing', async () => {
      const res = await request(app)
        .post('/users/_login')
        .send({ username: 'admin' });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('FAIL');
    });

    it('returns 401 FAIL when user does not exist', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/users/_login')
        .send({ username: 'nobody', password: 'password' });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('FAIL');
      expect(res.body.message).toMatch(/invalid/i);
    });

    it('returns 401 FAIL when password is incorrect', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(makePersonRow());
      mockVerifyPassword.mockReturnValueOnce(false);

      const res = await request(app)
        .post('/users/_login')
        .send({ username: 'admin', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('FAIL');
    });

    it('returns 401 FAIL_LOCKED_OUT when strike count >= 3', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(makePersonRow({ STRIKE_COUNT: 3 }));
      mockVerifyPassword.mockReturnValueOnce(true);

      const res = await request(app)
        .post('/users/_login')
        .send({ username: 'admin', password: 'admin' });

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('FAIL_LOCKED_OUT');
    });
  });

  // ==========================================================================
  // POST /_logout
  // ==========================================================================

  describe('POST /users/_logout', () => {
    it('destroys session and clears cookie when session exists', async () => {
      // authMiddleware mock already injects req.session

      const res = await request(app).post('/users/_logout');

      expect(res.status).toBe(204);
      expect(mockUpdatePersonLoginStatus).toHaveBeenCalledWith(1, false);
      expect(mockDestroySession).toHaveBeenCalledWith('test-session');
      expect(mockClearSessionCookie).toHaveBeenCalled();
    });

    it('still returns 204 and clears cookie on a second logout call (idempotent)', async () => {
      // The authMiddleware mock always injects a session. Call logout twice and verify
      // the cookie-clearing side effect happens each time.
      mockDestroySession.mockResolvedValue(true);

      const first = await request(app).post('/users/_logout');
      const second = await request(app).post('/users/_logout');

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      expect(mockClearSessionCookie).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // GET /users
  // ==========================================================================

  describe('GET /users', () => {
    it('returns all users as an array', async () => {
      mockGetAllPersons.mockResolvedValueOnce([
        makePersonRow({ ID: 1, USERNAME: 'admin' }),
        makePersonRow({ ID: 2, USERNAME: 'jdoe', FIRSTNAME: 'John', LASTNAME: 'Doe' }),
      ]);

      const res = await request(app).get('/users');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].username).toBe('admin');
      expect(res.body[1].username).toBe('jdoe');
    });

    it('returns empty array when no users exist', async () => {
      mockGetAllPersons.mockResolvedValueOnce([]);

      const res = await request(app).get('/users');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ==========================================================================
  // GET /users/current
  // ==========================================================================

  describe('GET /users/current', () => {
    it('returns the currently authenticated user', async () => {
      const res = await request(app).get('/users/current');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.username).toBe('admin');
    });
  });

  // ==========================================================================
  // GET /users/:userIdOrName
  // ==========================================================================

  describe('GET /users/:userIdOrName', () => {
    it('returns a user by numeric ID', async () => {
      mockGetPersonById.mockResolvedValueOnce(makePersonRow());

      const res = await request(app).get('/users/1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.username).toBe('admin');
      expect(mockGetPersonById).toHaveBeenCalledWith(1);
    });

    it('returns a user by username string', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(makePersonRow());

      const res = await request(app).get('/users/admin');

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('admin');
      expect(mockGetPersonByUsername).toHaveBeenCalledWith('admin');
    });

    it('returns 404 when user is not found by ID', async () => {
      mockGetPersonById.mockResolvedValueOnce(null);

      const res = await request(app).get('/users/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 404 when user is not found by username', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(null);

      const res = await request(app).get('/users/nosuchuser');

      expect(res.status).toBe(404);
    });

    it('maps all user fields correctly', async () => {
      mockGetPersonById.mockResolvedValueOnce(makePersonRow({
        ID: 42,
        USERNAME: 'jsmith',
        FIRSTNAME: 'Jane',
        LASTNAME: 'Smith',
        ORGANIZATION: 'HealthCo',
        EMAIL: 'jane@healthco.com',
        PHONENUMBER: '555-9876',
        DESCRIPTION: 'Developer',
        INDUSTRY: 'Healthcare IT',
      }));

      const res = await request(app).get('/users/42');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(42);
      expect(res.body.username).toBe('jsmith');
      expect(res.body.firstName).toBe('Jane');
      expect(res.body.lastName).toBe('Smith');
      expect(res.body.organization).toBe('HealthCo');
      expect(res.body.email).toBe('jane@healthco.com');
    });
  });

  // ==========================================================================
  // POST /users (create)
  // ==========================================================================

  describe('POST /users', () => {
    it('creates a new user and returns 201', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(null); // no existing user

      const res = await request(app)
        .post('/users')
        .send({ username: 'newuser', password: 'secret123', firstName: 'New', lastName: 'User' });

      expect(res.status).toBe(201);
      expect(mockHashPassword).toHaveBeenCalledWith('secret123');
      expect(mockCreatePerson).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'newuser', password: 'hashed-password' })
      );
    });

    it('uses default password when password field is absent', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/users')
        .send({ username: 'nopwduser' });

      expect(res.status).toBe(201);
      expect(mockHashPassword).toHaveBeenCalledWith('admin');
    });

    it('returns 400 when username is missing', async () => {
      const res = await request(app)
        .post('/users')
        .send({ firstName: 'NoName' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/username/i);
      expect(mockCreatePerson).not.toHaveBeenCalled();
    });

    it('returns 409 when username already exists', async () => {
      mockGetPersonByUsername.mockResolvedValueOnce(makePersonRow());

      const res = await request(app)
        .post('/users')
        .send({ username: 'admin', password: 'admin' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
      expect(mockCreatePerson).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // PUT /users/:userId (update)
  // ==========================================================================

  describe('PUT /users/:userId', () => {
    it('updates an existing user and returns 204', async () => {
      mockGetPersonById.mockResolvedValueOnce(makePersonRow());

      const res = await request(app)
        .put('/users/1')
        .send({ firstName: 'Updated', lastName: 'Name', email: 'updated@example.com' });

      expect(res.status).toBe(204);
      expect(mockUpdatePerson).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ firstName: 'Updated', lastName: 'Name', email: 'updated@example.com' })
      );
    });

    it('returns 404 when user does not exist', async () => {
      mockGetPersonById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/users/999')
        .send({ firstName: 'Ghost' });

      expect(res.status).toBe(404);
      expect(mockUpdatePerson).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // DELETE /users/:userId
  // ==========================================================================

  describe('DELETE /users/:userId', () => {
    it('deletes an existing user and returns 204', async () => {
      mockGetPersonById.mockResolvedValueOnce(makePersonRow());

      const res = await request(app).delete('/users/1');

      expect(res.status).toBe(204);
      expect(mockDeletePerson).toHaveBeenCalledWith(1);
    });

    it('returns 404 when user does not exist', async () => {
      mockGetPersonById.mockResolvedValueOnce(null);

      const res = await request(app).delete('/users/999');

      expect(res.status).toBe(404);
      expect(mockDeletePerson).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // GET /users/:userId/loggedIn
  // ==========================================================================

  describe('GET /users/:userId/loggedIn', () => {
    it('returns true when user has an active session', async () => {
      mockIsUserLoggedIn.mockResolvedValueOnce(true);

      const res = await request(app).get('/users/1/loggedIn');

      expect(res.status).toBe(200);
      expect(res.body).toBe(true);
      expect(mockIsUserLoggedIn).toHaveBeenCalledWith(1);
    });

    it('returns false when user has no active session', async () => {
      mockIsUserLoggedIn.mockResolvedValueOnce(false);

      const res = await request(app).get('/users/2/loggedIn');

      expect(res.status).toBe(200);
      expect(res.body).toBe(false);
    });
  });

  // ==========================================================================
  // PUT /users/:userId/password
  // ==========================================================================

  describe('PUT /users/:userId/password', () => {
    it('updates the password and returns empty requirements array on success', async () => {
      mockGetPersonById.mockResolvedValueOnce(makePersonRow());

      const res = await request(app)
        .put('/users/1/password')
        .send({ password: 'NewStr0ng!' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(mockHashPassword).toHaveBeenCalledWith('NewStr0ng!');
      expect(mockUpdatePersonPassword).toHaveBeenCalledWith(1, 'hashed-password');
    });

    it('accepts password as plain text body (string format)', async () => {
      mockGetPersonById.mockResolvedValueOnce(makePersonRow());

      const res = await request(app)
        .put('/users/1/password')
        .type('text/plain')
        .send('Longpassword!');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(mockHashPassword).toHaveBeenCalledWith('Longpassword!');
    });

    it('returns 400 with validation message when password is too short (< 8 chars)', async () => {
      mockGetPersonById.mockResolvedValueOnce(makePersonRow());

      const res = await request(app)
        .put('/users/1/password')
        .send({ password: 'short' });

      expect(res.status).toBe(400);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toMatch(/at least 8 characters/i);
      expect(mockUpdatePersonPassword).not.toHaveBeenCalled();
    });

    it('returns 400 when password field is missing entirely', async () => {
      const res = await request(app)
        .put('/users/1/password')
        .send({});

      expect(res.status).toBe(400);
      expect(mockUpdatePersonPassword).not.toHaveBeenCalled();
    });

    it('returns 404 when user does not exist', async () => {
      mockGetPersonById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put('/users/999/password')
        .send({ password: 'ValidPass1!' });

      expect(res.status).toBe(404);
      expect(mockUpdatePersonPassword).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // POST /users/_checkPassword
  // ==========================================================================

  describe('POST /users/_checkPassword', () => {
    it('returns empty array when password meets requirements', async () => {
      const res = await request(app)
        .post('/users/_checkPassword')
        .send({ password: 'StrongPass1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns validation message when password is too short', async () => {
      const res = await request(app)
        .post('/users/_checkPassword')
        .send({ password: 'abc' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatch(/at least 8 characters/i);
    });

    it('returns validation message when password is absent', async () => {
      const res = await request(app)
        .post('/users/_checkPassword')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('accepts password as plain text body', async () => {
      const res = await request(app)
        .post('/users/_checkPassword')
        .type('text/plain')
        .send('toolong_is_fine');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('rejects exactly 7-character password (boundary)', async () => {
      const res = await request(app)
        .post('/users/_checkPassword')
        .send({ password: 'seven77' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('accepts exactly 8-character password (boundary)', async () => {
      const res = await request(app)
        .post('/users/_checkPassword')
        .send({ password: 'eight888' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ==========================================================================
  // GET /users/:userId/preferences/:name (single preference)
  // ==========================================================================

  describe('GET /users/:userId/preferences/:name', () => {
    it('returns the preference value as plain text', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({ theme: 'dark', language: 'en' });

      const res = await request(app).get('/users/1/preferences/theme');

      expect(res.status).toBe(200);
      expect(res.text).toBe('dark');
      expect(mockGetPersonPreferences).toHaveBeenCalledWith(1);
    });

    it('returns 404 when the preference key does not exist', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({ theme: 'dark' });

      const res = await request(app).get('/users/1/preferences/missingKey');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // ==========================================================================
  // PUT /users/:userId/preferences/:name (single preference)
  // ==========================================================================

  describe('PUT /users/:userId/preferences/:name', () => {
    it('sets a single preference and returns 204', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({ theme: 'light' });

      const res = await request(app)
        .put('/users/1/preferences/theme')
        .type('text/plain')
        .send('dark');

      expect(res.status).toBe(204);
      expect(mockSetPersonPreferences).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ theme: 'dark' })
      );
    });

    it('adds a new preference key while preserving existing ones', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({ theme: 'dark' });

      const res = await request(app)
        .put('/users/1/preferences/language')
        .type('text/plain')
        .send('en');

      expect(res.status).toBe(204);
      expect(mockSetPersonPreferences).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ theme: 'dark', language: 'en' })
      );
    });

    it('JSON body is serialised to a string value', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({});

      const res = await request(app)
        .put('/users/1/preferences/settings')
        .send({ color: 'blue' });

      expect(res.status).toBe(204);
      const savedPrefs = mockSetPersonPreferences.mock.calls[0][1] as Record<string, string>;
      expect(typeof savedPrefs['settings']).toBe('string');
    });
  });

  // ==========================================================================
  // GET /users/:userId/preferences (all preferences)
  // ==========================================================================

  describe('GET /users/:userId/preferences', () => {
    it('returns all preferences for a user', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({ theme: 'dark', language: 'en' });

      const res = await request(app).get('/users/1/preferences');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ theme: 'dark', language: 'en' });
    });

    it('returns empty object when user has no preferences', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({});

      const res = await request(app).get('/users/1/preferences');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('filters by name query param when provided', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({ theme: 'dark', language: 'en' });

      const res = await request(app).get('/users/1/preferences?name=theme');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ theme: 'dark' });
      expect(res.body.language).toBeUndefined();
    });

    it('returns empty object when name filter matches nothing', async () => {
      mockGetPersonPreferences.mockResolvedValueOnce({ theme: 'dark' });

      const res = await request(app).get('/users/1/preferences?name=nonexistent');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });

  // ==========================================================================
  // PUT /users/:userId/preferences (bulk update)
  // ==========================================================================

  describe('PUT /users/:userId/preferences', () => {
    it('replaces all preferences and returns 204', async () => {
      const prefs = { theme: 'solarized', language: 'fr', notifications: 'true' };

      const res = await request(app)
        .put('/users/1/preferences')
        .send(prefs);

      expect(res.status).toBe(204);
      expect(mockSetPersonPreferences).toHaveBeenCalledWith(1, prefs);
    });

    it('accepts an empty object to clear preferences', async () => {
      const res = await request(app)
        .put('/users/1/preferences')
        .send({});

      expect(res.status).toBe(204);
      expect(mockSetPersonPreferences).toHaveBeenCalledWith(1, {});
    });
  });
});
