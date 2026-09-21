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
        output: { entryFileNames: '[name].js' }
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
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
