/**
 * How an HTML composition gets bay's move library (`./motion`).
 *
 * A composition window may load only files in its own folder (`src/main/html/sandbox.ts`), so the
 * library has to be a file there. An author asks for it by name —
 *
 *     <script src="bay-motion.js"></script>
 *
 * — and main writes that file beside the composition whenever one that names it is written. The
 * file's text is generated from the TypeScript (`./motion-bundle.ts`, `pnpm gen:motion`); this
 * module is the part both processes read: the name, the global, how a document asks, and the
 * sentence for each thing that can happen.
 */

/** The file main writes beside a composition. Same folder only: `lib/bay-motion.js` is the author's own. */
export const MOTION_FILE = 'bay-motion.js'

/** The global the script defines. A `.brf` module gets the same object as `import { BM } from 'bay'`. */
export const MOTION_GLOBAL = 'BM'

/**
 * How bay's own copy starts. A `bay-motion.js` that does not start this way is somebody else's
 * file, and bay never overwrites it.
 */
export const MOTION_BANNER = '/*! bay-motion.js'

/** Whether the document loads `bay-motion.js` from its own folder with a script tag. */
export function referencesMotionFile(html: string): boolean {
  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0])
    const value = (src?.[1] ?? src?.[2] ?? src?.[3] ?? '').trim()
    if (value === MOTION_FILE || value === `./${MOTION_FILE}`) return true
  }
  return false
}

/**
 * Whether the document calls `BM.something` without anything in it defining `BM` — the shape of a
 * composition whose author forgot the script tag.
 */
export function usesMotionGlobal(html: string): boolean {
  if (!/\bBM\s*\.\s*[A-Za-z_$]/.test(html)) return false
  return !/\b(?:const|let|var|function|class)\s+BM\b|\bBM\s*=(?!=)/.test(html)
}

/**
 * What happened to the library when a composition was written. Absent altogether when the
 * document neither asks for it nor uses it.
 */
export type MotionFileResult =
  /** The tag is there and bay's current library is beside the composition. */
  | { state: 'written' }
  /** The tag is there, and a `bay-motion.js` bay did not write is already beside the composition. Left alone. */
  | { state: 'foreign' }
  /** The tag is there and the file could not be written. */
  | { state: 'failed'; error: string }
  /** The document calls `BM.…` and has no tag for the file. */
  | { state: 'unreferenced' }

/** The line a person (or an agent) reads for each state. Only `written` is good news. */
export function motionFileMessage(result: MotionFileResult): string {
  switch (result.state) {
    case 'written':
      return `${MOTION_FILE} is beside the composition: window.${MOTION_GLOBAL} is bay's move library.`
    case 'foreign':
      return (
        `A ${MOTION_FILE} that bay did not write is already beside this composition, and bay left it alone, ` +
        `so window.${MOTION_GLOBAL} is whatever that file defines — not bay's move library. Rename that file ` +
        `(and its <script> tag), or remove it and write the composition again.`
      )
    case 'failed':
      return (
        `${MOTION_FILE} could not be written beside the composition (${result.error}), so its <script> tag ` +
        `loads nothing, every ${MOTION_GLOBAL}.… call throws, and the clip is a still frame.`
      )
    case 'unreferenced':
      return (
        `This composition calls ${MOTION_GLOBAL}.… but has no <script src="${MOTION_FILE}"></script>, so ` +
        `${MOTION_GLOBAL} is undefined, time(t) throws, and the clip is a still frame. Add that tag above your ` +
        `own script; bay writes the file beside the composition when it sees the tag.`
      )
  }
}
