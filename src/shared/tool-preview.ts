/**
 * What a tool call looks like while the model is still writing it.
 *
 * The input arrives as JSON fragments that do not parse until the call is finished, and the one
 * worth watching is usually a single long string — a composition's HTML, a script, captions. So
 * this pulls that string out of the unfinished JSON and decodes what has arrived, and says in
 * one line what is being written and how much.
 */

/** The argument worth showing as it streams, per tool. Anything else shows its raw input. */
const STREAMED_FIELD: Record<string, string> = {
  write_composition: 'html',
  write_brf: 'code',
  apply_script: 'script',
  add_captions: 'srt'
}

export interface ToolPreview {
  /** "Writing story-cards.html · 12.4 KB" */
  label: string
  /** The end of what has arrived, decoded, for a small scrolling box. */
  tail: string
}

/**
 * The value of `"field": "…` in unfinished JSON, decoded as far as it has arrived. Null when the
 * field has not started. An escape cut off at the end of the fragment is dropped, not garbled.
 */
export function partialStringField(json: string, field: string): string | null {
  const open = new RegExp(`"${field}"\\s*:\\s*"`).exec(json)
  if (!open) return null
  let out = ''
  for (let i = open.index + open[0].length; i < json.length; i++) {
    const c = json[i]!
    if (c === '"') return out
    if (c !== '\\') {
      out += c
      continue
    }
    const next = json[i + 1]
    if (next === undefined) return out
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out
      out += String.fromCharCode(parseInt(hex, 16))
      i += 5
      continue
    }
    out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next
    i += 1
  }
  return out
}

function size(chars: number): string {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${chars} B`
}

export function toolPreview(tool: string, input: string, tailLines = 12): ToolPreview {
  const field = STREAMED_FIELD[tool]
  const body = field ? partialStringField(input, field) : null
  const path = partialStringField(input, 'path')
  const name = path ? path.split(/[\\/]/).pop() : null
  const shown = body ?? input
  const lines = shown.split('\n')
  return {
    label: `${name ? `Writing ${name}` : 'Writing'} · ${size(shown.length)}`,
    tail: lines.slice(-tailLines).join('\n')
  }
}
