import { detectInjection, normalizeForInjection } from "./outbound-guard";

export const SMS_TRIAGE_LABELS = [
	"negative",
	"positive",
	"ambiguous",
	"abusive",
] as const;

export type SmsTriageLabel = (typeof SMS_TRIAGE_LABELS)[number];

export const SMS_TRIAGE_RULES = [
	"opt-out",
	"wrong-number",
	"decline",
	"abusive-language",
	"injection",
	"spam",
	"gibberish",
	"too-long",
	"legal-threat",
	"interest",
	"hedged",
	"unclear",
	"empty",
] as const;

export type SmsTriageRule = (typeof SMS_TRIAGE_RULES)[number];

export type SmsTriage = { label: SmsTriageLabel; rule: SmsTriageRule };

export const SMS_TRIAGE = {
	maxChars: 480,
	gibberish: {
		minChars: 9,
		maxVowelShare: 0.12,
		longWordChars: 20,
		repeatRun: 8,
	},
} as const;

const FOLD_FROM = "01345@$";
const FOLD_TO = "oieasas";

const LOOKALIKE = new Map([
	["а", "a"],
	["е", "e"],
	["о", "o"],
	["р", "p"],
	["с", "c"],
	["х", "x"],
	["у", "y"],
	["і", "i"],
	["ѕ", "s"],
	["ј", "j"],
	["ο", "o"],
	["α", "a"],
	["ε", "e"],
	["ν", "v"],
	["ι", "i"],
]);

const PROFANITY: readonly RegExp[] = [
	/\bf+u+c+k+\w*/,
	/\bf+u+k+\b/,
	/\bsh+i+t+\w*/,
	/\bb+i+t+c+h+\w*/,
	/\ba+s+s+h+o+l+e+s?\b/,
	/\bc+u+n+t+s?\b/,
	/\bd+i+c+k+(?:head)?s?\b/,
	/\bb+a+s+t+a+r+d+s?\b/,
	/\bp+i+s+s+(?:ed)?\s+off\b/,
	/\bmother\s?f\w+/,
	/\bson of a (?:bitch|b)\b/,
	/\bwhore\b|\bslut\b|\bretard\w*/,
	/\bscum\w*|\bpiece of (?:shit|crap|garbage)\b/,
	/\bgo (?:to )?hell\b|\bdrop dead\b|\bkill yourself\b|\bkys\b/,
	/\bstfu\b|\bgtfo\b|\bwtf\b/,
	/\b(?:screw|f)\s+you\b/,
	/\bf\s?u\b/,
	/\bf+ off\b/,
	/\bshut (?:the )?(?:up|hell up)\b/,
	/\bdamn you\b/,
];

const LEGAL_THREAT: readonly RegExp[] = [
	/\b(?:sue|suing|lawsuit|lawyer|attorney|legal action|class action)\b/,
	/\b(?:report|reporting|complain|complaint)\b.{0,30}\b(?:fcc|ftc|attorney general|police|bbb|carrier)\b/,
	/\b(?:fcc|ftc|tcpa|do not call registry|dnc)\b/,
	/\bharass(?:ment|ing|ed)?\b/,
];

const SPAM: readonly RegExp[] = [
	/\bhttps?:\/\//,
	/\bwww\.\S+/,
	/\b[a-z0-9-]+\.(?:com|net|org|io|co|ly|xyz|info|biz|app|link)\b/,
	/\b(?:click|tap) (?:here|the link|below)\b/,
	/\b(?:free (?:gift|money|iphone|trial|cash)|you(?:'ve| have)? won|claim your|winner|crypto|bitcoin|forex|casino|viagra|loan offer|work from home|make \$?\d+)\b/,
	/\bbuy now\b|\blimited time\b|\bact now\b|\bcall (?:us )?now\b.{0,10}\d/,
];

const OPT_OUT: readonly RegExp[] = [
	/\bstop\b/,
	/\bunsubscribe\b/,
	/\bopt[\s-]?out\b/,
	/\b(?:remove|delete|take|drop)\b.{0,20}\b(?:me|my (?:number|name|info|phone))\b.{0,20}\b(?:list|database|texts?|messages?|contacts?)?\b/,
	/\b(?:do not|don'?t|dont|never|no more|quit|cease)\b.{0,15}\b(?:text|texting|message|messaging|contact|contacting|call|calling|email|bother|reach|send)\b/,
	/\b(?:leave|let) me (?:alone|be)\b/,
	/\bno more (?:texts?|messages?|msgs?|sms)\b/,
	/\bstop (?:texting|messaging|contacting|sending|bothering)\b/,
	/\bnever (?:want to )?(?:hear|text|contact)\b/,
];

const WRONG_NUMBER: readonly RegExp[] = [
	/\bwrong (?:number|person|guy|girl)\b/,
	/\bnot (?:my|his|her|their|the right|this|\w+'s) (?:number|phone)\b/,
	/\bthis is not (?:\w+'s |my )?(?:number|phone)\b/,
	/\byou(?:'ve| have) (?:got|texted|reached) the wrong\b/,
	/\bnew (?:owner|number|phone)\b.{0,30}\b(?:this|my)\b/,
	/\bi (?:never|didn'?t|did not) (?:sign|ask|request|fill|opt|enter)\b/,
	/\bnever (?:signed|asked|requested|filled|opted|entered)\b/,
];

const HARD_DECLINE: readonly RegExp[] = [
	/\bnot interested\b/,
	/\bno longer interested\b/,
	/\b(?:uninterested|disinterested)\b/,
	/\bno (?:thanks|thank you|thx|ty)\b/,
	/\bnot (?:looking|in the market|for me|needed|needing|wanting|buying)\b/,
	/\b(?:don'?t|dont|do not|doesn'?t|does not) (?:want|need|care|have an interest)\b/,
	/\bno (?:need|interest|desire)\b/,
	/\b(?:already|i'?m|im|we'?re|were|i am|we are|got|have|has|had)\b.{0,20}\b(?:covered|insured)\b/,
	/\b(?:already (?:have |got )?|(?:i|we) (?:have|got|own|carry) |i've (?:got )?|we've (?:got )?)(?:a |an |my |our |some |the )?(?:\w+ )?(?:insurance|coverage|policy|policies|plan|agent|broker)\b/,
	/\b(?:i'?m|im|we'?re|i am|we are) (?:good|set|fine|all set|all good)\b(?! (?:to|with (?:a|that|the)))/,
	/\bpass\b(?! (?:me|it|along))/,
	/\bhard pass\b|\bnot happening\b|\bno way\b|\bforget it\b/,
	/\b(?:this is|you(?:'re| are)) (?:a )?(?:spam|scam|scammers?|fraud)\b/,
	/\bcancel\b|\bnot (?:today|ever|at all|this time)\b/,
	/\bwho (?:is|are|r) (?:this|you)\b.{0,40}\b(?:leave|stop|don'?t|dont)\b/,
];

const SOFT_DECLINE: readonly RegExp[] = [
	/^(?:no|nope|nah|naw|nay|n|nop|noo+|no\.|neg|negative)$/,
	/^(?:no|nope|nah) (?:i'?m|im|we'?re|i am|we are)? ?(?:good|fine|ok|okay|all set)$/,
	/\bnot now\b/,
	/\bnot (?:right now|at the moment|at this time|yet|currently|really|so much)\b/,
	/^no\b(?!.{0,12}\b(?:problem|worries|rush|prob|issue|trouble)\b)/,
	/\bnope\b|\bnah\b/,
];

const HEDGE: readonly RegExp[] = [
	/\bmaybe\b|\bperhaps\b|\bpossibly\b|\bmight\b|\bnot sure\b|\bunsure\b|\bi guess\b|\bdepends\b/,
	/\blater\b(?! (?:today|tonight|this|on today))|\b(?:next (?:week|month|year)|another time|some ?time|down the road|in a (?:few|couple)|after (?:the )?(?:holidays?|new year))\b/,
	/\bthink about it\b|\blet me think\b|\bget back to you\b/,
];

const POSITIVE: readonly RegExp[] = [
	/^(?:y|yes|yess+|yea|yeah|yeh|yep|yup|yah|ya|sure|ok|okay|k|kk|alright|aight|absolutely|definitely|certainly|of course|affirmative|please|si|oui|ye|yas|go ahead|go on|sounds good|sounds great|works for me|do it)$/,
	/^(?:yes|yeah|yep|yup|sure|ok|okay|ya|yea)\b/,
	/\binterested\b(?! in (?:nothing|anything else))/,
	/\b(?:life|term|whole|final expense|burial|funeral)(?: insurance| coverage| policy)?\b/,
	/\bhealth(?: insurance| coverage| plan| plans)?\b/,
	/\b(?:medical|medicare|obamacare|aca|dental|vision|marketplace)\b/,
	/\bboth\b|\ball of (?:them|it|the above)\b|\beither\b/,
	/\btell me more\b|\bmore (?:info|information|details)\b|\bsend (?:me )?(?:info|information|details)\b/,
	/\bhow much\b|\bwhat(?:'s| is| are) (?:the )?(?:cost|price|rates?|premiums?)\b|\bcost\b.{0,10}\b(?:per|a) month\b/,
	/\bwhat (?:plans?|options?|coverage|policies|types?|kinds?|products?)\b/,
	/\b(?:call|phone|ring|reach) me\b|\bgive me a call\b|\bcan (?:you|someone|an agent) call\b/,
	/\b(?:quote|quotes|get a quote|free quote|pricing)\b/,
	/\b(?:i'?d|i would|i do|we'?d|we would|i'?m|im|i am) (?:like|love|want|need|looking|wanting)\b/,
	/\blacking\b/,
	/\bsign me up\b|\blet'?s (?:do|talk|go|chat)\b|\bi'?m in\b|\bcount me in\b/,
	/\b(?:i|we) (?:do|did) (?:want|need|have an interest)\b/,
	/\b(?:need|want|looking for) (?:some |a |an |more )?(?:coverage|insurance|policy|plan|help|protection)\b/,
	/\bwhen (?:can|could|are) (?:you|we|someone)\b|\bavailable (?:to talk|tomorrow|today|now)\b/,
	/\b(?:call|talk|speak|chat)\b.{0,15}\b(?:today|tomorrow|tonight|morning|afternoon|evening|now|asap|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
	/\b(?:my|our) (?:wife|husband|spouse|family|kids|children|parents|mom|dad)\b.{0,30}\b(?:need|needs|covered|coverage|insurance)\b/,
];

const AMBIGUOUS_QUESTIONS: readonly RegExp[] = [
	/\bwho (?:is|are|r) (?:this|you|u)\b/,
	/\bwho (?:dis|dat)\b/,
	/\bwhat (?:company|business|agency|is this|is it|are you|r u|do you|about)\b/,
	/\bwhere (?:did|do) you (?:get|find|have)\b/,
	/\bhow did you (?:get|find)\b/,
	/\b(?:is this|are you) (?:a )?(?:bot|robot|real|human|person|spam|scam|automated|ai)\b/,
	/\bwhat'?s this (?:about|for)\b|\bwhat is this regarding\b/,
	/\bwho (?:gave|sent)\b/,
	/\bhuh\b|\bwhat\?*$/,
];

const SCAM_QUESTION: readonly RegExp[] = [
	/\b(?:is this|are you|is that|r u|are u) (?:a |an )?(?:legit|legitimate|scam|scammer|spam|fraud)\b/,
	/\bis this (?:real|legit)\b/,
];

const LACKING: readonly RegExp[] = [
	/\b(?:i|we) (?:have|got|has) (?:no|not|zero|never had)\b/,
	/\b(?:don'?t|do not|dont|doesn'?t) have (?:any |a )?(?:insurance|coverage|policy)\b/,
	/\bnot (?:covered|insured)\b|\bun(?:covered|insured)\b|\bno (?:insurance|coverage|policy)\b/,
];

const REPEAT_RUN = new RegExp(
	`([^\\p{L}\\s])\\1{${SMS_TRIAGE.gibberish.repeatRun - 1},}|([a-z])\\2{${SMS_TRIAGE.gibberish.repeatRun - 1},}`,
	"u",
);

const LACKING_STRIP =
	/\b(?:i|we) (?:have|got|has) (?:no|not|zero|never had)\b|\b(?:don'?t|do not|dont|doesn'?t) have (?:any |a )?(?:insurance|coverage|policy)\b|\bnot (?:covered|insured)\b|\bun(?:covered|insured)\b|\bno (?:insurance|coverage|policy)\b/g;

const EMAIL = /\S+@[\w-]+(?:\.[\w-]+)+/g;

const KEYBOARD_MASH = /qwert|asdf|zxcv|hjkl|uiop|jkjk|lkjh/;

const POSITIVE_EMOJIS = ["👍", "👌", "🙏", "✅", "😊", "🙂", "😀", "😁", "👏"];
const NEGATIVE_EMOJIS = ["👎", "🚫", "❌", "🙅", "⛔", "😡", "😠"];

function emojiVerdict(raw: string): SmsTriage | null {
	if (/[\p{L}\p{N}]/u.test(raw)) return null;
	if (NEGATIVE_EMOJIS.some((emoji) => raw.includes(emoji))) {
		return verdict("negative", "decline");
	}
	if (POSITIVE_EMOJIS.some((emoji) => raw.includes(emoji))) {
		return verdict("positive", "interest");
	}
	return null;
}

const NO_NEGATION = /\bno (?:problem|worries|rush|prob|issue|trouble|hurry)\b/g;

const FILLER =
	/^(?:hi|hello|hey|hola|yo|sup|good (?:morning|afternoon|evening))[\s,.!]*/;

function fold(text: string): string {
	return Array.from(normalizeForInjection(text))
		.map((char) => {
			const index = FOLD_FROM.indexOf(char);
			return index === -1
				? (LOOKALIKE.get(char) ?? char)
				: (FOLD_TO[index] ?? char);
		})
		.join("");
}

export function foldReply(text: string): string {
	return fold(text)
		.replace(/[*_~`^|\\]+/g, "")
		.replace(/[’‘]/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function squeeze(text: string): string {
	return text.replace(/([a-z])\1{2,}/g, "$1$1");
}

function plain(text: string): string {
	return text
		.replace(/[^\p{L}\p{N}\s'$%@.-]/gu, " ")
		.replace(/(^|\s)[.-]+|[.-]+(\s|$)/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function any(patterns: readonly RegExp[], text: string): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

function isGibberish(text: string): boolean {
	const { minChars, maxVowelShare, longWordChars } = SMS_TRIAGE.gibberish;
	if (KEYBOARD_MASH.test(text)) return true;
	const letters = Array.from(text.replace(/[^\p{L}]/gu, ""));
	if (letters.length < minChars) return false;
	const vowels = letters.filter((char) => /[aeiouyà-ÿ]/i.test(char)).length;
	if (vowels / letters.length < maxVowelShare) return true;
	const words = text.split(/\s+/).filter(Boolean);
	return words.length === 1 && letters.length >= longWordChars;
}

function verdict(label: SmsTriageLabel, rule: SmsTriageRule): SmsTriage {
	return { label, rule };
}

export function triageDetail(text: string): SmsTriage {
	const raw = text ?? "";
	if (raw.trim().length === 0) return verdict("ambiguous", "empty");
	if (Array.from(raw).length > SMS_TRIAGE.maxChars) {
		return verdict("abusive", "too-long");
	}

	const folded = foldReply(raw);
	if (detectInjection(raw) || detectInjection(folded)) {
		return verdict("abusive", "injection");
	}

	const squeezed = squeeze(folded);
	const clean = plain(squeezed);

	const emoji = emojiVerdict(raw);
	if (emoji) return emoji;
	if (REPEAT_RUN.test(folded)) return verdict("abusive", "gibberish");
	if (clean.length === 0) return verdict("ambiguous", "empty");

	if (any(PROFANITY, squeezed) || any(PROFANITY, clean)) {
		return verdict("abusive", "abusive-language");
	}
	if (any(SPAM, foldReply(raw.replace(EMAIL, " "))))
		return verdict("abusive", "spam");
	if (isGibberish(clean)) {
		return verdict("abusive", "gibberish");
	}
	if (any(LEGAL_THREAT, clean)) return verdict("abusive", "legal-threat");

	if (any(SCAM_QUESTION, clean)) return verdict("ambiguous", "unclear");
	if (any(WRONG_NUMBER, clean)) return verdict("negative", "wrong-number");
	const optOutText = clean.replace(/\bstop by\b|\bstop in\b|\bbus stop\b/g, "");
	if (any(OPT_OUT, optOutText)) return verdict("negative", "opt-out");

	const body = clean.replace(FILLER, "").trim() || clean;
	const lacking = any(LACKING, body);
	const nonNegated = body
		.replace(NO_NEGATION, " ")
		.replace(LACKING_STRIP, " lacking ")
		.replace(/\s+/g, " ")
		.trim();
	const hedged = any(HEDGE, nonNegated);
	const questionOnly = any(AMBIGUOUS_QUESTIONS, nonNegated);

	if (!lacking && any(HARD_DECLINE, nonNegated)) {
		return verdict("negative", "decline");
	}

	const soft = any(SOFT_DECLINE, nonNegated);
	const positive = any(POSITIVE, nonNegated);

	if (soft && hedged) return verdict("ambiguous", "hedged");
	if (soft && positive) return verdict("ambiguous", "unclear");
	if (soft) return verdict("negative", "decline");
	if (positive && hedged) return verdict("ambiguous", "hedged");
	if (positive) return verdict("positive", "interest");
	if (questionOnly) return verdict("ambiguous", "unclear");
	if (hedged) return verdict("ambiguous", "hedged");
	return verdict("ambiguous", "unclear");
}

export function triageReply(text: string): SmsTriageLabel {
	return triageDetail(text).label;
}

const LOUD_RULES: ReadonlySet<SmsTriageRule> = new Set([
	"opt-out",
	"wrong-number",
]);

export function triageBatch(texts: readonly string[]): SmsTriage {
	const results = texts.map(triageDetail);
	const abusive = results.find((result) => result.label === "abusive");
	if (abusive) return abusive;
	const loud = results.find((result) => LOUD_RULES.has(result.rule));
	if (loud) return loud;
	return results.at(-1) ?? verdict("ambiguous", "empty");
}
