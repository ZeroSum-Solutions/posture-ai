'use client'

import { useEffect, useState } from 'react'

import type {
  LegalDocumentKind,
  LegalSection,
  LegalSnapshot,
} from '@/lib/legal/types'

export type LegalDocumentLoadState = Readonly<{
  document: LegalSnapshot | null
  isLoading: boolean
  error: string | null
}>

function isSection(value: unknown): value is LegalSection {
  if (!value || typeof value !== 'object') return false
  const section = value as Record<string, unknown>
  return typeof section.id === 'string'
    && (typeof section.heading === 'string' || section.heading === null)
    && Array.isArray(section.paragraphs)
    && section.paragraphs.every((paragraph) => typeof paragraph === 'string')
    && (section.bullets === undefined
      || (Array.isArray(section.bullets) && section.bullets.every((bullet) => typeof bullet === 'string')))
}

function isLegalSnapshot(value: unknown, kind: LegalDocumentKind): value is LegalSnapshot {
  if (!value || typeof value !== 'object') return false
  const document = value as Record<string, unknown>
  return document.schemaVersion === 1
    && document.kind === kind
    && typeof document.documentId === 'string'
    && typeof document.version === 'string'
    && typeof document.title === 'string'
    && typeof document.effectiveAt === 'string'
    && document.jurisdiction === 'US'
    && document.locale === 'en-US'
    && document.productScope === 'us_fitness_wellness_assessment_beta_v1'
    && typeof document.audience === 'string'
    && typeof document.bodySha256 === 'string'
    && typeof document.text === 'string'
    && Array.isArray(document.sections)
    && document.sections.every(isSection)
    && typeof document.isFixture === 'boolean'
}

export default function useLegalDocument(
  kind: LegalDocumentKind,
  enabled = true,
): LegalDocumentLoadState {
  const requestKey = enabled ? kind : null
  const [state, setState] = useState<LegalDocumentLoadState & { requestKey: LegalDocumentKind | null }>({
    requestKey,
    document: null,
    isLoading: enabled,
    error: null,
  })

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/legal/documents?kind=${encodeURIComponent(kind)}`, {
          signal: controller.signal,
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          const message = body && typeof body === 'object' && 'error' in body
            && typeof body.error === 'string'
            ? body.error
            : 'Required legal text is temporarily unavailable.'
          throw new Error(message)
        }
        const candidate = body && typeof body === 'object' && 'document' in body
          ? body.document
          : null
        if (!isLegalSnapshot(candidate, kind)) {
          throw new Error('The legal document response was invalid. Acceptance is disabled.')
        }
        setState({ requestKey: kind, document: candidate, isLoading: false, error: null })
      } catch (caught) {
        if (controller.signal.aborted) return
        setState({
          requestKey: kind,
          document: null,
          isLoading: false,
          error: caught instanceof Error
            ? caught.message
            : 'Required legal text is temporarily unavailable.',
        })
      }
    })()

    return () => controller.abort()
  }, [enabled, kind])

  if (state.requestKey !== requestKey) {
    return { document: null, isLoading: enabled, error: null }
  }
  return state
}
