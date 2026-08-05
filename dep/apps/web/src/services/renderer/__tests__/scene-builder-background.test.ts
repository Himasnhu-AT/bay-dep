import { describe, expect, test } from "vitest";

import type { SceneTracks } from "@/timeline";
import type { TBackground } from "@/project/types";
import { buildScene } from "@/services/renderer/scene-builder";
import { ColorNode } from "@/services/renderer/nodes/color-node";

// Minimal empty scene: no visible content, so the only children of the root are
// whatever the background branch of buildScene contributes.
const emptyTracks = {
	overlay: [],
	main: { id: "main", type: "video", hidden: false, elements: [] },
	audio: [],
} as unknown as SceneTracks;

function buildRoot(background: TBackground) {
	return buildScene({
		canvasSize: { width: 1920, height: 1080 },
		tracks: emptyTracks,
		mediaAssets: [],
		duration: 0,
		background,
		isPreview: false,
	} as unknown as Parameters<typeof buildScene>[0]);
}

describe("buildScene background", () => {
	test("adds a single ColorNode carrying the chosen solid color", () => {
		const root = buildRoot({ type: "color", color: "#ff0000" });
		const colorNodes = root.children.filter((n) => n instanceof ColorNode);

		expect(colorNodes).toHaveLength(1);
		expect((colorNodes[0] as ColorNode).params.color).toBe("#ff0000");
	});

	test("treats 'transparent' as a sentinel and adds no ColorNode", () => {
		const root = buildRoot({ type: "color", color: "transparent" });
		expect(root.children.some((n) => n instanceof ColorNode)).toBe(false);
	});

	test("a blur background never adds a solid ColorNode", () => {
		const root = buildRoot({ type: "blur", blurIntensity: 40 });
		expect(root.children.some((n) => n instanceof ColorNode)).toBe(false);
	});
});
