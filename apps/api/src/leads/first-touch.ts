export type FirstTouchFacts = {
	alreadyQueued: boolean;
	suppressed: boolean;
	consent: boolean;
	dueAt: Date | null;
};

type FirstTouchSkip =
	| "already-queued"
	| "suppressed"
	| "no-consent"
	| "no-send-window";

export type FirstTouchPlan =
	| { queue: true; dueAt: Date }
	| { queue: false; reason: FirstTouchSkip };

export function planFirstTouch(facts: FirstTouchFacts): FirstTouchPlan {
	if (facts.alreadyQueued) return { queue: false, reason: "already-queued" };
	if (facts.suppressed) return { queue: false, reason: "suppressed" };
	if (!facts.consent) return { queue: false, reason: "no-consent" };
	if (!facts.dueAt) return { queue: false, reason: "no-send-window" };
	return { queue: true, dueAt: facts.dueAt };
}
