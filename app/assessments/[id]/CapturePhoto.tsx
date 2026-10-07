'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import Icon from '@/components/array/Icon'
import styles from './CapturePhoto.module.css'

/**
 * One saved capture. With `onSelect` the photo is a toggle that picks its view (the Evidence
 * tab lists that view's findings under the set); once selected, a small magnifier opens it
 * full size.
 */
export default function CapturePhoto({
  url,
  label,
  selected = false,
  onSelect,
}: {
  url: string | null
  label: string
  selected?: boolean
  onSelect?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [failed, setFailed] = useState(false)
  const hasPhoto = !!url && !failed
  const face = hasPhoto
    ? <Image src={url} alt={`${label} capture`} width={240} height={320} unoptimized onError={() => setFailed(true)} />
    : (
      <span className={styles.missing}>
        <Icon name="image-off-linear" size={18} />
        <span>{failed ? 'Photo unavailable' : 'No photo for this view'}</span>
      </span>
    )

  return <>
    {onSelect
      ? <button type="button" className={styles.select} aria-pressed={selected} aria-label={`${label} view`} onClick={onSelect}>{face}</button>
      : face}
    {hasPhoto ? <>
      {(selected || !onSelect) && <button type="button" className={styles.enlarge} aria-label={`Enlarge ${label} capture`} onClick={() => dialog.current?.showModal()}>
        <Icon name="magnifer-linear" size={12} />
      </button>}
      <dialog ref={dialog} className={styles.dialog} aria-label={`${label} capture photo`} onClick={event => {
        if (event.target === event.currentTarget) dialog.current?.close()
      }}>
        <div className={styles.content}>
          <div className={styles.header}><h3>{label} capture</h3><button type="button" className="a-secondary" onClick={() => dialog.current?.close()}>Close photo</button></div>
          <Image src={url!} alt={`${label} original capture`} width={960} height={1280} unoptimized />
        </div>
      </dialog>
    </> : null}
  </>
}
