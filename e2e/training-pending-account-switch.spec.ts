import { expect, test, type Page } from '@playwright/test'
import { provisionLocalAthlete } from './helpers/athlete-auth'
import { totpCode } from '../scripts/testing/totp'

type OfflineSnapshot = {
  activeUser: string | null
  entries: Array<{
    status: string
    envelope: {
      userId: string
      subjectId: string
      sessionId: string
      requestId: string
      mutation: { kind: string }
    }
  }>
}

async function readOfflineSnapshot(page: Page): Promise<OfflineSnapshot> {
  return page.evaluate(() => new Promise<OfflineSnapshot>((resolve, reject) => {
    const open = indexedDB.open('posture-ai-training-offline', 1)
    open.onerror = () => reject(new Error('Offline training storage unavailable'))
    open.onsuccess = () => {
      const database = open.result
      const transaction = database.transaction(['meta', 'entries'], 'readonly')
      const active = transaction.objectStore('meta').get('activeUser')
      const entries = transaction.objectStore('entries').getAll()
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline training storage read failed'))
      transaction.oncomplete = () => {
        database.close()
        resolve({
          activeUser: (active.result as { userId?: string } | undefined)?.userId ?? null,
          entries: entries.result as OfflineSnapshot['entries'],
        })
      }
    }
  }))
}

async function signInAthlete(page: Page, athlete: Awaited<ReturnType<typeof provisionLocalAthlete>>) {
  await page.goto('/auth/sign-in?next=/train')
  await page.locator('input[type="email"]').fill(athlete.email)
  await page.locator('input[type="password"]').fill(athlete.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/mfa/)
  await page.getByLabel('Authenticator code').fill(totpCode(athlete.secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL(url => url.pathname === '/train')
}

test('a direct account switch clears a real pending training envelope without replaying it as the next actor', async ({ page, context }) => {
  test.setTimeout(90_000)
  const nextAthlete = await provisionLocalAthlete()

  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Build a strength program', exact: true })
    .getByText('Practice Athlete', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2032-01-05')
  await page.getByRole('button', { name: 'Build practice draft', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Use these starting targets', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use these starting targets', exact: true }).click()
  await expect(page.getByText('Starting targets accepted and program created.', { exact: true })).toBeVisible()

  const sessionHref = await page.getByRole('link', { name: 'Open first strength session', exact: true }).getAttribute('href')
  expect(sessionHref).toMatch(/^\/workouts\?training_session_id=/)
  const sessionId = new URL(sessionHref!, page.url()).searchParams.get('training_session_id')
  expect(sessionId).toBeTruthy()
  await page.goto(sessionHref!)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()

  await expect.poll(() => readOfflineSnapshot(page)).toMatchObject({ entries: [] })
  const before = await readOfflineSnapshot(page)
  expect(before.activeUser).toMatch(/^[0-9a-f-]{36}$/)

  const setRequests: Array<{ requestId?: string }> = []
  context.on('request', request => {
    if (request.method() !== 'PUT' || !/\/api\/training\/sessions\/[^/]+\/sets\/[^/]+$/.test(new URL(request.url()).pathname)) return
    try {
      setRequests.push(request.postDataJSON() as { requestId?: string })
    } catch {
      setRequests.push({})
    }
  })
  await page.route('**/api/training/sessions/*/sets/*', route => route.abort('connectionreset'))
  const firstSet = page.getByRole('group', { name: 'Set 1', exact: true }).first()
  await firstSet.getByRole('button', { name: 'Save set', exact: true }).click()
  await expect(page.getByText('1 pending change on this device.', { exact: true })).toBeVisible()

  const pending = await readOfflineSnapshot(page)
  expect(pending.entries).toHaveLength(1)
  expect(pending.entries[0]).toMatchObject({
    status: 'pending',
    envelope: {
      userId: before.activeUser,
      sessionId,
      mutation: { kind: 'set_actual' },
    },
  })
  expect(pending.entries[0].envelope.requestId).toMatch(/^[0-9a-f-]{36}$/)
  expect(setRequestsWrap(setRequests, pending.entries[0].envelope.requestId)).toHaveLength(1)

  const nextTab = await context.newPage()
  const priorTabReloaded = page.waitForEvent('framenavigated', {
    predicate: frame => frame === page.mainFrame(),
  })
  // This is an account replacement in shared browser storage, with no logout.
  await signInAthlete(nextTab, nextAthlete)
  await priorTabReloaded

  await expect(page.getByRole('group', { name: 'Set 1', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save set', exact: true })).toHaveCount(0)
  await expect.poll(() => readOfflineSnapshot(nextTab)).toMatchObject({ entries: [] })
  const after = await readOfflineSnapshot(nextTab)
  expect(after.activeUser).not.toBe(before.activeUser)
  expect(after.activeUser).toMatch(/^[0-9a-f-]{36}$/)

  const currentIdentity = await nextTab.request.get('/api/training/eligibility/answers')
  expect(currentIdentity.ok()).toBe(true)
  expect(await currentIdentity.json()).toMatchObject({ subjectId: nextAthlete.subjectId })
  const oldSession = await nextTab.request.get(`/api/training/sessions/${encodeURIComponent(sessionId!)}`)
  expect([403, 404]).toContain(oldSession.status())

  // Exercise the normal reconnect/reload drains after the switch. With no
  // transferred entry, neither document may replay the prior request ID.
  await nextTab.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.reload()
  await page.waitForLoadState('networkidle')
  expect(await readOfflineSnapshot(nextTab)).toMatchObject({ activeUser: after.activeUser, entries: [] })
  expect(setRequestsWrap(setRequests, pending.entries[0].envelope.requestId)).toHaveLength(1)
  await nextTab.close()
})

function setRequestsWrap(requests: Array<{ requestId?: string }>, requestId: string) {
  return requests.filter(request => request.requestId === requestId)
}
