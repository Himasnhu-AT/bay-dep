/**
 * What the renderer sees.
 *
 * Nothing is declared here. `window.bay` is `BayApi`, declared globally in
 * `src/shared/ipc.ts`, and that is the only declaration there should be — TypeScript requires
 * every declaration of a property to be identical, so a second one here could only ever
 * repeat it or conflict with it.
 *
 * This file exists because `tsconfig.web.json` includes `src/preload/*.d.ts` and nothing else
 * from this directory. That is the rule that keeps renderer code from importing preload
 * *code*, and it is worth a file to say so.
 */

export {}
