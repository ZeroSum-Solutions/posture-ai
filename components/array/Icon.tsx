import { arrayIcons, type IconName } from './icons'

/**
 * Solar linear iconography. 20px in nav and controls, 18px in tiles, 14px
 * inline with text. Never filled, never two-tone, never emoji — the one
 * exception is `check-circle-bold`, used for the verified tick on a thumbnail.
 *
 * Icons are inlined from the Solar set at authoring time rather than fetched
 * from an icon CDN: the screening flow has to render with no network.
 */
export default function Icon({
  name,
  size = 18,
  className,
  title,
}: {
  name: IconName
  size?: number
  className?: string
  /** Supply only when the icon is the sole carrier of meaning. */
  title?: string
}) {
  const icon = arrayIcons[name]
  // Bodies come from the generated icons module — compile-time constants, never
  // user input, so the inner HTML needs no sanitizer.
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: 'block', flex: '0 0 auto' }}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}
