// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider, useToast } from './Toast'

afterEach(cleanup)

function Harness() {
  const toast = useToast()
  return (
    <div>
      <button onClick={() => toast.success('Saved')}>fire success</button>
      <button onClick={() => toast.info('Heads up')}>fire info</button>
      <button onClick={() => toast.error('Could not save')}>fire error</button>
    </div>
  )
}

describe('Toast', () => {
  it('a success toast is role="status"', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'fire success' }))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an info toast is role="status"', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'fire info' }))
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('an error toast is role="alert"', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'fire error' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('useToast throws outside a ToastProvider', () => {
    function Bare() {
      useToast()
      return null
    }
    expect(() => render(<Bare />)).toThrow()
  })
})
