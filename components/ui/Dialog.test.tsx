// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

afterEach(cleanup)

function Harness({ danger = false }: { danger?: boolean }) {
  const [open, setOpen] = useState(false)
  const onConfirm = vi.fn()
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this client?"
        description="This can't be undone."
        confirm={{ label: danger ? 'Delete' : 'Save', onConfirm, tone: danger ? 'danger' : 'primary' }}
      />
    </div>
  )
}

describe('Dialog', () => {
  it('initial focus lands on Cancel, the safer control', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))
  })

  it('is role="dialog" for a plain confirm', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('is role="alertdialog" for a danger confirm', async () => {
    render(<Harness danger />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('Cancel closes the dialog and restores focus to the trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
