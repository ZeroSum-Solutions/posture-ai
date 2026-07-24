import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createClient } from './helpers'
import { skipForProductionReadiness } from './production-readiness-skip'

test.describe('error states (regression: silent-swallow fixes)', () => {
  test.beforeEach(({ browserName }, testInfo) => skipForProductionReadiness(
    testInfo,
    browserName !== 'chromium',
    {
      key: 'skip:error-states:mobile-webkit',
      source: 'e2e/error-states.spec.ts::error states project guard',
      scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
    },
    'run once on chromium',
  ))

  test('client detail: assessments 500 shows alert not empty-state', async ({ page }) => {
    test.setTimeout(60_000)
    const client = await createClient(page, 'E2E', `ErrAssess-${randomUUID().slice(0, 8)}`)
    const assessmentResponse = await page.request.post('/api/assessments', {
      data: { client_id: client.id, submission_id: randomUUID(), test_mode: true },
    })
    expect(
      assessmentResponse.ok(),
      `assessment creation failed: ${assessmentResponse.status()}`,
    ).toBeTruthy()
    const dbUrl = process.env.E2E_SUPABASE_DB_URL
    if (!dbUrl) throw new Error('E2E_SUPABASE_DB_URL is required')
    const connection = new pg.Client({ connectionString: dbUrl })
    await connection.connect()
    try {
      // Client history is now loaded by the server component, so a browser
      // route mock cannot exercise its failure path. Inject a target-scoped,
      // local-database read failure and restore the canonical RLS policy in the
      // finally block. The client fallback request encounters the same real
      // PostgREST error and must render the honest error state.
      await connection.query(`
        CREATE OR REPLACE FUNCTION public.e2e_fail_assessment_history(target uuid, expected uuid)
        RETURNS boolean
        LANGUAGE plpgsql
        VOLATILE
        SET search_path = ''
        AS $$
        BEGIN
          IF target = expected THEN
            RAISE EXCEPTION 'forced local E2E assessment-history failure';
          END IF;
          RETURN true;
        END;
        $$;
      `)
      await connection.query(`
        ALTER POLICY assessments_own ON public.assessments
        USING (
          practitioner_id = (SELECT auth.uid())
          AND public.e2e_fail_assessment_history(client_id, '${client.id}'::uuid)
        );
      `)

      await page.goto(`/clients/${client.id}`)
      const alert = page.locator('[role="alert"]').filter({ hasText: /could not load/i })
      await expect(alert).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/No assessments yet/)).toHaveCount(0)
    } finally {
      await connection.query(`
        ALTER POLICY assessments_own ON public.assessments
        USING (practitioner_id = (SELECT auth.uid()));
      `)
      await connection.query('DROP FUNCTION IF EXISTS public.e2e_fail_assessment_history(uuid, uuid);')
      await connection.end()
    }
  })

  test('archive failure: dialog stays interactive and shows error', async ({ page }) => {
    const client = await createClient(page, 'E2E', `ErrArchive-${randomUUID().slice(0, 8)}`)
    await page.goto(`/clients/${client.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(client.last_name) })).toBeVisible()

    // Set up route BEFORE clicking to archive
    await page.route(`**/api/clients/${client.id}`, route => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
      }
      return route.continue()
    })

    await page.getByRole('button', { name: 'Archive Client' }).click()
    await expect(page.getByRole('heading', { name: 'Archive Client?' })).toBeVisible()
    await page.getByRole('button', { name: 'Yes, Archive' }).click()

    // Error alert appears
    const alert = page.locator('[role="alert"]').filter({ hasText: /could not archive/i })
    await expect(alert).toBeVisible({ timeout: 8_000 })
    // Dialog buttons still present (dialog stays interactive, not closed)
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yes, Archive' })).toBeVisible()
  })

  test('wizard step 1: clients 500 shows error not empty-state', async ({ page }) => {
    await page.route(/\/api\/clients(?:\?.*)?$/, route => route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
      : route.continue())
    await page.goto('/assessments/new?testMode=1')
    await page.getByRole('textbox', { name: 'Search clients by name' }).fill('Failure')
    const alert = page.locator('[role="alert"]').filter({ hasText: /could not load your clients/i })
    await expect(alert).toBeVisible({ timeout: 10_000 })
    // Must NOT show the "No clients yet" empty state
    await expect(page.getByText(/No clients yet/)).toHaveCount(0)
  })

  test('assessment results: prior assessments 500 shows aux error alert', async ({ page }) => {
    const client = await createClient(page, 'E2E', `ErrPrior-${randomUUID().slice(0, 8)}`)
    const res = await page.request.post('/api/assessments', { data: { client_id: client.id, submission_id: randomUUID(), test_mode: true } })
    expect(res.ok(), `assessment create failed: ${res.status()}`).toBeTruthy()
    const assessmentId = (await res.json()).id as string

    // Route prior assessments to 500 before navigating
    await page.route('**/api/clients/*/assessments**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
    )
    await page.goto(`/assessments/${assessmentId}`)
    const alert = page.locator('[role="alert"]').filter({ hasText: /could not load|report options/i })
    await expect(alert).toBeVisible({ timeout: 15_000 })
  })

  test('report error has role=alert', async ({ page }) => {
    const client = await createClient(page, 'E2E', `ErrPdf-${randomUUID().slice(0, 8)}`)
    const res = await page.request.post('/api/assessments', { data: { client_id: client.id, submission_id: randomUUID(), test_mode: true } })
    expect(res.ok(), `assessment create failed: ${res.status()}`).toBeTruthy()
    const assessmentId = (await res.json()).id as string
    // Approve so PDF gate doesn't block
    await page.request.patch(`/api/assessments/${assessmentId}/approve`, { data: { approved: true } })

    await page.goto(`/assessments/${assessmentId}`)
    // Wait for results to load
    await page.waitForSelector('[data-testid^="finding-card-"]', { timeout: 15_000 })

    await page.route('**/api/reports**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'PDF generation failed' }) })
    )

    await page.getByRole('button', { name: /PDF/i }).first().click()
    // pdfError has role="alert"
    const errEl = page.locator('[role="alert"]').filter({ hasText: /PDF|failed|generation/i })
    await expect(errEl).toBeVisible({ timeout: 8_000 })
  })

  test('settings: org fetch 500 shows error toast/alert', async ({ page }) => {
    await page.route('**/api/settings/organization**', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
      }
      return route.continue()
    })
    await page.goto('/settings')
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: 10_000 })
  })
})
