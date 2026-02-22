/**
 * Authentication Routes
 *
 * Express router for authentication endpoints.
 */

import { Router, Request, Response } from 'express';
import {
  createUser,
  findUserByUsernameOrEmail,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  updateLastLogin,
  validateRefreshToken,
  invalidateRefreshToken,
  invalidateAllUserTokens,
  toPublicUser,
  findUserById,
  REFRESH_COOKIE_OPTIONS,
  CLEAR_COOKIE_OPTIONS,
} from './auth.js';
import {
  LoginSchema,
  RegisterSchema,
  formatValidationError,
} from './auth-schemas.js';
import { authenticate } from './auth-middleware.js';

export function createAuthRouter(): Router {
  const router = Router();

  // ========================================================================
  // POST /api/auth/register
  // ========================================================================

  router.post('/register', async (req: Request, res: Response) => {
    try {
      // Validate input
      const result = RegisterSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json(formatValidationError(result.error));
      }

      const { username, email, password } = result.data;

      // Check for existing user
      const existingUser = findUserByUsernameOrEmail(username);
      if (existingUser) {
        if (existingUser.username.toLowerCase() === username.toLowerCase()) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Username already exists',
            code: 'AUTH_USERNAME_EXISTS',
          });
        }
        if (existingUser.email.toLowerCase() === email.toLowerCase()) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Email already registered',
            code: 'AUTH_EMAIL_EXISTS',
          });
        }
      }

      // Create user
      const user = await createUser({ username, email, password });

      // Generate tokens
      const accessToken = generateAccessToken(
        findUserById(user.id) || { ...user, password_hash: '', is_active: true, role: 'user' }
      );
      const { token: refreshToken, jti } = generateRefreshToken(
        findUserById(user.id) || { ...user, password_hash: '', is_active: true, role: 'user' }
      );

      // Set refresh token cookie
      res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);

      // Return response
      res.status(201).json({
        user,
        access_token: accessToken,
      });
    } catch (error) {
      // Handle our custom errors
      if (error instanceof Error) {
        if (error.message === 'USERNAME_EXISTS') {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Username already exists',
            code: 'AUTH_USERNAME_EXISTS',
          });
        }
        if (error.message === 'EMAIL_EXISTS') {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Email already registered',
            code: 'AUTH_EMAIL_EXISTS',
          });
        }
      }

      console.error('Registration error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create user account',
      });
    }
  });

  // ========================================================================
  // POST /api/auth/login
  // ========================================================================

  router.post('/login', async (req: Request, res: Response) => {
    try {
      // Validate input
      const result = LoginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json(formatValidationError(result.error));
      }

      const { username, password } = result.data;

      // Find user
      const user = findUserByUsernameOrEmail(username);
      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid username or password',
          code: 'AUTH_INVALID_CREDENTIALS',
        });
      }

      // Verify password
      const isValid = await verifyPassword(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid username or password',
          code: 'AUTH_INVALID_CREDENTIALS',
        });
      }

      // Check if account is active
      if (!user.is_active) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Account is inactive',
          code: 'AUTH_ACCOUNT_INACTIVE',
        });
      }

      // Update last login
      updateLastLogin(user.id);

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const { token: refreshToken } = generateRefreshToken(user);

      // Set refresh token cookie
      res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);

      // Return response
      res.json({
        user: toPublicUser(user),
        access_token: accessToken,
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Login failed',
      });
    }
  });

  // ========================================================================
  // POST /api/auth/logout
  // ========================================================================

  router.post('/logout', (req: Request, res: Response) => {
    try {
      // Get refresh token from cookie
      const refreshToken = req.cookies?.refresh_token;

      if (refreshToken) {
        // Decode to get JTI (without verification for logout)
        const parts = refreshToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload.jti) {
            invalidateRefreshToken(payload.jti);
          }
        }
      }

      // Clear refresh token cookie
      res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);

      res.json({
        message: 'Logged out successfully',
      });
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear cookie and return success
      res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);
      res.json({
        message: 'Logged out successfully',
      });
    }
  });

  // ========================================================================
  // POST /api/auth/logout-all
  // Logout from all devices
  // ========================================================================

  router.post('/logout-all', authenticate, (req: Request, res: Response) => {
    try {
      if (req.user) {
        invalidateAllUserTokens(req.user.id);
      }

      // Clear refresh token cookie
      res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);

      res.json({
        message: 'Logged out from all devices successfully',
      });
    } catch (error) {
      console.error('Logout all error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to logout from all devices',
      });
    }
  });

  // ========================================================================
  // POST /api/auth/refresh
  // ========================================================================

  router.post('/refresh', (req: Request, res: Response) => {
    try {
      // Get refresh token from cookie
      const refreshToken = req.cookies?.refresh_token;

      if (!refreshToken) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Refresh token not found',
          code: 'AUTH_MISSING_REFRESH_TOKEN',
        });
      }

      // Decode to get JTI
      const parts = refreshToken.split('.');
      if (parts.length !== 3) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid refresh token format',
          code: 'AUTH_INVALID_REFRESH_TOKEN',
        });
      }

      let payload: any;
      try {
        payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      } catch {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid refresh token',
          code: 'AUTH_INVALID_REFRESH_TOKEN',
        });
      }

      // Validate refresh token and get user
      const user = validateRefreshToken(payload.jti);
      if (!user) {
        // Clear invalid cookie
        res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired refresh token',
          code: 'AUTH_INVALID_REFRESH_TOKEN',
        });
      }

      // Check if account is still active
      if (!user.is_active) {
        invalidateRefreshToken(payload.jti);
        res.clearCookie('refresh_token', CLEAR_COOKIE_OPTIONS);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Account is inactive',
          code: 'AUTH_ACCOUNT_INACTIVE',
        });
      }

      // Generate new tokens
      const accessToken = generateAccessToken(user);
      const { token: newRefreshToken } = generateRefreshToken(user);

      // Invalidate old refresh token
      invalidateRefreshToken(payload.jti);

      // Set new refresh token cookie
      res.cookie('refresh_token', newRefreshToken, REFRESH_COOKIE_OPTIONS);

      // Return response
      res.json({
        access_token: accessToken,
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to refresh token',
      });
    }
  });

  // ========================================================================
  // GET /api/auth/me
  // ========================================================================

  router.get('/me', authenticate, (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Not authenticated',
          code: 'AUTH_NOT_AUTHENTICATED',
        });
      }

      // Get fresh user data
      const user = findUserById(req.user.id);
      if (!user) {
        return res.status(404).json({
          error: 'Not found',
          message: 'User not found',
          code: 'AUTH_USER_NOT_FOUND',
        });
      }

      res.json({
        user: toPublicUser(user),
      });
    } catch (error) {
      console.error('Get current user error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to get user info',
      });
    }
  });

  // ========================================================================
  // GET /api/auth/check
  // Check if session is valid (without requiring auth)
  // ========================================================================

  router.get('/check', (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refresh_token;
    const hasSession = !!refreshToken;

    res.json({
      authenticated: hasSession,
    });
  });

  return router;
}
