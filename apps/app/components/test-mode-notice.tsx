import Warning from "@carbon/icons-react/es/Warning";
import { Icon } from "@crm/ui/components/icon";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { TEST_MODE_MESSAGE } from "@/lib/test-mode";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

async function loadDryRun(): Promise<boolean> {
	try {
		const summary = await getServerQueryClient().fetchQuery(
			getServerTrpc().today.summary.queryOptions(),
		);

		return summary.dryRun;
	} catch (error) {
		unstable_rethrow(error);
		return false;
	}
}

export async function TestModeNotice() {
	await connection();

	if (!(await loadDryRun())) return null;

	return (
		<div
			role="status"
			className="flex shrink-0 items-center justify-center gap-2 border-b bg-warning/15 px-3 py-1.5 text-center font-medium text-sm"
		>
			<Icon icon={Warning} aria-hidden />
			<span>{TEST_MODE_MESSAGE}</span>
		</div>
	);
}
