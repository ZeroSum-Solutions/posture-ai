import styles from './AmbientField.module.css'

/**
 * The ambient photograph and its legibility veil. Carries the mood so content
 * can stay neutral; decorative only, hence `aria-hidden` and an empty alt.
 *
 * The asset is hosted locally (`public/ambient/field.jpg`) and downscaled — it
 * sits under a 4px blur, so resolution beyond ~1080px buys nothing.
 */
export default function AmbientField() {
  return (
    <div className={`${styles.field} app-ambient-field`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative fixed-viewport layer; next/image adds no value and forces a wrapper that breaks mix-blend-mode */}
      <img src="/ambient/field.jpg" alt="" className={styles.photo} decoding="async" fetchPriority="low" />
      <div className={styles.veil} />
    </div>
  )
}
