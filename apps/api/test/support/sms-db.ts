import { Prisma } from "@crm/db";

export type FakeSms = {
	id: string;
	createdAt?: Date;
	contactId: string;
	direction: string;
	body: string;
	telnyxId: string | null;
	status: string;
	errorCode: string | null;
};

export type FakeTask = {
	id: string;
	contactId: string | null;
	kind: string;
	reason: string;
	payload: Prisma.InputJsonValue | null;
	startedAt: Date | null;
	finishedAt: Date | null;
	outcome: string | null;
};

export type FakeContact = {
	id: string;
	phone: string;
	archivedAt: Date | null;
};

export type FakeState = {
	workspaceName: string | null;
	contacts: FakeContact[];
	sms: FakeSms[];
	tasks: FakeTask[];
	suppressions: { e164: string; reason: string; createdAt?: Date }[];
	consents: {
		id: string;
		contactId: string | null;
		e164: string | null;
		source: string;
		revokedAt: Date | null;
	}[];
	drafts: { id: string; contactId: string; status: string }[];
	stateFields: { contactId: string; text: string }[];
	events: {
		id: string;
		sessionId: string;
		contactId: string | null;
		type: string;
		data: Prisma.InputJsonValue;
		emittedAt?: Date;
	}[];
};

type Scalar = string | number | boolean | Date | null;

type Condition =
	| Scalar
	| { in: readonly Scalar[] }
	| { not: Scalar }
	| undefined;

type Where = { [key: string]: Condition | Where[] };

function satisfies(actual: Scalar, expected: Condition): boolean {
	if (expected === undefined) return true;
	if (expected === null || expected instanceof Date) return actual === expected;
	if (!(expected instanceof Object)) return actual === expected;
	if ("in" in expected) return expected.in.includes(actual);
	return actual !== expected.not;
}

function matches<Row extends object>(row: Row, where: Where = {}): boolean {
	return Object.entries(where).every(([key, expected]) => {
		if (key === "OR" && Array.isArray(expected)) {
			return expected.some((branch) => matches(row, branch));
		}
		if (Array.isArray(expected)) return false;
		return satisfies(Reflect.get(row, key) as Scalar, expected);
	});
}

const at = (row: { createdAt?: Date }) => row.createdAt?.getTime() ?? 0;

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

function duplicate(): Prisma.PrismaClientKnownRequestError {
	return new Prisma.PrismaClientKnownRequestError("Unique constraint", {
		code: "P2002",
		clientVersion: "test",
	});
}

export function fakeDb(seed: Partial<FakeState> = {}) {
	const state: FakeState = {
		workspaceName: null,
		contacts: [],
		sms: [],
		tasks: [],
		suppressions: [],
		consents: [],
		events: [],
		drafts: [],
		stateFields: [],
		...seed,
	};

	const client = {
		$queryRaw: async () => [],
		organization: {
			findUnique: async () =>
				state.workspaceName === null ? null : { name: state.workspaceName },
		},
		contact: {
			findFirst: async ({ where }: { where: Where }) =>
				state.contacts.find((row) => matches(row, where)) ?? null,
		},
		fieldValue: {
			findFirst: async ({ where }: { where: { contactId: string } }) => {
				const row = state.stateFields.find(
					(entry) => entry.contactId === where.contactId,
				);
				return row ? { text: row.text } : null;
			},
		},
		smsDraft: {
			updateMany: async ({
				where,
				data,
			}: {
				where: Where;
				data: { status: string };
			}) => {
				const rows = state.drafts.filter((row) => matches(row, where));
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			},
		},
		smsMessage: {
			findMany: async ({
				where,
			}: {
				where: { contactId: string; direction: string };
			}) =>
				state.sms
					.filter(
						(row) =>
							row.contactId === where.contactId &&
							row.direction === where.direction &&
							row.status !== "SENDING_FAILED",
					)
					.sort((a, b) => at(b) - at(a))
					.map((row) => ({ createdAt: row.createdAt ?? new Date(0) })),
			findFirst: async ({
				where,
			}: {
				where: { contactId: string; direction: string; body?: string };
			}) =>
				state.sms
					.filter(
						(row) =>
							row.contactId === where.contactId &&
							row.direction === where.direction &&
							(where.body === undefined || row.body === where.body),
					)
					.sort((a, b) => at(b) - at(a))
					.map((row) => ({
						id: row.id,
						createdAt: row.createdAt ?? new Date(0),
					}))[0] ?? null,
			create: async ({ data }: { data: Omit<FakeSms, "id" | "errorCode"> }) => {
				if (
					data.telnyxId &&
					state.sms.some((row) => row.telnyxId === data.telnyxId)
				) {
					throw duplicate();
				}
				const row = {
					id: nextId("sms"),
					errorCode: null,
					createdAt: new Date(),
					...data,
				};
				state.sms.push(row);
				return row;
			},
			updateMany: async ({
				where,
				data,
			}: {
				where: Where;
				data: Partial<FakeSms>;
			}) => {
				const rows = state.sms.filter((row) => matches(row, where));
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			},
		},
		agentTask: {
			findFirst: async ({ where }: { where: Where }) =>
				state.tasks.find((row) => matches(row, where)) ?? null,
			create: async ({ data }: { data: Partial<FakeTask> }) => {
				const row: FakeTask = {
					id: nextId("task"),
					contactId: null,
					kind: "",
					reason: "",
					payload: null,
					startedAt: null,
					finishedAt: null,
					outcome: null,
					...data,
				};
				state.tasks.push(row);
				return row;
			},
			update: async ({
				where,
				data,
			}: {
				where: { id: string };
				data: Partial<FakeTask>;
			}) => {
				const row = state.tasks.find((task) => task.id === where.id);
				if (row) Object.assign(row, data);
				return row;
			},
			updateMany: async ({
				where,
				data,
			}: {
				where: Where;
				data: Partial<FakeTask>;
			}) => {
				const rows = state.tasks.filter((row) => matches(row, where));
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			},
		},
		phoneSuppression: {
			findUnique: async ({ where }: { where: { e164: string } }) => {
				const row = state.suppressions.find(
					(entry) => entry.e164 === where.e164,
				);
				return row ? { createdAt: new Date(0), ...row } : null;
			},
			upsert: async ({
				where,
				create,
			}: {
				where: { e164: string };
				create: { e164: string; reason: string };
			}) => {
				const existing = state.suppressions.find(
					(row) => row.e164 === where.e164,
				);
				if (existing) return existing;
				const row = { createdAt: new Date(), ...create };
				state.suppressions.push(row);
				return row;
			},
			deleteMany: async ({ where }: { where: Where }) => {
				const before = state.suppressions.length;
				state.suppressions = state.suppressions.filter(
					(row) => !matches(row, where),
				);
				return { count: before - state.suppressions.length };
			},
		},
		consentRecord: {
			findFirst: async ({ where }: { where: Where }) =>
				state.consents.find((row) => matches(row, where)) ?? null,
			create: async ({
				data,
			}: {
				data: { contactId: string; e164: string; source: string };
			}) => {
				const row = { id: nextId("consent"), revokedAt: null, ...data };
				state.consents.push(row);
				return row;
			},
			updateMany: async ({
				where,
				data,
			}: {
				where: Where;
				data: { revokedAt: Date };
			}) => {
				const rows = state.consents.filter((row) => matches(row, where));
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			},
		},
		agentEvent: {
			create: async ({ data }: { data: FakeState["events"][number] }) => {
				if (state.events.some((row) => row.id === data.id)) throw duplicate();
				state.events.push(data);
				return data;
			},
			findUnique: async ({ where }: { where: { id: string } }) =>
				state.events.find((row) => row.id === where.id) ?? null,
			update: async ({
				where,
				data,
			}: {
				where: { id: string };
				data: Partial<FakeState["events"][number]>;
			}) => {
				const row = state.events.find((event) => event.id === where.id);
				if (!row) throw new Error(`No agent event ${where.id}`);
				Object.assign(row, data);
				return row;
			},
			updateMany: async ({
				where,
				data,
			}: {
				where: Where;
				data: Partial<FakeState["events"][number]>;
			}) => {
				const rows = state.events.filter((row) => matches(row, where));
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			},
		},
	};

	const db = {
		...client,
		$transaction: async <Result>(
			work: (tx: typeof client) => Promise<Result>,
		): Promise<Result> => work(client),
	};

	return { state, db };
}
