import AuthFrame from '@/components/AuthFrame'
import { Button } from '@/components/ui/Button'

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
        <p className="t-body" style={{ margin: 0 }}>
          If you received an invitation, open the secure link in that email to set
          up your account and multi-factor authentication. Invitations are tied to
          one email address and cannot be transferred.
        </p>
        <p className="t-label" style={{ margin: 0 }}>
          Need access or a replacement invitation? Contact your beta administrator.
        </p>
        <Button href="/auth/sign-in" variant="primary" size="lg" block style={{ marginTop: 'var(--s-16)' }}>
          <span className="sr-only">Already accepted an invitation? </span>Sign in
        </Button>
      </div>
    </AuthFrame>
  )
}
