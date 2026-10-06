/**
 * The effect pass: one clip's picture through its effect stack, returned as a canvas the
 * compositor draws exactly where it would have drawn the clip.
 *
 * Built the way the grade is (`grade.ts`), and in its slot: a *source transform* inside
 * `#drawSource`, not a second renderer. The compositor hands this the element it was about to draw
 * and the clip's resolved stack, gets back a picture of the same framing at the size it will
 * appear, and draws that with the same geometry, alpha, fades, blend, CSS adjustments and rotation
 * as before — so the preview, `preview_frame` and export run one implementation, and what an
 * effect does at frame N is the same in all three.
 *
 * **Order.** grade → effects, first to last → subject mask → adjustments and blend. With a grade,
 * the grade pass draws into a render target instead of the canvas (`GradeRequest.into`) and the
 * stack starts from that; without one it starts from the source itself.
 *
 * **It shares the grade's WebGL context** (Chromium caps a page at ~16, and one per effect would
 * spend them in a minute), with programs, a vertex array and scratch targets of its own. Sharing
 * a context is sharing its state, so the rules, each from a fault the grade already hit:
 * - Texture units 0 and 1 only. The grade keeps its curve and LUT on 3 and 4 and re-binds them
 *   only when they change, so a pass that bound there would be drawn through by the next grade.
 * - `target()` binds on the active unit and unbinds it; unit 0 is made active before every call.
 * - A target is never bound for reading while it is drawn into: every pass binds both its inputs
 *   (or null) before drawing, and both units are unbound at the end, so the next grade — whose
 *   program *could* sample units 1 and 2 — never finds one of these targets still attached.
 * - The vertex array is this file's own and unbound afterwards; the grade draws with the default.
 *
 * **A stack that cannot run is reported, never skipped silently.** A shader that does not
 * compile, a context that is lost, a source that taints: the result is `ok: false` with why, the
 * compositor draws the clip without its effects and records it beside failed grades
 * (`DrawStats.gradeIssues`), and an export that wrote such a frame does not finish clean.
 */

import { resolveEffects, type ResolvedEffect, type ResolvedStack } from '@shared/effects/resolve'
import type { Effect } from '@shared/effects/spec'
import type { ResolvedGrade } from '@shared/grade'
import { EFFECT_PASSES, EFFECT_VERTEX, effectFragment, type PassInput, type UniformValue } from './effectShaders'
import { gradeSource, intrinsic, passSize, sharedGl, type GradeRequest, type SharedGl, type Target } from './grade'

export interface EffectsRequest extends Omit<GradeRequest, 'into'> {
  /** The clip's resolved grade, run first. Null or absent starts the stack from the source. */
  grade?: ResolvedGrade | null
}

export type EffectsResult =
  | {
      ok: true
      canvas: OffscreenCanvas
      width: number
      height: number
      /** What was not as asked although the effects ran: the grade under them failed or skipped its LUT. */
      warnings: string[]
    }
  | { ok: false; error: string }

const stackCache = new WeakMap<readonly Effect[], ResolvedStack | null>()

/**
 * `resolveEffects`, memoised by array. Items are immutable in the store — an edit makes a new
 * `effects` array — so identity is a sound key and the stack is resolved once per edit, not per
 * frame. Null means there is nothing to draw and nothing to report: the plain draw path.
 */
export function resolvedEffectsOf(effects: readonly Effect[] | undefined): ResolvedStack | null {
  if (!effects) return null
  if (stackCache.has(effects)) return stackCache.get(effects) ?? null
  const resolved = resolveEffects(effects)
  stackCache.set(effects, resolved)
  return resolved
}

interface Program {
  program: WebGLProgram
  uniforms: Map<string, WebGLUniformLocation | null>
}

interface State {
  vao: WebGLVertexArrayObject
  source: WebGLTexture
  /** A program, or the reason it could not be built — kept, so a bad shader is not recompiled every frame. */
  programs: Map<string, Program | string>
}

/** Per context: a lost context is replaced by a new one, and nothing made in the old one is valid in it. */
const states = new WeakMap<WebGL2RenderingContext, State>()

function stateFor(gl: WebGL2RenderingContext): State {
  const existing = states.get(gl)
  if (existing) return existing
  const vao = gl.createVertexArray() as WebGLVertexArrayObject
  gl.bindVertexArray(vao)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  gl.activeTexture(gl.TEXTURE0)
  const source = gl.createTexture() as WebGLTexture
  gl.bindTexture(gl.TEXTURE_2D, source)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_2D, null)

  const made: State = { vao, source, programs: new Map() }
  states.set(gl, made)
  return made
}

function build(gl: WebGL2RenderingContext, name: string): Program | string {
  const fragment = effectFragment(name)
  if (fragment === null) return `there is no shader "${name}"`
  const compile = (type: number, text: string): WebGLShader | string => {
    const shader = gl.createShader(type)
    if (!shader) return 'the context is lost'
    gl.shaderSource(shader, text)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'did not compile'
      gl.deleteShader(shader)
      return log.trim()
    }
    return shader
  }
  const vertex = compile(gl.VERTEX_SHADER, EFFECT_VERTEX)
  if (typeof vertex === 'string') return `the ${name} shader did not compile: ${vertex}`
  const frag = compile(gl.FRAGMENT_SHADER, fragment)
  if (typeof frag === 'string') return `the ${name} shader did not compile: ${frag}`
  const program = gl.createProgram() as WebGLProgram
  gl.attachShader(program, vertex)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return `the ${name} shader did not link: ${(gl.getProgramInfoLog(program) ?? '').trim()}`
  }
  gl.useProgram(program)
  // Units are fixed per sampler for the life of the program.
  gl.uniform1i(gl.getUniformLocation(program, 'u_in'), 0)
  gl.uniform1i(gl.getUniformLocation(program, 'u_aux'), 1)
  return { program, uniforms: new Map() }
}

function programFor(gl: WebGL2RenderingContext, state: State, name: string): Program {
  let entry = state.programs.get(name)
  if (entry === undefined) {
    entry = build(gl, name)
    state.programs.set(name, entry)
  }
  if (typeof entry === 'string') throw new Error(entry)
  return entry
}

function location(gl: WebGL2RenderingContext, program: Program, name: string): WebGLUniformLocation | null {
  if (!program.uniforms.has(name)) program.uniforms.set(name, gl.getUniformLocation(program.program, name))
  return program.uniforms.get(name) ?? null
}

function setUniform(gl: WebGL2RenderingContext, program: Program, name: string, value: UniformValue): void {
  const at = location(gl, program, name)
  if (typeof value === 'number') gl.uniform1f(at, value)
  else if (value.length === 2) gl.uniform2f(at, value[0] ?? 0, value[1] ?? 0)
  else if (value.length === 3) gl.uniform3f(at, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
  else gl.uniform4f(at, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0)
}

/** A picture a pass can read: its texture, how image space maps onto it, and half a texel of it. */
interface Picture {
  texture: WebGLTexture
  map: [number, number, number, number]
  half: [number, number]
  /** The ping-pong target it lives in, when it is one. */
  key?: string
}

/** A render target as a picture: its rows are bottom-up, so image space is flipped onto it. */
function targetPicture(target: Target, key?: string): Picture {
  return { texture: target.texture, map: [0, 1, 1, -1], half: [0.5 / target.width, 0.5 / target.height], key }
}

/**
 * Draws `stack` over the request's source. Never throws: a stack that cannot run is `ok: false`
 * with the reason, and the caller draws the clip without it and says so.
 */
export function drawEffects(stack: readonly ResolvedEffect[], request: EffectsRequest): EffectsResult {
  const shared = sharedGl()
  if ('error' in shared) return { ok: false, error: shared.error }
  if (stack.length === 0) return { ok: false, error: 'there are no effects to draw' }
  const sourceWidth = intrinsic(request.source, 'width')
  const sourceHeight = intrinsic(request.source, 'height')
  if (sourceWidth <= 0 || sourceHeight <= 0) return { ok: false, error: 'the source has no pixels yet' }
  const { width, height } = passSize(request.width, request.height)
  const gl = shared.gl
  const warnings: string[] = []
  try {
    return run(shared, stack, request, { width, height, sourceWidth, sourceHeight }, warnings)
  } catch (error) {
    // A shader that would not build, a SecurityError uploading a source that is not CORS-clean,
    // or a context lost mid-draw.
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    // Leave the context as the grade expects to find it (the rules at the top of this file).
    try {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.bindVertexArray(null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    } catch {
      // A lost context refuses these too; the result above already says what happened.
    }
  }
}

function run(
  shared: SharedGl,
  stack: readonly ResolvedEffect[],
  request: EffectsRequest,
  size: { width: number; height: number; sourceWidth: number; sourceHeight: number },
  warnings: string[]
): EffectsResult {
  const { gl, canvas } = shared
  const { width, height } = size
  const { grade: resolvedGrade, ...gradeRequest } = request

  // The input: the graded picture in a target, or the source uploaded premultiplied.
  let current: Picture | null = null
  if (resolvedGrade) {
    const graded = gradeSource(resolvedGrade, { ...gradeRequest, into: 'fxBase' })
    if (graded.ok && graded.target) {
      if (graded.warning) warnings.push(graded.warning)
      current = targetPicture(graded.target)
    } else if (!graded.ok) {
      warnings.push(`it was drawn ungraded: ${graded.error}`)
    }
  }

  // The drawing buffer only grows, as in the grade; the result is read from its top-left corner.
  if (canvas.width < width || canvas.height < height) {
    canvas.width = Math.max(canvas.width, width)
    canvas.height = Math.max(canvas.height, height)
  }
  const canvasHeight = canvas.height

  const state = stateFor(gl)
  gl.bindVertexArray(state.vao)
  gl.disable(gl.BLEND)
  if (!current) {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, state.source)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, request.source as TexImageSource)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    current = {
      texture: state.source,
      map: [
        request.sx / size.sourceWidth,
        request.sy / size.sourceHeight,
        request.sw / size.sourceWidth,
        request.sh / size.sourceHeight
      ],
      half: [0.5 / Math.max(1, request.sw), 0.5 / Math.max(1, request.sh)]
    }
  }

  const env = {
    width,
    height,
    scale: width / Math.max(1e-6, request.boxWidth),
    frame: request.frame
  }

  for (let index = 0; index < stack.length; index += 1) {
    const effect = stack[index] as ResolvedEffect
    const plan = EFFECT_PASSES[effect.kind]
    if (!plan) throw new Error(`there is no shader for the ${effect.kind} effect`)
    const last = index === stack.length - 1
    const input: Picture = current
    const scratch = new Map<string, Picture>()
    const read = (from: PassInput): Picture => {
      if (from === 'current') return input
      const picture = scratch.get(from)
      if (!picture) throw new Error(`the ${effect.kind} effect reads "${from}" before drawing it`)
      return picture
    }

    for (const step of plan(effect.params, env)) {
      const program = programFor(gl, state, step.program)
      // The output first: making a target binds and unbinds unit 0, which the inputs then take.
      gl.activeTexture(gl.TEXTURE0)
      let framebuffer: WebGLFramebuffer | null = null
      let viewport: [number, number, number, number] = [0, canvasHeight - height, width, height]
      let produced: Picture | null = null
      let scratchName: string | null = null
      if (step.output !== 'result') {
        const target = shared.target(step.output.scratch, step.output.width, step.output.height, gl.LINEAR)
        framebuffer = target.framebuffer
        viewport = [0, 0, target.width, target.height]
        produced = targetPicture(target)
        scratchName = step.output.scratch
      } else if (!last) {
        const key = input.key === 'fxA' ? 'fxB' : 'fxA'
        const target = shared.target(key, width, height, gl.LINEAR)
        framebuffer = target.framebuffer
        viewport = [0, 0, width, height]
        produced = targetPicture(target, key)
      }

      const main = read(step.input)
      const aux = step.aux ? read(step.aux) : null
      gl.useProgram(program.program)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, aux ? aux.texture : null)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, main.texture)
      setUniform(gl, program, 'u_map', main.map)
      setUniform(gl, program, 'u_half', main.half)
      if (aux) {
        setUniform(gl, program, 'u_auxMap', aux.map)
        setUniform(gl, program, 'u_auxHalf', aux.half)
      }
      setUniform(gl, program, 'u_px', [1 / width, 1 / height])
      for (const [name, value] of Object.entries(step.uniforms)) setUniform(gl, program, name, value)

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.viewport(...viewport)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (scratchName && produced) scratch.set(scratchName, produced)
      else if (produced) current = produced
    }
  }

  const error = gl.getError()
  if (error !== gl.NO_ERROR) return { ok: false, error: `WebGL error ${error}` }
  return { ok: true, canvas, width, height, warnings }
}
