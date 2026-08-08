export function completionMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'expired':
      return 'This invitation has expired. Request a replacement invitation.'
    case 'revoked':
      return 'Practitioner access has been revoked. Contact your beta administrator.'
    case 'not_invited':
    case 'email_mismatch':
      return 'This account does not match an active practitioner invitation.'
    case 'recovery_not_authorized':
      return 'MFA recovery has not been authorized. Contact your beta administrator before trying again.'
    case 'mfa_required':
      return 'The server did not receive the new MFA session. Verify again or reload this page.'
    case 'unauthorized':
      return 'Your secure session has expired. Open the invitation or sign in again.'
    default:
      return fallback || 'Could not activate practitioner access. Please try again.'
  }
}

/**
 * TOTP secrets are base32; authenticator apps accept them with or without
 * spaces. Grouping makes a 32-character key possible to type by hand without
 * losing your place. The clipboard always gets the unspaced original.
 */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}
