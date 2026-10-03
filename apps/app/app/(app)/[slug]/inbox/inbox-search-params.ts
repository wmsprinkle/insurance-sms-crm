import {
	createLoader,
	parseAsInteger,
	parseAsString,
	parseAsStringLiteral,
} from "nuqs/server";
import { SEARCH_PARAM } from "@/lib/search-param-keys";

export const INBOX_FILTERS = ["open", "all"] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_PAGE_SIZE = 25;

export const inboxParsers = {
	[SEARCH_PARAM.list.q]: parseAsString.withDefault(""),
	[SEARCH_PARAM.list.page]: parseAsInteger.withDefault(1),
	[SEARCH_PARAM.inbox.filter]:
		parseAsStringLiteral(INBOX_FILTERS).withDefault("open"),
	[SEARCH_PARAM.inbox.contact]: parseAsString,
};

export const loadInboxSearchParams = createLoader(inboxParsers);

export type InboxValues = {
	q: string;
	page: number;
	show: InboxFilter;
};

export function inboxListInput(values: InboxValues) {
	return {
		q: values.q,
		page: values.page,
		pageSize: INBOX_PAGE_SIZE,
		filter: values.show,
		dir: "desc" as const,
		sort: "",
	};
}
