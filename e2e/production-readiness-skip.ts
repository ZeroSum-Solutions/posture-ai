import type { TestInfo } from '@playwright/test'

export type ProductionReadinessSkip = {
  key: string
  source: string
  scope: Record<string, string>
}

export function skipForProductionReadiness(
  testInfo: TestInfo,
  condition: boolean,
  approvedSkip: ProductionReadinessSkip,
  description: string,
) {
  if (!condition) return
  testInfo.annotations.push({
    type: 'production-readiness-skip',
    description: JSON.stringify({
      key: approvedSkip.key,
      source: approvedSkip.source,
      scope: approvedSkip.scope,
    }),
  })
  testInfo.skip(true, description)
}
