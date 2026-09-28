/**
 * Types for what the 3D text path imports from outside the tree.
 *
 * The slice of opentype.js 2.0 that 3D text uses (`text3dGeometry.ts`). The package ships no
 * types, and its `main` is a browser IIFE that Node cannot import by name, so the ES build is
 * imported by path — which is also what Vite picks.
 */
declare module 'opentype.js/dist/opentype.mjs' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z'
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }
  export interface Glyph {
    index: number
    advanceWidth?: number
    getPath(x: number, y: number, fontSize: number): { commands: PathCommand[] }
  }
  export interface Font {
    unitsPerEm: number
    charToGlyph(char: string): Glyph
    getKerningValue(left: Glyph, right: Glyph): number
  }
  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): Font
}

/**
 * Vite's `?inline`: the file's bytes as a `data:` URL string in the chunk. The built-in 3D font
 * (`scene3d.ts`) arrives this way, so it needs no fetch — `connect-src` does not admit `data:`.
 */
declare module '*.woff?inline' {
  const dataUrl: string
  export default dataUrl
}
