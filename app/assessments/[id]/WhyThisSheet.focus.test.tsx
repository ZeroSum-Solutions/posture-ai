// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import WhyThisSheet from './WhyThisSheet'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WhyThisSheet focus management', () => {
  it('moves focus into the modal dialog on open (WCAG 2.4.3 / 2.1.2)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ muscles: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    render(
      <WhyThisSheet
        exerciseName="Child's Pose"
        findingKey="trunk_lean"
        findingLabel="Trunk Lean"
        movementAction="lengthens"
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(fetch).toHaveBeenCalledWith(
      '/api/clinical-content/findings/trunk_lean/muscles',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})
