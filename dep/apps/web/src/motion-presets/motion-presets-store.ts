import { create } from "zustand";
import { toast } from "sonner";

import { EditorCore } from "@/core";
import { storageService } from "@/services/storage/service";
import { isVisualElement } from "@/timeline";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import { generateUUID } from "@/utils/id";

import { captureMotionPreset } from "./preset-ops";
import type { MotionGraphicsPreset } from "./types";

interface MotionPresetsStore {
	presets: MotionGraphicsPreset[];
	isLoaded: boolean;
	isLoading: boolean;
	error: string | null;

	loadPresets: () => Promise<void>;
	savePresetFromElement: (args: {
		trackId: string;
		elementId: string;
		name: string;
	}) => Promise<void>;
	removePreset: (args: { presetId: string }) => Promise<void>;
	applyPreset: (args: {
		trackId: string;
		elementId: string;
		preset: MotionGraphicsPreset;
	}) => void;
}

export const useMotionPresetsStore = create<MotionPresetsStore>((set, get) => ({
	presets: [],
	isLoaded: false,
	isLoading: false,
	error: null,

	loadPresets: async () => {
		set({ isLoading: true });
		try {
			const data = await storageService.loadPresets();
			set({
				presets: data.presets,
				isLoaded: true,
				isLoading: false,
				error: null,
			});
		} catch (error) {
			set({
				isLoading: false,
				error:
					error instanceof Error ? error.message : "Failed to load presets",
			});
		}
	},

	savePresetFromElement: async ({ trackId, elementId, name }) => {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		const track = findTrackInSceneTracks({ tracks, trackId });
		const element = track?.elements.find((el) => el.id === elementId);
		if (!element || !isVisualElement(element)) {
			toast.error("Select a clip with effects or keyframes to save a preset");
			return;
		}
		const preset = captureMotionPreset({
			element,
			id: generateUUID(),
			name,
			savedAt: new Date().toISOString(),
		});
		await storageService.savePreset({ preset });
		await get().loadPresets();
		toast.success(`Saved preset "${name}"`);
	},

	removePreset: async ({ presetId }) => {
		await storageService.removePreset({ presetId });
		await get().loadPresets();
	},

	applyPreset: ({ trackId, elementId, preset }) => {
		EditorCore.getInstance().timeline.applyMotionPreset({
			trackId,
			elementId,
			preset,
		});
	},
}));
