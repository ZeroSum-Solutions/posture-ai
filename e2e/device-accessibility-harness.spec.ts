import { expect, test, type Locator, type Page } from '@playwright/test'

const PHONE_VIEWPORT = { width: 390, height: 844 }

// The island renders after the page's own content, so the number of Tab presses
// needed to reach its first slot is a property of whatever screen is mounted --
// the dashboard's review queue alone contributes several links. The old limit of
// 12 was tuned to the NavBar, which sat at the top of the document. Bound this
// generously instead of tracking page content: the assertion is "reachable by
// sequential Tab", not "reachable within N".
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Alt+Tab', limit = 60): Promise<void> {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    await page.keyboard.press(key)
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute('aria-label') ?? await target.textContent()}`)
}

test.describe('device accessibility browser harness', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE_VIEWPORT)
  })

  test('phone-width island navigation is keyboard operable, marks the active destination, and preserves responsive route state', async ({ page, browserName }) => {
    // IslandNav (components/array/IslandNav.tsx) replaced NavBar's hamburger
    // with a fixed pill of Link slots — there is no open/closed menu to drive
    // by keyboard anymore. What survives from the old test: every slot must be
    // keyboard-reachable in order, the focus indicator must be visible,
    // activating a slot must navigate, aria-current must track the active
    // destination, and the phone-width layout must not gain horizontal
    // overflow after the route change.
    await page.goto('/dashboard')
    // Whether pressing Tab MOVES focus to a link is a browser/OS preference,
    // not an app property: WebKit skips links entirely unless Full Keyboard
    // Access is enabled, and headless WebKit does not honour the Option+Tab
    // alternative either. So sequential traversal is asserted where the browser
    // actually traverses links, while EVERY browser must still satisfy the
    // parts that are this app's responsibility -- each slot focusable, a
    // visible focus indicator on it, and Enter activating it. Asserting Tab
    // order under WebKit would be testing Safari's default, and would fail no
    // matter what this app did.
    const traversesLinksByTab = browserName !== 'webkit'

    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav).toBeVisible()

    // The clinical-content flag (lib/clinical-content/inventory.ts) is enabled
    // in this e2e environment — the a11y spec exercises /exercises and
    // /muscles on the same shell — so islandPolicy.islandSlots() yields all
    // five slots below. A gated environment would drop Library.
    const labels = await nav.getByRole('link').evaluateAll(links =>
      links.map(link => link.getAttribute('aria-label'))
    )
    expect(labels).toEqual(['Today', 'Clients', 'Capture', 'Library', 'Profile'])

    const todayLink = nav.getByRole('link', { name: 'Today' })
    await expect(todayLink).toHaveAttribute('aria-current', 'page')
    const settingsLink = nav.getByRole('link', { name: 'Profile' })
    await expect(settingsLink).not.toHaveAttribute('aria-current', 'page')

    // Every slot must be able to hold focus. Where the browser traverses links
    // at all, the first slot must additionally be reachable by sequential Tab
    // from the top of the document, and the rest must follow it one press at a
    // time — which is the focus-ORDER guarantee, asserted without depending on
    // how many focusables the mounted screen puts before the island.
    for (const [index, label] of labels.entries()) {
      const slot = nav.getByRole('link', { name: label! })
      if (!traversesLinksByTab) await slot.focus()
      else if (index === 0) await tabTo(page, slot, 'Tab')
      else await page.keyboard.press('Tab')
      await expect(slot).toBeFocused()
    }

    // The loop above leaves focus on the last slot (Profile) — check the
    // focus indicator there and use it as the activation target.
    await expect(settingsLink).toBeFocused()
    const focusStyle = await settingsLink.evaluate(element => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
    })
    expect(focusStyle).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' })

    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/settings$/)
    await expect(settingsLink).toHaveAttribute('aria-current', 'page')
    await expect(todayLink).not.toHaveAttribute('aria-current', 'page')
    const hasHorizontalOverflow = await page.locator('html').evaluate(root => root.scrollWidth > root.clientWidth)
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('reduced-motion preference removes route animation at phone width', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await expect.poll(() => page.locator('.app-shell-main').evaluate(element => getComputedStyle(element).transform))
      .toBe('none')
    const motionState = await page.locator('.app-shell-main').evaluate(element => {
      const style = getComputedStyle(element)
      return {
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
        transform: style.transform,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      }
    })
    // Engines serialize the same 0.01ms rule as either 0.00001s or 1e-05s.
    expect(Number.parseFloat(motionState.animationDuration)).toBeLessThanOrEqual(0.00001)
    expect(Number.parseFloat(motionState.transitionDuration)).toBeLessThanOrEqual(0.00001)
    expect(motionState.transform).toBe('none')
    expect(motionState.scrollBehavior).toBe('auto')
  })
})
