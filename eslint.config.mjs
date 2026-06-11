import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

export default [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'mobile/**',
      'test-results/**',
      'playwright-report/**',
      'scripts/spike/**',
      'public/**',
    ],
  },
]
