import { PageShell, PageShellContent } from "@/components/page-shell";
import { LeadDetailSkeleton } from "./lead-detail";

export default function Loading() {
	return (
		<PageShell>
			<PageShellContent>
				<LeadDetailSkeleton />
			</PageShellContent>
		</PageShell>
	);
}
