import { parseDemoScan, type DemoScan } from './scan'

export const DEMO_SCAN_STORAGE_KEY = 'posture-ai.demo.scan.v1'
export const DEMO_SCAN_EVENT = 'posture-demo-scan-changed'

let cachedRaw: string | null = null
let cachedScan: DemoScan | null = null

export function loadDemoScan(): DemoScan | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DEMO_SCAN_STORAGE_KEY)
    if (raw === cachedRaw) return cachedScan
    cachedRaw = raw
    cachedScan = raw && raw.length <= 128_000 ? parseDemoScan(JSON.parse(raw)) : null
    return cachedScan
  } catch {
    cachedRaw = null
    cachedScan = null
    return null
  }
}

export function subscribeDemoScan(onChange: () => void): () => void {
  window.addEventListener(DEMO_SCAN_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(DEMO_SCAN_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** No photograph, image URL, or name from an account is stored here. */
export function saveDemoScan(scan: DemoScan): void {
  const validated = parseDemoScan(scan)
  if (!validated) throw new Error('This scan could not be saved. Please scan again.')
  window.localStorage.setItem(DEMO_SCAN_STORAGE_KEY, JSON.stringify(validated))
  window.dispatchEvent(new Event(DEMO_SCAN_EVENT))
}

export function clearDemoScan(): void {
  window.localStorage.removeItem(DEMO_SCAN_STORAGE_KEY)
  window.dispatchEvent(new Event(DEMO_SCAN_EVENT))
}
