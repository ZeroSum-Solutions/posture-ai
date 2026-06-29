// Consent wording + version, kept free of any server-only imports so client
// components (the public remote-consent page, the enrollment form) can import it
// safely. policy.ts adds the server-side hashing on top of these constants.
//
// NOTE: this wording is engineering-side scaffolding pending counsel review of
// the BIPA/MHMD retention & destruction language. See docs/plans.
export const CONSENT_VERSION = '2026-06-28.1'

export const CONSENT_TEXT = `Consent to Posture Screening

I authorize this practitioner and Posture AI to capture posture views of me and
to compute body-position measurements from them, for the purpose of posture
screening and movement guidance.

What is collected: body-position landmark coordinates only. Photos are processed
on this device and are never uploaded or stored — only the position measurements
are saved. No facial-recognition or face-geometry template is created.

How it is used: to produce a screening summary and movement suggestions reviewed
by the practitioner. Posture AI is a screening tool, not a medical diagnosis.

Sharing & sale: your data is not sold and is not shared with advertisers or
third-party trackers. It is stored by the practitioner using Posture AI.

Your rights: you may withdraw this consent and request deletion of your data at
any time by asking the practitioner.

By signing, I confirm I have read and agree to the above. If the person being
screened is under 18, a parent or legal guardian must sign on their behalf.`
