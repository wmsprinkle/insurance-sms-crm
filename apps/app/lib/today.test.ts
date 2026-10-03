import { describe, expect, it } from "bun:test";
import {
	getStartedItems,
	getStartedProgress,
	handoffDetail,
	needsYouItems,
} from "./today";

const NO_UNKNOWN = { unknownSends: [] };
const NO_QUEUE = { drafts: [], handoffs: [] };
const NO_THREADS = { rows: [] };

function thread(contactId: string, openCount: number, createdAt: string) {
	return {
		contactId,
		name: contactId,
		phone: null,
		openCount,
		funnelStatus: "replied" as const,
		lastMessage: {
			preview: "yes please",
			direction: "INBOUND" as const,
			status: "RECEIVED" as const,
			createdAt,
		},
	};
}

describe("needsYouItems", () => {
	it("is empty with nothing to do", () => {
		expect(
			needsYouItems({
				summary: NO_UNKNOWN,
				queue: NO_QUEUE,
				threads: NO_THREADS,
			}),
		).toEqual([]);
	});

	it("leaves out leads who declined, opted out or were abusive", () => {
		const closed = (
			contactId: string,
			funnelStatus: "not_interested" | "opted_out" | "abusive",
		) => ({ ...thread(contactId, 1, "2026-10-03T09:00:00.000Z"), funnelStatus });

		const items = needsYouItems({
			summary: NO_UNKNOWN,
			queue: {
				drafts: [],
				handoffs: [
					{
						id: "h1",
						contactId: "x",
						name: "Rude",
						phone: null,
						reason: "triage:abusive",
						createdAt: "2026-10-03T11:00:00.000Z",
					},
				],
			},
			threads: {
				rows: [
					closed("a", "not_interested"),
					closed("b", "opted_out"),
					closed("c", "abusive"),
					thread("d", 1, "2026-10-03T09:00:00.000Z"),
				],
			},
		});

		expect(items.map((item) => item.contactId)).toEqual(["d"]);
	});

	it("keeps one row per lead and the most urgent kind", () => {
		const items = needsYouItems({
			summary: NO_UNKNOWN,
			queue: {
				drafts: [
					{
						id: "d1",
						contactId: "a",
						name: "Ana",
						phone: null,
						body: "Sure, when?",
						reason: "approval-mode",
						reasonLabel: "",
						retryAt: null,
						createdAt: "2026-10-03T10:00:00.000Z",
						handedOff: false,
					},
				],
				handoffs: [
					{
						id: "h1",
						contactId: "a",
						name: "Ana",
						phone: null,
						reason: "triage:ambiguous",
						createdAt: "2026-10-03T11:00:00.000Z",
					},
				],
			},
			threads: { rows: [thread("a", 2, "2026-10-03T09:00:00.000Z")] },
		});
		expect(items).toHaveLength(1);
		expect(items[0]?.kind).toBe("handoff");
		expect(items[0]?.draftId).toBe("d1");
		expect(items[0]?.handoff).toBe(true);
		expect(items[0]?.unhandledReplies).toBe(2);
		expect(items[0]?.lastReply).toBe("yes please");
		expect(items[0]?.at).toBe("2026-10-03T09:00:00.000Z");
	});

	it("sorts unknown sends first, then oldest first", () => {
		const items = needsYouItems({
			summary: {
				unknownSends: [
					{
						contactId: "u",
						name: "U",
						phone: null,
						at: "2026-10-03T12:00:00.000Z",
					},
				],
			},
			queue: NO_QUEUE,
			threads: {
				rows: [
					thread("late", 1, "2026-10-03T10:00:00.000Z"),
					thread("early", 1, "2026-10-03T08:00:00.000Z"),
				],
			},
		});
		expect(items.map((item) => item.contactId)).toEqual(["u", "early", "late"]);
	});

	it("skips threads with no open replies", () => {
		const items = needsYouItems({
			summary: NO_UNKNOWN,
			queue: NO_QUEUE,
			threads: { rows: [thread("a", 0, "2026-10-03T08:00:00.000Z")] },
		});
		expect(items).toEqual([]);
	});
});

describe("handoffDetail", () => {
	it("explains triage reasons in plain words", () => {
		expect(handoffDetail("triage:ambiguous")).toContain("unclear");
		expect(handoffDetail("triage:abusive")).toContain("Abusive");
		expect(handoffDetail("lead asked for a person")).toBe(
			"lead asked for a person",
		);
	});
});

describe("getStartedItems", () => {
	const READY = {
		telnyxConfigured: true,
		fromNumber: "+18337544120",
		dryRun: true,
		calendarConnected: true,
		leadCount: 12,
		brandName: "Acme Insurance",
		licensedStates: ["TX"],
	};

	it("marks everything done when set up", () => {
		const items = getStartedItems(READY);
		expect(getStartedProgress(items)).toEqual({ done: 4, total: 4 });
	});

	it("reports what is missing", () => {
		const items = getStartedItems({
			...READY,
			telnyxConfigured: false,
			calendarConnected: false,
			leadCount: 0,
			brandName: " ",
			licensedStates: [],
		});
		expect(getStartedProgress(items)).toEqual({ done: 0, total: 4 });
		const business = items.find((item) => item.id === "business");
		expect(business?.detail).toBe(
			"Still to set: business name and licensed states.",
		);
		expect(items.find((item) => item.id === "leads")?.href).toBe(
			"/leads/import",
		);
	});

	it("shows test mode as information, not a to-do", () => {
		const on = getStartedItems(READY).find((item) => item.id === "mode");
		const off = getStartedItems({ ...READY, dryRun: false }).find(
			(item) => item.id === "mode",
		);
		expect(on?.status).toBe("info");
		expect(on?.title).toBe("Test mode is on");
		expect(off?.title).toBe("Test mode is off");
	});
});
