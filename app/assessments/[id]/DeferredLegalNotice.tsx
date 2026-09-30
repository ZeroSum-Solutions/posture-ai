'use client'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type LegalNoticeComponent from '@/components/LegalNotice'
import { useDisclosureOpen } from './useDisclosureOpen'

const LegalNotice = dynamic(() => import('@/components/LegalNotice'))

/**
 * The results page shows the screening notice inside a collapsed disclosure.
 * Load its code and fetch its text only when that disclosure first opens, so it
 * stays out of the route's initial JavaScript.
 */
export default function DeferredLegalNotice(props: ComponentProps<typeof LegalNoticeComponent>) {
  const [anchorRef, opened] = useDisclosureOpen<HTMLSpanElement>()
  if (opened) return <LegalNotice {...props} />
  return <span ref={anchorRef} hidden />
}
