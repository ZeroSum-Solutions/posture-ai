import type { LegalSnapshot } from '@/lib/legal/types'

export type ReportNotice = LegalSnapshot | Readonly<{
  kind: 'prototype_notice'
  text: string
}>

/** Prototype provenance is not a signed or approved legal document. */
export const PROTOTYPE_REPORT_NOTICE: ReportNotice = {
  kind: 'prototype_notice',
  text: 'Posture AI prototype screening. Findings and movement suggestions support a demonstration and do not replace an individual assessment by a qualified health professional.',
}

export function reportNoticeCaption(notice: ReportNotice): string {
  return notice.kind === 'prototype_notice'
    ? 'Prototype report · Clinical review is not asserted.'
    : `Version ${notice.version} · Effective ${notice.effectiveAt}`
}
