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
      '.claude/**',
    ],
  },
  {
    files: ['app/api/**/*.{ts,tsx}'],
    rules: {
      // API logs may contain regulated identifiers or provider error text.
      // Routes must use lib/log.ts, which hashes IDs and accepts controlled codes.
      'no-console': 'error',
    },
  },
]
