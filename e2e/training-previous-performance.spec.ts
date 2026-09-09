import { expect, test } from '@playwright/test'
import { TrainingProgramWorkspaceProjectionSchema } from '../lib/training/contracts/program-workspace'

test('shows exact previous comparable working sets in the next strength session', async ({ page, browserName }) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/workouts')
  await page.getByRole('button', { name: 'Try a sample program', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Build a strength program', exact: true }).getByText('Practice Athlete', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click()
  await page.getByLabel('Cycle start date', { exact: true }).fill('2030-01-07')
  await page.getByRole('button', { name: 'Build practice draft' }).click()
  await expect(page.getByRole('button', { name: 'Use these starting targets' })).toBeVisible()
  const publication = page.waitForResponse(response => response.request().method() === 'GET'
    && /\/api\/training\/programs\/[^/]+$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Use these starting targets' }).click()
  const stored = await publication
  expect(stored.ok()).toBe(true)
  const assignmentId = new URL(stored.url()).pathname.split('/').at(-1)!
  const readWorkspace = async () => {
    const response = await page.request.get(`/api/training/programs/${assignmentId}/workspace?view=program`)
    expect(response.ok()).toBe(true)
    return TrainingProgramWorkspaceProjectionSchema.parse(await response.json())
  }
  const before = await readWorkspace()
  const sessions = before.sessions.filter(session => session.kind === 'strength')
  expect(sessions.length).toBeGreaterThanOrEqual(2)
  await page.goto(`/workouts?training_session_id=${sessions[0].sessionId}`)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  const firstPrevious = page.getByRole('complementary', { name: 'Previous comparable session', exact: true }).first()
  await expect(firstPrevious).toContainText('No comparable saved session yet.')
  for (const ordinal of [1, 2]) {
    const set = page.getByRole('group', { name: `Set ${ordinal}`, exact: true }).first()
    if (ordinal === 1) {
      // Follow the real focus order through numeric entry and explicit saving.
      const load = set.getByRole('textbox', { name: 'Load', exact: true })
      await load.focus()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText('10.25')
      await page.keyboard.press('Tab')
      await expect(set.getByRole('combobox', { name: 'Unit', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(set.getByRole('spinbutton', { name: 'Reps', exact: true })).toBeFocused()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText('8')
      await page.keyboard.press('Tab')
      const rir = set.getByRole('combobox', { name: 'RIR', exact: true })
      await expect(rir).toBeFocused()
      await page.keyboard.press('Space')
      await page.keyboard.press('3')
      await page.keyboard.press('Enter')
      await expect(rir).toHaveValue('3')
      await page.keyboard.press('Tab')
      await expect(set.getByRole('combobox', { name: 'During this set', exact: true })).toBeFocused()
      // WebKit's default keyboard setting skips buttons with plain Tab.
      await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
      await expect(set.getByRole('button', { name: 'Save set', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
    } else {
      await set.getByRole('textbox', { name: 'Load', exact: true }).fill('10.25')
      await set.getByRole('combobox', { name: 'Unit', exact: true }).selectOption('kg')
      await set.getByRole('spinbutton', { name: 'Reps', exact: true }).fill('7')
      await set.getByRole('combobox', { name: 'RIR', exact: true }).selectOption('3')
      await set.getByRole('button', { name: 'Save set', exact: true }).click()
    }
    await expect(set.getByRole('button', { name: 'Set saved', exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: /Finish with \d+ omissions/, exact: true }).click()
  await expect(page.getByText('This session is completed with omissions.')).toBeVisible()
  await page.goto(`/workouts?training_session_id=${sessions[1].sessionId}`)
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  const previous = page.getByRole('complementary', { name: 'Previous comparable session', exact: true }).first()
  await expect(previous).toContainText('Set 1: 10.25 kg · one dumbbell total · 8 reps · RIR 3')
  await expect(previous).toContainText('Set 2: 10.25 kg · one dumbbell total · 7 reps · RIR 3')
  await expect(page.getByRole('group', { name: 'Set 1', exact: true }).first().getByRole('button', { name: 'Save set', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Previous comparable session', exact: true }).first()).toContainText('10.25 kg')
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})
