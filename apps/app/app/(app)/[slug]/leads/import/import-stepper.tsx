import Checkmark from "@carbon/icons-react/es/Checkmark";
import { Icon } from "@crm/ui/components/icon";
import { cn } from "@crm/ui/lib/utils";
import { type ImportStepId, stepStates } from "@/lib/lead-import";

export function ImportStepper({ current }: { current: ImportStepId }) {
	return (
		<nav aria-label="Import progress">
			<ol className="flex flex-wrap items-center gap-x-4 gap-y-2">
				{stepStates(current).map((step) => (
					<li
						key={step.id}
						aria-current={step.state === "current" ? "step" : undefined}
						className={cn(
							"flex items-center gap-2 text-sm",
							step.state === "upcoming"
								? "text-muted-foreground"
								: "text-foreground",
							step.state === "current" && "font-medium",
						)}
					>
						<span
							className={cn(
								"flex size-6 items-center justify-center rounded-md border text-xs tabular-nums",
								step.state === "current" &&
									"border-primary bg-primary text-primary-foreground",
							)}
						>
							{step.state === "done" ? (
								<Icon icon={Checkmark} aria-hidden />
							) : (
								step.number
							)}
						</span>
						<span>{step.label}</span>
						<span className="sr-only">
							{step.state === "done"
								? "(done)"
								: step.state === "current"
									? "(current step)"
									: "(not started)"}
						</span>
					</li>
				))}
			</ol>
		</nav>
	);
}
