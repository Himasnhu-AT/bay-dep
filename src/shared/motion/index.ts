/**
 * bay's move library: measured moves as pure functions of time.
 *
 * One vocabulary, two consumers. A `.brf` module writes `import { BM } from 'bay'`; an HTML
 * composition writes `<script src="bay-motion.js"></script>` and gets the same object as the
 * global `BM` (main writes that file beside the composition; its text is generated from this
 * folder by `pnpm gen:motion`, never kept by hand). Either way a move is `BM.wordLand(t, 0.2)`.
 *
 * Families: `core` (curves, springs, spline), `matrix`, `enter` (something arrives), `carry`
 * (the next beat grows out of this one), `contact` (one thing causes another, and the sims),
 * `camera` (one camera over one world, and what it does to the screen).
 */

export * from './core'
export * from './matrix'
export * from './enter'
export * from './carry'
export * from './contact'
export * from './camera'
