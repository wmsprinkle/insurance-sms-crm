export type CsvTable = {
	headers: string[];
	rows: CsvRow[];
};

type CsvRow = { rowNumber: number; cells: string[] };

export class CsvParseError extends Error {}

export function parseCsv(text: string): CsvTable {
	const records = splitRecords(text.replace(/^\uFEFF/, "")).map(
		(cells, index) => ({ rowNumber: index + 1, cells }),
	);
	const [headerRow, ...rows] = records.filter((record) =>
		record.cells.some((cell) => cell.trim() !== ""),
	);

	if (!headerRow) throw new CsvParseError("The CSV has no header row.");

	return { headers: headerRow.cells.map((header) => header.trim()), rows };
}

function splitRecords(text: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let cell = "";
	let quoted = false;
	let index = 0;

	while (index < text.length) {
		const char = text[index];

		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				cell += '"';
				index += 2;
				continue;
			}
			if (char === '"') {
				quoted = false;
				index += 1;
				continue;
			}
			cell += char;
			index += 1;
			continue;
		}

		if (char === '"' && cell === "") {
			quoted = true;
		} else if (char === ",") {
			record.push(cell);
			cell = "";
		} else if (char === "\n" || char === "\r") {
			record.push(cell);
			records.push(record);
			record = [];
			cell = "";
			if (char === "\r" && text[index + 1] === "\n") index += 1;
		} else {
			cell += char;
		}
		index += 1;
	}

	if (quoted) throw new CsvParseError("The CSV has an unclosed quote.");

	if (cell !== "" || record.length > 0) {
		record.push(cell);
		records.push(record);
	}

	return records;
}
