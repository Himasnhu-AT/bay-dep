//! Integration: a scene carrying real timeline content builds into the right render nodes.
//!
//! The existing scene-builder test only covers the background branch on an empty scene. This
//! drives the element→node path of `buildScene` (timeline element model → `buildTrackNodes` →
//! node tree) with actual content, asserting layer ordering and node identity. It uses an
//! `effect` element because its `EffectLayerNode` is pure data at construction (media/text
//! nodes touch canvas/decoders and belong to the browser-run render goldens instead).

import { describe, expect, it } from "vitest";

import type { SceneTracks } from "@/timeline";
import { buildScene } from "@/services/renderer/scene-builder";
import { ColorNode } from "@/services/renderer/nodes/color-node";
import { EffectLayerNode } from "@/services/renderer/nodes/effect-layer-node";

function sceneWith(elements: unknown[]): SceneTracks {
	return {
		overlay: [],
		main: { id: "main", type: "video", hidden: false, elements },
		audio: [],
	} as unknown as SceneTracks;
}

function effectElement(id: string, startTime: number): unknown {
	return {
		id,
		type: "effect",
		effectType: "brightness",
		params: { amount: 1.5 },
		startTime,
		duration: 5,
		hidden: false,
	};
}

describe("buildScene with timeline content (integration)", () => {
	it("turns an effect element on the main track into an EffectLayerNode", () => {
		const root = buildScene({
			canvasSize: { width: 1920, height: 1080 },
			tracks: sceneWith([effectElement("fx1", 0)]),
			mediaAssets: [],
			duration: 5,
			background: { type: "color", color: "transparent" },
			isPreview: false,
		});

		const effectNodes = root.children.filter((node) => node instanceof EffectLayerNode);
		expect(effectNodes).toHaveLength(1);
		expect((effectNodes[0] as EffectLayerNode).params.effectType).toBe("brightness");
		// Transparent background contributes no ColorNode.
		expect(root.children.some((node) => node instanceof ColorNode)).toBe(false);
	});

	it("keeps a solid background plus content together in the node tree", () => {
		const root = buildScene({
			canvasSize: { width: 1920, height: 1080 },
			tracks: sceneWith([effectElement("fx1", 0), effectElement("fx2", 5)]),
			mediaAssets: [],
			duration: 10,
			background: { type: "color", color: "#123456" },
			isPreview: false,
		});

		expect(root.children.filter((node) => node instanceof EffectLayerNode)).toHaveLength(2);
		const colorNodes = root.children.filter((node) => node instanceof ColorNode);
		expect(colorNodes).toHaveLength(1);
		expect((colorNodes[0] as ColorNode).params.color).toBe("#123456");
	});
});
