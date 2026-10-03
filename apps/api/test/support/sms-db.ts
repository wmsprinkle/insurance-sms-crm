import { Prisma } from "@crm/db";

export type FakeSms = {
	id: string;
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
	contacts: FakeContact[];
	sms: FakeSms[];
	tasks: FakeTask[];
	suppressions: { e164: string; reason: string }[];
	consents: {
		id: string;
		contactId: string;
		source: string;
		revokedAt: Date | null;
	}[];
	events: {
		id: string;
		sessionId: string;
		contactId: string | null;
		type: string;
		data: Prisma.InputJsonValue;
	}[];
};

type Scalar = string | number | boolean | Date | null;

type Condition =
	| Scalar
	| { in: readonly Scalar[] }
	| { not: Scalar }
	| undefined;

type Where = { [key: string]: Condition };

function satisfies(actual: Scalar, expected: Condition): boolean {
	if (expected === undefined) return true;
	if (expected === null || expected instanceof Date) return actual === expected;
	if (!(expected instanceof Object)) return actual === expected;
	if ("in" in expected) return expected.in.includes(actual);
	return actual !== expected.not;
}

function matches<Row extends object>(row: Row, where: Where = {}): boolean {
	return Object.entries(where).every(([key, expected]) =>
		satisfies(Reflect.get(row, key) as Scalar, expected),
	);
}

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
		contacts: [],
		sms: [],
		tasks: [],
		suppressions: [],
		consents: [],
		events: [],
		...seed,
	};

	const client = {
		$queryRaw: async () => [],
		contact: {
			findFirst: async ({ where }: { where: Where }) =>
				state.contacts.find((row) => matches(row, where)) ?? null,
		},
		smsMessage: {
			create: async ({ data }: { data: Omit<FakeSms, "id" | "errorCode"> }) => {
				if (
					data.telnyxId &&
					state.sms.some((row) => row.telnyxId === data.telnyxId)
				) {
					throw duplicate();
				}
				const row = { id: nextId("sms"), errorCode: null, ...data };
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
			findUnique: async ({ where }: { where: { e164: string } }) =>
				state.suppressions.find((row) => row.e164 === where.e164) ?? null,
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
				state.suppressions.push(create);
				return create;
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
				data: { contactId: string; source: string };
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
				state.events.push(data);
				return data;
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
