'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import styles from './CapturePhoto.module.css'

export default function CapturePhoto({ url, label }: { url: string | null; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <span className={styles.missing}>
    {failed ? 'Photo unavailable' : 'Photo not saved'}
  </span>
  return <>
    <button type="button" className={styles.thumbnail} aria-label={`Enlarge ${label} capture`} onClick={() => dialog.current?.showModal()}>
      <Image src={url} alt={`${label} capture`} width={240} height={320} unoptimized onError={() => setFailed(true)} />
      <span>View photo</span>
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-label={`${label} capture photo`} onClick={event => {
      if (event.target === event.currentTarget) dialog.current?.close()
    }}>
      <div className={styles.content}>
        <div className={styles.header}><h3>{label} capture</h3><button type="button" className="a-secondary" onClick={() => dialog.current?.close()}>Close photo</button></div>
        <Image src={url} alt={`${label} original capture`} width={960} height={1280} unoptimized />
        <p>Saved acquisition image. The schematic model is a separate illustration.</p>
      </div>
    </dialog>
  </>
}
