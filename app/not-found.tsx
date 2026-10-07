import { EmptyState } from '@/components/ui'

export default function NotFound() {
  return (
    <div
      className="app-screen app-screen-x"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
    >
      <EmptyState
        variant="page"
        icon="magnifer-linear"
        title="Page not found"
        body="The page you are looking for does not exist or has been moved."
        primary={{ label: 'Go to Dashboard', href: '/dashboard' }}
      />
    </div>
  )
}
