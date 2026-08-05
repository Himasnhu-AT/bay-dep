//! P0-ARCH-02 — golden-fixture capture (headless, provenance-correct).
//!
//! This is the *capture command* for the fixtures the native test strategy depends on,
//! and simultaneously a *regression guard* for the web app:
//!
//!   • `CAPTURE_GOLDEN=1 pnpm --filter web exec vitest run src/services/storage/migrations/__tests__/golden-fixtures.test.ts`
//!       → (re)writes the committed fixtures under `<repo>/fixtures/golden/`.
//!   • plain `pnpm --filter web test`
//!       → asserts the current code still produces byte-identical fixtures (fails if a
//!         migration or the keybinding defaults drift from what's committed).
//!
//! Only the fully headless, deterministic sources are captured here — the real project
//! migration chain (v0→v31) and the default keybindings. The GPU/browser-coupled goldens
//! (FrameDescriptor, media-probe, audio-mix) need WebCodecs / Web Audio / a CanvasRenderer
//! and are captured from the running app; see `fixtures/golden/README.md`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDefaultShortcuts } from "@/actions/definitions";
import { serializeKeybindingsState } from "@/actions/keybindings/persistence";
import { migrations } from "@/services/storage/migrations";
import type { ProjectRecord } from "@/services/storage/migrations/transformers/types";
import { transformProjectV1ToV2 } from "@/services/storage/migrations/transformers/v1-to-v2";

const CAPTURE = Boolean(process.env.CAPTURE_GOLDEN);
const FIXED_TIME = new Date("2020-01-01T00:00:00.000Z");

/** Walk up until we find the JS workspace root (dep/: holds pnpm-workspace.yaml + fixtures/). */
function repoRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 12; i += 1) {
		if (existsSync(resolve(dir, "pnpm-workspace.yaml")) && existsSync(resolve(dir, "fixtures"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	throw new Error("could not locate repo root from golden-fixtures test");
}

const GOLDEN_DIR = resolve(repoRoot(), "fixtures/golden");

/** Deterministic capture environment: fixed clock + counter-based UUIDs, so the real
 *  transformers (which call `new Date()` and `crypto.randomUUID`) yield byte-stable output. */
let originalRandomUUID: typeof crypto.randomUUID;
let uuidCounter = 0;

beforeAll(() => {
	// Freeze the clock: the real transformers call `new Date()` / `Date.now()`.
	vi.useFakeTimers();
	vi.setSystemTime(FIXED_TIME);

	// Deterministic v4-shaped UUIDs (the transformers call crypto.randomUUID).
	originalRandomUUID = crypto.randomUUID.bind(crypto);
	uuidCounter = 0;
	crypto.randomUUID = (() => {
		const n = (uuidCounter++).toString(16).padStart(12, "0");
		return `00000000-0000-4000-8000-${n}`;
	}) as typeof crypto.randomUUID;
});

afterAll(() => {
	crypto.randomUUID = originalRandomUUID;
	vi.useRealTimers();
});

/** Assert a computed fixture matches the committed file, or (in capture mode) write it. */
function reconcile({ path, value }: { path: string; value: unknown }): void {
	const absolute = resolve(GOLDEN_DIR, path);
	const serialized = `${JSON.stringify(value, null, "\t")}\n`;

	if (CAPTURE) {
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, serialized);
		return;
	}

	if (!existsSync(absolute)) {
		throw new Error(
			`missing golden fixture ${path}; run with CAPTURE_GOLDEN=1 to generate it`,
		);
	}
	// Compare parsed values so formatting alone never fails the guard.
	expect(value).toEqual(JSON.parse(readFileSync(absolute, "utf8")));
}

describe("golden fixtures: project migration chain v0→v31", () => {
	it("threads one seed project through every migration and captures each version", async () => {
		const ordered = [...migrations].sort((a, b) => a.from - b.from);
		expect(ordered.map((m) => [m.from, m.to])).toEqual(
			Array.from({ length: 31 }, (_, i) => [i, i + 1]),
		);

		// A minimal but valid v0 project: id + name, no `scenes` (v0→v1 wraps it into a
		// main scene). This is the exact shape a brand-new pre-scenes project had.
		const seed: ProjectRecord = { id: "golden-project", name: "Golden Project" };
		const projectId = "golden-project";

		reconcile({ path: "migrations/v0.json", value: seed });

		const manifest: Array<{ from: number; to: number; skipped: boolean; reason?: string }> = [];
		let project: ProjectRecord = seed;

		for (const migration of ordered) {
			// v1→v2 is the one migration whose `.run()` reads legacy per-scene tracks from
			// separate IndexedDB stores and then destructively deletes them. Drive its pure
			// transformer directly with an explicit (empty, for this seed) context — exactly
			// what its own unit test does — to stay headless and avoid the destructive
			// cleanup. Every other step runs its real `.run()` unchanged.
			const result =
				migration.from === 1
					? transformProjectV1ToV2({
							project,
							context: { legacyTracksBySceneId: {}, mediaTypesById: {} },
						})
					: await migration.run({ projectId, project });
			manifest.push({
				from: migration.from,
				to: migration.to,
				skipped: result.skipped,
				reason: result.reason,
			});
			// Capture the concrete project at this version regardless of skip (a skip records
			// the unchanged project — an honest no-op step).
			project = result.project;
			reconcile({ path: `migrations/v${migration.to}.json`, value: project });
		}

		// The end of the chain must be at the current schema version.
		expect((project as { version?: number }).version).toBe(31);
		reconcile({ path: "migrations/_manifest.json", value: manifest });
	});
});

describe("golden fixtures: default keybindings", () => {
	it("captures the serialized default keybinding map", () => {
		const serialized = serializeKeybindingsState({
			keybindings: getDefaultShortcuts(),
			isCustomized: false,
		});
		// Sanity: a non-trivial, deterministic map.
		expect(Object.keys(serialized.keybindings).length).toBeGreaterThan(0);
		expect(serialized.isCustomized).toBe(false);
		reconcile({ path: "keybindings/default.json", value: serialized });
	});
});
