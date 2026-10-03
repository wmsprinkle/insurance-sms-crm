import { redirect } from "next/navigation";
import { workspaceUrl } from "@/lib/workspace-url";

export default async function ImportLeadsRedirect({
	params,
}: PageProps<"/[slug]/contacts/import">) {
	const { slug } = await params;
	redirect(workspaceUrl(slug, "/leads/import"));
}
