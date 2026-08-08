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
// In the reported WebKit module worker, importScripts is missing, so the
// main-thread branch throws "Can't find variable: document". Supplying a
// throwing importScripts function enters MediaPipe's worker fallback. Its
// explicit self.import hook then lets us redirect only that WebKit fallback
// from the classic wasm loader to the module-shaped sibling. Chromium keeps
// the classic loader, avoiding its "Cannot use import.meta outside a module"
// startup regression.
//
// Scope: only live-worker.ts calls this. It is a no-op unless explicitly
// called, and the runtime guard refuses to run anywhere a document exists, so
// even a future accidental call from main-thread code cannot touch it. The
// guard also survives Turbopack's worker compilation; unlike `typeof window`,
// it is not constant-folded away.
type ModuleLoader = (url: string) => Promise<unknown>

const loadModule: ModuleLoader = url => import(/* webpackIgnore: true */ url)

export function mediaPipeModuleLoaderUrl(url: string): string {
  const moduleUrl = url.replace(
    /vision_wasm_internal\.js(?=([?#]|$))/u,
    'vision_wasm_module_internal.js',
  )
  if (moduleUrl === url) {
    throw new Error(`[pose] unsupported MediaPipe worker loader "${url}"`)
  }
  return moduleUrl
}

export function installImportScriptsFallback(importModule: ModuleLoader = loadModule): void {
  // Target `globalThis`, not `self`: inside every real Worker `self ===
  // globalThis`, so this is identical there, but the vendored loader's
  // `typeof importScripts` check reads the bare global identifier, which
  // resolves through `globalThis` — not through whatever object a caller
  // happens to have assigned to a `self` property (e.g. in a non-browser
  // harness that stands up its own `self` stand-in). `globalThis` is the
  // one object guaranteed to back that lookup everywhere.
  const scope = globalThis as unknown as {
    document?: unknown
    importScripts?: (...urls: string[]) => void
    import?: ModuleLoader
  }

  // A real main thread exposes document and a Worker does not. Use a runtime
  // property test instead of `typeof window`: Turbopack constant-folds the
  // latter while compiling the worker dependency graph and previously erased
  // this entire compatibility branch from the production worker chunk.
  // Combined with the loader's own "is importScripts already callable" check,
  // this installs
  // the fallback only in the one scope that needs it — never on the main
  // thread (a real DOM already makes the loader's other branch work there,
  // per lib/pose/detect.ts), and never over a real, working `importScripts`
  // (classic workers, and Chromium's module workers) — zero behavior change
  // in either of those cases.
  if ('document' in scope || typeof scope.importScripts === 'function') return

  // MediaPipe checks this explicit hook after a module worker rejects
  // importScripts and before it falls back to native import(). Its resolver
  // still needs to return the classic loader for Chromium, where importScripts
  // succeeds. Only the WebKit fallback redirects that filename to the
  // module-shaped sibling that self-registers ModuleFactory.
  scope.import = url => importModule(mediaPipeModuleLoaderUrl(url))
  scope.importScripts = () => {
    throw new TypeError('[pose] importScripts is unavailable in this module worker; use dynamic import() instead')
  }
}
