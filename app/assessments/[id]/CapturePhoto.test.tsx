// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CapturePhoto from './CapturePhoto'

afterEach(cleanup)

it('opens and closes the saved view in an accessible photo dialog', () => {
  const show = vi.fn()
  const close = vi.fn()
  HTMLDialogElement.prototype.showModal = show
  HTMLDialogElement.prototype.close = close
  render(<CapturePhoto url="/api/captures/capture-1/image" label="side left" />)
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge side left capture' }))
  expect(show).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('Close photo'))
  expect(close).toHaveBeenCalledOnce()
  expect(screen.getByAltText('side left original capture').getAttribute('src')).toBe('/api/captures/capture-1/image')
})

it('does not invent a photograph for historical landmark-only captures', () => {
  render(<CapturePhoto url={null} label="front" />)
  expect(screen.getByText('Photo not saved')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
