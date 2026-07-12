// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ConsentResponder from './ConsentResponder'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ConsentResponder success announcement', () => {
  it('announces the recorded confirmation via a live status region (WCAG 4.1.3)', async () => {
    // The whole <main> subtree is swapped on success; without a live status region a
    // screen-reader user gets no confirmation their consent was recorded.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
    render(<ConsentResponder token="t1" />)
    fireEvent.change(screen.getByLabelText(/Type full name/i), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: /Agree & Sign/i }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toMatch(/recorded/i)
  })
})
