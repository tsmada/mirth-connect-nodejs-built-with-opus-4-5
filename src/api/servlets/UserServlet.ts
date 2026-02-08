/**
 * User Servlet
 *
 * Handles user authentication and management.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/UserServletInterface.java
 */

import { Router, Request, Response } from 'express';
import {
  User,
  LoginStatus,
  LoginStatusType,
  createLoginStatus,
} from '../models/User.js';
import {
  authMiddleware,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
  isUserLoggedIn,
  hashPassword,
} from '../middleware/auth.js';
import { authorize } from '../middleware/authorization.js';
import {
  USER_GET,
  USER_GET_ALL,
  USER_CREATE,
  USER_UPDATE,
  USER_REMOVE,
  USER_CHECK_PASSWORD,
  USER_UPDATE_PASSWORD,
  USER_GET_PREFERENCES,
  USER_SET_PREFERENCES,
  USER_IS_LOGGED_IN,
} from '../middleware/operations.js';
import * as MirthDao from '../../db/MirthDao.js';

export const userRouter = Router();

/**
 * POST /users/_login
 * Login with username and password
 */
userRouter.post('/_login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      const status = createLoginStatus(LoginStatusType.FAIL, 'Username and password required');
      res.sendData(status, 401);
      return;
    }

    // Get user from database
    const personRow = await MirthDao.getPersonByUsername(username);

    if (!personRow) {
      const status = createLoginStatus(LoginStatusType.FAIL, 'Invalid username or password');
      res.sendData(status, 401);
      return;
    }

    // Verify password
    if (!verifyPassword(password, personRow.SALT, personRow.PASSWORD)) {
      // Update strike count
      const status = createLoginStatus(LoginStatusType.FAIL, 'Invalid username or password');
      res.sendData(status, 401);
      return;
    }

    // Check if account is locked
    if (personRow.STRIKE_COUNT >= 3) {
      const status = createLoginStatus(LoginStatusType.FAIL_LOCKED_OUT, 'Account is locked');
      res.sendData(status, 401);
      return;
    }

    // Create user object
    const user: User = {
      id: personRow.ID,
      username: personRow.USERNAME,
      firstName: personRow.FIRSTNAME,
      lastName: personRow.LASTNAME,
      organization: personRow.ORGANIZATION,
      email: personRow.EMAIL,
      phoneNumber: personRow.PHONENUMBER,
      description: personRow.DESCRIPTION,
      industry: personRow.INDUSTRY,
      lastLogin: personRow.LAST_LOGIN,
      gracePeriodStart: personRow.GRACE_PERIOD_START,
      strikeCount: personRow.STRIKE_COUNT,
    };

    // Create session
    const session = createSession(user, req.ip);
    setSessionCookie(res, session.id);

    // Update login status in database
    await MirthDao.updatePersonLoginStatus(user.id, true);

    // Check for grace period
    let loginStatus: LoginStatus;
    if (personRow.GRACE_PERIOD_START) {
      loginStatus = createLoginStatus(
        LoginStatusType.SUCCESS_GRACE_PERIOD,
        'Login successful (grace period)',
        username
      );
    } else {
      loginStatus = createLoginStatus(LoginStatusType.SUCCESS, 'Login successful', username);
    }

    res.sendData(loginStatus);
  } catch (error) {
    console.error('Login error:', error);
    const status = createLoginStatus(LoginStatusType.FAIL, 'An error occurred during login');
    res.sendData(status, 500);
  }
});

/**
 * POST /users/_logout
 * Logout current session
 */
userRouter.post('/_logout', authMiddleware({ required: false }), async (req: Request, res: Response) => {
  try {
    if (req.session) {
      // Update login status in database
      await MirthDao.updatePersonLoginStatus(req.session.userId, false);
      destroySession(req.session.id);
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'An error occurred during logout' });
  }
});

/**
 * GET /users
 * Get all users
 */
userRouter.get('/', authMiddleware({ required: true }), authorize({ operation: USER_GET_ALL }), async (_req: Request, res: Response) => {
  try {
    const rows = await MirthDao.getAllPersons();
    const users: User[] = rows.map(personRowToUser);
    res.sendData(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

/**
 * GET /users/current
 * Get current logged in user
 */
userRouter.get('/current', authMiddleware({ required: true }), authorize({ operation: USER_GET, dontCheckAuthorized: true }), (req: Request, res: Response) => {
  if (req.user) {
    res.sendData(req.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

/**
 * GET /users/:userIdOrName
 * Get user by ID or username
 */
userRouter.get('/:userIdOrName', authMiddleware({ required: true }), authorize({ operation: USER_GET }), async (req: Request, res: Response) => {
  try {
    const userIdOrName = req.params.userIdOrName as string;
    let personRow;

    // Check if it's a numeric ID
    const userId = parseInt(userIdOrName, 10);
    if (!isNaN(userId)) {
      personRow = await MirthDao.getPersonById(userId);
    } else {
      personRow = await MirthDao.getPersonByUsername(userIdOrName);
    }

    if (!personRow) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = personRowToUser(personRow);
    res.sendData(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

/**
 * POST /users
 * Create a new user
 */
userRouter.post('/', authMiddleware({ required: true }), authorize({ operation: USER_CREATE }), async (req: Request, res: Response) => {
  try {
    const userData = req.body;

    if (!userData.username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    // Check if user already exists
    const existing = await MirthDao.getPersonByUsername(userData.username);
    if (existing) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    // Hash password
    const hashedPassword = hashPassword(userData.password || 'admin');

    // Create user in database
    await MirthDao.createPerson({
      username: userData.username,
      password: hashedPassword,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      organization: userData.organization || '',
      email: userData.email || '',
      phoneNumber: userData.phoneNumber || '',
      description: userData.description || '',
      industry: userData.industry || '',
    });

    res.status(201).end();
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PUT /users/:userId
 * Update a user
 */
userRouter.put('/:userId', authMiddleware({ required: true }), authorize({ operation: USER_UPDATE, checkAuthorizedUserId: 'userId' }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    const userData = req.body;

    const existing = await MirthDao.getPersonById(userId);
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await MirthDao.updatePerson(userId, {
      firstName: userData.firstName,
      lastName: userData.lastName,
      organization: userData.organization,
      email: userData.email,
      phoneNumber: userData.phoneNumber,
      description: userData.description,
      industry: userData.industry,
    });

    res.status(204).end();
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /users/:userId
 * Delete a user
 */
userRouter.delete('/:userId', authMiddleware({ required: true }), authorize({ operation: USER_REMOVE }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);

    const existing = await MirthDao.getPersonById(userId);
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await MirthDao.deletePerson(userId);
    res.status(204).end();
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * GET /users/:userId/loggedIn
 * Check if user is logged in
 */
userRouter.get('/:userId/loggedIn', authMiddleware({ required: true }), authorize({ operation: USER_IS_LOGGED_IN }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    const loggedIn = isUserLoggedIn(userId);
    res.sendData(loggedIn);
  } catch (error) {
    console.error('Check logged in error:', error);
    res.status(500).json({ error: 'Failed to check login status' });
  }
});

/**
 * PUT /users/:userId/password
 * Update user password
 */
userRouter.put('/:userId/password', authMiddleware({ required: true }), authorize({ operation: USER_UPDATE_PASSWORD, checkAuthorizedUserId: 'userId' }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    const newPassword = typeof req.body === 'string' ? req.body : req.body.password;

    if (!newPassword) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    const existing = await MirthDao.getPersonById(userId);
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check password requirements
    const requirements: string[] = [];
    if (newPassword.length < 8) {
      requirements.push('Password must be at least 8 characters');
    }

    if (requirements.length > 0) {
      res.sendData(requirements, 400);
      return;
    }

    // Generate hash (Mirth 3.x uses SHA256 without salt)
    const hashedPassword = hashPassword(newPassword);

    await MirthDao.updatePersonPassword(userId, hashedPassword);
    res.sendData([]);
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

/**
 * POST /users/_checkPassword
 * Check password against requirements
 */
userRouter.post('/_checkPassword', authMiddleware({ required: true }), authorize({ operation: USER_CHECK_PASSWORD }), (req: Request, res: Response) => {
  const password = typeof req.body === 'string' ? req.body : req.body.password;
  const requirements: string[] = [];

  if (!password || password.length < 8) {
    requirements.push('Password must be at least 8 characters');
  }

  res.sendData(requirements);
});

/**
 * GET /users/:userId/preferences/:name
 * Get a single preference by name
 */
userRouter.get('/:userId/preferences/:name', authMiddleware({ required: true }), authorize({ operation: USER_GET_PREFERENCES, checkAuthorizedUserId: 'userId' }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    const name = req.params.name as string;

    const prefs = await MirthDao.getPersonPreferences(userId);
    const value = prefs[name];

    if (value === undefined) {
      res.status(404).json({ error: 'Preference not found' });
      return;
    }

    res.type('text/plain').send(value);
  } catch (error) {
    console.error('Get preference error:', error);
    res.status(500).json({ error: 'Failed to get preference' });
  }
});

/**
 * PUT /users/:userId/preferences/:name
 * Set a single preference by name
 */
userRouter.put('/:userId/preferences/:name', authMiddleware({ required: true }), authorize({ operation: USER_SET_PREFERENCES, checkAuthorizedUserId: 'userId' }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    const name = req.params.name as string;
    const value = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Get existing preferences and update the single value
    const prefs = await MirthDao.getPersonPreferences(userId);
    prefs[name] = value;
    await MirthDao.setPersonPreferences(userId, prefs);

    res.status(204).end();
  } catch (error) {
    console.error('Set preference error:', error);
    res.status(500).json({ error: 'Failed to set preference' });
  }
});

/**
 * GET /users/:userId/preferences
 * Get user preferences
 */
userRouter.get('/:userId/preferences', authMiddleware({ required: true }), authorize({ operation: USER_GET_PREFERENCES, checkAuthorizedUserId: 'userId' }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    const nameFilter = req.query.name;

    const prefs = await MirthDao.getPersonPreferences(userId);

    // Filter by name if specified
    if (nameFilter && typeof nameFilter === 'string') {
      const filtered: Record<string, string> = {};
      if (prefs[nameFilter]) {
        filtered[nameFilter] = prefs[nameFilter];
      }
      res.sendData(filtered);
    } else {
      res.sendData(prefs);
    }
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

/**
 * PUT /users/:userId/preferences
 * Update user preferences
 */
userRouter.put('/:userId/preferences', authMiddleware({ required: true }), authorize({ operation: USER_SET_PREFERENCES, checkAuthorizedUserId: 'userId' }), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    const preferences = req.body;

    await MirthDao.setPersonPreferences(userId, preferences);
    res.status(204).end();
  } catch (error) {
    console.error('Set preferences error:', error);
    res.status(500).json({ error: 'Failed to set preferences' });
  }
});

/**
 * Helper to convert database row to User object
 */
function personRowToUser(row: MirthDao.PersonRow): User {
  return {
    id: row.ID,
    username: row.USERNAME,
    firstName: row.FIRSTNAME,
    lastName: row.LASTNAME,
    organization: row.ORGANIZATION,
    email: row.EMAIL,
    phoneNumber: row.PHONENUMBER,
    description: row.DESCRIPTION,
    industry: row.INDUSTRY,
    lastLogin: row.LAST_LOGIN,
    gracePeriodStart: row.GRACE_PERIOD_START,
    strikeCount: row.STRIKE_COUNT,
  };
}
