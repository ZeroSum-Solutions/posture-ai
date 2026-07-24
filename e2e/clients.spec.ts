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
    await expect(page.getByText('Search by first or last name')).toBeVisible()
    await expect(rowA).toHaveCount(0)
    await expect(rowB).toHaveCount(0)

    // A shared prefix returns both records without mounting the whole practice
    // directory before the practitioner has expressed intent.
    await page.getByPlaceholder('Search clients by name...').fill('List-')
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()

    // The bounded directory contract uses human-name prefix search.
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/clients' && url.searchParams.get('search') === `List-${tokenA}`
    })
    await page.getByPlaceholder('Search clients by name...').fill(`List-${tokenA}`)
    expect((await searchResponse).ok()).toBeTruthy()
    await expect(rowA).toBeVisible()
    await expect(rowB).toHaveCount(0)

    // Clearing the search returns to the search-first prompt.
    await page.getByPlaceholder('Search clients by name...').fill('')
    await expect(page.getByText('Search by first or last name')).toBeVisible()
    await expect(rowA).toHaveCount(0)
    await expect(rowB).toHaveCount(0)
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

    await page.getByRole('button', { name: 'Archive Client' }).click()
    await expect(page.getByRole('heading', { name: 'Archive Client?' })).toBeVisible()
    await page.getByRole('button', { name: 'Yes, Archive' }).click()

    await page.waitForURL(/\/clients$/, { timeout: 15_000 })
    await page.getByPlaceholder('Search clients by name...').fill(`Keep-${keepToken}`)
    await expect(page.getByRole('link', { name: new RegExp(`Keep-${keepToken}`) })).toBeVisible()
    await page.getByPlaceholder('Search clients by name...').fill(`Archive-${archiveToken}`)
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
    await page.getByPlaceholder('Search clients by name...').fill(`Keep-${token}`)
    await expect(page.locator(`a[href="/clients/${keeper.id}"]`)).toBeVisible()
    await page.getByPlaceholder('Search clients by name...').fill(`Erase-${token}`)
    await expect(page.locator(`a[href="/clients/${victim.id}"]`)).toBeVisible()

    // Right-to-erasure: tombstone + redact + purge.
    const del = await page.request.delete(`/api/clients/${victim.id}`, {
      data: { reason_code: 'practitioner_correction' },
    })
    expect(del.ok(), `delete failed: ${del.status()}`).toBeTruthy()

    // The erased client's row is gone; the keeper still renders.
    await page.goto('/clients')
    await page.getByPlaceholder('Search clients by name...').fill(`Keep-${token}`)
    await expect(page.locator(`a[href="/clients/${keeper.id}"]`)).toBeVisible()
    await page.getByPlaceholder('Search clients by name...').fill(`Erase-${token}`)
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

    await expect(page.getByText(/No assessments yet/)).toBeVisible()
    await expect(page.getByRole('link', { name: /New Assessment/ })).toBeVisible()

    // Progress/Compare need >= 2 assessments → absent; Assessments/Info always present.
    await expect(page.getByRole('tab', { name: 'Assessments' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Info' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Progress' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Compare' })).toHaveCount(0)

    // A consent-status outage must fail closed without stranding the entire client
    // page on its loading screen. The profile/history remain usable, while consent
    // is explicitly unavailable and no signing form is offered from uncertain state.
    await page.route('**/api/consent?client_id=*', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Consent terms are temporarily unavailable.' }),
    }))
    await page.reload()
    await expect(page.getByRole('heading', { name: new RegExp(`Empty-${token}`) })).toBeVisible()
    await expect(page.getByText('unavailable', { exact: true })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Record in-person consent' })).toHaveCount(0)
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
    await expect(page.getByText('Within measurement tolerance')).toBeVisible()
    await expect(page.getByText('Improved — lower severity')).toBeVisible()
    await expect(page.getByText('Regressed — higher severity')).toBeVisible()

    await page.getByLabel('After (comparison)').selectOption(newVersionId)
    await expect(page.getByText('Not comparable', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Selected assessment sequence').getByText(/different or missing scoring versions/)).toBeVisible()

    const progressTab = page.getByRole('tab', { name: 'Progress' })
    await progressTab.click()
    await expect(page.locator('#client-panel-assessments')).toHaveCSS('visibility', 'hidden')
    await progressTab.focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('#client-panel-progress')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Load interactive charts' })).toBeFocused()
    await page.getByRole('button', { name: 'Load interactive charts' }).click()
    await expect(page.getByRole('heading', { name: 'Recorded screening score over time' })).toBeVisible()
    await expect(page.getByText(/Lines stop at every scoring-version boundary/)).toBeVisible()
    await expect(page.getByText('v2').first()).toBeVisible()
    await expect(page.getByText('v3').first()).toBeVisible()
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
    await page.getByRole('link', { name: 'Edit Client' }).click()
    await page.waitForURL(new RegExp(`/clients/${client.id}/edit$`))

    const newToken = randomUUID().slice(0, 8)
    await page.getByLabel('Last Name').fill(`Edited-${newToken}`)
    await page.getByLabel(/Height/).fill('70')
    await page.getByLabel('Notes').fill(`Edited note ${newToken}`)
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Back on the detail page, header reflects the new name.
    await page.waitForURL(new RegExp(`/clients/${client.id}$`))
    await expect(page.getByRole('heading', { name: new RegExp(`Edited-${newToken}`) })).toBeVisible()

    // Info tab reflects the edited height + notes.
    await page.getByRole('tab', { name: 'Info' }).click()
    await expect(page.getByText(`Edited note ${newToken}`)).toBeVisible()
    await expect(page.getByText(/70 in/)).toBeVisible()

    // Persisted: a reload re-fetches from the DB and still shows the edits.
    await page.reload()
    await expect(page.getByRole('heading', { name: new RegExp(`Edited-${newToken}`) })).toBeVisible()
  })
})
