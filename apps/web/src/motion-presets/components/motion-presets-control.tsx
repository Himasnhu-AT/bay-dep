"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, MagicWand05Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { VisualElement } from "@/timeline";
import { useMotionPresetsStore } from "@/motion-presets/motion-presets-store";

export function MotionPresetsControl({
	element,
	trackId,
}: {
	element: VisualElement;
	trackId: string;
}) {
	const presets = useMotionPresetsStore((s) => s.presets);
	const isLoaded = useMotionPresetsStore((s) => s.isLoaded);
	const loadPresets = useMotionPresetsStore((s) => s.loadPresets);
	const savePresetFromElement = useMotionPresetsStore(
		(s) => s.savePresetFromElement,
	);
	const applyPreset = useMotionPresetsStore((s) => s.applyPreset);
	const removePreset = useMotionPresetsStore((s) => s.removePreset);

	const [name, setName] = useState("");

	useEffect(() => {
		if (!isLoaded) {
			loadPresets();
		}
	}, [isLoaded, loadPresets]);

	const hasSomethingToSave =
		(element.effects?.length ?? 0) > 0 ||
		Object.keys(element.animations ?? {}).length > 0;

	const handleSave = async () => {
		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}
		await savePresetFromElement({
			trackId,
			elementId: element.id,
			name: trimmed,
		});
		setName("");
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" aria-label="Motion presets">
					<HugeiconsIcon icon={MagicWand05Icon} className="size-4" />
					Presets
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 p-3 flex flex-col gap-3">
				<div className="flex flex-col gap-2">
					<span className="text-xs font-medium text-muted-foreground">
						Save as preset
					</span>
					<div className="flex gap-2">
						<Input
							value={name}
							placeholder="Preset name"
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									handleSave();
								}
							}}
						/>
						<Button
							size="sm"
							onClick={handleSave}
							disabled={!hasSomethingToSave || !name.trim()}
						>
							Save
						</Button>
					</div>
					{!hasSomethingToSave && (
						<span className="text-[11px] text-muted-foreground">
							Add an effect or a keyframe to this clip to save a preset.
						</span>
					)}
				</div>

				<div className="flex flex-col gap-1">
					<span className="text-xs font-medium text-muted-foreground">
						Saved presets
					</span>
					{presets.length === 0 ? (
						<span className="text-[11px] text-muted-foreground py-2">
							No presets yet.
						</span>
					) : (
						<ul className="flex flex-col gap-1 max-h-48 overflow-y-auto">
							{presets.map((preset) => (
								<li key={preset.id} className="flex items-center gap-2">
									<button
										type="button"
										className="flex-1 text-left text-sm truncate rounded px-2 py-1 hover:bg-accent"
										onClick={() =>
											applyPreset({ trackId, elementId: element.id, preset })
										}
									>
										{preset.name}
									</button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Remove ${preset.name}`}
										onClick={() => removePreset({ presetId: preset.id })}
									>
										<HugeiconsIcon icon={Delete02Icon} className="size-4" />
									</Button>
								</li>
							))}
						</ul>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
