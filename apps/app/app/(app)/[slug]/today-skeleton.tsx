import { Skeleton } from "@crm/ui/components/skeleton";

const KPI_PLACEHOLDERS = ["a", "b", "c", "d", "e"] as const;
const ROW_PLACEHOLDERS = ["a", "b", "c"] as const;

export function TodaySkeleton() {
	return (
		<div aria-busy="true" className="flex flex-col gap-6">
			<div className="grid grid-cols-2 gap-4 md:grid-cols-5" aria-hidden="true">
				{KPI_PLACEHOLDERS.map((id) => (
					<Skeleton key={id} className="h-24 w-full rounded-lg" />
				))}
			</div>
			<div className="grid gap-4 lg:grid-cols-[2fr_1fr]" aria-hidden="true">
				<div className="flex flex-col gap-3">
					<Skeleton className="h-[74px] w-full rounded-lg" />
					<Skeleton className="h-5 w-32" />
					{ROW_PLACEHOLDERS.map((id) => (
						<Skeleton key={id} className="h-16 w-full rounded-lg" />
					))}
				</div>
				<div className="flex flex-col gap-3">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-48 w-full rounded-lg" />
				</div>
			</div>
			<span role="status" className="sr-only">
				Loading today…
			</span>
		</div>
	);
}
