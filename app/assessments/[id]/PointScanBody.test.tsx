// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PointScanBody from './PointScanBody'
afterEach(cleanup)
it('shows a labelled generic guide and preserves the view switch', () => {
  const onViewChange = vi.fn()
  const { container } = render(<PointScanBody view="front" onViewChange={onViewChange} markers={[]} caption="Generic body guide, not a reconstruction of this person." />)
  expect(screen.getByRole('heading', { name: 'Region guide · front view' })).toBeTruthy()
  expect(screen.getByText(/not a reconstruction/)).toBeTruthy()
  expect(container.querySelector('canvas')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Side' }))
  expect(onViewChange).toHaveBeenCalledWith('side')
})
