import { describe, expect, test } from "vitest";

import { mediaTime } from "@/wasm";
import type { ScalarAnimationKey, ScalarChannel } from "@/animation/types";
import type { Effect } from "@/effects/types";
import type { VisualElement } from "@/timeline";
import {
	applyPresetToElement,
	captureMotionPreset,
	stampPreset,
} from "@/motion-presets/preset-ops";
import type { MotionGraphicsPreset } from "@/motion-presets/types";

function scalarChannel(id: string, value: number): ScalarChannel {
	const key: ScalarAnimationKey = {
		id,
		time: mediaTime({ ticks: 0 }),
		value,
		segmentToNext: "linear",
		tangentMode: "auto",
	};
	return { keys: [key] };
}

function brightnessEffect(id: string): Effect {
	return { id, type: "brightness", params: { amount: 1.5 }, enabled: true };
}

function preset(): MotionGraphicsPreset {
	return {
		id: "p1",
		name: "Glow",
		savedAt: "2026-08-01T00:00:00.000Z",
		effects: [brightnessEffect("fx1")],
		animations: {
			opacity: scalarChannel("k-opacity", 1),
			"effects.fx1.params.amount": scalarChannel("k-amount", 1.5),
		},
	};
}

function element(overrides: Partial<VisualElement> = {}): VisualElement {
	return {
		id: "v1",
		type: "video",
		effects: [],
		...overrides,
	} as unknown as VisualElement;
}

// deterministic id minting for assertions
function counter() {
	let n = 0;
	return () => `new${++n}`;
}

describe("captureMotionPreset", () => {
	test("snapshots an element's effects and animations", () => {
		const el = element({
			effects: [brightnessEffect("fx1")],
			animations: { opacity: scalarChannel("k1", 0.5) },
		} as Partial<VisualElement>);

		const captured = captureMotionPreset({
			element: el,
			id: "p1",
			name: "Glow",
			savedAt: "2026-08-01T00:00:00.000Z",
		});

		expect(captured.effects).toHaveLength(1);
		expect(captured.effects[0].type).toBe("brightness");
		expect(captured.animations?.opacity).toBeDefined();
	});
});

describe("stampPreset / applyPresetToElement", () => {
	test("mints new effect ids and remaps the matching animation paths", () => {
		const { effects, animations } = stampPreset({
			preset: preset(),
			generateId: counter(),
		});

		// effect got a fresh id
		expect(effects[0].id).toBe("new1");
		expect(effects[0].id).not.toBe("fx1");

		// the effect-param animation path followed the new id...
		expect(animations?.["effects.new1.params.amount"]).toBeDefined();
		// ...and the old-id path is gone
		expect(animations?.["effects.fx1.params.amount"]).toBeUndefined();

		// unrelated paths are untouched
		expect(animations?.opacity).toBeDefined();
	});

	test("preserves keyframe values while regenerating keyframe ids", () => {
		const { animations } = stampPreset({
			preset: preset(),
			generateId: counter(),
		});

		const opacity = animations?.opacity as ScalarChannel;
		expect(opacity.keys[0].value).toBe(1);
		expect(opacity.keys[0].id).not.toBe("k-opacity"); // regenerated

		const amount = animations?.["effects.new1.params.amount"] as ScalarChannel;
		expect(amount.keys[0].value).toBe(1.5);
	});

	test("appends onto an element, keeping its existing effects", () => {
		const target = element({ effects: [brightnessEffect("existing")] });

		const result = applyPresetToElement({
			element: target,
			preset: preset(),
			generateId: counter(),
		});

		expect(result.effects?.map((e) => e.id)).toEqual(["existing", "new1"]);
		expect(result.animations?.["effects.new1.params.amount"]).toBeDefined();
	});
});
