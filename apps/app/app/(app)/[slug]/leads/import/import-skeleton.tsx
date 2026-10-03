import { Skeleton } from "@crm/ui/components/skeleton";

export function ImportSkeleton() {
	return (
		<div aria-busy="true" className="flex max-w-4xl flex-col gap-6">
			<Skeleton className="h-6 w-80 max-w-full" />
			<Skeleton className="h-64 w-full rounded-lg" />
			<span role="status" className="sr-only">
				Loading the import…
			</span>
		</div>
	);
}
