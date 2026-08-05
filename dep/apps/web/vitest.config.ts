import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Pure-logic unit tests (ported from bun:test). Node environment; the `@/*`
// path alias is resolved from tsconfig.json by vite-tsconfig-paths.
export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		server: {
			deps: {
				// opencut-wasm ships `.wasm` via the ESM-integration proposal, which
				// Vite's transform can't handle. Externalise it so Node loads it
				// directly (works for both the published package and a local link).
				// The resolved files use underscores (opencut_wasm_bg.wasm), so match both.
				external: [/opencut[-_]wasm/],
			},
		},
	},
});
