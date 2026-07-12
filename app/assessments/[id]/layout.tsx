import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Assessment Results',
}

export default function AssessmentLayout({ children }: { children: ReactNode }) {
  return children
}
