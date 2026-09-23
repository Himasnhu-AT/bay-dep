import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        // Two entries from one config: the app, and the MCP proxy an agent client spawns.
        // The proxy is a separate bundle because it runs as plain Node — stdio JSON-RPC needs
        // a byte-exact stdout and Chromium does not provide one.
        input: {
          index: resolve('src/main/index.ts'),
          'mcp/index': resolve('src/main/mcp/entry.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        // Two preloads: the app's contextBridge, and a two-line shim for composition windows
        // that creates `window.__timelines` before a composition's own scripts run. The second
        // is a separate entry because it loads into a different kind of window — untrusted
        // local HTML with no bridge — and must never carry the app's surface with it.
        input: {
          index: resolve('src/preload/index.ts'),
          composition: resolve('src/preload/composition.ts')
        },
        // CommonJS, because a sandboxed renderer cannot load an ES-module preload, and the
        // composition window is sandboxed. `.cjs` because package.json says "type": "module".
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    // Dev only. `sucrase` is reached only from the `.brf` worker (`new URL('./brf.worker.ts',
    // import.meta.url)`), which Vite's start-up scan of index.html does not follow — so the first
    // `write_brf` of a session with a cold `node_modules/.vite` discovered it, re-optimised, and
    // reloaded the editor mid-call, taking any unsaved edits with it. Measured twice (test.md §2.10).
    optimizeDeps: { include: ['sucrase'] },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
