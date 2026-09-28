/**
 * `<scene3d>`: a 3D layer inside a `.brf` scene, as data.
 *
 * The worker that runs `.brf` code never touches the GPU (`brf-lockdown.ts` removes
 * `OffscreenCanvas`). It resolves `<scene3d>` and its `<text3d>`, `<box3d>`, `<plane3d>` and
 * `<light3d>` children to the plain objects typed here, one per frame, like every other layer. The
 * renderer's `engine/scene3d.ts` draws them with bay's own bundled three.js on one long-lived WebGL
 * context, and the result is painted into the `.brf` surface in layer order — so preview,
 * `preview_frame` and export draw 3D through the same path as everything else.
 *
 * Everything that moves comes from the module's code: a camera flies through because the code
 * computes `camera.position` from `t` each frame. Values here are not keyable; a plain JSON
 * document gets a still 3D scene.
 *
 * The caps are load-bearing. A document is untrusted input and three.js builds geometry on the
 * editor's main thread: a 200-character title at 24 curve segments with a bevel is millions of
 * vertices, and a GPU that hangs loses every WebGL context in the page, grade's included. So each
 * scene is refused *before* any geometry is built when its estimated vertex count is over budget.
 *
 * This file is pure: validation and resolution take the colour and variable helpers of the
 * format they sit in (`./brf`) as arguments, so it imports nothing from it.
 */

export type Vec3 = [number, number, number]

export interface Camera3d {
  /** Where the camera is, in world units. Default `[0, 0, 10]`. */
  position?: Vec3
  /** The point it looks at. Default the origin. */
  lookAt?: Vec3
  /** Vertical field of view, degrees. Default 40. */
  fov?: number
  /** Degrees the camera banks about its view axis; positive tilts the picture clockwise. */
  roll?: number
  near?: number
  far?: number
}

export interface Fog3d {
  color?: string
  /** Distance from the camera where fog starts, and where it is total. */
  near: number
  far: number
  /**
   * `fade` (default over a transparent background): distant things fade *out*, to see-through.
   * `tint`: they turn the fog colour — only right over an opaque background of that colour.
   * three.js's own fog is `tint`; over footage it turns far letters navy instead of fading them.
   */
  mode?: 'fade' | 'tint'
}

interface Placed3d {
  position?: Vec3
  /** Degrees about x, y and z. */
  rotation?: Vec3
  scale?: number | Vec3
}

interface Material3d {
  color?: string
  metalness?: number
  roughness?: number
  emissive?: string
  emissiveIntensity?: number
  opacity?: number
}

export interface Text3d extends Placed3d, Material3d {
  type: 'text3d'
  text: string
  /** An imported font's family, or `Inter` (built in). Default Inter. */
  font?: string
  weight?: number
  /** Cap-to-baseline scale: the em size in world units. Default 1. */
  size?: number
  /** Extrusion depth, world units. Default 0.2. */
  depth?: number
  /** Bevel size, world units. 0 (default) is a sharp edge. */
  bevel?: number
  curveSegments?: number
  align?: 'left' | 'center' | 'right'
  /** Multiple of `size` between lines of a `\n`-broken text. Default 1.2. */
  lineHeight?: number
}

export interface Box3d extends Placed3d, Material3d {
  type: 'box3d'
  /** `[width, height, depth]`. Default `[1, 1, 1]`. */
  size?: Vec3
}

export interface Plane3d extends Placed3d, Material3d {
  type: 'plane3d'
  /** `[width, height]`. Default `[1, 1]`. Drawn from both sides. */
  size?: [number, number]
}

export interface Light3d {
  type: 'light3d'
  /** `<light3d type="…">` in JSX; `kind` in the document, since `type` names the element. */
  kind: 'ambient' | 'directional' | 'point'
  color?: string
  intensity?: number
  position?: Vec3
  /** A point light reaches this far (0, the default, is unlimited). It does not fall off before. */
  distance?: number
}

export type Object3d = Text3d | Box3d | Plane3d | Light3d

/** What a `scene3d` layer adds to the 2D layer it is. */
export interface Scene3dFields {
  camera?: Camera3d
  fog?: Fog3d
  /** `"transparent"` (default) or a colour filling the layer's box behind the 3D. */
  background?: string
  objects: Object3d[]
}

export const OBJECT3D_TYPES = ['text3d', 'box3d', 'plane3d', 'light3d'] as const
export const LIGHT_KINDS = ['ambient', 'directional', 'point'] as const
export const BUILTIN_3D_FONT = 'Inter'

/** Caps, each checked before any geometry exists. See the file comment. */
export const SCENE3D_LIMITS = {
  meshes: 64,
  lights: 8,
  textLength: 200,
  curveSegments: 24,
  /** Estimated vertices per scene: `estimateVertices`. */
  vertices: 2_000_000,
  size: 1000,
  worldExtent: 100_000
} as const

/** Bevel rings per side, fixed: not worth a knob, and it bounds the vertex estimate. */
export const BEVEL_SEGMENTS = 3

export const DEFAULT_CURVE_SEGMENTS = 8

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Scene3dCheck {
  fault: (at: string, message: string) => void
  /** A colour string or a declared `$var` (the format's own rule). */
  isColor: (value: unknown) => boolean
  /** ` — did you mean "x"?`, or ''. */
  suggest: (word: string, candidates: string[]) => string
  /** Declared variable names, for `text="$name"`. */
  vars: Record<string, unknown>
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const MATERIAL = ['color', 'metalness', 'roughness', 'emissive', 'emissiveIntensity', 'opacity']
const PLACED = ['position', 'rotation', 'scale']
const ALLOWED_3D: Record<Object3d['type'], string[]> = {
  text3d: ['type', ...PLACED, ...MATERIAL, 'text', 'font', 'weight', 'size', 'depth', 'bevel', 'curveSegments', 'align', 'lineHeight'],
  box3d: ['type', ...PLACED, ...MATERIAL, 'size'],
  plane3d: ['type', ...PLACED, ...MATERIAL, 'size'],
  light3d: ['type', 'kind', 'color', 'intensity', 'position', 'distance']
}
const CAMERA_KEYS = ['position', 'lookAt', 'fov', 'roll', 'near', 'far']
const FOG_KEYS = ['color', 'near', 'far', 'mode']

function checkVec(value: unknown, n: 2 | 3, at: string, what: string, c: Scene3dCheck, positive = false): void {
  if (value === undefined) return
  const limit = positive ? SCENE3D_LIMITS.size : SCENE3D_LIMITS.worldExtent
  if (!Array.isArray(value) || value.length !== n || !value.every((v) => finite(v) && Math.abs(v) <= limit && (!positive || v > 0))) {
    const example = n === 3 ? '[0, 1.5, -4]' : '[4, 2]'
    c.fault(at, `must be ${what}: ${n} numbers${positive ? ` above 0 and at most ${limit}` : ` within ±${limit}`}, e.g. ${example} — computed from t in code if it moves`)
  }
}

function checkNumber(value: unknown, at: string, min: number, max: number, meaning: string, c: Scene3dCheck): void {
  if (value === undefined) return
  if (!finite(value) || value < min || value > max) c.fault(at, `must be ${meaning}, a number from ${min} to ${max}`)
}

function checkColor(value: unknown, at: string, c: Scene3dCheck): void {
  if (value !== undefined && !c.isColor(value)) c.fault(at, `${JSON.stringify(value)} is not a colour: use "#rrggbb", "#rrggbbaa" or "rgba(r,g,b,a)"`)
}

/**
 * Every problem with a scene3d layer's own fields — `camera`, `fog`, `background`, `objects` —
 * reported at its path. The 2D part (x, y, w, h, opacity…) is the format's to check.
 */
export function checkScene3d(layer: Record<string, unknown>, at: string, c: Scene3dCheck): void {
  if (layer.camera !== undefined) {
    const camera = layer.camera
    if (!isObject(camera)) {
      c.fault(`${at}.camera`, 'must be {{ position: [x, y, z], lookAt: [x, y, z], fov }}')
    } else {
      for (const key of Object.keys(camera)) {
        if (!CAMERA_KEYS.includes(key)) c.fault(`${at}.camera.${key}`, `a camera has no "${key}"${c.suggest(key, CAMERA_KEYS)}; it takes ${CAMERA_KEYS.join(', ')}`)
      }
      checkVec(camera.position, 3, `${at}.camera.position`, 'where the camera is', c)
      checkVec(camera.lookAt, 3, `${at}.camera.lookAt`, 'the point it looks at', c)
      checkNumber(camera.fov, `${at}.camera.fov`, 1, 170, 'the vertical field of view in degrees', c)
      checkNumber(camera.roll, `${at}.camera.roll`, -3600, 3600, 'degrees of bank', c)
      checkNumber(camera.near, `${at}.camera.near`, 0.001, 1000, 'the nearest distance drawn', c)
      checkNumber(camera.far, `${at}.camera.far`, 0.01, SCENE3D_LIMITS.worldExtent, 'the farthest distance drawn', c)
      if (finite(camera.near) && finite(camera.far) && camera.far <= camera.near) c.fault(`${at}.camera.far`, `must be beyond near (${camera.near})`)
      if (Array.isArray(camera.position) && Array.isArray(camera.lookAt) && camera.position.every((v, i) => v === (camera.lookAt as unknown[])[i])) {
        c.fault(`${at}.camera.lookAt`, 'is where the camera is, so it looks nowhere: put the camera back from what it looks at')
      }
    }
  }
  if (layer.fog !== undefined) {
    const fog = layer.fog
    if (!isObject(fog)) {
      c.fault(`${at}.fog`, 'must be {{ near: 8, far: 30, color: "#0b0b12", mode: "fade" }}')
    } else {
      for (const key of Object.keys(fog)) {
        if (!FOG_KEYS.includes(key)) c.fault(`${at}.fog.${key}`, `fog has no "${key}"${c.suggest(key, FOG_KEYS)}; it takes ${FOG_KEYS.join(', ')}`)
      }
      checkColor(fog.color, `${at}.fog.color`, c)
      if (!finite(fog.near) || fog.near < 0) c.fault(`${at}.fog.near`, 'must be the distance from the camera where fog starts, 0 or more')
      if (!finite(fog.far) || (finite(fog.near) && fog.far <= fog.near)) c.fault(`${at}.fog.far`, 'must be the distance where fog is total, beyond near')
      if (fog.mode !== undefined && fog.mode !== 'fade' && fog.mode !== 'tint') {
        c.fault(`${at}.fog.mode`, 'must be "fade" (distant things turn see-through — right over footage) or "tint" (they turn the fog colour — only over an opaque background)')
      }
    }
  }
  if (layer.background !== undefined && layer.background !== 'transparent') checkColor(layer.background, `${at}.background`, c)

  const objects = layer.objects
  if (!Array.isArray(objects)) {
    c.fault(`${at}.objects`, 'a scene3d holds its 3D objects: <text3d>, <box3d>, <plane3d> and <light3d>')
    return
  }
  let meshes = 0
  let lights = 0
  let vertices = 0
  objects.forEach((object, i) => {
    const where = `${at}.objects[${i}]`
    if (!isObject(object)) {
      c.fault(where, 'a 3D object is an object with a "type"')
      return
    }
    const type = object.type
    if (typeof type !== 'string' || !(OBJECT3D_TYPES as readonly string[]).includes(type)) {
      c.fault(`${where}.type`, `must be one of ${OBJECT3D_TYPES.join(', ')}${typeof type === 'string' ? c.suggest(type, [...OBJECT3D_TYPES]) : ''} — 2D elements go outside the <scene3d>`)
      return
    }
    const kind = type as Object3d['type']
    const allowed = ALLOWED_3D[kind]
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) c.fault(`${where}.${key}`, `a ${kind} has no "${key}"${c.suggest(key, allowed)}`)
    }
    if (kind === 'light3d') {
      lights++
      if (typeof object.kind !== 'string' || !(LIGHT_KINDS as readonly string[]).includes(object.kind)) {
        c.fault(`${where}.kind`, `a light is type="ambient", "directional" or "point"${typeof object.kind === 'string' ? c.suggest(object.kind, [...LIGHT_KINDS]) : ''}`)
      }
      checkColor(object.color, `${where}.color`, c)
      checkNumber(object.intensity, `${where}.intensity`, 0, 1000, 'the brightness', c)
      checkVec(object.position, 3, `${where}.position`, 'where the light is', c)
      checkNumber(object.distance, `${where}.distance`, 0, SCENE3D_LIMITS.worldExtent, 'how far a point light reaches (0 = unlimited)', c)
      return
    }
    meshes++
    checkVec(object.position, 3, `${where}.position`, 'where it sits', c)
    checkVec(object.rotation, 3, `${where}.rotation`, 'degrees about x, y and z', c)
    if (object.scale !== undefined && !(finite(object.scale) && object.scale > 0 && object.scale <= SCENE3D_LIMITS.size)) {
      checkVec(object.scale, 3, `${where}.scale`, 'a scale (one number, or one per axis)', c, true)
    }
    checkColor(object.color, `${where}.color`, c)
    checkColor(object.emissive, `${where}.emissive`, c)
    checkNumber(object.metalness, `${where}.metalness`, 0, 1, 'how metallic it is', c)
    checkNumber(object.roughness, `${where}.roughness`, 0, 1, 'how rough it is (0 mirror, 1 matte)', c)
    checkNumber(object.emissiveIntensity, `${where}.emissiveIntensity`, 0, 100, 'how strongly it glows its emissive colour', c)
    checkNumber(object.opacity, `${where}.opacity`, 0, 1, 'its opacity', c)
    if (kind === 'box3d') {
      checkVec(object.size, 3, `${where}.size`, '[width, height, depth]', c, true)
      vertices += 24
    } else if (kind === 'plane3d') {
      checkVec(object.size, 2, `${where}.size`, '[width, height]', c, true)
      vertices += 4
    } else {
      const text = object.text
      if (typeof text !== 'string') c.fault(`${where}.text`, 'must be the words to extrude: <text3d>SOC 2</text3d>')
      else if (text.startsWith('$') && !(text.slice(1) in c.vars)) c.fault(`${where}.text`, `refers to ${text}, which "vars" does not declare`)
      else if (text.length > SCENE3D_LIMITS.textLength) c.fault(`${where}.text`, `is ${text.length} characters; 3D text takes at most ${SCENE3D_LIMITS.textLength} — split it, or use <text> for body copy`)
      if (object.font !== undefined && (typeof object.font !== 'string' || object.font.trim() === '')) c.fault(`${where}.font`, `must be an imported font's family, or "${BUILTIN_3D_FONT}"`)
      checkNumber(object.weight, `${where}.weight`, 100, 1000, 'the weight (400 regular, 700 bold)', c)
      checkNumber(object.size, `${where}.size`, 0.001, SCENE3D_LIMITS.size, 'the em size in world units', c)
      checkNumber(object.depth, `${where}.depth`, 0, SCENE3D_LIMITS.size, 'the extrusion depth in world units', c)
      checkNumber(object.bevel, `${where}.bevel`, 0, SCENE3D_LIMITS.size, 'the bevel size in world units (0 = sharp)', c)
      checkNumber(object.lineHeight, `${where}.lineHeight`, 0.1, 10, 'a multiple of size between lines', c)
      if (object.curveSegments !== undefined && !(Number.isInteger(object.curveSegments) && (object.curveSegments as number) >= 1 && (object.curveSegments as number) <= SCENE3D_LIMITS.curveSegments)) {
        c.fault(`${where}.curveSegments`, `must be a whole number from 1 to ${SCENE3D_LIMITS.curveSegments} (default ${DEFAULT_CURVE_SEGMENTS})`)
      }
      if (object.align !== undefined && !['left', 'center', 'right'].includes(object.align as string)) c.fault(`${where}.align`, 'must be left, center or right')
      if (typeof text === 'string') {
        vertices += estimateVertices(text.length, finite(object.curveSegments) ? object.curveSegments : DEFAULT_CURVE_SEGMENTS, finite(object.bevel) && object.bevel > 0)
      }
    }
  })
  if (meshes > SCENE3D_LIMITS.meshes) c.fault(`${at}.objects`, `holds ${meshes} meshes; a scene3d takes at most ${SCENE3D_LIMITS.meshes}`)
  if (lights > SCENE3D_LIMITS.lights) c.fault(`${at}.objects`, `holds ${lights} lights; a scene3d takes at most ${SCENE3D_LIMITS.lights}`)
  if (vertices > SCENE3D_LIMITS.vertices) {
    c.fault(
      `${at}.objects`,
      `would build about ${Math.round(vertices / 1000)}k vertices, over the ${SCENE3D_LIMITS.vertices / 1_000_000}M a scene may: shorten the text, lower curveSegments (default ${DEFAULT_CURVE_SEGMENTS}), or drop the bevel`
    )
  }
}

/**
 * An upper estimate of the vertices extruded text builds, from what is known before any font is
 * read. Calibrated on Inter Black's densest glyph, `@` (measured per character: 840 vertices at
 * 1 curve segment, 6216 at 8, 18504 at 24; a bevel multiplies by 4.0): each character is taken as
 * `200 + 800 × curveSegments`, times 4.2 with a bevel. A more ornate font can exceed it, which is
 * why the renderer also counts the geometry it built against the same budget
 * (`engine/text3dGeometry.ts`); `text3dGeometry.test.ts` holds this above what Inter builds.
 */
export function estimateVertices(characters: number, curveSegments: number, bevel: boolean): number {
  return Math.ceil(characters * (200 + 800 * curveSegments) * (bevel ? 4.2 : 1))
}

// ---------------------------------------------------------------------------
// Resolution: a layer + the moment → what the renderer draws
// ---------------------------------------------------------------------------

export interface ResolvedMaterial {
  /** `rgba(r,g,b,a)`; alpha multiplies `opacity`. */
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  opacity: number
}

export interface ResolvedPlaced {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export type ResolvedObject3d =
  | (ResolvedPlaced & ResolvedMaterial & {
      type: 'text3d'
      text: string
      /** The family as written, or null for the built-in face. */
      font: string | null
      weight: number
      size: number
      depth: number
      bevel: number
      curveSegments: number
      align: 'left' | 'center' | 'right'
      lineHeight: number
    })
  | (ResolvedPlaced & ResolvedMaterial & { type: 'box3d'; size: Vec3 })
  | (ResolvedPlaced & ResolvedMaterial & { type: 'plane3d'; size: [number, number] })
  | { type: 'light3d'; kind: Light3d['kind']; color: string; intensity: number; position: Vec3; distance: number }

export interface Scene3dFrame {
  camera: { position: Vec3; lookAt: Vec3; fov: number; roll: number; near: number; far: number }
  fog: { color: string; near: number; far: number; mode: 'fade' | 'tint' } | null
  /** Null is transparent. */
  background: string | null
  objects: ResolvedObject3d[]
  /** True when the scene named no light and was given the default pair. */
  defaultLights: boolean
}

export interface Scene3dResolve {
  /** A colour or `$var` → `rgba(…)`. */
  color: (value: string) => string
  /** `$name` → its value; anything else as is. */
  text: (value: string) => string
}

const vec = (value: Vec3 | undefined, fallback: Vec3): Vec3 => (value ? [value[0], value[1], value[2]] : fallback)

/** The default pair a scene without lights gets: soft fill, and a key from the upper right front. */
export const DEFAULT_LIGHTS: ResolvedObject3d[] = [
  { type: 'light3d', kind: 'ambient', color: 'rgba(255,255,255,1)', intensity: 0.6, position: [0, 0, 0], distance: 0 },
  { type: 'light3d', kind: 'directional', color: 'rgba(255,255,255,1)', intensity: 2.2, position: [4, 6, 8], distance: 0 }
]

const LIGHT_INTENSITY: Record<Light3d['kind'], number> = { ambient: 0.6, directional: 2.2, point: 3 }

/** Fills every default, so the renderer never decides anything. Expects a checked layer. */
export function resolveScene3d(layer: Scene3dFields, r: Scene3dResolve): Scene3dFrame {
  const camera = layer.camera ?? {}
  const background = layer.background === undefined || layer.background === 'transparent' ? null : r.color(layer.background)
  const fog = layer.fog
    ? { color: r.color(layer.fog.color ?? '#000000'), near: layer.fog.near, far: layer.fog.far, mode: layer.fog.mode ?? (background === null ? 'fade' : 'tint') }
    : null
  const objects: ResolvedObject3d[] = []
  for (const o of layer.objects) {
    if (o.type === 'light3d') {
      objects.push({
        type: 'light3d',
        kind: o.kind,
        color: r.color(o.color ?? '#ffffff'),
        intensity: o.intensity ?? LIGHT_INTENSITY[o.kind],
        position: vec(o.position, [4, 6, 8]),
        distance: o.distance ?? 0
      })
      continue
    }
    const scale: Vec3 = o.scale === undefined ? [1, 1, 1] : typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : vec(o.scale, [1, 1, 1])
    const placed: ResolvedPlaced = { position: vec(o.position, [0, 0, 0]), rotation: vec(o.rotation, [0, 0, 0]), scale }
    const material: ResolvedMaterial = {
      color: r.color(o.color ?? '#ffffff'),
      metalness: o.metalness ?? 0.1,
      roughness: o.roughness ?? 0.45,
      emissive: r.color(o.emissive ?? '#000000'),
      emissiveIntensity: o.emissiveIntensity ?? 1,
      opacity: o.opacity ?? 1
    }
    if (o.type === 'box3d') objects.push({ type: 'box3d', ...placed, ...material, size: vec(o.size, [1, 1, 1]) })
    else if (o.type === 'plane3d') objects.push({ type: 'plane3d', ...placed, ...material, size: o.size ? [o.size[0], o.size[1]] : [1, 1] })
    else {
      const font = o.font === undefined ? null : o.font.trim()
      objects.push({
        type: 'text3d',
        ...placed,
        ...material,
        text: r.text(o.text),
        font: font !== null && font.toLowerCase() === BUILTIN_3D_FONT.toLowerCase() ? null : font,
        weight: o.weight ?? 700,
        size: o.size ?? 1,
        depth: o.depth ?? 0.2,
        bevel: o.bevel ?? 0,
        curveSegments: o.curveSegments ?? DEFAULT_CURVE_SEGMENTS,
        align: o.align ?? 'center',
        lineHeight: o.lineHeight ?? 1.2
      })
    }
  }
  const defaultLights = !objects.some((o) => o.type === 'light3d')
  if (defaultLights) objects.push(...DEFAULT_LIGHTS)
  return {
    camera: {
      position: vec(camera.position, [0, 0, 10]),
      lookAt: vec(camera.lookAt, [0, 0, 0]),
      fov: camera.fov ?? 40,
      roll: camera.roll ?? 0,
      near: camera.near ?? 0.1,
      far: camera.far ?? 1000
    },
    fog,
    background,
    objects,
    defaultLights
  }
}

type TextObject3d = Extract<ResolvedObject3d, { type: 'text3d' }>

/** What an extruded text's geometry is built from, at the size it is built. */
export interface TextShape {
  text: string
  size: number
  depth: number
  bevelSize: number
  bevelThickness: number
  curveSegments: number
  align: 'left' | 'center' | 'right'
  lineHeight: number
}

/**
 * A text's geometry is built at **unit size and unit depth** and sized by the mesh's scale, so a
 * text whose `size` or `depth` animates is extruded once, not once per frame (a title that grows
 * would otherwise rebuild up to the whole vertex budget every frame). The bevel is the exception:
 * it is absolute, so in unit space it is `bevel / size` wide and `bevel / depth` deep, and a
 * bevelled text rebuilds when its size or depth changes — the guide says so. A depth of 0 is built
 * flat (unit depth 0, no z scale), so a bevel keeps its own thickness.
 */
export function textUnit(o: Pick<TextObject3d, 'text' | 'size' | 'depth' | 'bevel' | 'curveSegments' | 'align' | 'lineHeight'>): { shape: TextShape; scale: Vec3 } {
  const zScale = o.depth > 0 ? o.depth : 1
  return {
    shape: {
      text: o.text,
      size: 1,
      depth: o.depth > 0 ? 1 : 0,
      bevelSize: o.bevel > 0 ? o.bevel / o.size : 0,
      bevelThickness: o.bevel > 0 ? o.bevel / zScale : 0,
      curveSegments: o.curveSegments,
      align: o.align,
      lineHeight: o.lineHeight
    },
    scale: [o.size, o.size, zScale]
  }
}

/**
 * The key one extruded text's geometry is cached under: its shape (`textUnit`'s, in the renderer)
 * and nothing else. Colour, position, rotation, opacity — and, without a bevel, size and depth —
 * change every frame of a fly-through and must not rebuild anything; new words, a font or a bevel
 * must. `fontKey` names the exact face.
 */
export function text3dGeometryKey(shape: TextShape, fontKey: string): string {
  return JSON.stringify([fontKey, shape.text, shape.size, shape.depth, shape.bevelSize, shape.bevelThickness, shape.curveSegments, shape.align, shape.lineHeight])
}
