import * as React from 'react'
import type { ReactNode } from 'react'

type VTProps = { name?: string; share?: string; default?: string; enter?: string; exit?: string; children: ReactNode }

// React's <ViewTransition> ships in the canary React that the Next.js App
// Router bundles; the stable react package (unit tests) does not export it.
const ViewTransition = (React as unknown as { ViewTransition?: React.ComponentType<VTProps> }).ViewTransition

/**
 * A shared-element morph across routes (DESIGN.md › Motion rule 2): elements
 * with the same `name` on the old and new page morph into each other through
 * the browser's View Transitions API. Falls back to plain children where
 * ViewTransition is unavailable. `name` must be unique on a page.
 */
export function Morph({ name, kind = 'morph', children }: { name: string; kind?: 'morph' | 'lens-morph'; children: ReactNode }) {
  if (!ViewTransition) return <>{children}</>
  return (
    <ViewTransition name={name} share={kind} default="none">
      {children}
    </ViewTransition>
  )
}
