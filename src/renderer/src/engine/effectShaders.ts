/**
 * The effect catalog's shaders, and for each effect the passes it draws with them.
 *
 * Data and arithmetic only — nothing here touches WebGL — so the catalog/shader pairing, the
 * uniforms each pass is handed and the plan for a multi-pass effect are tested under Node
 * (`effectShaders.test.ts`). `effects.ts` compiles and runs them.
 *
 * **Conventions every fragment relies on.**
 * - Coordinates are *image space*: `v_uv` is 0..1 across the clip's picture with (0,0) at its
 *   top-left, whatever is being drawn into. `S(p)` reads the pass's input there and `A(p)` its
 *   second input; each maps image space onto its own texture (the source is uploaded top row
 *   first, a render target is the other way up) and clamps to the picture's edge, so a blur at the
 *   border repeats the border rather than reading outside a crop.
 * - Colour is **premultiplied** in every texture. A pass that changes colour divides the alpha out
 *   (`straight`) and multiplies it back; a pass that only moves or averages pixels works on the
 *   premultiplied values directly, which is what makes a blur across a keyed edge correct.
 * - Lengths arrive in device pixels: the plan multiplies a parameter in timeline pixels by
 *   `env.scale`, and a fragment multiplies device pixels by `u_px` to get image space. So one
 *   stored number is the same share of the picture in the preview and at export size.
 * - No fragment reads a clock or a random source. The one effect that changes over time takes the
 *   timeline frame as a uniform (`glitch`), through the hash the grade's grain uses.
 *
 * Each block that makes a decision names the function in `@shared/effects/math` it is written
 * from; the two must stay the same arithmetic.
 */

import { flag, num, point, rgb, type ResolvedParams } from '@shared/effects/spec'
import { blurPlan, GLITCH_MAX_SHIFT, MIN_KEY_SOFTNESS, SMEAR_TAPS } from '@shared/effects/math'

export const EFFECT_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const HEADER = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_in;
uniform vec4 u_map;
uniform vec2 u_half;
uniform sampler2D u_aux;
uniform vec4 u_auxMap;
uniform vec2 u_auxHalf;
uniform vec2 u_px;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec4 S(vec2 p) {
  p = clamp(p, u_half, 1.0 - u_half);
  return texture(u_in, u_map.xy + p * u_map.zw);
}
vec4 A(vec2 p) {
  p = clamp(p, u_auxHalf, 1.0 - u_auxHalf);
  return texture(u_aux, u_auxMap.xy + p * u_auxMap.zw);
}
vec3 straight(vec4 c) {
  return c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
}
`

const SMEAR = `${SMEAR_TAPS}`

/** Fragment bodies by program name. Several effects share `gauss`. */
const BODIES: Record<string, string> = {
  'directional-blur': `
uniform vec2 u_dir;
uniform float u_len;
void main() {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${SMEAR}; i++) {
    float t = (float(i) + 0.5) / ${SMEAR}.0 - 0.5;
    acc += S(v_uv + u_dir * (t * u_len) * u_px);
  }
  o = acc / ${SMEAR}.0;
}`,

  'zoom-blur': `
uniform vec2 u_centre;
uniform float u_amount;
void main() {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${SMEAR}; i++) {
    float t = (float(i) + 0.5) / ${SMEAR}.0;
    acc += S(u_centre + (v_uv - u_centre) * (1.0 - u_amount * t));
  }
  o = acc / ${SMEAR}.0;
}`,

  // sharpenKernel: pixel + amount * (pixel - soft), soft being SOFT_KERNEL (1 2 1 / 2 4 2 / 1 2 1, over 16).
  sharpen: `
uniform float u_amount;
uniform float u_radius;
void main() {
  vec2 d = u_radius * u_px;
  vec4 c = S(v_uv);
  vec4 axial = S(v_uv + vec2(d.x, 0.0)) + S(v_uv - vec2(d.x, 0.0)) + S(v_uv + vec2(0.0, d.y)) + S(v_uv - vec2(0.0, d.y));
  vec4 diagonal = S(v_uv + d) + S(v_uv - d) + S(v_uv + vec2(d.x, -d.y)) + S(v_uv + vec2(-d.x, d.y));
  vec4 soft = (c * 4.0 + axial * 2.0 + diagonal) / 16.0;
  vec3 sharp = c.rgb + u_amount * (c.rgb - soft.rgb);
  o = vec4(clamp(sharp, 0.0, c.a), c.a);
}`,

  // What glows: each pixel weighted by how far its brightest channel is past the threshold,
  // box-averaged over the u_down x u_down device pixels this texel stands for, so a highlight
  // smaller than the shrink still contributes.
  'glow-bright': `
uniform float u_down;
uniform float u_threshold;
uniform vec3 u_tint;
uniform vec2 u_outPx;
void main() {
  vec4 acc = vec4(0.0);
  int n = int(u_down);
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      vec4 c = S(v_uv + ((vec2(float(i), float(j)) + 0.5) / u_down - 0.5) * u_outPx);
      vec3 s = straight(c);
      float k = smoothstep(u_threshold, 1.0, max(s.r, max(s.g, s.b)));
      acc += vec4(c.rgb * u_tint, c.a) * k;
    }
  }
  o = acc / (u_down * u_down);
}`,

  // gaussianWeights: exp(-x^2 / 2 sigma^2), cut at three sigma, normalised.
  gauss: `
uniform vec2 u_step;
uniform float u_sigma;
void main() {
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i);
    if (abs(x) > ceil(u_sigma * 3.0)) continue;
    float w = exp(-(x * x) / (2.0 * u_sigma * u_sigma));
    acc += S(v_uv + u_step * x) * w;
    total += w;
  }
  o = acc / total;
}`,

  // Screened, alpha included: light added over the picture, and past its edge where it is transparent.
  'glow-composite': `
uniform float u_amount;
void main() {
  vec4 base = S(v_uv);
  vec4 glow = clamp(A(v_uv) * u_amount, 0.0, 1.0);
  o = base + glow * (1.0 - base);
}`,

  'chromatic-aberration': `
uniform float u_amount;
uniform vec2 u_dir;
uniform float u_radial;
void main() {
  vec2 v = (u_radial > 0.5 ? (v_uv - 0.5) * 2.0 : u_dir) * u_amount * u_px;
  vec4 r = S(v_uv + v);
  vec4 g = S(v_uv);
  vec4 b = S(v_uv - v);
  o = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,

  // pixelCell picks the block; the block is the average of a 4 x 4 grid across it, so it does not
  // flicker with the one pixel at its centre.
  pixelate: `
uniform vec2 u_cell;
void main() {
  vec2 base = floor(v_uv / u_cell) * u_cell;
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      acc += S(base + (vec2(float(i), float(j)) + 0.5) / 4.0 * u_cell);
    }
  }
  o = acc / 16.0;
}`,

  // glitchBand. grainHash must stay identical to grainHash in @shared/grade.
  glitch: `
uniform float u_amount;
uniform float u_band;
uniform float u_step;
uniform float u_seed;
uniform float u_split;
uint grainHash(uvec2 cell, uint frame, uint seed) {
  uint h = (cell.x * 0x5f356495u) ^ (cell.y * 0x2ff1c8b9u) ^ (frame * 0x6c8e9cf5u);
  h ^= seed;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}
void main() {
  uint band = uint(max(0.0, floor(v_uv.y / u_band)));
  uint h = grainHash(uvec2(band, 0u), uint(u_step), uint(u_seed));
  float pick = float(h & 0xffffu) / 65536.0;
  float side = float(h >> 16u) / 65536.0;
  if (pick >= u_amount) {
    o = S(v_uv);
    return;
  }
  float shift = (side * 2.0 - 1.0) * ${GLITCH_MAX_SHIFT.toFixed(4)} * u_amount;
  // The band wraps round rather than smearing its edge pixel across the gap it leaves.
  vec2 p = vec2(fract(v_uv.x + shift), v_uv.y);
  vec2 s = vec2(u_split * u_px.x, 0.0);
  vec4 r = S(p + s);
  vec4 g = S(p);
  vec4 b = S(p - s);
  o = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,

  // duotoneColour.
  duotone: `
uniform vec3 u_shadows;
uniform vec3 u_highlights;
uniform float u_amount;
void main() {
  vec4 c = S(v_uv);
  vec3 s = straight(c);
  vec3 d = mix(u_shadows, u_highlights, clamp(dot(s, LUMA), 0.0, 1.0));
  o = vec4(mix(s, d, u_amount) * c.a, c.a);
}`,

  // tintColour.
  tint: `
uniform vec3 u_color;
uniform float u_amount;
void main() {
  vec4 c = S(v_uv);
  vec3 s = straight(c);
  float l = clamp(dot(s, LUMA), 0.0, 1.0);
  vec3 t = l < 0.5 ? u_color * (l * 2.0) : u_color + (1.0 - u_color) * (l * 2.0 - 1.0);
  o = vec4(mix(s, t, u_amount) * c.a, c.a);
}`,

  flip: `
uniform vec2 u_flip;
void main() {
  o = S(mix(v_uv, 1.0 - v_uv, u_flip));
}`,

  // mirrorCoord.
  mirror: `
uniform float u_centre;
uniform float u_vertical;
uniform float u_reverse;
void main() {
  float x = u_vertical > 0.5 ? v_uv.y : v_uv.x;
  bool kept = u_reverse > 0.5 ? x >= u_centre : x <= u_centre;
  float m = kept ? x : clamp(2.0 * u_centre - x, 0.0, 1.0);
  o = S(u_vertical > 0.5 ? vec2(v_uv.x, m) : vec2(m, v_uv.y));
}`,

  // chroma, keyMatte and despill, in that order. The result is premultiplied by the matte, which
  // is what lets the canvas composite it over the tracks beneath with no fringe of screen colour.
  'chroma-key': `
uniform vec3 u_key;
uniform float u_similarity;
uniform float u_soft;
uniform float u_spill;
vec2 chroma(vec3 c) {
  float y = dot(c, LUMA);
  return vec2((c.b - y) / 1.8556, (c.r - y) / 1.5748);
}
void main() {
  vec4 px = S(v_uv);
  vec3 c = straight(px);
  vec2 kc = chroma(u_key);
  vec2 cc = chroma(c);
  float matte = smoothstep(u_similarity, u_similarity + u_soft, distance(cc, kc));
  float kl = length(kc);
  if (kl >= 1e-4 && u_spill > 0.0) {
    vec2 dir = kc / kl;
    cc -= dir * max(0.0, dot(cc, dir)) * u_spill;
    float y = dot(c, LUMA);
    float r = y + 1.5748 * cc.y;
    float b = y + 1.8556 * cc.x;
    c = clamp(vec3(r, (y - 0.2126 * r - 0.0722 * b) / 0.7152, b), 0.0, 1.0);
  }
  float a = px.a * matte;
  o = vec4(c * a, a);
}`
}

export const EFFECT_PROGRAMS: readonly string[] = Object.keys(BODIES)

/** The whole fragment source for a program, or null for a name that has none. */
export function effectFragment(program: string): string | null {
  const body = BODIES[program]
  return body === undefined ? null : HEADER + body
}

// ---------------------------------------------------------------------------
// Pass plans
// ---------------------------------------------------------------------------

export interface EffectEnv {
  /** The size the picture is drawn at, in device pixels. */
  width: number
  height: number
  /** Device pixels per timeline pixel. */
  scale: number
  /** The timeline frame being drawn. */
  frame: number
}

export type UniformValue = number | readonly number[]

/** `'current'` is the picture the effect was handed; anything else names a scratch target. */
export type PassInput = 'current' | string

export interface PassStep {
  program: string
  uniforms: Record<string, UniformValue>
  input: PassInput
  /** A second picture, read with `A()`. */
  aux?: PassInput
  /** `'result'` is the effect's output; otherwise a scratch target of this size. */
  output: 'result' | { scratch: string; width: number; height: number }
}

const DEG = Math.PI / 180

function direction(degrees: number): [number, number] {
  return [Math.cos(degrees * DEG), Math.sin(degrees * DEG)]
}

function single(program: string, uniforms: Record<string, UniformValue>): PassStep[] {
  return [{ program, uniforms, input: 'current', output: 'result' }]
}

/** The passes each effect draws, last one always to `'result'`. Keyed by catalog kind. */
export const EFFECT_PASSES: Record<string, (params: ResolvedParams, env: EffectEnv) => PassStep[]> = {
  'directional-blur': (p, env) =>
    single('directional-blur', { u_dir: direction(num(p, 'angle')), u_len: num(p, 'length') * env.scale }),

  'zoom-blur': (p) => single('zoom-blur', { u_centre: point(p, 'centre'), u_amount: num(p, 'amount') }),

  sharpen: (p, env) => single('sharpen', { u_amount: num(p, 'amount'), u_radius: num(p, 'radius') * env.scale }),

  glow: (p, env) => {
    const { down, sigma } = blurPlan(num(p, 'radius') * env.scale)
    const width = Math.max(1, Math.ceil(env.width / down))
    const height = Math.max(1, Math.ceil(env.height / down))
    const a = { scratch: 'fxGlowA', width, height }
    const b = { scratch: 'fxGlowB', width, height }
    const steps: PassStep[] = [
      {
        program: 'glow-bright',
        input: 'current',
        output: a,
        uniforms: { u_down: down, u_threshold: num(p, 'threshold'), u_tint: rgb(p, 'color'), u_outPx: [1 / width, 1 / height] }
      },
      { program: 'gauss', input: a.scratch, output: b, uniforms: { u_step: [1 / width, 0], u_sigma: sigma } },
      { program: 'gauss', input: b.scratch, output: a, uniforms: { u_step: [0, 1 / height], u_sigma: sigma } },
      { program: 'glow-composite', input: 'current', aux: a.scratch, output: 'result', uniforms: { u_amount: num(p, 'amount') } }
    ]
    return steps
  },

  'chromatic-aberration': (p, env) =>
    single('chromatic-aberration', {
      u_amount: num(p, 'amount') * env.scale,
      u_dir: direction(num(p, 'angle')),
      u_radial: flag(p, 'radial') ? 1 : 0
    }),

  pixelate: (p, env) => {
    const size = num(p, 'size') * env.scale
    return single('pixelate', { u_cell: [size / env.width, size / env.height] })
  },

  glitch: (p, env) =>
    single('glitch', {
      u_amount: num(p, 'amount'),
      u_band: Math.max(1, num(p, 'blockSize') * env.scale) / env.height,
      // glitchBand's `step`: the pattern holds for `hold` frames.
      u_step: Math.floor(Math.max(0, env.frame) / Math.max(1, Math.round(num(p, 'hold')))),
      u_seed: Math.round(num(p, 'seed')),
      u_split: num(p, 'rgbSplit') * env.scale
    }),

  duotone: (p) =>
    single('duotone', { u_shadows: rgb(p, 'shadows'), u_highlights: rgb(p, 'highlights'), u_amount: num(p, 'amount') }),

  tint: (p) => single('tint', { u_color: rgb(p, 'color'), u_amount: num(p, 'amount') }),

  flip: (p) => single('flip', { u_flip: [flag(p, 'horizontal') ? 1 : 0, flag(p, 'vertical') ? 1 : 0] }),

  mirror: (p) =>
    single('mirror', { u_centre: num(p, 'centre'), u_vertical: flag(p, 'vertical') ? 1 : 0, u_reverse: flag(p, 'reverse') ? 1 : 0 }),

  'chroma-key': (p) =>
    single('chroma-key', {
      u_key: rgb(p, 'color'),
      u_similarity: num(p, 'similarity'),
      u_soft: Math.max(num(p, 'smoothness'), MIN_KEY_SOFTNESS),
      u_spill: num(p, 'spill')
    })
}
