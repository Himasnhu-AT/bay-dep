/**
 * Draws `<scene3d>` layers (`@shared/scene3d`) with bay's own bundled three.js.
 *
 * Loaded only when a 3D layer first appears (`scene3dRuntime.ts` imports this with `import()`), so
 * three.js, opentype.js and the built-in Inter outlines are a chunk the editor never pays for
 * until it draws 3D. The chunk is `'self'`: the CSP needs nothing new, and nothing is fetched but
 * an imported font's own file over `bay://`.
 *
 * **One renderer, one context, for every 3D layer in the page** — preview, `preview_frame` and
 * export alike — on an `OffscreenCanvas` resized to each layer's device size, with
 * `premultipliedAlpha` and `preserveDrawingBuffer` as grade's proven context has. Each layer is
 * rendered and then drawn by the caller into the `.brf` surface before the next is rendered, so one
 * canvas serves them in turn. It is a separate context from grade's on purpose: `GradeContext`
 * fixes its sampler units for the life of its context and three.js changes GL state freely.
 *
 * **Context loss is never silent.** If the GPU resets, three.js draws nothing and says nothing. So
 * after every render the context is asked; lost, the frame is an error (a placeholder, named in
 * `IncompleteFrames`) and the next frame builds a new renderer. Geometry is CPU-side and survives.
 *
 * Colour: three.js's defaults — sRGB colours converted to linear, lit, written back as sRGB, no
 * tone mapping — so an unlit colour lands where the same colour does in a 2D layer.
 */

import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Fog,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type BufferGeometry
} from 'three'
import { parse, type Font } from 'opentype.js/dist/opentype.mjs'
import { parseColor } from '@shared/brf'
import type { ResolvedObject3d, Scene3dFrame } from '@shared/scene3d'
import { GeometryCache } from './text3dGeometry'
import { resolveText3dFont, type BuiltinWeight, type FontFile, type Text3dFont } from './scene3dFonts'
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?inline'
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?inline'
import inter900 from '@fontsource/inter/files/inter-latin-900-normal.woff?inline'

/** The longest edge a 3D layer renders at; larger draws are rendered at this and scaled up. */
const MAX_EDGE = 4096
const MAX_MATERIALS = 64

const BUILTIN: Record<BuiltinWeight, string> = { 400: inter400, 700: inter700, 900: inter900 }

/** A `data:` URL's bytes — decoded here, since `connect-src` does not admit `data:` to `fetch`. */
function bytesOf(dataUrl: string): ArrayBuffer {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * three.js's fog blends colour toward the fog colour. Over transparent footage that turns far
 * letters navy instead of fading them, so `fade` scales alpha instead — premultiplied after, by
 * three's own `premultiplied_alpha_fragment`, which every material here has on.
 */
const FADE_FOG = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.a *= 1.0 - fogFactor;
#endif
`

type Loaded = { font: Font } | { pending: true } | { error: string }
type TextObject = Extract<ResolvedObject3d, { type: 'text3d' }>

function rgba(text: string): [number, number, number, number] {
  return parseColor(text) ?? [0, 0, 0, 0]
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180

export class Scene3dRenderer {
  readonly #track: (work: Promise<void>) => void
  #canvas: OffscreenCanvas | null = null
  #renderer: WebGLRenderer | null = null
  #lost = false
  readonly #geometries = new GeometryCache()
  readonly #fonts = new Map<string, Loaded>()
  #materials: MeshStandardMaterial[] = []

  /** `track` is told of every font still loading, so the runtime can `settle` and redraw. */
  constructor(track: (work: Promise<void>) => void) {
    this.#track = track
  }

  /**
   * Whether `scene` can be drawn now: every font read and every text extruded. Pending while an
   * imported font's file is on its way; an error names what cannot be drawn, before anything is.
   */
  prepare(scene: Scene3dFrame, files: readonly FontFile[]): { ready: true } | { pending: true } | { error: string } {
    let pending = false
    for (const o of scene.objects) {
      if (o.type !== 'text3d') continue
      const got = this.#textGeometry(o, files)
      if ('error' in got) return { error: `3D text ${JSON.stringify(o.text.slice(0, 40))}: ${got.error}` }
      if ('pending' in got) pending = true
    }
    return pending ? { pending: true } : { ready: true }
  }

  /** `scene` rendered at `width`×`height` device pixels, on the shared canvas. Call `prepare` first. */
  render(scene: Scene3dFrame, files: readonly FontFile[], width: number, height: number): { canvas: OffscreenCanvas } | { error: string } {
    const context = this.#context()
    if ('error' in context) return context
    const { renderer, canvas } = context
    const fit = Math.min(1, MAX_EDGE / Math.max(width, height))
    const w = Math.max(1, Math.round(width * fit))
    const h = Math.max(1, Math.round(height * fit))
    renderer.setSize(w, h, false)

    if (scene.background) {
      const [r, g, b, a] = rgba(scene.background)
      renderer.setClearColor(`rgb(${r},${g},${b})`, a)
    } else renderer.setClearColor(0x000000, 0)

    const world = new Scene()
    const fade = scene.fog?.mode === 'fade'
    if (scene.fog) {
      const [r, g, b] = rgba(scene.fog.color)
      world.fog = new Fog(`rgb(${r},${g},${b})`, scene.fog.near, scene.fog.far)
    }

    const cam = scene.camera
    const camera = new PerspectiveCamera(cam.fov, w / h, cam.near, cam.far)
    camera.position.set(...cam.position)
    camera.lookAt(...cam.lookAt)
    if (cam.roll !== 0) camera.rotateZ(radians(cam.roll))

    let slot = 0
    for (const o of scene.objects) {
      if (o.type === 'light3d') {
        const [r, g, b] = rgba(o.color)
        const color = `rgb(${r},${g},${b})`
        if (o.kind === 'ambient') world.add(new AmbientLight(color, o.intensity))
        else if (o.kind === 'directional') {
          const light = new DirectionalLight(color, o.intensity)
          light.position.set(...o.position)
          world.add(light)
        } else {
          // No falloff (decay 0): a brightness that means the same at any distance, cut off at `distance`.
          const light = new PointLight(color, o.intensity, o.distance, 0)
          light.position.set(...o.position)
          world.add(light)
        }
        continue
      }
      let geometry: BufferGeometry
      if (o.type === 'box3d') geometry = this.#geometries.box(o.size)
      else if (o.type === 'plane3d') geometry = this.#geometries.plane(o.size)
      else {
        const got = this.#textGeometry(o, files)
        if (!('geometry' in got)) return { error: 'error' in got ? got.error : '3D text was drawn before its font had loaded' }
        geometry = got.geometry
      }
      const mesh = new Mesh(geometry, this.#material(slot++, o, fade))
      mesh.position.set(...o.position)
      mesh.rotation.set(radians(o.rotation[0]), radians(o.rotation[1]), radians(o.rotation[2]))
      mesh.scale.set(...o.scale)
      world.add(mesh)
    }

    renderer.render(world, camera)
    if (this.#lost || renderer.getContext().isContextLost()) {
      this.#lost = true
      return { error: 'the 3D drawing context was lost (the GPU reset) — this frame has no 3D; the next one rebuilds it' }
    }
    return { canvas }
  }

  #textGeometry(o: TextObject, files: readonly FontFile[]): { geometry: BufferGeometry } | { pending: true } | { error: string } {
    const choice = resolveText3dFont(o.font, o.weight, files)
    if ('error' in choice) return choice
    const font = this.#font(choice)
    if (!('font' in font)) return font
    return this.#geometries.text(font.font, choice.key, o)
  }

  #font(choice: Exclude<Text3dFont, { error: string }>): Loaded {
    const known = this.#fonts.get(choice.key)
    if (known) return known
    if (choice.kind === 'builtin') {
      let loaded: Loaded
      try {
        loaded = { font: parse(bytesOf(BUILTIN[choice.weight])) }
      } catch (error) {
        loaded = { error: `the built-in font could not be read: ${(error as Error).message}` }
      }
      this.#fonts.set(choice.key, loaded)
      return loaded
    }
    this.#fonts.set(choice.key, { pending: true })
    const work = fetch(choice.url)
      .then((response) => {
        if (!response.ok) throw new Error(`the file answered ${response.status}`)
        return response.arrayBuffer()
      })
      .then((buffer) => {
        this.#fonts.set(choice.key, { font: parse(buffer) })
      })
      .catch((error: unknown) => {
        this.#fonts.set(choice.key, { error: `its font file could not be read (${error instanceof Error ? error.message : String(error)})` })
      })
    this.#track(work)
    return { pending: true }
  }

  #material(slot: number, o: Exclude<ResolvedObject3d, { type: 'light3d' }>, fade: boolean): MeshStandardMaterial {
    let material = this.#materials[slot]
    if (!material) {
      material = new MeshStandardMaterial()
      // Reused frame to frame, so the shader program is compiled once, not per frame.
      material.transparent = true
      material.premultipliedAlpha = true
      material.onBeforeCompile = (shader) => {
        if (material!.userData.fade) shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FADE_FOG)
      }
      material.customProgramCacheKey = () => (material!.userData.fade ? 'bay-fog-fade' : 'bay-fog-tint')
      if (slot < MAX_MATERIALS) this.#materials[slot] = material
    }
    if (material.userData.fade !== fade) {
      material.userData.fade = fade
      material.needsUpdate = true
    }
    const [r, g, b, a] = rgba(o.color)
    material.color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
    const [er, eg, eb] = rgba(o.emissive)
    material.emissive.setRGB(er / 255, eg / 255, eb / 255, SRGBColorSpace)
    material.emissiveIntensity = o.emissiveIntensity
    material.metalness = o.metalness
    material.roughness = o.roughness
    material.opacity = o.opacity * a
    const side = o.type === 'plane3d' ? DoubleSide : FrontSide
    if (material.side !== side) {
      material.side = side
      material.needsUpdate = true
    }
    return material
  }

  #context(): { renderer: WebGLRenderer; canvas: OffscreenCanvas } | { error: string } {
    if (this.#renderer && this.#canvas && !this.#lost) return { renderer: this.#renderer, canvas: this.#canvas }
    this.#release()
    try {
      const canvas = new OffscreenCanvas(1, 1)
      canvas.addEventListener('webglcontextlost', () => {
        this.#lost = true
      })
      const renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        stencil: false
      })
      renderer.setPixelRatio(1)
      renderer.outputColorSpace = SRGBColorSpace
      renderer.toneMapping = NoToneMapping
      this.#canvas = canvas
      this.#renderer = renderer
      this.#lost = false
      return { renderer, canvas }
    } catch (error) {
      return { error: `3D cannot be drawn here: no WebGL2 context (${(error as Error).message})` }
    }
  }

  #release(): void {
    for (const material of this.#materials) material?.dispose()
    this.#materials = []
    this.#renderer?.dispose()
    this.#renderer = null
    this.#canvas = null
  }

  /** Frees the context, the geometry and the fonts. A later draw starts again from nothing. */
  dispose(): void {
    this.#release()
    this.#geometries.clear()
    this.#fonts.clear()
  }

  /** For a probe: lose the context on purpose, as a GPU reset would. */
  forceContextLoss(): void {
    this.#renderer?.forceContextLoss()
  }
}
