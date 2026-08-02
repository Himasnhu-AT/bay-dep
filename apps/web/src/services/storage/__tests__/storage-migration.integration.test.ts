//! Integration: the storage migration runner over a real (fake) IndexedDB.
//!
//! Unlike the pure per-migration unit tests, this drives `runStorageMigrations` end-to-end
//! against an in-memory IndexedDB — exercising `IndexedDBAdapter`, the version-detection +
//! ordering logic, and the record write-back. It is also the regression test for the
//! positional-args bug in `runner.ts` (which made it call `indexedDB.open(undefined)`).
//!
//! We seed the committed **v30 golden** so only the pure `v30→v31` step runs. (Starting from
//! v0 would exercise v1→v2's legacy-store *deletes*, which hang under fake-indexeddb because
//! `IndexedDBAdapter` intentionally keeps connections open — a real trait that only bites the
//! in-memory shim. Cross-checking the runner against the golden lineage is the useful signal.)
//! No per-test DB cleanup is needed: the runner skips projects already at the current version.

import "fake-indexeddb/auto";

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";
import {
	CURRENT_PROJECT_VERSION,
	migrations,
	runStorageMigrations,
} from "@/services/storage/migrations";
import type { ProjectRecord } from "@/services/storage/migrations/transformers/types";

function repoRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 12; i += 1) {
		if (existsSync(resolve(dir, "Cargo.toml")) && existsSync(resolve(dir, "apps"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	throw new Error("could not locate repo root");
}

const GOLDEN_DIR = resolve(repoRoot(), "fixtures/golden/migrations");

function goldenProject(version: number): ProjectRecord {
	return JSON.parse(readFileSync(resolve(GOLDEN_DIR, `v${version}.json`), "utf8"));
}

function projectsAdapter() {
	return new IndexedDBAdapter<ProjectRecord>({
		dbName: "video-editor-projects",
		storeName: "projects",
		version: 1,
	});
}

async function seed(id: string, record: ProjectRecord): Promise<void> {
	await projectsAdapter().set({ key: id, value: { ...record, id } });
}

function assertCurrentSchema(project: ProjectRecord | null): void {
	expect(project).not.toBeNull();
	expect(project?.version).toBe(CURRENT_PROJECT_VERSION);
	const scenes = project?.scenes as Array<Record<string, unknown>> | undefined;
	expect(Array.isArray(scenes)).toBe(true);
	expect(scenes?.filter((scene) => scene.isMain === true)).toHaveLength(1);
	expect(project?.settings).toBeDefined();
	expect(project?.metadata).toBeDefined();
	expect(project?.currentSceneId).toBeTruthy();
}

describe("storage migration runner (integration, fake IndexedDB)", () => {
	it("migrates a persisted v30 project up to the current schema version", async () => {
		await seed("proj-30", goldenProject(30));

		const { migratedCount } = await runStorageMigrations({ migrations });
		expect(migratedCount).toBeGreaterThanOrEqual(1);

		assertCurrentSchema(await projectsAdapter().get("proj-30"));
	}, 20000);

	it("re-running is a no-op for projects already at the current version", async () => {
		// proj-30 is already at CURRENT from the previous test; nothing new to migrate.
		const { migratedCount } = await runStorageMigrations({ migrations });
		expect(migratedCount).toBe(0);
		assertCurrentSchema(await projectsAdapter().get("proj-30"));
	}, 20000);

	it("migrates several projects in one run, skipping ones already current", async () => {
		await seed("proj-a", goldenProject(30));
		await seed("proj-b", goldenProject(30));

		const { migratedCount } = await runStorageMigrations({ migrations });
		// Exactly the two freshly-seeded v30 projects migrate; proj-30 is already current.
		expect(migratedCount).toBe(2);

		assertCurrentSchema(await projectsAdapter().get("proj-a"));
		assertCurrentSchema(await projectsAdapter().get("proj-b"));
	}, 20000);
});
