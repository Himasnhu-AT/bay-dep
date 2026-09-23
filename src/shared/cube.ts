/**
 * Reading an Adobe/Resolve `.cube` 3D LUT.
 *
 * Main parses — the renderer never touches the filesystem — and the result travels on a
 * `kind: 'lut'` asset (`Asset.lut`, see `@shared/grade`). Pure, so it is tested without Electron.
 *
 * Every refusal names the line and says what would fix it, because the person reading it is
 * usually an agent that picked a file by name and needs to know whether to pick another.
 */

export interface ParsedCube {
  size: number
  title: string | null
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /** `size³` RGB triples, red fastest — the file's own order. */
  values: Float32Array
  /** How many values lay outside 0..1 and will be clamped by the 16-bit store. */
  outOfRange: number
}

/** 2..65 covers every LUT any grading tool writes; 65³ is already 824k values. */
export const MAX_CUBE_SIZE = 65

export type CubeResult = { ok: true; cube: ParsedCube } | { ok: false; error: string }

function triple(parts: string[]): [number, number, number] | null {
  if (parts.length !== 3) return null
  const n = parts.map(Number)
  return n.every((v) => Number.isFinite(v)) ? (n as [number, number, number]) : null
}

export function parseCube(text: string): CubeResult {
  const lines = text.split(/\r\n|\n|\r/)
  let size: number | null = null
  let title: string | null = null
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  let values: Float32Array | null = null
  let count = 0
  let outOfRange = 0

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1
    const line = (lines[index] ?? '').replace(/#.*$/, '').trim()
    if (line === '') continue
    const parts = line.split(/\s+/)
    const keyword = (parts[0] ?? '').toUpperCase()

    if (keyword === 'TITLE') {
      title = line.slice(5).trim().replace(/^"(.*)"$/, '$1') || null
      continue
    }
    if (keyword === 'LUT_1D_SIZE') {
      return {
        ok: false,
        error: `line ${lineNo}: this is a 1D LUT (LUT_1D_SIZE). bay applies 3D LUTs only — export the look as a 3D .cube (LUT_3D_SIZE 33 is standard).`
      }
    }
    if (keyword === 'LUT_3D_SIZE') {
      if (values !== null) return { ok: false, error: `line ${lineNo}: LUT_3D_SIZE appears twice.` }
      const n = Number(parts[1])
      if (parts.length !== 2 || !Number.isInteger(n) || n < 2 || n > MAX_CUBE_SIZE) {
        return {
          ok: false,
          error: `line ${lineNo}: LUT_3D_SIZE must be a whole number from 2 to ${MAX_CUBE_SIZE}; got "${parts.slice(1).join(' ')}".`
        }
      }
      size = n
      values = new Float32Array(n * n * n * 3)
      continue
    }
    if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
      const t = triple(parts.slice(1))
      if (!t) return { ok: false, error: `line ${lineNo}: ${keyword} needs three numbers.` }
      if (keyword === 'DOMAIN_MIN') domainMin = t
      else domainMax = t
      continue
    }
    if (keyword === 'LUT_3D_INPUT_RANGE') {
      // Resolve's spelling of a uniform domain.
      const lo = Number(parts[1])
      const hi = Number(parts[2])
      if (parts.length !== 3 || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        return { ok: false, error: `line ${lineNo}: LUT_3D_INPUT_RANGE needs two numbers.` }
      }
      domainMin = [lo, lo, lo]
      domainMax = [hi, hi, hi]
      continue
    }

    // Anything else must be a data row, and data only makes sense after the size.
    const t = triple(parts)
    if (!t) {
      if (parts.some((part) => /^[-+]?(nan|inf|infinity)$/i.test(part))) {
        return { ok: false, error: `line ${lineNo}: "${line.slice(0, 60)}" holds a value that is not a finite number.` }
      }
      if (/^[A-Z_][A-Z0-9_]*$/.test(keyword) && !/^[-+.\d]/.test(parts[0] ?? '')) {
        // An unknown keyword (LUT_IN_VIDEO_RANGE and friends). Ignored rather than refused: the
        // format lets writers add their own, and none of them change what the table means here.
        continue
      }
      return {
        ok: false,
        error: `line ${lineNo}: expected three numbers (an R G B row), got "${line.slice(0, 60)}".`
      }
    }
    if (!values || size === null) {
      return { ok: false, error: `line ${lineNo}: a data row comes before LUT_3D_SIZE, so the table has no size.` }
    }
    if (count >= size ** 3) {
      return { ok: false, error: `line ${lineNo}: more rows than LUT_3D_SIZE ${size} allows (${size ** 3}).` }
    }
    for (let c = 0; c < 3; c += 1) {
      const v = t[c] as number
      if (v < 0 || v > 1) outOfRange += 1
      values[count * 3 + c] = v
    }
    count += 1
  }

  if (size === null || !values) {
    return { ok: false, error: 'no LUT_3D_SIZE line, so this is not a 3D .cube LUT.' }
  }
  if (count !== size ** 3) {
    return {
      ok: false,
      error: `the table has ${count} rows but LUT_3D_SIZE ${size} needs ${size ** 3}. The file is truncated or its size line is wrong.`
    }
  }
  for (let c = 0; c < 3; c += 1) {
    if (!((domainMax[c] as number) > (domainMin[c] as number))) {
      return { ok: false, error: 'DOMAIN_MAX must be greater than DOMAIN_MIN on every channel.' }
    }
  }
  return { ok: true, cube: { size, title, domainMin, domainMax, values, outOfRange } }
}

/** The identity `.cube` of a given size — for tests and as a worked example of the format. */
export function identityCube(size: number): string {
  const rows: string[] = [`LUT_3D_SIZE ${size}`]
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        rows.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`)
      }
    }
  }
  return rows.join('\n')
}

/** Samples a parsed cube at an RGB, trilinearly — the reference the shader's 3D texture must match. */
export function sampleCube(cube: Pick<ParsedCube, 'size' | 'values' | 'domainMin' | 'domainMax'>, rgb: [number, number, number]): [number, number, number] {
  const n = cube.size
  const pos = rgb.map((v, c) => {
    const lo = cube.domainMin[c] as number
    const hi = cube.domainMax[c] as number
    return Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * (n - 1)
  }) as [number, number, number]
  const i0 = pos.map((p) => Math.min(n - 2, Math.floor(p)))
  const f = pos.map((p, k) => p - (i0[k] as number))
  const at = (r: number, g: number, b: number, c: number): number =>
    cube.values[((b * n + g) * n + r) * 3 + c] as number
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c += 1) {
    let acc = 0
    for (let corner = 0; corner < 8; corner += 1) {
      const dr = corner & 1
      const dg = (corner >> 1) & 1
      const db = (corner >> 2) & 1
      const w =
        (dr ? (f[0] as number) : 1 - (f[0] as number)) *
        (dg ? (f[1] as number) : 1 - (f[1] as number)) *
        (db ? (f[2] as number) : 1 - (f[2] as number))
      acc += w * at((i0[0] as number) + dr, (i0[1] as number) + dg, (i0[2] as number) + db, c)
    }
    out[c] = acc
  }
  return out
}
