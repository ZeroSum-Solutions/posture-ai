/**
 * `components/ui` is the v3 component home; `Surface` itself still lives in
 * `components/array` (it predates the rewrite and dozens of screens import it
 * from there — see the grep in the PR description). This re-export lets new
 * code import every `components/ui` primitive, including `Surface`, from one
 * place without moving a widely-used module and risking an import-path churn
 * PR of its own.
 */
export { Surface, SurfaceLink, SurfaceButton } from '@/components/array/Surface'
