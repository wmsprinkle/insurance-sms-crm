import { describe, expect, it } from "bun:test";
import {
	allSelected,
	CONSENT_SOURCE_LABELS,
	isFiltered,
	LEADS,
	leadsListInput,
	nextStatuses,
	previewOf,
	SUPPRESSION_LABELS,
	statusChips,
	TIMELINE_DOT,
	toggleId,
	togglePage,
	toggleStatus,
} from "./leads";

describe("selection", () => {
	it("toggles one id", () => {
		expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
		expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
	});

	it("selects and clears a page", () => {
		expect(togglePage(["x"], ["a", "b"])).toEqual(["x", "a", "b"]);
		expect(togglePage(["x", "a", "b"], ["a", "b"])).toEqual(["x"]);
		expect(allSelected(["a"], ["a", "b"])).toBe(false);
		expect(allSelected([], [])).toBe(false);
	});
});

describe("status filter", () => {
	it("toggles a status", () => {
		expect(toggleStatus([], "new")).toEqual(["new"]);
		expect(toggleStatus(["new", "booked"], "new")).toEqual(["booked"]);
	});

	it("builds chips with All first, needs_you second and a total", () => {
		const chips = statusChips({ new: 2, needs_you: 1 }, [], (s) => s);
		expect(chips[0]).toMatchObject({ value: null, count: 3, active: true });
		expect(chips[1]?.value).toBe("needs_you");
		expect(chips.find((c) => c.value === "booked")?.count).toBe(0);
	});

	it("marks selected chips active and All inactive", () => {
		const chips = statusChips({}, ["booked"], (s) => s);
		expect(chips[0]?.active).toBe(false);
		expect(chips.find((c) => c.value === "booked")?.active).toBe(true);
	});
});

describe("list input and rows", () => {
	it("uses the page size and newest first", () => {
		expect(leadsListInput({ q: "a", page: 2, status: ["new"] })).toMatchObject({
			pageSize: LEADS.pageSize,
			dir: "desc",
			status: ["new"],
		});
	});

	it("previews the last message", () => {
		expect(previewOf({ lastMessage: null })).toBe(LEADS.noMessage);
		expect(
			previewOf({
				lastMessage: { preview: "Hi", direction: "OUTBOUND", at: "x" },
			}),
		).toBe("You: Hi");
		expect(
			previewOf({
				lastMessage: { preview: "Yes", direction: "INBOUND", at: "x" },
			}),
		).toBe("Yes");
	});

	it("knows when a filter is active", () => {
		expect(isFiltered({ q: " ", status: [] })).toBe(false);
		expect(isFiltered({ q: "x", status: [] })).toBe(true);
		expect(isFiltered({ q: "", status: ["new"] })).toBe(true);
	});
});

describe("nextStatuses", () => {
	it("picks one status from All", () => {
		expect(nextStatuses([], ["all", "new"])).toEqual(["new"]);
	});

	it("adds and removes statuses", () => {
		expect(nextStatuses(["new"], ["new", "booked"])).toEqual(["new", "booked"]);
		expect(nextStatuses(["new", "booked"], ["booked"])).toEqual(["booked"]);
	});

	it("goes back to All when the last status is cleared or All is chosen", () => {
		expect(nextStatuses(["new"], [])).toEqual([]);
		expect(nextStatuses(["new"], ["new", "all"])).toEqual([]);
	});
});

describe("labels", () => {
	it("labels every consent source and suppression reason", () => {
		expect(Object.keys(CONSENT_SOURCE_LABELS)).toHaveLength(5);
		expect(Object.keys(SUPPRESSION_LABELS)).toHaveLength(5);
		expect(Object.keys(TIMELINE_DOT)).toHaveLength(8);
	});
});
