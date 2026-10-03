import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";

export function DraftsQueue() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Drafts waiting for approval</CardTitle>
				<CardDescription>
					With automatic sending off, every reply the agent writes waits here
					for a person to approve it.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-xs">
					The approval queue is not built yet. Drafts are not shown here.
				</p>
			</CardContent>
		</Card>
	);
}
