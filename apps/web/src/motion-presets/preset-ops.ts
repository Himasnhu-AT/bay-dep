import { cloneAnimations } from "@/animation";
import type { ElementAnimations } from "@/animation/types";
import type { Effect } from "@/effects/types";
import type { VisualElement } from "@/timeline";
import { generateUUID } from "@/utils/id";

import type { MotionGraphicsPreset } from "./types";

/**
 * Snapshot an element's effects + animations into a preset payload. The bundle is
 * detached from the source element (cloned) so later edits don't mutate the preset.
 */
export function captureMotionPreset({
	element,
	id = generateUUID(),
	name,
	savedAt,
}: {
	element: VisualElement;
	id?: string;
	name: string;
	savedAt: string;
}): MotionGraphicsPreset {
	return {
		id,
		name,
		savedAt,
		effects: (element.effects ?? []).map((effect) => ({
			...effect,
			params: { ...effect.params },
		})),
		animations: cloneAnimations({ animations: element.animations }),
	};
}

/**
 * Rewrite `effects.<oldId>.…` animation-path prefixes to the stamped effect ids so
 * effect-param channels stay bound to the effects they animate.
 */
function remapEffectAnimationPaths({
	animations,
	effectIdMap,
}: {
	animations: ElementAnimations | undefined;
	effectIdMap: Map<string, string>;
}): ElementAnimations | undefined {
	if (!animations) {
		return undefined;
	}
	const remapped: ElementAnimations = {};
	for (const [path, data] of Object.entries(animations)) {
		const match = path.match(/^effects\.([^.]+)\.(.+)$/);
		const mappedId = match ? effectIdMap.get(match[1]) : undefined;
		const nextPath = mappedId ? `effects.${mappedId}.${match?.[2]}` : path;
		remapped[nextPath] = data;
	}
	return remapped;
}

/**
 * Prepare a preset for a fresh element: mint new effect ids (so repeated applies
 * don't collide), remap the matching animation-path prefixes, and regenerate
 * keyframe ids. Returns the pieces to merge onto the target element.
 */
export function stampPreset({
	preset,
	generateId = generateUUID,
}: {
	preset: MotionGraphicsPreset;
	generateId?: () => string;
}): { effects: Effect[]; animations: ElementAnimations | undefined } {
	const effectIdMap = new Map<string, string>();
	const effects = preset.effects.map((effect) => {
		const newId = generateId();
		effectIdMap.set(effect.id, newId);
		return { ...effect, id: newId, params: { ...effect.params } };
	});

	const remapped = remapEffectAnimationPaths({
		animations: preset.animations,
		effectIdMap,
	});
	const animations = cloneAnimations({
		animations: remapped,
		shouldRegenerateKeyframeIds: true,
	});

	return { effects, animations };
}

/**
 * Append a preset's (freshly-stamped) effects and merge its animations onto an
 * element. Existing effects/animations on the element are preserved.
 */
export function applyPresetToElement({
	element,
	preset,
	generateId = generateUUID,
}: {
	element: VisualElement;
	preset: MotionGraphicsPreset;
	generateId?: () => string;
}): VisualElement {
	const { effects, animations } = stampPreset({ preset, generateId });
	return {
		...element,
		effects: [...(element.effects ?? []), ...effects],
		animations:
			element.animations || animations
				? { ...(element.animations ?? {}), ...(animations ?? {}) }
				: undefined,
	};
}
