'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Surface } from '@/components/array/Surface'
import type { ManualRoutine, ManualRoutineItem } from './ManualRoutine.types'
import styles from './ManualRoutines.module.css'

function duration(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
  return `${seconds} seconds`
}

export default function ManualRoutinePlayer({ routine }: { routine: Pick<ManualRoutine, 'title'> & { items: readonly ManualRoutineItem[] } }) {
  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [failedImages, setFailedImages] = useState<string[]>([])
  const item = routine.items[index]

  if (!item) return <p role="alert">This routine has no exercises to show.</p>
  const display = item.exerciseDisplay

  return <section className={styles.player} aria-labelledby="manual-player-heading">
    <div className={styles.playerHeader}>
      <div>
        <p className="t-kicker">Manual routine · Reference content</p>
        <h2 id="manual-player-heading" className="t-headline-sm">{routine.title}</h2>
        <p className="t-body">These targets were entered manually. This walkthrough does not record completed work or change future targets.</p>
      </div>
      <span className="t-quiet">{index + 1} of {routine.items.length}</span>
    </div>
    <Surface tier="tile" innerClassName={styles.playerCard}>
      {display.media && !failedImages.includes(display.media.posterUrl) ? <>
        <Image className={styles.image} src={display.media.posterUrl} alt={display.media.alt} width={display.media.width} height={display.media.height} priority onError={() => {
          const url = display.media?.posterUrl
          if (url) setFailedImages(previous => previous.includes(url) ? previous : [...previous, url])
        }} />
        <p className="t-quiet">Image by {display.media.source.author} · <a href={display.media.source.assetUrl} target="_blank" rel="noreferrer">wger image source</a> · <a href={display.media.source.license.url} target="_blank" rel="noreferrer">{display.media.source.license.shortName}</a> · unmodified</p>
      </> : display.media ? <p role="status" className="t-quiet">Image unavailable. Follow the written instructions below.</p> : null}
      <div><p className="t-kicker">Exercise {String(index + 1).padStart(2, '0')}</p><h3 className="t-title">{display.name}</h3></div>
      <p className={styles.target}>{item.kind === 'strength'
        ? `${item.sets} set${item.sets === 1 ? '' : 's'} × ${item.reps} rep${item.reps === 1 ? '' : 's'} · ${item.load.value} ${item.load.unit}`
        : duration(item.durationSeconds)}</p>
      {item.restSeconds !== undefined ? <p className="t-quiet">Rest {duration(item.restSeconds)}</p> : null}
      <p className="t-body">{display.instructions}</p>
      <p className="t-quiet">By {display.source.author} · <a href={display.source.recordUrl} target="_blank" rel="noreferrer" aria-label={`Source for ${display.name}`}>wger source</a> · <a href={display.source.license.url} target="_blank" rel="noreferrer">{display.source.license.shortName}</a></p>
    </Surface>
    {finished ? <p role="status" className={styles.notice}>You reached the end of this routine. No workout completion was recorded.</p> : null}
    <div className={styles.actions}>
      <button type="button" className="a-secondary" disabled={index === 0} onClick={() => { setIndex(value => value - 1); setFinished(false) }}>Previous exercise</button>
      {index < routine.items.length - 1
        ? <button type="button" className="a-primary" onClick={() => { setIndex(value => value + 1); setFinished(false) }}>Next exercise</button>
        : <button type="button" className="a-primary" onClick={() => setFinished(true)}>Finish viewing routine</button>}
    </div>
  </section>
}
