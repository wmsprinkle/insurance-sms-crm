export const SAMPLE_LEADS = {
	fileName: "sample-leads.csv",
	mimeType: "text/csv;charset=utf-8",
	headers: [
		"phone",
		"first_name",
		"last_name",
		"email",
		"consent_source",
		"consent_date",
		"opt_in_text",
		"opt_in_url",
		"consent_ip",
	],
	rows: [
		[
			"512-555-0101",
			"Ana",
			"Ruiz",
			"ana@example.com",
			"WEB_FORM",
			"2026-09-01",
			"I agree to get texts about insurance quotes from Acme Insurance.",
			"https://acme.example/quote",
			"203.0.113.10",
		],
		[
			"(214) 555-0142",
			"Ben",
			"Carter",
			"",
			"WEB_FORM",
			"2026-09-03",
			"I agree to get texts about insurance quotes from Acme Insurance.",
			"https://acme.example/quote",
			"203.0.113.24",
		],
		[
			"+1 713 555 0163",
			"Chloe",
			"Nguyen",
			"chloe@example.com",
			"MANUAL",
			"2026-09-05",
			"Said yes to texts on a phone call.",
			"",
			"",
		],
		[
			"305-555-0188",
			"Dev",
			"Patel",
			"",
			"WEB_FORM",
			"2026-09-08",
			'I agree to get texts, including "quote" follow-ups, from Acme Insurance.',
			"https://acme.example/quote",
			"203.0.113.77",
		],
	],
} as const;

function cell(value: string): string {
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function sampleLeadsCsv(): string {
	const lines = [SAMPLE_LEADS.headers, ...SAMPLE_LEADS.rows].map((row) =>
		row.map(cell).join(","),
	);
	return `${lines.join("\n")}\n`;
}
