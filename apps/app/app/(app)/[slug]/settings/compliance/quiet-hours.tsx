"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { CardTable } from "@crm/ui/components/card-table";
import { SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

const DAY_COLUMNS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const COLUMNS = [
	{ id: "scope", header: "Where", width: "w-[10%]" },
	...DAY_COLUMNS.map((day) => ({ id: day, header: day })),
];

export function QuietHours() {
	const trpc = useTRPC();
	const table = useQuery(trpc.settings.quietHours.queryOptions());

	if (!table.data) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Allowed sending hours</CardTitle>
				<CardDescription>
					Texts go out only inside these windows, in the lead's local time. A
					lead with an unknown state gets the strictest window of every zone.
					These rules are built in and need a legal review before launch.
				</CardDescription>
			</CardHeader>
			<CardContent className="overflow-x-auto">
				<CardTable columns={COLUMNS}>
					{table.data.rows.map((row) => (
						<SimpleTableRow key={row.scope}>
							<TableCell className="font-medium">{row.scope}</TableCell>
							{row.days.map((day) => (
								<TableCell
									key={day.day}
									className="text-muted-foreground tabular-nums"
								>
									{day.window ?? "Closed"}
								</TableCell>
							))}
						</SimpleTableRow>
					))}
				</CardTable>
			</CardContent>
		</Card>
	);
}
