// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReviewTabs from './ReviewTabs'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

const tabs = [
  { id: 'review-summary', label: 'Summary', content: <p>Summary content</p> },
  { id: 'review-findings', label: 'Findings', count: 9, content: <p>Finding content</p> },
  { id: 'review-exercises', label: 'Exercises', count: 12, content: <p>Exercise content</p> },
]

describe('ReviewTabs', () => {
  it('shows one concern at a time and exposes selected state', () => {
    render(<ReviewTabs tabs={tabs} defaultTabId="review-summary" />)

    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Summary content')).toBeTruthy()
    expect(screen.queryByText('Finding content')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))

    expect(screen.getByRole('tab', { name: /Findings/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Finding content')).toBeTruthy()
    expect(screen.queryByText('Summary content')).toBeNull()
    expect(window.location.hash).toBe('#review-findings')
  })

  it('supports arrow, Home, and End keyboard navigation', () => {
    render(<ReviewTabs tabs={tabs} defaultTabId="review-summary" />)
    const summary = screen.getByRole('tab', { name: 'Summary' })

    fireEvent.keyDown(summary, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Findings/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /Findings/ }), { key: 'End' })
    expect(screen.getByRole('tab', { name: /Exercises/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /Exercises/ }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens a valid deep-linked tab from the URL hash', async () => {
    window.history.replaceState(null, '', '#review-findings')
    render(<ReviewTabs tabs={tabs} defaultTabId="review-summary" />)

    expect(await screen.findByText('Finding content')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Findings/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens assessment evidence and scrolls after resolving the anatomy viewer alias', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    window.history.replaceState(null, '', '#anatomy-viewer-title')

    render(<ReviewTabs
      defaultTabId="assessment-summary"
      tabs={[
        { id: 'assessment-summary', label: 'Summary', content: <p>Assessment summary</p> },
        {
          id: 'assessment-evidence',
          label: 'Evidence',
          content: <h2 id="anatomy-viewer-title">Explore anatomy in 3D</h2>,
        },
      ]}
    />)

    expect(await screen.findByRole('heading', { name: 'Explore anatomy in 3D' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Evidence' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))
  })
})
