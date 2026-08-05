import { describe, expect, test } from "vitest";

import { mediaTime } from "@/wasm";
import type { ScalarAnimationKey, ScalarChannel } from "@/animation/types";
import type { TimelineElement, VideoElement } from "@/timeline/types";
import {
	buildSeparatedAudioElement,
	canExtractSourceAudio,
	canRecoverSourceAudio,
	canToggleSourceAudio,
	getSourceAudioActionLabel,
	isSourceAudioEnabled,
	isSourceAudioSeparated,
} from "@/timeline/audio-separation";

function volumeKeys(): ScalarAnimationKey[] {
	return [
		{
			id: "src-k0",
			time: mediaTime({ ticks: 0 }),
			value: -20,
			segmentToNext: "linear",
			tangentMode: "auto",
		},
		{
			id: "src-k1",
			time: mediaTime({ ticks: 1000 }),
			value: 0,
			segmentToNext: "linear",
			tangentMode: "auto",
		},
	];
}

function videoElement(overrides: Record<string, unknown> = {}): VideoElement {
	return {
		id: "v1",
		type: "video",
		trackId: "t1",
		mediaId: "media-1",
		name: "clip.mp4",
		startTime: mediaTime({ ticks: 5 }),
		duration: mediaTime({ ticks: 100 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
		sourceDuration: mediaTime({ ticks: 100 }),
		params: { volume: 6, muted: false },
		isSourceAudioEnabled: true,
		animations: { volume: { keys: volumeKeys() } },
		...overrides,
	} as unknown as VideoElement;
}

describe("source-audio separation guards", () => {
	test("canExtract requires a video with enabled source audio and an audio-bearing asset", () => {
		const el = videoElement();
		expect(canExtractSourceAudio(el, { hasAudio: true })).toBe(true);
		expect(canExtractSourceAudio(el, { hasAudio: false })).toBe(false);
		expect(canExtractSourceAudio(el, null)).toBe(false);
	});

	test("canExtract is false for non-video elements", () => {
		const audioEl = { type: "audio" } as unknown as TimelineElement;
		expect(canExtractSourceAudio(audioEl, { hasAudio: true })).toBe(false);
	});

	test("a separated clip can be recovered but not re-extracted", () => {
		const separated = videoElement({ isSourceAudioEnabled: false });
		expect(isSourceAudioSeparated({ element: separated })).toBe(true);
		expect(isSourceAudioEnabled({ element: separated })).toBe(false);
		expect(canRecoverSourceAudio(separated)).toBe(true);
		expect(canExtractSourceAudio(separated, { hasAudio: true })).toBe(false);
	});

	test("canToggle covers both directions", () => {
		expect(canToggleSourceAudio(videoElement(), { hasAudio: true })).toBe(true);
		expect(
			canToggleSourceAudio(videoElement({ isSourceAudioEnabled: false }), null),
		).toBe(true);
	});

	test("action label flips with separation state", () => {
		expect(getSourceAudioActionLabel({ element: videoElement() })).toBe(
			"Extract audio",
		);
		expect(
			getSourceAudioActionLabel({
				element: videoElement({ isSourceAudioEnabled: false }),
			}),
		).toBe("Recover audio");
	});
});

describe("buildSeparatedAudioElement", () => {
	test("copies identity, timing and volume params from the source video", () => {
		const audio = buildSeparatedAudioElement({ sourceElement: videoElement() });

		expect(audio.type).toBe("audio");
		expect(audio.sourceType).toBe("upload");
		expect(audio.mediaId).toBe("media-1");
		expect(audio.name).toBe("clip.mp4");
		expect(audio.duration).toBe(mediaTime({ ticks: 100 }));
		expect(audio.startTime).toBe(mediaTime({ ticks: 5 }));
		expect(audio.params.volume).toBe(6);
		expect(audio.params.muted).toBe(false);
	});

	test("clones the volume animation channel with fresh keyframe ids", () => {
		const audio = buildSeparatedAudioElement({ sourceElement: videoElement() });
		const keys = (audio.animations?.volume as ScalarChannel | undefined)?.keys;

		expect(keys).toHaveLength(2);
		// times and values transplant unchanged (keyframe times are element-relative)...
		expect(keys?.map((k) => k.time)).toEqual([
			mediaTime({ ticks: 0 }),
			mediaTime({ ticks: 1000 }),
		]);
		expect(keys?.map((k) => k.value)).toEqual([-20, 0]);
		// ...but ids are regenerated so the two elements don't share keyframe identity.
		expect(keys?.map((k) => k.id)).not.toEqual(["src-k0", "src-k1"]);
		for (const key of keys ?? []) {
			expect(key.id).not.toBe("src-k0");
			expect(key.id).not.toBe("src-k1");
		}
	});

	test("omits animations when the source has no volume channel", () => {
		const audio = buildSeparatedAudioElement({
			sourceElement: videoElement({ animations: undefined }),
		});
		expect(audio.animations).toBeUndefined();
	});
});
