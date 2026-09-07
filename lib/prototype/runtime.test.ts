import { describe, expect, test } from 'vitest'

import {
  configuredOperationMode,
  operationForPractitioner,
} from './runtime'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-000000000002'

describe('prototype operation policy', () => {
  test('defaults to governed operation when prototype mode is not explicitly configured', () => {
    expect(configuredOperationMode({})).toBe('governed')
    expect(operationForPractitioner(OWNER_ID, {})).toEqual({
      mode: 'governed',
      isPrototype: false,
      practitionerId: OWNER_ID,
    })
  })

  test('enables prototype operation only for an explicitly allowlisted practitioner', () => {
    const environment = {
      POSTURE_OPERATION_MODE: 'prototype',
      POSTURE_PROTOTYPE_PRACTITIONER_IDS: OWNER_ID,
    }

    expect(operationForPractitioner(OWNER_ID, environment)).toEqual({
      mode: 'prototype',
      isPrototype: true,
      practitionerId: OWNER_ID,
    })
    expect(operationForPractitioner(OTHER_ID, environment).mode).toBe('governed')
  })

  test('fails closed for a malformed allowlist instead of partially accepting it', () => {
    const environment = {
      POSTURE_OPERATION_MODE: 'prototype',
      POSTURE_PROTOTYPE_PRACTITIONER_IDS: `${OWNER_ID},not-a-user-id`,
    }

    expect(operationForPractitioner(OWNER_ID, environment).mode).toBe('governed')
  })

  test('does not treat test flags or a public flag as prototype authority', () => {
    expect(operationForPractitioner(OWNER_ID, {
      POSTURE_TEST_MODE_ENABLED: '1',
      NEXT_PUBLIC_POSTURE_TEST_MODE: '1',
    }).mode).toBe('governed')
  })
})
