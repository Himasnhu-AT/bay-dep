// Ambient declaration so side-effect CSS imports (e.g. `import "./globals.css"`)
// type-check under a plain `tsc --noEmit`. Next's webpack handles the actual loading.
declare module "*.css";
