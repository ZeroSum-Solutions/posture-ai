import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'

/**
 * Public account creation is intentionally unavailable. Practitioner identities
 * are issued by an administrator and bound to a single invitation before Auth
 * creates the account.
 */
export default function SignUpPage() {
  return (
    <AuthFrame
      title="Practitioner access is invitation-only"
      description="This beta is limited to practitioners invited by the Posture AI team."
    >
      <div
        role="status"
        style={{
          background: 'rgba(0,152,243,0.1)',
          border: '1px solid rgba(0,152,243,0.3)',
          borderRadius: '8px',
          padding: '16px',
          color: 'var(--text-primary)',
          fontSize: '0.9rem',
          lineHeight: 1.6,
          marginBottom: '20px',
        }}
      >
        If you received an invitation, open the secure link in that email to set
        up your account and multi-factor authentication. Invitations are tied to
        one email address and cannot be transferred.
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Need access or a replacement invitation? Contact your beta administrator.
      </p>
      <Link
        href="/auth/sign-in"
        style={{
          display: 'inline-flex',
          minHeight: '44px',
          alignItems: 'center',
          color: 'var(--text-secondary)',
          textDecoration: 'underline',
          fontSize: '0.9rem',
        }}
      >
        Already accepted an invitation? Sign in
      </Link>
    </AuthFrame>
  )
}
