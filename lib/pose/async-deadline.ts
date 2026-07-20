export class AsyncDeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsyncDeadlineError'
  }
}

/**
 * Bounds async work that cannot be cancelled. A value that resolves after the
 * deadline is disposed instead of entering the active pose lifecycle.
 */
export function settleBeforeDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  disposeLate: (value: T) => void,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new AsyncDeadlineError(message))
    }, timeoutMs)

    void work.then(
      value => {
        if (settled) {
          disposeLate(value)
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
