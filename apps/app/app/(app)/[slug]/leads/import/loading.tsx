import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { ImportSkeleton } from "./import-skeleton";

export default function Loading() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Import leads</PageShellTitle>
					<PageShellDescription>
						Add leads from a CSV file in three steps.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<ImportSkeleton />
			</PageShellContent>
		</PageShell>
	);
}
