/**
 * The ambient photograph runs behind every app screen. Two exceptions:
 *
 * - the marketing home page, which composes its own imagery;
 * - immersive screens (capture, player), whose background is the live camera or
 *   video frame. Those are hidden by the shell's `:has([data-immersive-surface])`
 *   rule at render time rather than by pathname, because the capture route only
 *   becomes immersive once the camera step is reached.
 */
export function shouldRenderAmbientField(pathname: string): boolean {
  return pathname !== '/'
}
