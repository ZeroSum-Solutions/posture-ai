// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import RemoteConsentButton from './RemoteConsentButton'

// next/link is not used in RemoteConsentButton so no mock needed

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RemoteConsentButton', () => {
  describe('Copy link — clipboard rejects (BUG-013/019)', () => {
    it('shows role=alert error and does NOT show "Copied" when clipboard rejects', async () => {
      // Arrange: mock fetch to resolve successfully so we reach the ready state
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://example.com/consent/abc123', qr: 'data:image/png;base64,abc' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      // Mock clipboard to reject
      const clipboardMock = {
        writeText: vi.fn().mockRejectedValue(new Error('permission denied')),
      }
      vi.stubGlobal('navigator', { clipboard: clipboardMock })

      render(<RemoteConsentButton clientId="test-client-id" />)

      // Click "Send remote consent link" to generate (move to ready state)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send remote consent link/i }))
      })

      // Should now be in ready state with the Copy link button
      expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy()

      // Click Copy link — clipboard rejects
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
      })

      // Should show role=alert error
      const alert = screen.getByRole('alert')
      expect(alert).toBeTruthy()
      expect(alert.textContent).toMatch(/could not copy/i)

      // Should NOT show "Copied"
      expect(screen.queryByRole('button', { name: /copied/i })).toBeNull()
    })
  })

  describe('Copy link — clipboard succeeds', () => {
    it('shows "Copied" then reverts to "Copy link" after 2 seconds', async () => {
      vi.useFakeTimers()

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://example.com/consent/abc123', qr: 'data:image/png;base64,abc' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const clipboardMock = {
        writeText: vi.fn().mockResolvedValue(undefined),
      }
      vi.stubGlobal('navigator', { clipboard: clipboardMock })

      render(<RemoteConsentButton clientId="test-client-id" />)

      // Generate link
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send remote consent link/i }))
      })

      // Click Copy link
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
      })

      // Should immediately show "Copied"
      expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy()

      // Advance timers by 2000ms
      await act(async () => {
        vi.advanceTimersByTime(2100)
      })

      // Should revert back to "Copy link"
      expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /copied/i })).toBeNull()

      vi.useRealTimers()
    })
  })
})
