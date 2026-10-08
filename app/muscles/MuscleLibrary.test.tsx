// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MuscleLibrary } from './MuscleLibrary'

const muscle = (slug: string, reviewed_at: string | null) => ({
  slug, name: slug, region: 'trunk', function_text: `${slug} function`, reviewed_at,
})

afterEach(cleanup)

describe('muscle library review status', () => {
  it('says "pending review" once when every entry is pending', () => {
    render(<MuscleLibrary muscles={[muscle('a', null), muscle('b', null), muscle('c', null)]} />)
    expect(screen.getByText('All entries pending review')).toBeTruthy()
    expect(screen.queryByText('Pending review')).toBeNull()
  })

  it('marks only the rows that differ from the majority', () => {
    render(<MuscleLibrary muscles={[muscle('a', null), muscle('b', null), muscle('c', '2026-01-01')]} />)
    expect(screen.getByText('Pending review unless marked reviewed')).toBeTruthy()
    expect(screen.getAllByText('Reviewed')).toHaveLength(1)
    cleanup()
    render(<MuscleLibrary muscles={[muscle('a', '2026-01-01'), muscle('b', '2026-01-01'), muscle('c', null)]} />)
    expect(screen.queryByText(/entries pending review|unless marked/)).toBeNull()
    expect(screen.getAllByText('Pending review')).toHaveLength(1)
  })
})
