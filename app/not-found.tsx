import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'

export default function NotFound() {
  return (
    <div
      className="app-screen app-screen-x"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
    >
      <Surface tier="feature">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
          <Icon name="magnifer-linear" size={32} />
          <h1 className="t-readout-xl n">404</h1>
          <h2 className="t-headline-sm">Page Not Found</h2>
          <p className="t-body">
            The page you are looking for does not exist or has been moved.
          </p>
          <Link href="/dashboard" className="a-primary" style={{ marginTop: 8 }}>
            Go to Dashboard
          </Link>
        </div>
      </Surface>
    </div>
  )
}
