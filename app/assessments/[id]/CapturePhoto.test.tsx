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
  expect(screen.getByText('No photo for this view')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('selects its view when tapped, apart from the enlarge control', () => {
  const onSelect = vi.fn()
  const show = vi.fn()
  HTMLDialogElement.prototype.showModal = show
  const { rerender } = render(<CapturePhoto url="/api/captures/capture-2/image" label="front" onSelect={onSelect} />)
  const tile = screen.getByRole('button', { name: 'front view' })
  expect(tile.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(tile)
  expect(onSelect).toHaveBeenCalledOnce()
  expect(show).not.toHaveBeenCalled()
  rerender(<CapturePhoto url="/api/captures/capture-2/image" label="front" onSelect={onSelect} selected />)
  expect(screen.getByRole('button', { name: 'front view' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge front capture' }))
  expect(show).toHaveBeenCalledOnce()
  expect(onSelect).toHaveBeenCalledOnce()
})
