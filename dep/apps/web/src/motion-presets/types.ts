import type { ElementAnimations } from "@/animation/types";
import type { Effect } from "@/effects/types";

/**
 * A reusable "motion graphics" preset: a bundle of an element's effects and its
 * keyframe animations, captured from one element and stampable onto others.
 */
export interface MotionGraphicsPreset {
	id: string;
	name: string;
	savedAt: string;
	effects: Effect[];
	animations?: ElementAnimations;
}

/** The whole preset collection, stored under a single IndexedDB record. */
export interface MotionGraphicsPresetsData {
	presets: MotionGraphicsPreset[];
	lastModified: string;
}
