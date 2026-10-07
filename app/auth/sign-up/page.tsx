import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import { Banner } from '@/components/ui/Banner'

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
      <div className="app-stack">
        <Banner variant="info">
          If you received an invitation, open the secure link in that email to set
          up your account and multi-factor authentication. Invitations are tied to
          one email address and cannot be transferred.
        </Banner>
        <p className="t-footnote" style={{ color: 'var(--text-3)' }}>
          Need access or a replacement invitation? Contact your beta administrator.
        </p>
        <Link
          href="/auth/sign-in"
          className="t-footnote"
          style={{ display: 'inline-flex', minHeight: 48, alignItems: 'center', color: 'var(--text-2)', textDecoration: 'underline' }}
        >
          Already accepted an invitation? Sign in
        </Link>
      </div>
    </AuthFrame>
  )
}
