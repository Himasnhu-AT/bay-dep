import type { CSSProperties, ReactNode } from 'react'
import type { CompositionVariableValue } from '@shared/composition'
import type { TemplateSpec } from '@shared/templates'

/**
 * A still of a template as it will sit in the frame, drawn from the row's draft values.
 *
 * Not a render: a composition frame is a capture in main, and seven of them for a list the user
 * is only browsing would be seven hidden windows. Instead each layout is the template's own —
 * the same `--u` unit (one pixel of a frame whose short side is 1080, via container units), the
 * same offsets, sizes and weights as `src/main/templates/<id>.html` at its settled state — so a
 * changed position or colour moves here exactly as it will in the clip. The colours are the
 * template's, not the chrome's: this box depicts footage.
 */

const U = (n: number): string => `calc(${n} * var(--u))`

const SHADOW = '0 0.25em 1em rgba(0,0,0,.7)'

function text(values: Record<string, CompositionVariableValue>, id: string): string {
  const value = values[id]
  return typeof value === 'string' ? value : String(value ?? '')
}

function num(values: Record<string, CompositionVariableValue>, id: string, fallback: number): number {
  const value = values[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function Layout({ spec, values }: { spec: TemplateSpec; values: Record<string, CompositionVariableValue> }): ReactNode {
  const accent = text(values, 'accent')
  switch (spec.id) {
    case 'subtitle':
      return (
        <div style={{ position: 'absolute', left: U(60), right: U(60), bottom: `${num(values, 'bottom', 11)}%`, textAlign: 'center' }}>
          <span
            style={{
              display: 'inline-block',
              color: text(values, 'ink'),
              fontSize: U(num(values, 'size', 64)),
              fontWeight: 800,
              lineHeight: 1.18,
              padding: `${U(14)} ${U(26)}`,
              borderRadius: U(16),
              background: values['pill'] === false ? 'transparent' : 'rgba(10,10,12,.72)',
              textShadow: SHADOW
            }}
          >
            {text(values, 'text')}
          </span>
        </div>
      )
    case 'lower-third':
      return (
        <div style={{ position: 'absolute', left: U(70), bottom: `${num(values, 'bottom', 24)}%`, display: 'flex' }}>
          <div style={{ width: U(10), background: accent, borderRadius: U(5) }} />
          <div style={{ paddingLeft: U(22), textShadow: SHADOW }}>
            <div style={{ color: '#fff', fontSize: U(68), fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
              {text(values, 'name')}
            </div>
            <div style={{ color: accent, fontSize: U(38), fontWeight: 700, marginTop: U(4) }}>{text(values, 'role')}</div>
          </div>
        </div>
      )
    case 'title-card':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: '#08080A', opacity: num(values, 'scrim', 0.72) }} />
          <div style={{ position: 'absolute', left: U(70), right: U(70), top: '50%', transform: 'translateY(-50%)', textAlign: 'center' }}>
            <div style={{ color: accent, fontSize: U(34), fontWeight: 800, letterSpacing: '0.2em' }}>{text(values, 'kicker')}</div>
            <div style={{ color: '#fff', fontSize: U(128), fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.02, marginTop: U(14) }}>
              {text(values, 'title')}
            </div>
            <div style={{ height: U(6), background: accent, margin: `${U(26)} auto 0`, width: U(220) }} />
          </div>
        </>
      )
    case 'callout':
      return (
        <div
          style={{
            position: 'absolute',
            left: `${num(values, 'x', 6)}%`,
            top: `${num(values, 'y', 14)}%`,
            background: 'rgba(10,10,12,.82)',
            border: `${U(2)} solid ${accent}`,
            color: '#fff',
            fontSize: U(44),
            fontWeight: 700,
            padding: `${U(14)} ${U(26)}`,
            borderRadius: U(16),
            whiteSpace: 'nowrap'
          }}
        >
          {text(values, 'text')}
        </div>
      )
    case 'stat':
      return (
        <div style={{ position: 'absolute', left: U(60), right: U(60), top: `${num(values, 'y', 16)}%`, textAlign: 'center', textShadow: SHADOW }}>
          <div style={{ color: text(values, 'ink'), fontSize: U(150), fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>
            {Math.round(num(values, 'to', 0)).toLocaleString()}
          </div>
          <div style={{ color: '#fff', opacity: 0.82, fontSize: U(40), fontWeight: 700, marginTop: U(10) }}>{text(values, 'caption')}</div>
        </div>
      )
    case 'progress':
      return (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${num(values, 'top', 0)}%`,
            height: U(num(values, 'thickness', 10)),
            background: 'rgba(255,255,255,.18)'
          }}
        >
          {/* Shown part-way through, as a still mid-clip would. */}
          <div style={{ height: '100%', width: '40%', background: accent }} />
        </div>
      )
    case 'end-card':
      return (
        <>
          <div style={{ position: 'absolute', inset: 0, background: '#08080A', opacity: 0.8 }} />
          <div style={{ position: 'absolute', left: U(70), right: U(70), top: '50%', transform: 'translateY(-50%)', textAlign: 'center' }}>
            <div style={{ color: '#fff', fontSize: U(76), fontWeight: 900, letterSpacing: '-0.03em' }}>{text(values, 'line')}</div>
            <div style={{ color: accent, fontSize: U(52), fontWeight: 800, marginTop: U(12) }}>{text(values, 'handle')}</div>
          </div>
        </>
      )
    default:
      return null
  }
}

export function TemplatePreview({
  spec,
  values,
  width,
  height
}: {
  spec: TemplateSpec
  /** The draft: every declared variable, overrides applied over defaults. */
  values: Record<string, CompositionVariableValue>
  /** The canvas the template will be sized to. */
  width: number
  height: number
}): ReactNode {
  // A tall canvas is capped so a vertical preview does not take the whole panel.
  const style = {
    aspectRatio: `${width} / ${height}`,
    containerType: 'size',
    '--u': 'calc(100cqmin / 1080)',
    fontFamily: "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif",
    // A stand-in for footage, as the subtitle previews use.
    background: 'linear-gradient(160deg, #5b4a42 0%, #2c2623 55%, #151312 100%)'
  } as CSSProperties
  return (
    <div aria-hidden="true" className="mx-auto max-h-44 w-full overflow-hidden rounded-sm" style={{ maxWidth: height > width ? Math.round((176 * width) / height) : undefined }}>
      <div className="relative w-full overflow-hidden" style={style}>
        <Layout spec={spec} values={values} />
      </div>
    </div>
  )
}
