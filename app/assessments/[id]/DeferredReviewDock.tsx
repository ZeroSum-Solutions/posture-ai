'use client'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type ReviewDockComponent from './ReviewDock'
import { useDisclosureOpen } from './useDisclosureOpen'

const ReviewDock = dynamic(() => import('./ReviewDock'))

/**
 * The report dock sits inside the collapsed "Report, share & compare"
 * disclosure. Load its code when that disclosure first opens, so it stays out
 * of the route's initial JavaScript. All dock state lives in the parent.
 */
export default function DeferredReviewDock(props: ComponentProps<typeof ReviewDockComponent>) {
  const [anchorRef, opened] = useDisclosureOpen<HTMLSpanElement>()
  if (opened) return <ReviewDock {...props} />
  return <span ref={anchorRef} hidden />
}
