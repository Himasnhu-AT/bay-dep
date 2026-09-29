// Prints quick-liquid's engine as a script that defines window.QuickLiquid, for injecting into a
// recorded page (the package ships ESM only). node quick-liquid-inject.mjs > /tmp/ql.js
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
const dist = dirname(createRequire(import.meta.url).resolve('quick-liquid/core')).replace(/core$/, '')
const chunk = readdirSync(dist).find((f) => /^chunk-.*\.mjs$/.test(f))
const src = readFileSync(join(dist, chunk), 'utf8').replace(/export\s*\{([^}]*)\};?\s*(\/\/#.*)?$/s, (_, names) => `window.QuickLiquid = { ${names.trim()} };`)
process.stdout.write(`(() => {\n${src}\n})();\n`)
