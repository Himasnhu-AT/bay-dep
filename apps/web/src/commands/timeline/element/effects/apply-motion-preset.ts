import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { isVisualElement, updateElementInSceneTracks } from "@/timeline";
import type { SceneTracks, VisualElement } from "@/timeline";
import { applyPresetToElement } from "@/motion-presets/preset-ops";
import type { MotionGraphicsPreset } from "@/motion-presets/types";

/**
 * Stamp a saved motion-graphics preset (effects + keyframe animations) onto a
 * visual element. New effect ids are minted and the matching animation paths are
 * remapped inside `applyPresetToElement`, so repeated applies never collide.
 */
export class ApplyMotionPresetCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly preset: MotionGraphicsPreset;

	constructor({
		trackId,
		elementId,
		preset,
	}: {
		trackId: string;
		elementId: string;
		preset: MotionGraphicsPreset;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.preset = preset;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			elementPredicate: isVisualElement,
			update: (element) =>
				applyPresetToElement({
					element: element as VisualElement,
					preset: this.preset,
				}),
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
