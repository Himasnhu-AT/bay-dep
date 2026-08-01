import { describe, expect, test } from "vitest";

import {
	strokeMeasuredTextLayout,
	type MeasuredTextLayout,
} from "@/text/primitives";

// A recording stand-in for the Canvas 2D context — no real canvas needed to
// verify the stroke primitive sets the right state and strokes each line.
function fakeContext() {
	const strokeCalls: Array<{ text: string; x: number; y: number }> = [];
	const ctx = {
		font: "",
		textAlign: "" as CanvasTextAlign,
		textBaseline: "" as CanvasTextBaseline,
		strokeStyle: "" as string,
		lineWidth: 0,
		lineJoin: "" as CanvasLineJoin,
		lineCap: "" as CanvasLineCap,
		letterSpacing: "",
		strokeText(text: string, x: number, y: number) {
			strokeCalls.push({ text, x, y });
		},
	};
	return { ctx, strokeCalls };
}

function layout(lines: string[]): MeasuredTextLayout {
	return {
		fontString: "16px sans-serif",
		textAlign: "center",
		letterSpacing: 0,
		lineHeightPx: 20,
		scaledFontSize: 16,
		fontSizeRatio: 1,
		textDecoration: "none",
		lines,
		lineMetrics: [],
		block: { visualCenterOffset: 0 },
	} as unknown as MeasuredTextLayout;
}

describe("strokeMeasuredTextLayout", () => {
	test("applies stroke style/width and strokes every line", () => {
		const { ctx, strokeCalls } = fakeContext();

		strokeMeasuredTextLayout({
			ctx: ctx as unknown as Parameters<
				typeof strokeMeasuredTextLayout
			>[0]["ctx"],
			layout: layout(["Hello", "World"]),
			strokeColor: "#00ff00",
			strokeWidth: 3,
		});

		expect(ctx.strokeStyle).toBe("#00ff00");
		expect(ctx.lineWidth).toBe(3);
		expect(ctx.lineJoin).toBe("round");
		expect(strokeCalls.map((c) => c.text)).toEqual(["Hello", "World"]);
	});
});
