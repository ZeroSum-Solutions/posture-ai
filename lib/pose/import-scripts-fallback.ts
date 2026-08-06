// Fixes exactly one upstream defect: the vendored `@mediapipe/tasks-vision`
// wasm-glue loader (`run_script_helper`, minified as `ta`/`$h` inside
// vision_bundle.mjs) assumes `importScripts` is always exposed as a callable
// function inside any Worker:
//
//   async function ta(t) {
//     if ("function" != typeof importScripts) {
//       const e = document.createElement("script")   // <-- crashes here
//       ...
//     }
//     try { importScripts(t.toString()) }
//     catch (e) {
//       if (!(e instanceof TypeError)) throw e
//       await import(t.toString())                    // <-- what we want
//     }
//   }
//
// `PoseLandmarker.createFromOptions` pulls in that loader once per delegate
// attempt (live-worker.ts's init() calls it once for GPU, once for CPU).
// The assumption holds in a Chromium `type:'module'` Worker — calling
// `importScripts` there throws a TypeError the loader catches, and it falls
// back to a dynamic `import()` — but not in a WebKit `type:'module'`
// Worker, where `importScripts` is not defined as a global at all. There,
// the loader falls into the branch written for the main thread and throws a
// ReferenceError on the bare `document` identifier: this project's
// real-iPhone production crash, "Can't find variable: document", on both
// the GPU and CPU delegate attempts.
//
// Fix: make the loader's own probe (`typeof importScripts !== 'function'`)
// come back exactly the way it already does in Chromium, so the loader
// takes the branch it already knows how to handle and never touches
// `document`.
//
// Scope: only live-worker.ts (a genuine `type:'module'` Worker) calls this.
// It is a no-op unless explicitly called — importing this module alone does
// nothing — and the runtime guard below is a second, independent layer that
// refuses to run anywhere a `window` exists, so even a future accidental
// call from main-thread code cannot touch it.
export function installImportScriptsFallback(): void {
  // Target `globalThis`, not `self`: inside every real Worker `self ===
  // globalThis`, so this is identical there, but the vendored loader's
  // `typeof importScripts` check reads the bare global identifier, which
  // resolves through `globalThis` — not through whatever object a caller
  // happens to have assigned to a `self` property (e.g. in a non-browser
  // harness that stands up its own `self` stand-in). `globalThis` is the
  // one object guaranteed to back that lookup everywhere.
  const scope = globalThis as unknown as { importScripts?: (...urls: string[]) => void }

  // `typeof window === 'undefined'` is the standard "this is a Worker, not
  // the main thread" check (Workers never have `window`). Combined with the
  // loader's own "is importScripts already callable" check, this installs
  // the fallback only in the one scope that needs it — never on the main
  // thread (a real DOM already makes the loader's other branch work there,
  // per lib/pose/detect.ts), and never over a real, working `importScripts`
  // (classic workers, and Chromium's module workers) — zero behavior change
  // in either of those cases.
  if (typeof window !== 'undefined' || typeof scope.importScripts === 'function') return

  scope.importScripts = () => {
    throw new TypeError('[pose] importScripts is unavailable in this module worker; use dynamic import() instead')
  }
}
