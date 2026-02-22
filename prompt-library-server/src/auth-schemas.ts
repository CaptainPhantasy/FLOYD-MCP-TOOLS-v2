/**
 * Authentication Validation Schemas
 *
 * Zod schemas for validating authentication requests.
 */

import { z } from 'zod';

// ============================================================================
// PASSWORD VALIDATION
// ============================================================================

/**
 * Password must:
 * - Be at least 8 characters long
 * - Contain at least one letter
 * - Contain at least one number
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .regex(
    /[a-zA-Z]/,
    'Password must contain at least one letter'
  )
  .regex(
    /[0-9]/,
    'Password must contain at least one number'
  );

// ============================================================================
// AUTH SCHEMAS
// ============================================================================

/**
 * Login request schema
 */
export const LoginSchema = z.object({
  username: z.string().min(1, 'Username or email is required'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Registration request schema
 */
export const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters long')
    .max(30, 'Username must not exceed 30 characters')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores'
    ),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email format'),
  password: passwordSchema,
});

/**
 * Refresh token schema (for request validation)
 */
export const RefreshSchema = z.object({
  // No body required - token comes from cookie
});

/**
 * Logout schema
 */
export const LogoutSchema = z.object({
  // No body required
});

/**
 * Update password schema (for future use)
 */
export const UpdatePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: passwordSchema,
});

// ============================================================================
// ERROR RESPONSES
// ============================================================================

/**
 * Format validation errors for API responses
 */
export function formatValidationError(error: z.ZodError): {
  error: string;
  message: string;
  details: Record<string, string>;
} {
  const details: Record<string, string> = {};

  error.errors.forEach((err) => {
    const path = err.path.join('.');
    details[path] = err.message;
  });

  return {
    error: 'Validation failed',
    message: 'Please check your input and try again',
    details,
  };
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordSchema>;
