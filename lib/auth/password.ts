// Minimum password length enforced consistently across sign-up, password reset,
// and the in-app password change. Kept >= Supabase's backend default (6) so every
// client flow agrees on a single value.
export const MIN_PASSWORD_LENGTH = 8

/**
 * Validates a new password chosen during the reset flow. Returns a
 * user-facing error message, or null when the password is acceptable.
 */
export function validatePasswordReset(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password !== confirm) {
    return 'Passwords do not match.'
  }
  return null
}
