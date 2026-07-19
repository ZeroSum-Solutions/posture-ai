// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import CaptureTelemetryPanel from './CaptureTelemetryPanel'
import { getLiveTelemetrySnapshot } from '@/lib/pose/live-telemetry'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('CaptureTelemetryPanel', () => {
  it('stays absent without the explicit development query flag', () => {
    render(<CaptureTelemetryPanel activeSlot="front" phase="live" />)
    expect(screen.queryByTestId('capture-telemetry')).toBeNull()
    expect(getLiveTelemetrySnapshot()).toBeNull()
  })

  it('shows an opt-in panel and tears down its collector on unmount', async () => {
    window.history.replaceState({}, '', '/assessments/new?captureTelemetry=1')
    const view = render(<CaptureTelemetryPanel activeSlot="front" phase="live" />)

    await waitFor(() => expect(screen.getByTestId('capture-telemetry')).toBeTruthy())
    expect(screen.getByText(/no photos, landmarks, or client fields/i)).toBeTruthy()
    expect(getLiveTelemetrySnapshot()?.viewTransitions).toEqual([{ view: 'front', phase: 'live' }])

    view.unmount()
    expect(getLiveTelemetrySnapshot()).toBeNull()
  })
})
