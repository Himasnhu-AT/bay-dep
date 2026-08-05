import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import { brightnessEffectDefinition } from "./brightness";

const defaultEffects = [blurEffectDefinition, brightnessEffectDefinition];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition,
		});
	}
}
