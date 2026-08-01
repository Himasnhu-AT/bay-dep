import type { EffectDefinition } from "@/effects/types";

export const BRIGHTNESS_SHADER = "brightness";

// 1.0 leaves the image unchanged; <1 darkens, >1 brightens.
export const DEFAULT_BRIGHTNESS_AMOUNT = 1;

function parseAmount(effectParams: Record<string, unknown>): number {
	const raw = effectParams.amount;
	const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
	return Number.isFinite(value) ? value : DEFAULT_BRIGHTNESS_AMOUNT;
}

export const brightnessEffectDefinition: EffectDefinition = {
	type: "brightness",
	name: "Brightness",
	keywords: ["brightness", "exposure", "light", "dim", "darken"],
	params: [
		{
			key: "amount",
			label: "Amount",
			type: "number",
			default: DEFAULT_BRIGHTNESS_AMOUNT,
			min: 0,
			max: 3,
			step: 0.05,
		},
	],
	renderer: {
		passes: [
			{
				shader: BRIGHTNESS_SHADER,
				uniforms: ({ effectParams }) => ({
					u_amount: parseAmount(effectParams),
				}),
			},
		],
	},
};
