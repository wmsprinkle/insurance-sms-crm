import {
	createLoader,
	parseAsArrayOf,
	parseAsInteger,
	parseAsString,
	parseAsStringLiteral,
} from "nuqs/server";
import { LEAD_STATUS_ORDER } from "@/lib/lead-status";
import { SEARCH_PARAM } from "@/lib/search-param-keys";

export const leadsParsers = {
	[SEARCH_PARAM.list.q]: parseAsString.withDefault(""),
	[SEARCH_PARAM.list.page]: parseAsInteger.withDefault(1),
	status: parseAsArrayOf(parseAsStringLiteral(LEAD_STATUS_ORDER)).withDefault(
		[],
	),
};

export const loadLeadsSearchParams = createLoader(leadsParsers);
