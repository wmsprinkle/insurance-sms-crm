import { describe, expect, it } from "bun:test";
import { columnSamples, previewCsv } from "./csv-preview";

describe("previewCsv", () => {
	it("reads headers and at most the asked rows", () => {
		const preview = previewCsv("a,b\n1,2\n3,4\n5,6\n", 2);
		expect(preview.headers).toEqual(["a", "b"]);
		expect(preview.rows).toEqual([
			["1", "2"],
			["3", "4"],
		]);
	});

	it("handles quoted commas, doubled quotes and CRLF", () => {
		const preview = previewCsv('a,b\r\n"x, y","say ""hi"""\r\n', 5);
		expect(preview.rows).toEqual([["x, y", 'say "hi"']]);
	});

	it("skips blank lines and a byte order mark", () => {
		const preview = previewCsv("﻿a\n\n1\n", 5);
		expect(preview.headers).toEqual(["a"]);
		expect(preview.rows).toEqual([["1"]]);
	});

	it("samples a column by header", () => {
		const preview = previewCsv("a,b\n1,2\n3,4\n", 5);
		expect(columnSamples(preview, "b").map((sample) => sample.text)).toEqual([
			"2",
			"4",
		]);
		expect(columnSamples(preview, "z")).toEqual([]);
		expect(columnSamples(preview, null)).toEqual([]);
	});
});
