// Supabase's default minimum password length.
export const MIN_PASSWORD_LENGTH = 6

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
