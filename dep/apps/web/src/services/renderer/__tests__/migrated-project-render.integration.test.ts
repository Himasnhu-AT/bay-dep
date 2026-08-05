//! Integration: a migrated project loads through the real storage service and is renderable.
//!
//! Ties three subsystems together end-to-end with real code (no hand-authored intermediate
//! data): the committed migration golden → `storageService.loadProject` (deserialization:
//! ISO dates → `Date`, duration → rounded `MediaTime`, migration-runner no-op for a current
//! project) → the runtime `TProject` → `buildScene` (the renderer's scene→node-tree pass).
//! Proves the output of the migration chain is a project today's app can actually load and draw.

import "fake-indexeddb/auto";

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import { storageService } from "@/services/storage/service";
import { buildScene } from "@/services/renderer/scene-builder";
import { ColorNode } from "@/services/renderer/nodes/color-node";
import type { TProject } from "@/project/types";

function repoRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 12; i += 1) {
		if (existsSync(resolve(dir, "pnpm-workspace.yaml")) && existsSync(resolve(dir, "fixtures"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	throw new Error("could not locate repo root");
}

const PROJECT_ID = "golden-project";

async function seedGoldenV31(): Promise<void> {
	const golden = JSON.parse(
		readFileSync(resolve(repoRoot(), "fixtures/golden/migrations/v31.json"), "utf8"),
	);
	await new IndexedDBAdapter({
		dbName: "video-editor-projects",
		storeName: "projects",
		version: 1,
	}).set({ key: PROJECT_ID, value: { ...golden, id: PROJECT_ID } });
}

describe("migrated project → load → render (integration)", () => {
	let project: TProject;

	beforeAll(async () => {
		await seedGoldenV31();
		const loaded = await storageService.loadProject({ id: PROJECT_ID });
		if (!loaded) {
			throw new Error("loadProject returned null for the seeded golden project");
		}
		project = loaded.project;
	}, 20000);

	it("deserializes the migration golden into a valid runtime project", () => {
		expect(project.version).toBe(31);
		expect(project.metadata.createdAt).toBeInstanceOf(Date);
		expect(project.metadata.updatedAt).toBeInstanceOf(Date);
		expect(project.scenes).toHaveLength(1);
		expect(project.scenes[0].isMain).toBe(true);
		expect(project.currentSceneId).toBe(project.scenes[0].id);
	});

	it("renders the loaded scene into a node tree carrying the background", () => {
		const scene = project.scenes[0];
		const root = buildScene({
			canvasSize: project.settings.canvasSize,
			tracks: scene.tracks,
			mediaAssets: [],
			duration: 0,
			background: project.settings.background,
			isPreview: false,
		});

		// A well-formed root with the solid #000000 background from the migrated settings.
		expect(root.children.length).toBeGreaterThan(0);
		const colorNodes = root.children.filter((node) => node instanceof ColorNode);
		expect(colorNodes).toHaveLength(1);
		expect((colorNodes[0] as ColorNode).params.color).toBe("#000000");
	});
});
