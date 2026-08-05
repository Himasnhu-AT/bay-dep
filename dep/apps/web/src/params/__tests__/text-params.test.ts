import { describe, expect, test } from "vitest";

import { getElementParams } from "@/params/registry";
import type { TimelineElement } from "@/timeline/types";
import { DEFAULTS } from "@/timeline/defaults";

const textParams = getElementParams({
	element: { type: "text" } as TimelineElement,
});

function param(key: string) {
	return textParams.find((p) => p.key === key);
}

describe("text stroke params", () => {
	test("strokeWidth is a registered number param with a matching default", () => {
		const p = param("strokeWidth");
		expect(p).toBeDefined();
		expect(p?.type).toBe("number");
		expect(p?.default).toBe(DEFAULTS.text.strokeWidth);
	});

	test("strokeColor is a registered color param with a matching default", () => {
		const p = param("strokeColor");
		expect(p).toBeDefined();
		expect(p?.type).toBe("color");
		expect(p?.default).toBe(DEFAULTS.text.strokeColor);
	});

	test("stroke defaults are wired into the default text element (drift guard)", () => {
		// The registry, DEFAULTS.text, and the default element params are three
		// separate sources of truth that must agree.
		expect(
			(DEFAULTS.text.element.params as Record<string, unknown>).strokeWidth,
		).toBe(DEFAULTS.text.strokeWidth);
		expect(
			(DEFAULTS.text.element.params as Record<string, unknown>).strokeColor,
		).toBe(DEFAULTS.text.strokeColor);
	});
});
