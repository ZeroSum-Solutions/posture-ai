// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Sheet } from './Sheet'

afterEach(cleanup)

function Harness({ title = 'Exercise detail' }: { title?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      <Sheet open={open} onOpenChange={setOpen} title={title}>
        <p>Body content</p>
      </Sheet>
    </div>
  )
}

describe('Sheet', () => {
  it('is a dialog with aria-modal, and has an always-present, accessibly-named Close button', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('moves focus to the title on open', async () => {
    render(<Harness title="Why this?" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))

    const title = await screen.findByRole('heading', { name: 'Why this?' })
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('Escape closes the sheet and restores focus to the trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open sheet' })
    // jsdom, unlike a real browser, does not focus a button on click — focus
    // it explicitly so "restores focus to the trigger" is actually checking
    // something (the real failure mode this guards: restoring focus to
    // `document.body` because the trigger was never captured).
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('leaves Escape to a native dialog opened inside the sheet', async () => {
    function Nested() {
      const [open, setOpen] = useState(true)
      return (
        <Sheet open={open} onOpenChange={setOpen} title="Capture">
          <dialog open aria-label="Front capture photo"><button>Close photo</button></dialog>
        </Sheet>
      )
    }
    render(<Nested />)
    await screen.findByRole('heading', { name: 'Capture' })
    const inner = screen.getByRole('button', { name: 'Close photo' })
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    inner.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByRole('heading', { name: 'Capture' })).toBeTruthy()
  })

  it('the Close button closes the sheet and restores focus to the trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open sheet' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
