# iPhone Chrome live pose startup

The deployed live worker reproduced `Live pose model could not start on GPU or CPU. GPU: Can't find variable: document CPU: Can't find variable: document` with a Chrome iPhone (CriOS) user agent in local WebKit.

MediaPipe 0.10.35 treats a user agent containing Safari without Chrome as Safari and requires a Version/17+ token before automatically using OffscreenCanvas. CriOS has Safari and CriOS tokens but no Version token. Its task factory therefore falls back to document.createElement('canvas') inside a worker. This is separate from the importScripts compatibility path fixed earlier.

The worker now supplies its own 1×1 OffscreenCanvas to createFromOptions for each delegate attempt. MediaPipe resizes it as needed. No user-agent override, DOM shim, model change, security-policy change or scoring change is required.

Verification:

- Real vendored loader regression with a CriOS user agent failed with `document is not defined` before the change and passed afterward.
- Replayed the deployed Turbopack worker and its real model/WASM on an anonymous localhost WebKit page. Original code failed with the exact GPU/CPU error; applying only the canvas option reached ready on GPU and in an explicit CPU recovery run.
- 106 pose tests and 150 content tests passed; typecheck, scoped lint and production build passed.
- These are browser-engine checks, not physical iPhone verification. The user's phone remains the final device check.
