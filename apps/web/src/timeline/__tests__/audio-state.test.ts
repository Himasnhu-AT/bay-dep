import { describe, expect, test } from "vitest";

import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import type { ScalarAnimationKey } from "@/animation/types";
import {
	clampDb,
	dBToLinear,
	getElementVolume,
	hasAnimatedVolume,
	isElementMuted,
	resolveEffectiveAudioGain,
	type AudioCapableElement,
} from "@/timeline/audio-state";

function audioElement(overrides: Record<string, unknown> = {}): AudioCapableElement {
	return {
		id: "a1",
		type: "audio",
		trackId: "t1",
		mediaId: "media-1",
		name: "clip.mp4",
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: TICKS_PER_SECOND }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
		params: { volume: 0, muted: false },
		...overrides,
	} as unknown as AudioCapableElement;
}

// -20 dB → 0 dB linear ramp over one second.
function rampAnimations() {
	const keys: ScalarAnimationKey[] = [
		{
			id: "k0",
			time: mediaTime({ ticks: 0 }),
			value: -20,
			segmentToNext: "linear",
			tangentMode: "auto",
		},
		{
			id: "k1",
			time: mediaTime({ ticks: TICKS_PER_SECOND }),
			value: 0,
			segmentToNext: "linear",
			tangentMode: "auto",
		},
	];
	return { volume: { keys } };
}

describe("dB helpers", () => {
	test("dBToLinear maps known anchors", () => {
		expect(dBToLinear(0)).toBeCloseTo(1, 6);
		expect(dBToLinear(-20)).toBeCloseTo(0.1, 6);
	});

	test("clampDb bounds the range and neutralises non-finite input", () => {
		expect(clampDb(Number.POSITIVE_INFINITY)).not.toBe(
			Number.POSITIVE_INFINITY,
		);
		expect(clampDb(Number.NaN)).toBe(0);
	});
});

describe("element volume state", () => {
	test("getElementVolume / isElementMuted read params", () => {
		expect(getElementVolume({ element: audioElement({ params: { volume: 6 } }) })).toBe(6);
		expect(isElementMuted({ element: audioElement({ params: { muted: true } }) })).toBe(true);
		expect(isElementMuted({ element: audioElement() })).toBe(false);
	});

	test("hasAnimatedVolume detects a volume channel", () => {
		expect(hasAnimatedVolume({ element: audioElement() })).toBe(false);
		expect(
			hasAnimatedVolume({ element: audioElement({ animations: rampAnimations() }) }),
		).toBe(true);
	});
});

describe("resolveEffectiveAudioGain", () => {
	test("static volume converts dB → linear", () => {
		expect(
			resolveEffectiveAudioGain({
				element: audioElement({ params: { volume: 0, muted: false } }),
				localTime: 0.5,
			}),
		).toBeCloseTo(1, 6);
	});

	test("muted (element or track) yields silence", () => {
		expect(
			resolveEffectiveAudioGain({
				element: audioElement({ params: { volume: 0, muted: true } }),
				localTime: 0,
			}),
		).toBe(0);
		expect(
			resolveEffectiveAudioGain({
				element: audioElement(),
				trackMuted: true,
				localTime: 0,
			}),
		).toBe(0);
	});

	test("follows the keyframed volume ramp at its endpoints", () => {
		const element = audioElement({ animations: rampAnimations() });
		// t=0 → -20 dB → 0.1 linear
		expect(resolveEffectiveAudioGain({ element, localTime: 0 })).toBeCloseTo(
			0.1,
			5,
		);
		// t=1s → 0 dB → 1.0 linear
		expect(resolveEffectiveAudioGain({ element, localTime: 1 })).toBeCloseTo(
			1,
			5,
		);
	});
});
