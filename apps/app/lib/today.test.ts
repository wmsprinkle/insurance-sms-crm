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
		attention: null as string | null,
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

	it("explains why the assistant could not answer a positive reply", () => {
		const items = needsYouItems({
			summary: NO_UNKNOWN,
			queue: NO_QUEUE,
			threads: {
				rows: [
					{
						...thread("a", 1, "2026-10-03T09:00:00.000Z"),
						funnelStatus: "needs_you" as const,
						attention:
							"The assistant could not reply: model unavailable. Check the AI key.",
					},
				],
			},
		});

		expect(items).toHaveLength(1);
		expect(items[0]?.detail).toBe(
			"The assistant could not reply: model unavailable. Check the AI key. They wrote: yes please",
		);
	});

	it("leaves out leads who declined, opted out or were abusive", () => {
		const closed = (
			contactId: string,
			funnelStatus: "not_interested" | "opted_out" | "abusive",
		) => ({
			...thread(contactId, 1, "2026-10-03T09:00:00.000Z"),
			funnelStatus,
		});

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
						firstMessage: true,
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
		telnyxApiKeySet: true,
		telnyxNumberSet: true,
		telnyxProfileSet: true,
		webhookKeySet: true,
		fromNumberMasked: "+1 833 *** 4120",
		modelKeySet: true,
		webhookUrl: "https://api.acme.test/webhooks/telnyx",
		dryRun: true,
		calendarConnected: true,
		leadCount: 12,
		brandName: "Acme Insurance",
		licensedStates: ["TX"],
	};

	const find = (items: ReturnType<typeof getStartedItems>, id: string) =>
		items.find((item) => item.id === id);

	it("marks everything done when set up", () => {
		const items = getStartedItems(READY);
		expect(getStartedProgress(items)).toEqual({ done: 6, total: 6 });
		expect(find(items, "telnyx")?.detail).toBe("Sending from +1 833 *** 4120.");
	});

	it("gives every to-do exactly one action and every done item none", () => {
		const todo = getStartedItems({
			...READY,
			telnyxApiKeySet: false,
			modelKeySet: false,
			webhookKeySet: false,
			calendarConnected: false,
			leadCount: 0,
			brandName: " ",
			licensedStates: [],
		});

		for (const item of todo) {
			if (item.status === "todo") expect(item.action).not.toBeNull();
			if (item.status === "info") expect(item.action).toBeNull();
		}
		for (const item of getStartedItems(READY)) {
			if (item.id !== "webhook") expect(item.action).toBeNull();
		}
	});

	it("says the API key is missing separately from the number", () => {
		const item = find(
			getStartedItems({ ...READY, telnyxApiKeySet: false }),
			"telnyx",
		);

		expect(item?.status).toBe("todo");
		expect(item?.detail).toBe("API key missing, number set (+1 833 *** 4120).");
		expect(item?.action).toMatchObject({
			kind: "copy",
			value: "TELNYX_API_KEY",
		});
	});

	it("says the number is missing when only the key is set", () => {
		const item = find(
			getStartedItems({
				...READY,
				telnyxNumberSet: false,
				fromNumberMasked: null,
			}),
			"telnyx",
		);

		expect(item?.detail).toBe("API key set, number missing.");
		expect(item?.action).toMatchObject({ value: "TELNYX_FROM_NUMBER" });
	});

	it("reports the model key without showing it", () => {
		const off = find(
			getStartedItems({ ...READY, modelKeySet: false }),
			"model",
		);

		expect(off?.status).toBe("todo");
		expect(off?.action).toMatchObject({ value: "AI_GATEWAY_API_KEY" });
		expect(find(getStartedItems(READY), "model")?.status).toBe("done");
	});

	it("shows the exact webhook URL with a copy action", () => {
		const item = find(getStartedItems(READY), "webhook");

		expect(item?.detail).toContain("https://api.acme.test/webhooks/telnyx");
		expect(item?.action).toEqual({
			kind: "copy",
			label: "Copy URL",
			value: "https://api.acme.test/webhooks/telnyx",
			copied: "Webhook URL copied.",
		});
	});

	it("reports what is missing", () => {
		const items = getStartedItems({
			...READY,
			calendarConnected: false,
			leadCount: 0,
			brandName: " ",
			licensedStates: [],
		});

		expect(find(items, "business")?.detail).toBe(
			"Still to set: business name and licensed states.",
		);
		expect(find(items, "leads")?.action).toMatchObject({
			kind: "link",
			href: "/leads/import",
		});
	});

	it("shows test mode as information, not a to-do", () => {
		const on = find(getStartedItems(READY), "mode");
		const off = find(getStartedItems({ ...READY, dryRun: false }), "mode");

		expect(on?.status).toBe("info");
		expect(on?.title).toBe("Test mode is on");
		expect(off?.title).toBe("Test mode is off");
	});
});
