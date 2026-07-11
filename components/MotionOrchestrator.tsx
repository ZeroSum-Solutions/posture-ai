'use client'

import { useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'

const IMPLICIT_TARGETS = [
  '.app-standard-page > :is(.app-page-kicker,.app-page-heading,.app-page-lede)',
  '.app-standard-page > :is(div,section,article,form)',
  '.auth-layout > *',
].join(',')

/** Adds one-shot viewport reveals without turning every component into a client component. */
export default function MotionOrchestrator() {
  const pathname = usePathname() ?? ''

  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>('.app-shell-main')
    if (!root) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const registered = new Set<HTMLElement>()
    let sequence = 0
    let scrollFrame = 0
    const viewportObserver = reduce ? null : new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          // Reveal intersecting content and anything a large scroll jump already passed.
          if (!entry.isIntersecting && entry.boundingClientRect.top >= 0) return
          const element = entry.target as HTMLElement
          element.classList.add('motion-visible')
          viewportObserver?.unobserve(element)
        })
      },
      { rootMargin: '0px 0px -9% 0px', threshold: 0.08 },
    )

    const registerTargets = () => {
      const explicit = Array.from(root.querySelectorAll<HTMLElement>('[data-motion]'))
      const implicit = pathname === '/dashboard'
        ? []
        : Array.from(root.querySelectorAll<HTMLElement>(IMPLICIT_TARGETS))

      for (const element of new Set([...explicit, ...implicit])) {
        if (registered.has(element)) continue
        registered.add(element)
        const order = Number(element.dataset.motionOrder ?? sequence++)
        element.style.setProperty('--motion-delay', `${Math.min(order, 5) * 55}ms`)
        element.classList.add('motion-reveal')
        if (reduce) element.classList.add('motion-visible')
        else viewportObserver?.observe(element)
      }
    }

    const revealPassedTargets = () => {
      scrollFrame = 0
      for (const element of registered) {
        if (element.classList.contains('motion-visible')) continue
        if (element.getBoundingClientRect().top < window.innerHeight * 0.91) {
          element.classList.add('motion-visible')
          viewportObserver?.unobserve(element)
        }
      }
    }

    const onScroll = () => {
      if (scrollFrame) return
      scrollFrame = window.requestAnimationFrame(revealPassedTargets)
    }

    registerTargets()
    const mutationObserver = new MutationObserver(registerTargets)
    mutationObserver.observe(root, { childList: true, subtree: true })
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      mutationObserver.disconnect()
      viewportObserver?.disconnect()
      window.removeEventListener('scroll', onScroll)
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame)
    }
  }, [pathname])

  return null
}
