import { Bubble, BubbleContent, BubbleGroup } from "@crm/ui/components/bubble";
import Logo from "@crm/ui/components/logo";
import Link from "next/link";
import type { ReactNode } from "react";
import { AuthShader } from "@/components/auth-shader";
import { PRODUCT } from "@/lib/product";

const SAMPLE_CONVERSATION = [
	{
		id: "ask",
		from: "us",
		text: "Hello Sam, Are you interested in life or health coverage?",
	},
	{ id: "reply", from: "lead", text: "Yes, tell me more" },
	{ id: "book", from: "us", text: "Great, how about Thursday at 2pm?" },
] as const;

export function AuthShell({
	children,
	preview = false,
}: {
	children: ReactNode;
	preview?: boolean;
}) {
	return (
		<main className="dark relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
			<AuthShader />

			<div className="relative flex w-full max-w-sm flex-col items-center gap-8">
				<Link href="/" aria-label="Homepage" className="flex">
					<Logo className="size-6 shrink-0" />
				</Link>

				{preview ? (
					<div className="flex flex-col items-center gap-3 text-center">
						<p className="font-mono text-xs/4 text-muted-foreground uppercase">
							{PRODUCT.name}
						</p>
						<h1 className="text-3xl/9 font-semibold text-balance sm:text-4xl/10">
							{PRODUCT.tagline}
						</h1>
					</div>
				) : null}

				{preview ? <SmsPreview /> : null}

				<div className="flex w-full flex-col gap-8">{children}</div>
			</div>
		</main>
	);
}

function SmsPreview() {
	return (
		<BubbleGroup
			role="group"
			aria-label="Example text conversation with a lead"
			className="w-full text-left"
		>
			{SAMPLE_CONVERSATION.map((message) => (
				<Bubble
					key={message.id}
					align={message.from === "us" ? "end" : "start"}
					variant={message.from === "us" ? "default" : "secondary"}
				>
					<BubbleContent>{message.text}</BubbleContent>
				</Bubble>
			))}
		</BubbleGroup>
	);
}

export function AuthHeading({
	title,
	description,
}: {
	title: string;
	description: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-1 text-center">
			<h2 className="text-2xl/8 font-semibold tracking-tight text-balance">
				{title}
			</h2>
			<p className="max-w-[40ch] text-sm/5 text-muted-foreground text-pretty">
				{description}
			</p>
		</div>
	);
}
