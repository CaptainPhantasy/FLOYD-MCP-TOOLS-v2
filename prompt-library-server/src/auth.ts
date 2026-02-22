/**
 * Authentication Module for Prompt Library Server
 *
 * Provides user authentication, JWT token management, and route protection.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { CookieOptions, Request } from 'express';

// ============================================================================
// CONFIGURATION
// ============================================================================

const USERS_DIR = join(process.env.PROMPT_LIB_PATH || '/Volumes/Storage/Prompt Library', '.promptlib');
const USERS_FILE = join(USERS_DIR, 'users.json');

const JWT_SECRET = process.env.JWT_SECRET || 'prompt-orchestrator-secret-key-change-in-production';
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';
const BCRYPT_ROUNDS = 12;

const COOKIE_SECRET = process.env.COOKIE_SECRET || 'cookie-secret-key';
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const COOKIE_SAME_SITE: 'strict' | 'lax' | 'none' = (process.env.COOKIE_SAME_SITE as any) || 'lax';

// ============================================================================
// TYPES
// ============================================================================

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at?: string;
  last_login?: string;
  is_active: boolean;
  role?: 'admin' | 'user';
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  created_at: string;
  last_login?: string;
}

export interface RefreshTokenData {
  user_id: string;
  expires_at: string;
}

export interface UsersStore {
  users: Record<string, User>;
  refresh_tokens: Record<string, RefreshTokenData>;
  last_updated: string;
}

export interface JwtPayload {
  sub: string;
  username?: string;
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
  jti?: string;
}

// ============================================================================
// USER STORE
// ============================================================================

function loadUsersStore(): UsersStore {
  try {
    if (existsSync(USERS_FILE)) {
      const content = readFileSync(USERS_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('Failed to load users store:', e);
  }
  // Return empty store if file doesn't exist
  return { users: {}, refresh_tokens: {}, last_updated: new Date().toISOString() };
}

function saveUsersStore(store: UsersStore): void {
  try {
    if (!existsSync(USERS_DIR)) {
      mkdirSync(USERS_DIR, { recursive: true });
    }
    store.last_updated = new Date().toISOString();
    writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('Failed to save users store:', e);
    throw new Error('Failed to save user data');
  }
}

// ============================================================================
// PASSWORD UTILITIES
// ============================================================================

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============================================================================
// JWT UTILITIES
// ============================================================================

/**
 * Generate an access token
 */
export function generateAccessToken(user: User): string {
  const payload = {
    sub: user.id,
    username: user.username,
    type: 'access' as const,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
  } as jwt.SignOptions);
}

/**
 * Generate a refresh token with unique JTI
 */
export function generateRefreshToken(user: User): { token: string; jti: string } {
  const jti = `refresh_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  const payload = {
    sub: user.id,
    type: 'refresh' as const,
    jti,
  };

  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRY,
  } as jwt.SignOptions);

  // Store refresh token metadata
  const store = loadUsersStore();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  store.refresh_tokens[jti] = {
    user_id: user.id,
    expires_at: expiresAt.toISOString(),
  };
  saveUsersStore(store);

  return { token, jti };
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (e) {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Generate a unique user ID
 */
function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new user
 */
export async function createUser(data: {
  username: string;
  email: string;
  password: string;
}): Promise<PublicUser> {
  const store = loadUsersStore();

  // Check for existing username
  for (const user of Object.values(store.users)) {
    if (user.username.toLowerCase() === data.username.toLowerCase()) {
      throw new Error('USERNAME_EXISTS');
    }
    if (user.email.toLowerCase() === data.email.toLowerCase()) {
      throw new Error('EMAIL_EXISTS');
    }
  }

  // Hash password
  const password_hash = await hashPassword(data.password);

  // Create user
  const user: User = {
    id: generateUserId(),
    username: data.username,
    email: data.email,
    password_hash,
    created_at: new Date().toISOString(),
    is_active: true,
    role: 'user',
  };

  store.users[user.id] = user;
  saveUsersStore(store);

  // Return public user data
  const { password_hash: _, ...publicUser } = user;
  return publicUser as PublicUser;
}

/**
 * Find user by username or email
 */
export function findUserByUsernameOrEmail(identifier: string): User | null {
  const store = loadUsersStore();
  const lowerIdentifier = identifier.toLowerCase();

  for (const user of Object.values(store.users)) {
    if (user.username.toLowerCase() === lowerIdentifier || user.email.toLowerCase() === lowerIdentifier) {
      return user;
    }
  }

  return null;
}

/**
 * Find user by ID
 */
export function findUserById(id: string): User | null {
  const store = loadUsersStore();
  return store.users[id] || null;
}

/**
 * Update user's last login timestamp
 */
export function updateLastLogin(userId: string): void {
  const store = loadUsersStore();
  if (store.users[userId]) {
    store.users[userId].last_login = new Date().toISOString();
    saveUsersStore(store);
  }
}

/**
 * Validate refresh token and get associated user
 */
export function validateRefreshToken(jti: string): User | null {
  const store = loadUsersStore();
  const tokenData = store.refresh_tokens[jti];

  if (!tokenData) {
    return null;
  }

  // Check if expired
  if (new Date(tokenData.expires_at) < new Date()) {
    // Clean up expired token
    delete store.refresh_tokens[jti];
    saveUsersStore(store);
    return null;
  }

  return findUserById(tokenData.user_id);
}

/**
 * Invalidate a refresh token
 */
export function invalidateRefreshToken(jti: string): void {
  const store = loadUsersStore();
  delete store.refresh_tokens[jti];
  saveUsersStore(store);
}

/**
 * Invalidate all refresh tokens for a user (logout all sessions)
 */
export function invalidateAllUserTokens(userId: string): void {
  const store = loadUsersStore();

  for (const [jti, tokenData] of Object.entries(store.refresh_tokens)) {
    if (tokenData.user_id === userId) {
      delete store.refresh_tokens[jti];
    }
  }

  saveUsersStore(store);
}

/**
 * Clean up expired refresh tokens (maintenance)
 */
export function cleanupExpiredTokens(): number {
  const store = loadUsersStore();
  const now = new Date();
  let cleaned = 0;

  for (const [jti, tokenData] of Object.entries(store.refresh_tokens)) {
    if (new Date(tokenData.expires_at) < now) {
      delete store.refresh_tokens[jti];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveUsersStore(store);
  }

  return cleaned;
}

// ============================================================================
// COOKIE OPTIONS
// ============================================================================

export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

export const CLEAR_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: '/api/auth',
  maxAge: 0,
};

// ============================================================================
// PUBLIC USER HELPER
// ============================================================================

/**
 * Convert User to PublicUser (remove sensitive data)
 */
export function toPublicUser(user: User): PublicUser {
  const { password_hash: _, ...publicUser } = user;
  return publicUser as PublicUser;
}
