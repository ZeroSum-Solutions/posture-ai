// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CameraCapture from './CameraCapture'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('demo camera lifecycle', () => {
  it('releases a camera stream when permission resolves after leaving capture', async () => {
    let resolveStream!: (stream: MediaStream) => void
    const pending = new Promise<MediaStream>(resolve => { resolveStream = resolve })
    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => pending) } })
    const { unmount } = render(<CameraCapture view="front" onCapture={vi.fn()} onClose={vi.fn()} />)
    unmount()
    await act(async () => { resolveStream(stream); await pending })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('explains denied permission and keeps capture disabled', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } })
    render(<CameraCapture view="side" onCapture={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Camera permission was declined'))
    expect((screen.getByRole('button', { name: 'Capture side' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel camera' })).toBeDefined()
  })
})
