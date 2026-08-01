import { beforeAll, describe, expect, test } from "vitest";

import { registerDefaultEffects } from "@/effects/definitions";
import {
	BRIGHTNESS_SHADER,
	brightnessEffectDefinition,
} from "@/effects/definitions/brightness";
import { effectsRegistry } from "@/effects/registry";

beforeAll(() => {
	registerDefaultEffects();
});

describe("brightness effect", () => {
	test("is registered among the default effects", () => {
		expect(effectsRegistry.get("brightness")).toBeDefined();
	});

	test("exposes a single 0..3 amount param defaulting to 1", () => {
		const [param] = brightnessEffectDefinition.params;
		expect(param.key).toBe("amount");
		expect(param.type).toBe("number");
		expect(param.default).toBe(1);
		expect(param.min).toBe(0);
		expect(param.max).toBe(3);
	});

	test("its single pass emits u_amount to the brightness shader", () => {
		const [pass] = brightnessEffectDefinition.renderer.passes;
		expect(pass.shader).toBe(BRIGHTNESS_SHADER);
		expect(
			pass.uniforms({ effectParams: { amount: 1.5 }, width: 1920, height: 1080 }),
		).toEqual({ u_amount: 1.5 });
	});

	test("falls back to 1 when the amount param is missing or invalid", () => {
		const [pass] = brightnessEffectDefinition.renderer.passes;
		expect(
			pass.uniforms({ effectParams: {}, width: 100, height: 100 }),
		).toEqual({ u_amount: 1 });
		expect(
			pass.uniforms({
				effectParams: { amount: "oops" },
				width: 100,
				height: 100,
			}),
		).toEqual({ u_amount: 1 });
	});
});
