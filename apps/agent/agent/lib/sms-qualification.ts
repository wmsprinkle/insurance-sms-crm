import { FieldEntity, FieldType } from "@crm/db/enums";
import { fieldKeyFromLabel } from "@crm/db/fields-shape";
import {
	AGE_BANDS,
	INSURANCE_LINES,
	QUALIFICATION_FIELD_LABELS,
	QUALIFICATION_KEYS,
	type QualificationFacts,
	type QualificationKey,
	qualificationFacts,
	sanitizeCoverage,
	TIMELINES,
} from "@crm/validation/sms-qualification";
import {
	createField,
	type RecordField,
	readFields,
	writeField,
} from "./fields";

type FieldSpec = {
	label: string;
	type: FieldType;
	options?: readonly string[];
	brief: string;
};

export const QUALIFICATION_FIELDS = {
	line: {
		label: QUALIFICATION_FIELD_LABELS.line,
		type: FieldType.SELECT,
		options: INSURANCE_LINES,
		brief: "Line of insurance the lead asked about by SMS.",
	},
	state: {
		label: QUALIFICATION_FIELD_LABELS.state,
		type: FieldType.TEXT,
		brief: "Two-letter US state the lead lives in, from the SMS thread.",
	},
	ageBand: {
		label: QUALIFICATION_FIELD_LABELS.ageBand,
		type: FieldType.SELECT,
		options: AGE_BANDS,
		brief: "Age band the lead gave by SMS. Never a date of birth.",
	},
	coverage: {
		label: QUALIFICATION_FIELD_LABELS.coverage,
		type: FieldType.TEXT,
		brief: "What the lead wants covered, in their words. No health details.",
	},
	timeline: {
		label: QUALIFICATION_FIELD_LABELS.timeline,
		type: FieldType.SELECT,
		options: TIMELINES,
		brief: "When the lead wants cover to start.",
	},
} as const satisfies Record<QualificationKey, FieldSpec>;

export function fieldKeyFor(key: QualificationKey): string {
	return fieldKeyFromLabel(QUALIFICATION_FIELDS[key].label);
}

export async function ensureQualificationFields(
	existing: readonly { key: string }[],
): Promise<void> {
	const present = new Set(existing.map((field) => field.key));

	for (const key of QUALIFICATION_KEYS) {
		if (present.has(fieldKeyFor(key))) continue;
		const spec: FieldSpec = QUALIFICATION_FIELDS[key];
		await createField({
			entity: FieldEntity.CONTACT,
			label: spec.label,
			type: spec.type,
			options: spec.options ? [...spec.options] : undefined,
			agentBrief: spec.brief,
		});
	}
}

function displayValue(field: RecordField): string | null {
	if (field.value === null) return null;
	if (field.type === FieldType.SELECT) {
		return (
			field.options.find((option) => option.id === field.value)?.label ?? null
		);
	}
	return String(field.value);
}

export function factsFromFields(
	fields: readonly RecordField[],
): QualificationFacts {
	const raw: Partial<Record<QualificationKey, string>> = {};
	for (const key of QUALIFICATION_KEYS) {
		const field = fields.find((entry) => entry.key === fieldKeyFor(key));
		const value = field ? displayValue(field) : null;
		if (value === null) continue;
		if (key === "coverage") {
			const safe = sanitizeCoverage(value);
			if (safe) raw[key] = safe;
			continue;
		}
		raw[key] = value;
	}

	const parsed = qualificationFacts.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`Stored qualification facts are unreadable: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".")} ${issue.message}`)
				.join("; ")}`,
		);
	}
	return parsed.data;
}

export async function readQualification(
	contactId: string,
): Promise<QualificationFacts> {
	return factsFromFields(await readFields(FieldEntity.CONTACT, contactId));
}

export async function writeQualification(
	contactId: string,
	facts: QualificationFacts,
): Promise<{ written: QualificationKey[]; refused: string[] }> {
	await ensureQualificationFields(
		await readFields(FieldEntity.CONTACT, contactId),
	);

	const written: QualificationKey[] = [];
	const refused: string[] = [];

	for (const key of QUALIFICATION_KEYS) {
		const value = facts[key];
		if (value === undefined) continue;
		const result = await writeField({
			entity: FieldEntity.CONTACT,
			recordId: contactId,
			key: fieldKeyFor(key),
			value,
		});
		if (result.written) written.push(key);
		else refused.push(`${key}: ${result.reason}`);
	}

	return { written, refused };
}
