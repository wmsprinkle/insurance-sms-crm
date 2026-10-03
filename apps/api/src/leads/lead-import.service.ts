import { RecordSource } from "@crm/db/enums";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { CsvParseError, type CsvTable, parseCsv } from "./csv";
import { checkRows, type LeadRowResult, totalsOf } from "./lead-batch";
import {
	mapRows,
	type PartialLeadColumnMapping,
	resolveMapping,
	suggestMapping,
} from "./lead-csv";
import { LeadWriterService } from "./lead-writer.service";
import type {
	LeadImportCommitInput,
	LeadImportOutput,
	LeadImportPreviewInput,
} from "./leads.contracts";
import { LEADS } from "./leads-config";

@Injectable()
export class LeadImportService {
	constructor(
		@Inject(LeadWriterService) private readonly writer: LeadWriterService,
	) {}

	async preview(input: LeadImportPreviewInput): Promise<LeadImportOutput> {
		const table = readTable(input.csv);
		const proposed: PartialLeadColumnMapping =
			input.mapping ?? suggestMapping(table.headers);
		const resolved = resolveMapping(table.headers, proposed);

		if (!resolved.ok) {
			return report(table, proposed, resolved.issues, []);
		}

		const outcome = await this.writer.triage(
			checkRows(mapRows(table, resolved.mapping)),
		);
		return report(table, resolved.mapping, [], outcome.results);
	}

	async commit(input: LeadImportCommitInput): Promise<LeadImportOutput> {
		const table = readTable(input.csv);
		const resolved = resolveMapping(table.headers, input.mapping);
		if (!resolved.ok) throw new BadRequestException(resolved.issues.join(" "));

		const outcome = await this.writer.triage(
			checkRows(mapRows(table, resolved.mapping)),
		);
		const results = await this.writer.write(outcome, RecordSource.LEAD_IMPORT);
		return report(table, resolved.mapping, [], results);
	}
}

function readTable(csv: string): CsvTable {
	let table: CsvTable;
	try {
		table = parseCsv(csv);
	} catch (cause) {
		if (cause instanceof CsvParseError) {
			throw new BadRequestException(cause.message);
		}
		throw cause;
	}

	if (table.headers.length > LEADS.csv.maxColumns) {
		throw new BadRequestException(
			`The CSV has more than ${LEADS.csv.maxColumns} columns.`,
		);
	}
	if (table.rows.length > LEADS.csv.maxRows) {
		throw new BadRequestException(
			`The CSV has more than ${LEADS.csv.maxRows} rows. Split it into smaller files.`,
		);
	}

	return table;
}

function report(
	table: CsvTable,
	mapping: PartialLeadColumnMapping,
	mappingIssues: string[],
	rows: LeadRowResult[],
): LeadImportOutput {
	return {
		headers: table.headers,
		mapping,
		mappingIssues,
		totals: totalsOf(rows),
		rows,
	};
}
