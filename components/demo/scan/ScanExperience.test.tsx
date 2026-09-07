// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { testLandmarksFrames } from '@posture-ai/engine'
import { DEMO_SCAN_STORAGE_KEY, loadDemoScan } from '@/lib/demo/scan-store'
import ScanExperience from './ScanExperience'

const detect = vi.hoisted(() => vi.fn())
vi.mock('@/lib/pose/detect', () => ({ detectPose: detect }))
vi.mock('@/lib/pose/normalize-upload', () => ({ normalizeUploadedImage: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,dGVzdA==', pixelQuality: null })) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a> }))

beforeEach(() => { window.localStorage.clear(); detect.mockReset() })
afterEach(cleanup)

describe('demo scan experience', () => {
  it('saves a labeled sample that survives reload and connects to workouts', () => {
    render(<ScanExperience />)
    fireEvent.click(screen.getByRole('button', { name: 'Use sample scan' }))
    expect(screen.getByText('Synthetic sample · Alex')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Build a workout from this scan' }).getAttribute('href')).toBe('/demo/workouts')
    expect(loadDemoScan()?.source).toBe('sample')
    cleanup()
    render(<ScanExperience />)
    expect(screen.getByText('Synthetic sample · Alex')).toBeDefined()
    expect(detect).not.toHaveBeenCalled()
  })

  it('reports failed detection, keeps retry controls, and never silently substitutes a sample', async () => {
    detect.mockResolvedValue({ view: 'front', landmarks: {}, detectedPoseCount: 0 })
    render(<ScanExperience />)
    fireEvent.change(screen.getByLabelText('Upload front photo'), { target: { files: [new File(['photo'], 'front.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No person detected'))
    expect((screen.getByRole('button', { name: 'See my scan findings' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Upload front photo') as HTMLInputElement).disabled).toBe(false)
    expect(loadDemoScan()).toBeNull()
  })

  it('scores detected front and side coordinates and saves no image bytes', async () => {
    detect.mockImplementation(async (_image, view) => ({ ...structuredClone(testLandmarksFrames.find(frame => frame.view === view)), detectedPoseCount: 1, aspectRatio: 0.75, source: 'upload' }))
    render(<ScanExperience />)
    for (const view of ['front', 'side']) {
      fireEvent.change(screen.getByLabelText(`Upload ${view} photo`), { target: { files: [new File(['photo'], `${view}.jpg`, { type: 'image/jpeg' })] } })
      await waitFor(() => expect((screen.getByLabelText(`Upload ${view} photo`) as HTMLInputElement).disabled).toBe(false))
    }
    fireEvent.click(screen.getByRole('button', { name: 'See my scan findings' }))
    expect(loadDemoScan()?.source).toBe('capture')
    expect(loadDemoScan()?.result.findings.length).toBeGreaterThan(0)
    expect(window.localStorage.getItem(DEMO_SCAN_STORAGE_KEY)).not.toContain('data:image')
    const visuals = screen.getAllByRole('img')
    expect(visuals.map(svg => svg.getAttribute('viewBox'))).toEqual(['0 0 225 300', '0 0 225 300'])
  })
})
