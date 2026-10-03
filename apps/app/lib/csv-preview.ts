export type CsvPreview = { headers: string[]; rows: string[][] };

const QUOTE = '"';

function parseLine(text: string, start: number) {
	const cells: string[] = [];
	let cell = "";
	let quoted = false;
	let index = start;

	for (; index < text.length; index += 1) {
		const char = text.charAt(index);
		if (quoted) {
			if (char === QUOTE && text.charAt(index + 1) === QUOTE) {
				cell += QUOTE;
				index += 1;
			} else if (char === QUOTE) {
				quoted = false;
			} else {
				cell += char;
			}
			continue;
		}
		if (char === QUOTE) {
			quoted = true;
		} else if (char === ",") {
			cells.push(cell);
			cell = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text.charAt(index + 1) === "\n") index += 1;
			index += 1;
			break;
		} else {
			cell += char;
		}
	}
	cells.push(cell);
	return { cells, end: index };
}

export function previewCsv(text: string, maxRows: number): CsvPreview {
	const source = text.replace(/^﻿/, "");
	const lines: string[][] = [];
	let position = 0;

	while (position < source.length && lines.length < maxRows + 1) {
		const { cells, end } = parseLine(source, position);
		position = end;
		if (cells.length === 1 && cells[0]?.trim() === "") continue;
		lines.push(cells.map((cell) => cell.trim()));
	}

	const [headers = [], ...rows] = lines;
	return { headers, rows };
}

export type ColumnSample = { rowNumber: number; text: string };

export function columnSamples(
	preview: CsvPreview,
	header: string | null | undefined,
): ColumnSample[] {
	if (!header) return [];
	const index = preview.headers.indexOf(header);
	if (index < 0) return [];
	return preview.rows.map((row, position) => ({
		rowNumber: position + 1,
		text: row[index] ?? "",
	}));
}
