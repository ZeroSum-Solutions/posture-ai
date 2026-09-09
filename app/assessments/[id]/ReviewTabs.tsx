'use client'

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import styles from './AssessmentReviewStudio.module.css'

const ANATOMY_VIEWER_HASH = 'anatomy-viewer-title'
const ASSESSMENT_EVIDENCE_TAB_ID = 'assessment-evidence'

export type ReviewTab = Readonly<{
  id: string
  label: string
  count?: number
  content: ReactNode
}>

type ReviewTabsProps = Readonly<{
  tabs: readonly ReviewTab[]
  defaultTabId: string
  label?: string
}>

function tabId(panelId: string) {
  return `${panelId}-tab`
}

export default function ReviewTabs({
  tabs,
  defaultTabId,
  label = 'Screening result details',
}: ReviewTabsProps) {
  const fallbackId = tabs.some((tab) => tab.id === defaultTabId)
    ? defaultTabId
    : tabs[0]?.id ?? ''
  const [activeId, setActiveId] = useState(fallbackId)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingAnatomyScrollRef = useRef(false)
  const tabIds = tabs.map((tab) => tab.id).join('|')

  useEffect(() => {
    function selectHashTab() {
      const hashId = window.location.hash.slice(1)
      const availableTabIds = tabIds.split('|')
      const resolvedTabId = hashId === ANATOMY_VIEWER_HASH
        && availableTabIds.includes(ASSESSMENT_EVIDENCE_TAB_ID)
        ? ASSESSMENT_EVIDENCE_TAB_ID
        : hashId
      pendingAnatomyScrollRef.current = hashId === ANATOMY_VIEWER_HASH
        && resolvedTabId === ASSESSMENT_EVIDENCE_TAB_ID
      if (availableTabIds.includes(resolvedTabId)) setActiveId(resolvedTabId)
    }

    selectHashTab()
    window.addEventListener('hashchange', selectHashTab)
    return () => window.removeEventListener('hashchange', selectHashTab)
  }, [tabIds])

  useEffect(() => {
    if (activeId !== ASSESSMENT_EVIDENCE_TAB_ID || !pendingAnatomyScrollRef.current) return
    const timer = window.setTimeout(() => {
      const target = document.getElementById(ANATOMY_VIEWER_HASH)
      if (!target) return
      pendingAnatomyScrollRef.current = false
      target.scrollIntoView({ block: 'start' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeId, tabIds])

  if (tabs.length === 0) return null

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab.id)

  function selectTab(nextIndex: number, shouldFocus = false) {
    const normalizedIndex = (nextIndex + tabs.length) % tabs.length
    const nextTab = tabs[normalizedIndex]
    setActiveId(nextTab.id)
    window.history.replaceState(null, '', `#${nextTab.id}`)
    if (shouldFocus) tabRefs.current[normalizedIndex]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      selectTab(activeIndex + 1, true)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      selectTab(activeIndex - 1, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectTab(0, true)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectTab(tabs.length - 1, true)
    }
  }

  return (
    <div className={styles.tabShell}>
      <div className={styles.tabList} role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const isSelected = tab.id === activeTab.id
          return (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={tab.id}
              tabIndex={isSelected ? 0 : -1}
              className={styles.tab}
              onClick={() => selectTab(index)}
              onKeyDown={handleKeyDown}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span className={styles.tabCount} aria-label={`${tab.count} items`}>
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <section
        key={activeTab.id}
        id={activeTab.id}
        role="tabpanel"
        aria-labelledby={tabId(activeTab.id)}
        className={`${styles.canvasSection} ${styles.tabPanel}`}
        tabIndex={0}
      >
        {activeTab.content}
      </section>
    </div>
  )
}
