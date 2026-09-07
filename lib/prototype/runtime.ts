export type OperationMode = 'governed' | 'prototype'

export type PractitionerOperation = {
  mode: OperationMode
  isPrototype: boolean
  practitionerId: string
}

export type OperationEnvironment = Readonly<Record<string, string | undefined>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function configuredOperationMode(
  environment: OperationEnvironment = process.env,
): OperationMode {
  return environment.POSTURE_OPERATION_MODE === 'prototype' ? 'prototype' : 'governed'
}

function configuredPrototypePractitioners(environment: OperationEnvironment): Set<string> | null {
  const raw = environment.POSTURE_PROTOTYPE_PRACTITIONER_IDS
  if (!raw) return null

  const ids = raw.split(',').map((value) => value.trim())
  if (ids.length === 0 || ids.some((id) => !UUID.test(id))) return null
  return new Set(ids.map((id) => id.toLowerCase()))
}

/**
 * Resolve the operation policy for one authenticated practitioner. This helper
 * grants no authentication or practitioner access by itself; callers must run
 * practitioner admission first. Invalid or incomplete configuration fails to
 * the governed path.
 */
export function operationForPractitioner(
  practitionerId: string,
  environment: OperationEnvironment = process.env,
): PractitionerOperation {
  const allowlist = configuredPrototypePractitioners(environment)
  const isPrototype = configuredOperationMode(environment) === 'prototype'
    && UUID.test(practitionerId)
    && allowlist?.has(practitionerId.toLowerCase()) === true

  return {
    mode: isPrototype ? 'prototype' : 'governed',
    isPrototype,
    practitionerId,
  }
}
