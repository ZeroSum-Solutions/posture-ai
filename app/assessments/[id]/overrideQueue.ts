import type { Capability } from '@/lib/program/selectPriorities'

export type OverrideSaveState = 'idle' | 'saving' | 'failed'

export type OverridePatch = {
  capability?: Capability
  priority_keys?: string[] | null
  exercise_swaps?: Record<string, Record<string, string>>
}

type SaveOverride = (patch: OverridePatch) => Promise<boolean>
type StateListener = (state: OverrideSaveState) => void

export type OverrideQueue = {
  enqueue: (patch: OverridePatch) => Promise<boolean>
  getState: () => OverrideSaveState
  retryFailed: () => Promise<boolean>
  waitForSettled: () => Promise<boolean>
}

export function createOverrideQueue(
  saveOverride: SaveOverride,
  onStateChange: StateListener = () => {},
): OverrideQueue {
  let state: OverrideSaveState = 'idle'
  let pendingCount = 0
  let failedPatches: OverridePatch[] = []
  let tail: Promise<void> = Promise.resolve()

  function updateState(nextState: OverrideSaveState) {
    if (state === nextState) return
    state = nextState
    onStateChange(state)
  }

  function enqueue(patch: OverridePatch): Promise<boolean> {
    pendingCount += 1
    updateState('saving')

    const result = tail.then(async () => {
      try {
        return await saveOverride(patch)
      } catch {
        return false
      }
    })

    tail = result.then((ok) => {
      pendingCount -= 1
      if (!ok) failedPatches = [...failedPatches, patch]
      updateState(pendingCount > 0 ? 'saving' : failedPatches.length > 0 ? 'failed' : 'idle')
    })

    return result
  }

  async function waitForSettled() {
    await tail
    return failedPatches.length === 0
  }

  async function retryFailed() {
    await tail
    if (failedPatches.length === 0) {
      updateState('idle')
      return true
    }

    const retryPatches = failedPatches
    failedPatches = []
    const retries = retryPatches.map((patch) => enqueue(patch))
    await Promise.all(retries)
    return waitForSettled()
  }

  return {
    enqueue,
    getState: () => state,
    retryFailed,
    waitForSettled,
  }
}
