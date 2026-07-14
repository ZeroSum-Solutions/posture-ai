export interface OverlayTransformInput {
  /** Source frame dimensions, already oriented (video.videoWidth/videoHeight). */
  srcW: number
  srcH: number
  /** Viewport (on-screen element) dimensions. */
  vpW: number
  vpH: number
  /** True only when the displayed video is horizontally mirrored (front camera). */
  mirror: boolean
}

export interface Point {
  x: number
  y: number
}

export interface OverlayTransform {
  /** Cover scale = max(vpW/srcW, vpH/srcH). */
  scale: number
  /** Centered cover offsets in viewport px (≤0 on the cropped axis). */
  offsetX: number
  offsetY: number
  /** Normalized source [0..1] → normalized viewport [0..1]. */
  toViewport(p: Point): Point
  /** Normalized viewport [0..1] → normalized source [0..1] (inverse). */
  toSource(p: Point): Point
}

/**
 * One tested affine mapping normalized MediaPipe source coords to normalized
 * viewport coords under `object-fit: cover` (§11.7). Used to draw the tracking
 * midline over the cover-cropped video and to keep drawing + gating in the same
 * coordinate frame. `mirror` flips x only (never y), and only when the displayed
 * video is actually mirrored — capture uses the environment camera, so
 * `mirror=false`. Source dims must already be oriented (videoWidth/videoHeight);
 * do not pre-rotate for portrait.
 */
export function sourceToViewport({ srcW, srcH, vpW, vpH, mirror }: OverlayTransformInput): OverlayTransform {
  const scale = Math.max(vpW / srcW, vpH / srcH)
  const scaledW = srcW * scale
  const scaledH = srcH * scale
  const offsetX = (vpW - scaledW) / 2
  const offsetY = (vpH - scaledH) / 2

  return {
    scale,
    offsetX,
    offsetY,
    toViewport({ x, y }) {
      const fx = mirror ? 1 - x : x
      return {
        x: (offsetX + fx * scaledW) / vpW,
        y: (offsetY + y * scaledH) / vpH,
      }
    },
    toSource({ x, y }) {
      const fx = (x * vpW - offsetX) / scaledW
      return {
        x: mirror ? 1 - fx : fx,
        y: (y * vpH - offsetY) / scaledH,
      }
    },
  }
}
