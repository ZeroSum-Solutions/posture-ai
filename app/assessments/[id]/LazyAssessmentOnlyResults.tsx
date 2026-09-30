'use client'
import dynamic from 'next/dynamic'

/**
 * page.tsx renders either this assessment-only view or ClinicalAssessmentResults.
 * A server page that imports both client components ships both in the route's
 * initial JavaScript, so the clinical route paid for this view it never shows.
 * Behind this client boundary its code loads only when it actually renders.
 */
const LazyAssessmentOnlyResults = dynamic(() => import('./AssessmentOnlyResults'))

export default LazyAssessmentOnlyResults
