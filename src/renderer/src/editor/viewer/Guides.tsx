import type { ReactNode } from 'react'

/**
 * Framing guides over the preview: title- and action-safe areas and a rule-of-thirds grid.
 *
 * Action safe is 90% of the frame and title safe 80%, the long-standing broadcast margins that
 * Premiere and Final Cut draw by default. Viewer chrome, like the handles: SVG over the canvas,
 * never drawn into it, so no export or `preview_frame` can contain a guide.
 */
export function Guides({ safeAreas, grid }: { safeAreas: boolean; grid: boolean }): ReactNode {
  if (!safeAreas && !grid) return null
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full text-on-media"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {grid && (
        <g stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke">
          {[100 / 3, 200 / 3].map((at) => (
            <g key={at}>
              <line x1={at} y1={0} x2={at} y2={100} vectorEffect="non-scaling-stroke" />
              <line x1={0} y1={at} x2={100} y2={at} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </g>
      )}
      {safeAreas && (
        <g fill="none" stroke="currentColor" strokeWidth={1}>
          {/* Action safe: 5% in from each edge. */}
          <rect x={5} y={5} width={90} height={90} strokeOpacity={0.45} vectorEffect="non-scaling-stroke" />
          {/* Title safe: 10% in, dashed so the two read apart. */}
          <rect
            x={10}
            y={10}
            width={80}
            height={80}
            strokeOpacity={0.45}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </svg>
  )
}
