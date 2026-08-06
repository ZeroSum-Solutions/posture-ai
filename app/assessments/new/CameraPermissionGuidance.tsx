'use client'
import type { PermissionGuidance } from '@/lib/capture/permission-guidance'

interface CameraPermissionGuidanceProps {
  /** Null for camera failures unrelated to permission (device missing,
   *  in use, disconnected, capture-time encode failure) — those keep the
   *  plain "Try Again" recovery with no added guidance. */
  guidance: PermissionGuidance | null
  onRetry: () => void
}

/**
 * Renders inside the existing camera-unavailable alert panel in
 * FullScreenCapture.tsx. Only the ordered steps + the browser-appropriate
 * framing are added here — the panel's role="alert", heading, and error copy
 * stay in the parent so this component owns exactly the new guidance content
 * plus the retry control, and there is still only one "Try Again" button.
 */
export default function CameraPermissionGuidance({ guidance, onRetry }: CameraPermissionGuidanceProps) {
  const deepLink = guidance?.systemSettingsDeepLink ?? null
  return (
    <>
      {guidance && (
        <div style={{ textAlign: 'left', width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p className="a-help" style={{ margin: 0 }}>{guidance.reason}</p>
          <p className="a-help" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {guidance.canRetryPrompt
              ? 'Try Again may show the camera permission prompt again.'
              : 'Try Again will not reopen the prompt — this has to change in your browser or device settings first:'}
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {guidance.steps.map((step, i) => (
              <li key={i} className="a-help" style={{ margin: 0 }}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      <button onClick={onRetry} className="a-primary">Try Again</button>
      {deepLink && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => { window.location.href = deepLink }}
            className="a-secondary"
          >
            Try Opening System Settings
          </button>
          <p className="a-help" style={{ margin: 0, maxWidth: 280 }}>
            macOS will ask you to confirm this, and it may not open directly to the Camera pane.
          </p>
        </div>
      )}
    </>
  )
}
