import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface BayMarkProps {
  /** Rendered edge length in CSS pixels. */
  size?: number
  /**
   * `tile` draws the app icon as shipped (its dark rounded square included), for the home
   * screen and the access gate. `glyph` drops the square so the mark sits on the chrome it is
   * placed on, for the top bar.
   */
  variant?: 'tile' | 'glyph'
  className?: string
  /** Named when the mark stands for the app on its own; decorative (hidden) beside the word. */
  title?: string
}

/**
 * bay's mark: three clip bars on a timeline, crossed by the playhead. The same geometry as
 * `build/icon.png` (`build/make-icon.mjs`, on a 1024 grid), redrawn as SVG so it is sharp at
 * any size and follows the theme's accent rather than being a raster of one theme.
 */
export function BayMark({ size = 20, variant = 'glyph', className, title }: BayMarkProps): ReactNode {
  const tile = variant === 'tile'
  return (
    <svg
      viewBox={tile ? '0 0 1024 1024' : '150 190 724 644'}
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0', className)}
    >
      {tile && <rect width="1024" height="1024" rx="224" fill="#121317" />}
      <rect x="176" y="320" width="520" height="108" rx="26" fill="var(--color-clip-video-edge)" />
      <rect x="272" y="480" width="576" height="108" rx="26" fill="var(--color-clip-video-edge)" />
      <rect x="176" y="640" width="400" height="108" rx="26" fill="var(--color-clip-audio-edge)" />
      <rect x="486" y="208" width="30" height="608" rx="15" fill="var(--color-accent)" />
    </svg>
  )
}
