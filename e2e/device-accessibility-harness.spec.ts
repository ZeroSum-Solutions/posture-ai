import { expect, test, type Locator, type Page } from '@playwright/test'

const PHONE_VIEWPORT = { width: 390, height: 844 }

async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Alt+Tab', limit = 12): Promise<void> {
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

  test('phone-width navigation is keyboard operable and preserves responsive route state', async ({ page, browserName }) => {
    await page.goto('/dashboard')
    // Safari/WebKit uses Option+Tab for full-control traversal unless the host
    // preference that makes plain Tab focus every control is enabled.
    const traversalKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'

    const menuButton = page.getByRole('button', { name: 'Toggle navigation menu' })
    await expect(menuButton).toBeVisible()
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')

    await tabTo(page, menuButton, traversalKey)
    await expect(menuButton).toBeFocused()
    const focusStyle = await menuButton.evaluate(element => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
    })
    expect(focusStyle).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' })

    await page.keyboard.press('Enter')
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true')

    const mobileMenu = page.locator('.nav-mobile-menu')
    await expect(mobileMenu).toBeVisible()
    const clientsLink = mobileMenu.getByRole('link', { name: 'Clients' })
    await tabTo(page, clientsLink, traversalKey)
    await expect(clientsLink).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/clients$/)
    await expect(page.getByRole('button', { name: 'Toggle navigation menu' })).toHaveAttribute('aria-expanded', 'false')
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
