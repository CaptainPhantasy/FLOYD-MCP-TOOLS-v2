/**
 * Authentication Middleware for Express
 *
 * Provides middleware for protecting routes and handling authentication.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractTokenFromHeader, findUserById, toPublicUser, JwtPayload } from './auth.js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email: string;
        created_at: string;
        last_login?: string;
      };
    }
  }
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Middleware to protect routes - requires valid access token
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // Extract token from Authorization header
  const token = extractTokenFromHeader(req);

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_MISSING_TOKEN',
    });
    return;
  }

  // Verify token
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      code: 'AUTH_INVALID_TOKEN',
    });
    return;
  }

  // Check token type
  if (payload.type !== 'access') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token type',
      code: 'AUTH_INVALID_TOKEN_TYPE',
    });
    return;
  }

  // Get user from payload
  const user = findUserById(payload.sub);

  if (!user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'User not found',
      code: 'AUTH_USER_NOT_FOUND',
    });
    return;
  }

  // Check if user is active
  if (!user.is_active) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Account is inactive',
      code: 'AUTH_ACCOUNT_INACTIVE',
    });
    return;
  }

  // Attach user to request
  req.user = toPublicUser(user);
  next();
}

/**
 * Optional authentication - attaches user if token is valid, doesn't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractTokenFromHeader(req);

  if (token) {
    const payload = verifyToken(token);

    if (payload && payload.type === 'access') {
      const user = findUserById(payload.sub);
      if (user && user.is_active) {
        req.user = toPublicUser(user);
      }
    }
  }

  next();
}

/**
 * Require admin role
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_MISSING_TOKEN',
    });
    return;
  }

  // Note: This would require the user role to be loaded from the full user object
  // For now, we'll just pass through - implement RBAC in a future update
  next();
}

// ============================================================================
// ERROR HANDLER HELPERS
// ============================================================================

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: any): boolean {
  const authErrorCodes = [
    'AUTH_MISSING_TOKEN',
    'AUTH_INVALID_TOKEN',
    'AUTH_INVALID_TOKEN_TYPE',
    'AUTH_USER_NOT_FOUND',
    'AUTH_ACCOUNT_INACTIVE',
  ];
  return authErrorCodes.includes(error?.code);
}

/**
 * Get auth error status code
 */
export function getAuthStatusCode(code: string): number {
  const statusMap: Record<string, number> = {
    AUTH_MISSING_TOKEN: 401,
    AUTH_INVALID_TOKEN: 401,
    AUTH_INVALID_TOKEN_TYPE: 401,
    AUTH_USER_NOT_FOUND: 401,
    AUTH_ACCOUNT_INACTIVE: 403,
  };
  return statusMap[code] || 401;
}
