import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers'

// On a cold local `next dev` server a route compiles on-demand, and slower
// production workers can expose the same hydration race: a controlled input can
// discard a value typed before React hydrates the freshly loaded page. Re-fill
// until the value sticks so a fresh-goto form fill is deterministic regardless
// of hydration timing (this does not loosen any assertion — it still requires
// the exact value to be present).
async function fillField(page: Page, label: string | RegExp, value: string) {
  const field = page.getByLabel(label)
  await expect(field).toBeVisible()
  await expect(async () => {
    await field.fill(value)
    expect(await field.inputValue()).toBe(value)
  }).toPass({ timeout: 15_000 })
}

// Client list + bounded server search (Required Phase-2 coverage). The shared
// practitioner accumulates clients from other specs, so this test asserts only
// on its own two uniquely-tokened clients and waits for the debounced API result.
test.describe('client list and search', () => {
  test('lists created clients and filters by name', async ({ page }) => {
    const tokenA = randomUUID().slice(0, 8)
    const tokenB = randomUUID().slice(0, 8)
    await createClient(page, 'E2E', `List-${tokenA}`)
    await createClient(page, 'E2E', `List-${tokenB}`)

    await page.goto('/clients')
    // `exact: true` so the page header <h1>Clients</h1> is not conflated with the
    // transient <h2>Loading clients</h2> heading (substring-matched otherwise).
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible()

    const rowA = page.getByRole('link', { name: new RegExp(`List-${tokenA}`) })
    const rowB = page.getByRole('link', { name: new RegExp(`List-${tokenB}`) })

    // The directory no longer gates on search. It previously mounted nothing
    // until the practitioner typed, and this test asserted that prompt plus a
    // zero-row start; app/clients/page.tsx now loads the owned directory on
    // mount and app/api/clients/route.ts returns it unfiltered for an empty
    // search. That gated pattern still exists, but on the /assessments/new
    // client picker, not here. Only the gating premise is dropped -- the
    // contract this test exists for, that prefix search filters the directory
    // through the bounded API, is asserted below exactly as before.
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()

    // A shared prefix returns both records.
    await page.getByPlaceholder('Search by name').fill('List-')
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()

    // The bounded directory contract uses human-name prefix search.
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/clients' && url.searchParams.get('search') === `List-${tokenA}`
    })
    await page.getByPlaceholder('Search by name').fill(`List-${tokenA}`)
    expect((await searchResponse).ok()).toBeTruthy()
    await expect(rowA).toBeVisible()
    await expect(rowB).toHaveCount(0)

    // Clearing the search restores the unfiltered directory rather than the
    // old search-first prompt, so the record filtered out above comes back.
    await page.getByPlaceholder('Search by name').fill('')
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()
  })
})

// Client archive is the only client-mutation flow the app exposes (there is no
// edit UI, and PATCH /api/clients/[id] accepts only archived_at). Archiving the
// throwaway "victim" client must drop it from the active list (which filters
// archived_at IS NULL); a separately-created "keeper" confirms the list rendered.
test.describe('client archive', () => {
  test('archiving a client removes it from the active list', async ({ page }) => {
    const keepToken = randomUUID().slice(0, 8)
    const archiveToken = randomUUID().slice(0, 8)
    await createClient(page, 'E2E', `Keep-${keepToken}`)
    const victim = await createClient(page, 'E2E', `Archive-${archiveToken}`)

    await page.goto(`/clients/${victim.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(`Archive-${archiveToken}`) })).toBeVisible()

    await page.getByRole('button', { name: 'Client record actions' }).click()
    await page.getByRole('button', { name: 'Archive client' }).click()
    await expect(page.getByRole('heading', { name: 'Archive Client?' })).toBeVisible()
    await page.getByRole('button', { name: 'Yes, Archive' }).click()

    await page.waitForURL(/\/clients$/, { timeout: 15_000 })
    await page.getByPlaceholder('Search by name').fill(`Keep-${keepToken}`)
    await expect(page.getByRole('link', { name: new RegExp(`Keep-${keepToken}`) })).toBeVisible()
    const archivedSearch = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/clients' && url.searchParams.get('search') === `Archive-${archiveToken}`
    })
    await page.getByPlaceholder('Search by name').fill(`Archive-${archiveToken}`)
    expect((await archivedSearch).ok()).toBeTruthy()
    await expect(page.getByText('No matching clients')).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(`Archive-${archiveToken}`) })).toHaveCount(0)
  })
})

// QA-001 regression: right-to-erasure must remove a client from the UI read
// paths, not just /api/clients. Erasing sets deleted_at (archived_at stays null)
// and redacts PII, so a list that filters only archived_at leaves the erased
// client as a redacted ghost row. The row is still a <Link> to /clients/<id>, so
// assert by that id-bearing href — it survives PII redaction where the name does
// not. Guards the same deleted_at filter added to the dashboard count/recent
// activity and the new-assessment client picker (all one root cause).
test.describe('erased client is hidden from the clients list', () => {
  test('an erased client no longer appears as a row in /clients', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    const victim = await createClient(page, 'E2E', `Erase-${token}`)
    const keeper = await createClient(page, 'E2E', `Keep-${token}`)

    // Both present before erasure.
    await page.goto('/clients')
    await page.getByPlaceholder('Search by name').fill(`Keep-${token}`)
    await expect(page.locator(`a[href="/clients/${keeper.id}"]`)).toBeVisible()
    await page.getByPlaceholder('Search by name').fill(`Erase-${token}`)
    await expect(page.locator(`a[href="/clients/${victim.id}"]`)).toBeVisible()

    // Right-to-erasure: tombstone + redact + purge.
    const del = await page.request.delete(`/api/clients/${victim.id}`, {
      data: { reason_code: 'practitioner_correction' },
    })
    expect(del.ok(), `delete failed: ${del.status()}`).toBeTruthy()

    // The erased client's row is gone; the keeper still renders.
    await page.goto('/clients')
    await page.getByPlaceholder('Search by name').fill(`Keep-${token}`)
    await expect(page.locator(`a[href="/clients/${keeper.id}"]`)).toBeVisible()
    const erasedSearch = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/clients' && url.searchParams.get('search') === `Erase-${token}`
    })
    await page.getByPlaceholder('Search by name').fill(`Erase-${token}`)
    expect((await erasedSearch).ok()).toBeTruthy()
    await expect(page.getByText('No matching clients')).toBeVisible()
    await expect(page.locator(`a[href="/clients/${victim.id}"]`)).toHaveCount(0)
  })
})

// Empty state: a freshly-created client (zero assessments) shows the empty
// Assessment History state + the "+ New Assessment" CTA, and — because the
// Progress/Compare trend tabs require >= 2 assessments — those tabs are absent.
// Single clean goto to the detail page (avoids the webkit chained-nav getUser race).
test.describe('client detail empty state', () => {
  test('a client with no assessments shows the empty state and no trend tabs', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    const client = await createClient(page, 'E2E', `Empty-${token}`)

    await page.goto(`/clients/${client.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(`Empty-${token}`) })).toBeVisible()

    await expect(page.getByText(/No scans yet/)).toBeVisible()
    await expect(page.getByRole('link', { name: /New scan/ })).toBeVisible()

    // Compare needs >= 2 assessments → absent; Findings/Details always present.
    await expect(page.getByRole('tab', { name: 'Findings' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Progress' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Compare' })).toHaveCount(0)

    // Consent fail-closed rendering is covered at the server-seeded component
    // boundary. This helper creates a consented client, so this journey stays
    // focused on the zero-assessment workspace contract.
  })
})

test.describe('client comparison policy', () => {
  function localService(): SupabaseClient {
    const supabaseUrl = process.env.E2E_SUPABASE_URL
    if (!supabaseUrl?.startsWith('http://127.0.0.1')) {
      throw new Error('Client comparison E2E requires local Supabase at 127.0.0.1')
    }
    const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY is required')
    return createSupabaseClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }

  test('shows all tolerance states and fails closed across scoring versions', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    const client = await createClient(page, 'E2E', `Compare-${token}`)
    const finding = (key: string, label: string, severity: number, deviation: number) => ({
      imbalance_key: key,
      label,
      severity_pct: severity,
      zone: 'warning',
      region: 'head_shoulders',
      deviation,
      standard: 0,
      unit: 'deg',
    })
    const fixtures = [
      {
        assessed_at: '2026-01-01T12:00:00Z', overall_grade: 'B', overall_score: 20,
        scoring_engine_version: 'v2', status: 'approved',
        assessment_findings: [
          finding('same', 'A — unchanged', 50, 5),
          finding('noise', 'B — tolerance', 50, 5),
          finding('better', 'C — improved', 50, 8),
          finding('worse', 'D — regressed', 50, 3),
        ],
      },
      {
        assessed_at: '2026-02-01T12:00:00Z', overall_grade: 'B', overall_score: 20,
        scoring_engine_version: 'v2', status: 'approved',
        assessment_findings: [
          finding('same', 'A — unchanged', 50, 5),
          finding('noise', 'B — tolerance', 54, 5.2),
          finding('better', 'C — improved', 45, 7),
          finding('worse', 'D — regressed', 55, 4),
        ],
      },
      {
        assessed_at: '2026-03-01T12:00:00Z', overall_grade: 'A', overall_score: 7,
        scoring_engine_version: 'v3', status: 'approved',
        assessment_findings: [finding('same', 'A — unchanged', 10, 1)],
      },
    ]
    const service = localService()
    const assessmentIds: string[] = []
    for (const fixture of fixtures) {
      const response = await page.request.post('/api/assessments', {
        data: { client_id: client.id, submission_id: randomUUID(), test_mode: true },
      })
      expect(response.ok(), `assessment creation failed: ${response.status()}`).toBeTruthy()
      const assessmentId = (await response.json()).id as string
      assessmentIds.push(assessmentId)

      const { data: assessment, error: assessmentError } = await service
        .from('assessments')
        .update({
          assessed_at: fixture.assessed_at,
          overall_grade: fixture.overall_grade,
          overall_score: fixture.overall_score,
          scoring_engine_version: fixture.scoring_engine_version,
        })
        .eq('id', assessmentId)
        .select('id, practitioner_id')
        .single()
      expect(assessmentError?.message).toBeUndefined()
      expect(assessment?.id).toBe(assessmentId)

      const { error: deleteError } = await service
        .from('assessment_findings')
        .delete()
        .eq('assessment_id', assessmentId)
      expect(deleteError?.message).toBeUndefined()

      const { error: findingsError } = await service
        .from('assessment_findings')
        .insert(fixture.assessment_findings.map((entry) => ({
          assessment_id: assessmentId,
          practitioner_id: assessment!.practitioner_id,
          ...entry,
        })))
      expect(findingsError?.message).toBeUndefined()
    }
    const [baselineId, sameVersionId, newVersionId] = assessmentIds as [string, string, string]

    await page.goto(`/clients/${client.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(`Compare-${token}`) })).toBeVisible()
    await page.getByRole('tab', { name: 'Compare' }).click()
    await page.getByLabel('Before (baseline)').selectOption(baselineId)
    await page.getByLabel('After (comparison)').selectOption(sameVersionId)

    await expect(page.getByText('Unchanged severity')).toBeVisible()
    // "Within measurement tolerance" is the shared comparisonStatusText() copy for
    // within_tolerance, used for both the overall verdict and every per-finding
    // row — so a bare getByText can match more than the "B — tolerance" finding
    // this assertion means. Scope to that finding's own row (#finding-noise).
    await expect(page.locator('#finding-noise').getByText('Within measurement tolerance')).toBeVisible()
    // Same shared comparisonStatusText() copy issue as the tolerance case above:
    // "Improved — lower severity" / "Regressed — higher severity" each also
    // appear in the overall verdict, so scope to the finding row this
    // assertion means.
    await expect(page.locator('#finding-better').getByText('Improved — lower severity')).toBeVisible()
    await expect(page.locator('#finding-worse').getByText('Regressed — higher severity')).toBeVisible()

    await page.getByLabel('After (comparison)').selectOption(newVersionId)
    // Same shared comparisonStatusText() copy issue: the always-visible
    // "Deviation score" trend card independently derives its own latest-vs-
    // previous verdict (also "Not comparable", since the newest fixture is
    // v3 against a v2 predecessor) alongside the Compare panel's
    // dropdown-driven verdict. Scope to the Compare panel this assertion means.
    await expect(page.locator('#client-panel-compare').getByText('Not comparable', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Selected assessment sequence').getByText(/different or missing scoring versions/)).toBeVisible()

    // There is no separate "Progress" tab or "Load interactive charts" gate
    // anymore — TrendChart (recharts LineChart replaced by a hand-drawn SVG,
    // see app/clients/[id]/TrendChart.tsx) renders inline above the tab strip
    // and its scoring-version history sits behind a "Recorded scores"
    // disclosure. Confirm the same underlying facts this test cares about:
    // the trend surfaces, and both scoring versions are represented.
    await expect(page.getByRole('heading', { name: 'Deviation score' })).toBeVisible()
    await page.getByRole('button', { name: 'Recorded scores', exact: true }).click()
    const scoringVersionCells = page.locator('#client-score-table tbody tr td:nth-child(4)')
    await expect(scoringVersionCells).toHaveText(['v3', 'v2', 'v2'])
  })
})

// Client create via the form UI. createClient() (helpers) hits the API directly,
// so the create FORM itself was previously uncovered. This guards the shared
// ClientForm (create mode) + the create-only consent gate after the refactor.
test.describe('client create form', () => {
  test('creates a client via the form and enforces the consent gate', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    await page.goto('/clients/new')
    // The legal document is fetched by the hydrated client component. Waiting
    // for it proves the controlled form is mounted before typing, so a cold
    // WebKit hydration pass cannot replace the first field's value.
    await expect(page.getByRole('article', { name: 'Consent to Posture Screening' }))
      .toBeVisible({ timeout: 15_000 })

    await fillField(page, 'First Name', 'E2E')
    await fillField(page, 'Last Name', `Form-${token}`)
    // Subject e-signature (typed name) is part of the consent — required to submit.
    await fillField(page, 'Type full name to sign', `E2E Form-${token}`)

    // Consent is required: submitting unchecked shows the error and does not navigate.
    await page.getByRole('button', { name: 'Create Client' }).click()
    await expect(page.getByTestId('error-consent')).toBeVisible()
    await expect(page).toHaveURL(/\/clients\/new$/)

    // With consent checked, it creates and lands on the new client's detail page.
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create Client' }).click()
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: new RegExp(`Form-${token}`) })).toBeVisible()
  })
})

// Client edit reuses the shared ClientForm in edit mode (consent is create-only,
// so it is absent here). Asserts the change renders on the detail page AND
// persists across a reload — a real PATCH round-trip, not just client state.
test.describe('client edit', () => {
  test('editing a client updates its profile and persists', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    const client = await createClient(page, 'E2E', `Edit-${token}`)

    await page.goto(`/clients/${client.id}`)
    await page.getByRole('button', { name: 'Client record actions' }).click()
    await page.getByRole('link', { name: 'Edit client' }).click()
    await page.waitForURL(new RegExp(`/clients/${client.id}/edit$`))

    const newToken = randomUUID().slice(0, 8)
    await page.getByLabel('Last Name').fill(`Edited-${newToken}`)
    await page.getByLabel(/Height/).fill('70')
    await page.getByLabel('Notes').fill(`Edited note ${newToken}`)
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Back on the detail page, header reflects the new name.
    await page.waitForURL(new RegExp(`/clients/${client.id}$`))
    await expect(page.getByRole('heading', { name: new RegExp(`Edited-${newToken}`) })).toBeVisible()

    // Details tab reflects the edited height + notes.
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByText(`Edited note ${newToken}`)).toBeVisible()
    await expect(page.getByText(/70 in/)).toBeVisible()

    // Persisted: a reload re-fetches from the DB and still shows the edits.
    await page.reload()
    await expect(page.getByRole('heading', { name: new RegExp(`Edited-${newToken}`) })).toBeVisible()
  })
})
