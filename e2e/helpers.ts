import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

type LegalDocumentIdentity = {
  documentId: string
  version: string
  bodySha256: string
}

export async function currentLegalDocument(
  page: Page,
  kind: 'subject_consent' | 'privacy' | 'terms' | 'screening_notice',
): Promise<LegalDocumentIdentity> {
  let response: Awaited<ReturnType<typeof page.request.get>> | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await page.request.get(`/api/legal/documents?kind=${kind}`)
      break
    } catch (error) {
      if (attempt === 1) throw error
      // The local Next server can reset an otherwise-idempotent setup GET while
      // concurrent browser projects are compiling routes. Retry transport
      // failure only; HTTP error responses still fail below without a retry.
      await page.waitForTimeout(100)
    }
  }
  if (!response) throw new Error(`${kind} legal document request did not complete`)
  expect(response.ok(), `${kind} legal document failed: ${response.status()}`).toBeTruthy()
  const body = await response.json() as { document?: LegalDocumentIdentity }
  expect(body.document?.documentId).toBeTruthy()
  expect(body.document?.version).toBeTruthy()
  expect(body.document?.bodySha256).toMatch(/^[0-9a-f]{64}$/)
  return body.document!
}

export function legalDocumentSubmission(document: LegalDocumentIdentity) {
  return {
    legal_document_id: document.documentId,
    legal_document_version: document.version,
    legal_document_body_sha256: document.bodySha256,
  }
}

/**
 * Creates a client via the authenticated API session and returns it. Defaults to
 * an adult subject with an in-person self-consent so it passes the capture gate;
 * pass opts to create minors / guardian-signed / remote-pending clients.
 */
export async function createClient(
  page: Page,
  firstName: string,
  lastName: string,
  opts?: { dateOfBirth?: string; signerRelationship?: string; remote?: boolean },
) {
  const data: Record<string, unknown> = {
    first_name: firstName,
    last_name: lastName,
    date_of_birth: opts?.dateOfBirth ?? '1990-01-01',
  }
  if (opts?.remote) {
    data.consent_mode = 'remote'
  } else {
    const document = await currentLegalDocument(page, 'subject_consent')
    data.signer_name = `${firstName} ${lastName}`
    data.signer_relationship = opts?.signerRelationship ?? 'self'
    Object.assign(data, legalDocumentSubmission(document))
  }
  const res = await page.request.post('/api/clients', { data })
  expect(res.ok(), `client creation failed: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  return (body.client ?? body) as { id: string; first_name: string; last_name: string }
}

/** Walks wizard step 1: pick the given client and continue to step 2. */
export async function selectClientInWizard(page: Page, fullName: string) {
  await page.getByRole('textbox', { name: 'Search clients by name' }).fill(fullName)
  const clientResult = page.getByRole('button', { name: fullName }).first()
  await expect(clientResult).toBeVisible({ timeout: 10_000 })
  await clientResult.click()
  await page.getByRole('button', { name: /Next: Confirm|Choose capture method/ }).click()
}

/**
 * The non-test-mode Step 2 full-screen capture opens on a one-time "Screening
 * Tool Only" disclaimer overlay. Dismissing it (the required user gesture) starts
 * the live camera and reveals the capture controls / upload fallback.
 */
export async function dismissCaptureDisclaimer(page: Page) {
  const dismiss = page.getByTestId('capture-disclaimer-dismiss')
  await expect(dismiss).toBeVisible({ timeout: 10_000 })
  await dismiss.click()
}

/** Upload one capture and wait for the async normalize/validate commit before
 * addressing the next hidden input. The UI intentionally locks every capture
 * control while that operation owns the selected slot. */
export async function setCaptureUpload(page: Page, index: number, file: string | Parameters<ReturnType<Page['locator']>['setInputFiles']>[0]) {
  const labels = ['Front', 'Left Side', 'Right Side', 'Back'] as const
  const input = page.locator('input[type="file"]').nth(index)
  await expect(input).toBeEnabled()
  await input.setInputFiles(file)
  await expect(page.getByRole('button', { name: new RegExp(`${labels[index]}.*captured`) })).toBeVisible({ timeout: 30_000 })
  if (index < labels.length - 1) {
    await expect(page.getByRole('button', { name: `${labels[index + 1]} (required), current` })).toBeVisible()
  }
}
