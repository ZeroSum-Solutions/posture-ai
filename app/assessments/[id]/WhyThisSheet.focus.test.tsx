// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import WhyThisSheet from './WhyThisSheet'

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  }),
}))

afterEach(cleanup)

describe('WhyThisSheet focus management', () => {
  it('moves focus into the modal dialog on open (WCAG 2.4.3 / 2.1.2)', async () => {
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
  })
})
