/**
 * The grade pass: one clip's picture through WebGL2, returned as a canvas the compositor draws
 * exactly where it would have drawn the clip.
 *
 * **Why a GPU pass inside a Canvas 2D compositor.** A CSS filter cannot do lift/gamma/gain, a curve,
 * a 3D LUT, halation or grain. Rather than a second renderer that must match the first, the grade
 * is a *source transform*: the compositor hands this the element it was about to draw, gets back a
 * graded canvas of the same framing at the size it will appear, and draws that instead — with the
 * same geometry, alpha, fades, blend, CSS adjustments and rotation as before. So preview,
 * `preview_frame` and export still composite through one implementation, and the grade is part of
 * it rather than beside it.
 *
 * **Rendered at output resolution**, never at source resolution: grain and halation are measured in
 * timeline pixels and drawn in device pixels, so export's grain is native at the delivery size
 * (the brief's "grain after upscale") and the preview's is the same field seen smaller.
 *
 * **Halation is screened in RGB.** The ffmpeg version first screened on YUV planes and cast the
 * whole picture violet, because screening the chroma planes pushes U and V up together. Here every
 * operation is on RGB by construction; `test/app/grade.mjs` measures a white dot's falloff as
 * R > G > B to hold that.
 *
 * One WebGL context, shared by every compositor in the renderer (preview, `preview_frame`, export):
 * a draw is synchronous from upload to `drawImage`, so nothing can interleave, and Chromium caps a
 * page at ~16 live contexts — one per `renderFrame` call would exhaust that in a minute of agent use.
 */

import {
  decodeLutData,
  resolveGrade,
  type Grade,
  type LutData,
  type ResolvedGrade
} from '@shared/grade'

export type GradeSource = HTMLVideoElement | HTMLImageElement | ImageBitmap | OffscreenCanvas

export interface GradeRequest {
  source: GradeSource
  /** The part of the source to grade, in source pixels. */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Output size in device pixels — the size the result will be drawn at. */
  width: number
  height: number
  /** The drawn rectangle in timeline pixels: the unit grain size and halation radius are in. */
  boxWidth: number
  boxHeight: number
  /** Timeline frame, for grain. */
  frame: number
  seed: number
  /** The table behind `grade.lut`, when there is one. */
  lut?: LutData
}

export type GradeResult =
  | { ok: true; canvas: OffscreenCanvas; width: number; height: number; warning: string | null }
  | { ok: false; error: string }

const resolvedCache = new WeakMap<Grade, ResolvedGrade | null>()

/**
 * `resolveGrade`, memoised by object. Items are immutable in the store — an edit makes a new grade
 * object — so identity is a sound key, and the curve table is built once per edit, not per frame.
 */
export function resolvedGradeOf(grade: Grade | undefined): ResolvedGrade | null {
  if (!grade) return null
  if (resolvedCache.has(grade)) return resolvedCache.get(grade) ?? null
  const resolved = resolveGrade(grade)
  resolvedCache.set(grade, resolved)
  return resolved
}

/** Largest edge the pass will render. Past this the result is drawn scaled up, not refused. */
const MAX_EDGE = 4096

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_out;
void main() {
  // (0,0) is the top-left of the output, matching the source's row order.
  v_out = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

/**
 * Four modes in one program, so the colour arithmetic exists exactly once:
 *   0 — colour-correct the source into an intermediate (straight alpha), for halation to read
 *   1 — colour-correct the source and finish it (vignette, grain) straight to the output
 *   2 — finish from the intermediate, screening the blurred halation over it
 *   3 — extract the halation source from the intermediate, box-downsampled by u_down
 *   4 — one direction of the separable Gaussian
 */
const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 v_out;
out vec4 o;

uniform int u_mode;
uniform sampler2D u_src;
uniform vec4 u_srcRect;
uniform sampler2D u_graded;
uniform sampler2D u_halo;
uniform vec2 u_viewOrigin;
uniform vec2 u_viewSize;
uniform vec2 u_readSize;

uniform bool u_wbOn;
uniform vec3 u_wb;
uniform vec3 u_lift;
uniform vec3 u_gain;
uniform vec3 u_gammaExp;
uniform float u_sat;
uniform bool u_curves;
uniform sampler2D u_curve;
uniform bool u_lut;
uniform sampler3D u_lutTex;
uniform float u_lutSize;
uniform float u_lutIntensity;
uniform vec3 u_lutMin;
uniform vec3 u_lutMax;

uniform float u_halThreshold;
uniform float u_halAmount;
uniform vec3 u_halColor;
uniform int u_down;
uniform vec2 u_dir;
uniform float u_sigma;

uniform float u_vig;
uniform float u_grainAmount;
uniform float u_grainSize;
uniform uint u_frame;
uniform uint u_seed;
uniform vec2 u_boxSize;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

float curveAt(float x, int channel) {
  vec4 t = texture(u_curve, vec2(x * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5));
  return channel == 0 ? t.r : channel == 1 ? t.g : t.b;
}

vec3 colour(vec3 c) {
  if (u_wbOn) c = toSrgb(toLinear(c) * u_wb);
  c = u_gain * (c + u_lift * (1.0 - c));
  c = pow(max(c, 0.0), u_gammaExp);
  float l = dot(c, LUMA);
  c = clamp(mix(vec3(l), c, u_sat), 0.0, 1.0);
  if (u_curves) c = vec3(curveAt(c.r, 0), curveAt(c.g, 1), curveAt(c.b, 2));
  if (u_lut) {
    vec3 p = clamp((c - u_lutMin) / (u_lutMax - u_lutMin), 0.0, 1.0);
    vec3 coord = p * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
    c = mix(c, texture(u_lutTex, coord).rgb, u_lutIntensity);
  }
  return clamp(c, 0.0, 1.0);
}

// Must stay identical to grainHash in @shared/grade.
uint grainHash(uvec2 cell, uint frame, uint seed) {
  uint h = (cell.x * 0x5f356495u) ^ (cell.y * 0x2ff1c8b9u) ^ (frame * 0x6c8e9cf5u);
  h ^= seed;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}

vec4 sourceAt(vec2 uv) {
  return texture(u_src, u_srcRect.xy + uv * u_srcRect.zw);
}

void main() {
  vec2 fragUv = (gl_FragCoord.xy - u_viewOrigin) / u_viewSize;

  if (u_mode == 3) {
    // Box-average u_down x u_down full-resolution texels, so a highlight smaller than the
    // downsample still contributes rather than falling between taps.
    vec3 acc = vec3(0.0);
    vec2 base = floor(gl_FragCoord.xy) * float(u_down);
    for (int j = 0; j < 8; j++) {
      if (j >= u_down) break;
      for (int i = 0; i < 8; i++) {
        if (i >= u_down) break;
        vec4 g = texture(u_graded, (base + vec2(float(i), float(j)) + 0.5) / u_readSize);
        float m = max(g.r, max(g.g, g.b));
        float k = smoothstep(u_halThreshold, 1.0, m);
        acc += u_halColor * (k * m * g.a);
      }
    }
    o = vec4(acc / float(u_down * u_down), 1.0);
    return;
  }
  if (u_mode == 4) {
    vec3 acc = vec3(0.0);
    float total = 0.0;
    for (int i = -24; i <= 24; i++) {
      float x = float(i);
      if (abs(x) > ceil(u_sigma * 3.0)) continue;
      float w = exp(-(x * x) / (2.0 * u_sigma * u_sigma));
      acc += texture(u_halo, fragUv + u_dir * x).rgb * w;
      total += w;
    }
    o = vec4(acc / total, 1.0);
    return;
  }

  vec4 px;
  if (u_mode == 2) {
    px = texture(u_graded, fragUv);
  } else {
    px = sourceAt(v_out);
    px.rgb = colour(px.rgb);
  }
  if (u_mode == 0) {
    o = px;
    return;
  }
  vec3 c = px.rgb;
  if (u_mode == 2) {
    vec3 h = clamp(texture(u_halo, fragUv).rgb * u_halAmount, 0.0, 1.0);
    c = 1.0 - (1.0 - c) * (1.0 - h);
  }
  if (u_vig > 0.0) {
    float r = length((v_out - 0.5) * 2.0) / 1.41421356;
    c *= 1.0 - u_vig * smoothstep(0.35, 1.0, r);
  }
  if (u_grainAmount > 0.0) {
    uvec2 cell = uvec2(floor(v_out * u_boxSize / u_grainSize));
    uint h = grainHash(cell, u_frame, u_seed);
    float n = float((h & 0xffffu) + (h >> 16u)) / 131070.0 - 0.5;
    float l = dot(c, LUMA);
    // Film grain is strongest in the mids and weakest at the ends of the scale.
    c += n * u_grainAmount * 0.25 * (0.35 + 2.6 * l * (1.0 - l));
  }
  c = clamp(c, 0.0, 1.0);
  o = vec4(c * px.a, px.a);
}`

interface Target {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
}

class GradeContext {
  readonly canvas: OffscreenCanvas
  readonly gl: WebGL2RenderingContext
  readonly program: WebGLProgram
  readonly uniforms = new Map<string, WebGLUniformLocation | null>()
  readonly source: WebGLTexture
  readonly curve: WebGLTexture
  curveTable: Float32Array | null = null
  readonly luts = new Map<string, { data: string; texture: WebGLTexture; size: number }>()
  readonly targets = new Map<string, Target>()
  lost = false

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1)
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('this renderer has no WebGL2')
    this.gl = gl
    this.canvas.addEventListener('webglcontextlost', () => {
      this.lost = true
    })
    this.program = link(gl)
    gl.useProgram(this.program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const at = gl.getAttribLocation(this.program, 'a_pos')
    gl.enableVertexAttribArray(at)
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)

    this.source = texture2d(gl)
    this.curve = texture2d(gl)
    // Units are fixed per sampler for the life of the context.
    gl.uniform1i(this.u('u_src'), 0)
    gl.uniform1i(this.u('u_graded'), 1)
    gl.uniform1i(this.u('u_halo'), 2)
    gl.uniform1i(this.u('u_curve'), 3)
    gl.uniform1i(this.u('u_lutTex'), 4)
    gl.disable(gl.BLEND)
  }

  u(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name))
    return this.uniforms.get(name) ?? null
  }

  /** An intermediate render target of exactly this size, reused across frames. */
  target(key: string, width: number, height: number, filter: number): Target {
    const gl = this.gl
    const existing = this.targets.get(key)
    if (existing && existing.width === width && existing.height === height) return existing
    if (existing) {
      gl.deleteTexture(existing.texture)
      gl.deleteFramebuffer(existing.framebuffer)
    }
    const texture = gl.createTexture() as WebGLTexture
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const framebuffer = gl.createFramebuffer() as WebGLFramebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    // Creating it bound it to whichever unit was active, and a target left bound for reading is a
    // feedback loop the moment it is drawn into: the first halation draw of every new size failed
    // with INVALID_OPERATION until this unbind (measured in test/app/grade.mjs, frame 5).
    gl.bindTexture(gl.TEXTURE_2D, null)
    const made = { texture, framebuffer, width, height }
    this.targets.set(key, made)
    return made
  }

  lutTexture(assetId: string, lut: LutData): { texture: WebGLTexture; size: number } | null {
    const cached = this.luts.get(assetId)
    // Keyed by the payload string too: re-importing a .cube under the same asset id must not
    // leave the old table on the GPU. Comparing a string reference is O(1) when it is unchanged.
    if (cached && cached.data === lut.data) return cached
    const values = decodeLutData(lut)
    if (!values) return null
    const gl = this.gl
    const texture = cached?.texture ?? (gl.createTexture() as WebGLTexture)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_3D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, values)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    const entry = { data: lut.data, texture, size: lut.size }
    this.luts.set(assetId, entry)
    return entry
  }
}

function texture2d(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture() as WebGLTexture
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const compile = (type: number, text: string): WebGLShader => {
    const shader = gl.createShader(type) as WebGLShader
    gl.shaderSource(shader, text)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`grade shader: ${gl.getShaderInfoLog(shader) ?? 'did not compile'}`)
    }
    return shader
  }
  const program = gl.createProgram() as WebGLProgram
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`grade program: ${gl.getProgramInfoLog(program) ?? 'did not link'}`)
  }
  return program
}

let shared: GradeContext | null = null
let unavailable: string | null = null

function context(): GradeContext | { error: string } {
  if (shared && !shared.lost) return shared
  if (unavailable) return { error: unavailable }
  try {
    shared = new GradeContext()
    return shared
  } catch (error) {
    // Remembered, so a renderer without WebGL2 reports once per draw rather than retrying the
    // context creation (which is slow) every frame.
    unavailable = error instanceof Error ? error.message : String(error)
    return { error: unavailable }
  }
}

/**
 * Grades one source. Never throws: a clip whose grade cannot run is drawn ungraded by the caller,
 * which reports it, rather than taking the frame down.
 */
export function gradeSource(resolved: ResolvedGrade, request: GradeRequest): GradeResult {
  const ctx = context()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const gl = ctx.gl
  const scale = Math.min(1, MAX_EDGE / Math.max(request.width, request.height))
  const width = Math.max(1, Math.round(request.width * scale))
  const height = Math.max(1, Math.round(request.height * scale))
  const sourceWidth = intrinsic(request.source, 'width')
  const sourceHeight = intrinsic(request.source, 'height')
  if (sourceWidth <= 0 || sourceHeight <= 0) return { ok: false, error: 'the source has no pixels yet' }

  // The drawing buffer only grows: a preview with two graded clips of different sizes would
  // otherwise reallocate it twice a frame. The result is read from its top-left corner.
  if (ctx.canvas.width < width || ctx.canvas.height < height) {
    ctx.canvas.width = Math.max(ctx.canvas.width, width)
    ctx.canvas.height = Math.max(ctx.canvas.height, height)
  }
  const canvasHeight = ctx.canvas.height

  let warning: string | null = null
  try {
    gl.useProgram(ctx.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, ctx.source)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, request.source as TexImageSource)
    gl.uniform4f(
      ctx.u('u_srcRect'),
      request.sx / sourceWidth,
      request.sy / sourceHeight,
      request.sw / sourceWidth,
      request.sh / sourceHeight
    )

    // -- colour uniforms ------------------------------------------------------
    const wbOn = resolved.whiteBalance.some((v) => Math.abs(v - 1) > 1e-6)
    gl.uniform1i(ctx.u('u_wbOn'), wbOn ? 1 : 0)
    gl.uniform3fv(ctx.u('u_wb'), resolved.whiteBalance)
    gl.uniform3fv(ctx.u('u_lift'), resolved.lift)
    gl.uniform3fv(ctx.u('u_gain'), resolved.gain)
    gl.uniform3fv(ctx.u('u_gammaExp'), resolved.gammaExponent)
    gl.uniform1f(ctx.u('u_sat'), resolved.saturation)

    gl.uniform1i(ctx.u('u_curves'), resolved.curveTable ? 1 : 0)
    if (resolved.curveTable && resolved.curveTable !== ctx.curveTable) {
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, ctx.curve)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, resolved.curveTable.length / 4, 1, 0, gl.RGBA, gl.FLOAT, resolved.curveTable)
      ctx.curveTable = resolved.curveTable
    }

    let lutOn = false
    if (resolved.lut) {
      const table = request.lut ? ctx.lutTexture(resolved.lut.assetId, request.lut) : null
      if (table && request.lut) {
        gl.activeTexture(gl.TEXTURE4)
        gl.bindTexture(gl.TEXTURE_3D, table.texture)
        gl.uniform1f(ctx.u('u_lutSize'), table.size)
        gl.uniform1f(ctx.u('u_lutIntensity'), resolved.lut.intensity)
        gl.uniform3fv(ctx.u('u_lutMin'), request.lut.domainMin)
        gl.uniform3fv(ctx.u('u_lutMax'), request.lut.domainMax)
        lutOn = true
      } else {
        warning = 'its LUT asset is missing or unreadable, so the LUT was skipped'
      }
    }
    gl.uniform1i(ctx.u('u_lut'), lutOn ? 1 : 0)

    // -- finishing uniforms -----------------------------------------------------
    const deviceScale = width / Math.max(1e-6, request.boxWidth)
    gl.uniform1f(ctx.u('u_vig'), resolved.vignette?.amount ?? 0)
    gl.uniform1f(ctx.u('u_grainAmount'), resolved.grain?.amount ?? 0)
    gl.uniform1f(ctx.u('u_grainSize'), resolved.grain?.size ?? 1)
    gl.uniform1ui(ctx.u('u_frame'), Math.max(0, Math.round(request.frame)) >>> 0)
    gl.uniform1ui(ctx.u('u_seed'), request.seed >>> 0)
    gl.uniform2f(ctx.u('u_boxSize'), request.boxWidth, request.boxHeight)

    const toOutput = (): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      // The top-left `width x height` of the drawing buffer, which is what drawImage reads.
      gl.viewport(0, canvasHeight - height, width, height)
      gl.uniform2f(ctx.u('u_viewOrigin'), 0, canvasHeight - height)
      gl.uniform2f(ctx.u('u_viewSize'), width, height)
    }

    if (!resolved.halation) {
      toOutput()
      gl.uniform1i(ctx.u('u_mode'), 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    } else {
      const halation = resolved.halation
      // Nothing an intermediate is about to be written from may still be bound for reading from
      // the last frame: WebGL refuses a draw whose program *could* sample its own target, whether
      // or not this mode's branch does.
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, null)
      // 0: graded, full size.
      const graded = ctx.target('graded', width, height, gl.LINEAR)
      gl.bindFramebuffer(gl.FRAMEBUFFER, graded.framebuffer)
      gl.viewport(0, 0, width, height)
      gl.uniform2f(ctx.u('u_viewOrigin'), 0, 0)
      gl.uniform2f(ctx.u('u_viewSize'), width, height)
      gl.uniform1i(ctx.u('u_mode'), 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 3: extract, downsampled so the blur's kernel stays within 24 taps a side.
      const sigmaDevice = halation.radius * deviceScale
      const down = Math.min(8, Math.max(1, Math.ceil(sigmaDevice / 8)))
      const sigma = Math.max(0.5, Math.min(8, sigmaDevice / down))
      const hw = Math.max(1, Math.ceil(width / down))
      const hh = Math.max(1, Math.ceil(height / down))
      const a = ctx.target('haloA', hw, hh, gl.LINEAR)
      const b = ctx.target('haloB', hw, hh, gl.LINEAR)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, graded.texture)
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer)
      gl.viewport(0, 0, hw, hh)
      gl.uniform2f(ctx.u('u_viewOrigin'), 0, 0)
      gl.uniform2f(ctx.u('u_viewSize'), hw, hh)
      gl.uniform2f(ctx.u('u_readSize'), width, height)
      gl.uniform1i(ctx.u('u_down'), down)
      gl.uniform1f(ctx.u('u_halThreshold'), halation.threshold)
      gl.uniform3fv(ctx.u('u_halColor'), halation.color)
      gl.uniform1i(ctx.u('u_mode'), 3)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 4: blur horizontally into b, then vertically back into a.
      gl.uniform1f(ctx.u('u_sigma'), sigma)
      gl.uniform1i(ctx.u('u_mode'), 4)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, a.texture)
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.framebuffer)
      gl.uniform2f(ctx.u('u_dir'), 1 / hw, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindTexture(gl.TEXTURE_2D, b.texture)
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer)
      gl.uniform2f(ctx.u('u_dir'), 0, 1 / hh)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 2: finish from the graded intermediate with the glow screened over it.
      gl.bindTexture(gl.TEXTURE_2D, a.texture)
      gl.uniform1f(ctx.u('u_halAmount'), halation.amount)
      toOutput()
      gl.uniform1i(ctx.u('u_mode'), 2)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const error = gl.getError()
    if (error !== gl.NO_ERROR) return { ok: false, error: `WebGL error ${error}` }
  } catch (error) {
    // Most often a SecurityError uploading a source that is not CORS-clean, or a context lost
    // mid-draw. Either way the caller draws the clip ungraded and says so.
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, canvas: ctx.canvas, width, height, warning }
}

function intrinsic(source: GradeSource, axis: 'width' | 'height'): number {
  if (source instanceof HTMLVideoElement) return axis === 'width' ? source.videoWidth : source.videoHeight
  if (source instanceof HTMLImageElement) return axis === 'width' ? source.naturalWidth : source.naturalHeight
  return source[axis]
}
