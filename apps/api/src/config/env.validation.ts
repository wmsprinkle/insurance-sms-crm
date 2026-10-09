import { plainToInstance, Type } from "class-transformer";
import {
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	Max,
	Min,
	MinLength,
	validateSync,
} from "class-validator";

export enum NodeEnv {
	Development = "development",
	Production = "production",
	Test = "test",
}

export class EnvironmentVariables {
	@IsEnum(NodeEnv)
	NODE_ENV: NodeEnv = NodeEnv.Development;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(65535)
	PORT = 3001;

	@IsString()
	@MinLength(1, {
		message:
			"DATABASE_URL is required. `docker compose up -d` starts one, or set it to any Postgres connection string.",
	})
	DATABASE_URL!: string;

	@IsString()
	@MinLength(32, {
		message:
			"BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32",
	})
	BETTER_AUTH_SECRET!: string;

	@IsString()
	@MinLength(1, {
		message:
			'ALLOWED_SIGN_IN is required — it is the only thing deciding who can sign in. Set it to your email domain, e.g. ALLOWED_SIGN_IN="acme.com", or to a single address for a one-person install.',
	})
	ALLOWED_SIGN_IN!: string;

	@IsOptional()
	@IsString()
	GOOGLE_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	GOOGLE_CLIENT_SECRET?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_CLIENT_SECRET?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_TENANT_ID?: string;

	@IsOptional()
	@IsString()
	AUTH0_DOMAIN?: string;

	@IsOptional()
	@IsString()
	AUTH0_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	AUTH0_CLIENT_SECRET?: string;

	@IsOptional()
	@IsString()
	SLACK_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	SLACK_CLIENT_SECRET?: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	API_URL?: string;

	@IsOptional()
	@IsString()
	APP_URL?: string;

	@IsOptional()
	@IsString()
	AUTH_COOKIE_DOMAIN?: string;

	@IsOptional()
	@IsString()
	REDIS_URL?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	CACHE_TTL_MS?: number;

	@IsOptional()
	@IsString()
	@MinLength(16, {
		message: "CRON_SECRET must be at least 16 characters.",
	})
	CRON_SECRET?: string;

	@IsOptional()
	@IsString()
	BLOB_READ_WRITE_TOKEN?: string;

	@IsOptional()
	@IsUrl(
		{ require_tld: false, require_protocol: true },
		{
			message:
				"AGENT_URL must be a full URL with a scheme, like http://127.0.0.1:2000.",
		},
	)
	AGENT_URL?: string;

	@IsOptional()
	@IsString()
	AGENT_BRIDGE_SECRET?: string;

	@IsOptional()
	@IsString()
	CRM_TELEMETRY_DISABLED?: string;

	@IsOptional()
	@IsString()
	LEAD_INGEST_SECRETS?: string;

	@IsOptional()
	@IsString()
	TELNYX_API_KEY?: string;

	@IsOptional()
	@IsString()
	TELNYX_MESSAGING_PROFILE_ID?: string;

	@IsOptional()
	@IsString()
	TELNYX_FROM_NUMBER?: string;

	@IsOptional()
	@IsString()
	TELNYX_PUBLIC_KEY?: string;

	@IsOptional()
	@IsString()
	TELNYX_MPS?: string;
}

export type RawEnvironment = Record<string, string | undefined>;

const SECRET_MIN_LENGTH = 32;

const PLACEHOLDER_SECRET =
	/^(changeme|change-me|secret|password|dummy|test|example|xxx+)/i;

function isHttps(value: string | undefined): boolean {
	if (!value) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

function isLoopback(value: string): boolean {
	try {
		return LOOPBACK_HOSTS.has(new URL(value).hostname);
	} catch {
		return false;
	}
}

export function productionProblems(config: RawEnvironment): string[] {
	if (config.NODE_ENV !== "production") return [];

	const problems: string[] = [];
	const has = (key: string) => (config[key] ?? "").length > 0;

	if (
		!(has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET")) &&
		!(has("MICROSOFT_CLIENT_ID") && has("MICROSOFT_CLIENT_SECRET")) &&
		!(
			has("AUTH0_DOMAIN") &&
			has("AUTH0_CLIENT_ID") &&
			has("AUTH0_CLIENT_SECRET")
		)
	) {
		problems.push(
			"Production needs OAuth sign-in: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or the MICROSOFT pair, or the AUTH0 trio). See docs/OAUTH_SETUP.md.",
		);
	}

	if (PLACEHOLDER_SECRET.test(config.BETTER_AUTH_SECRET ?? "")) {
		problems.push("BETTER_AUTH_SECRET looks like a placeholder.");
	}

	const urls: Array<[string, string | undefined]> = [
		["API_URL", config.API_URL ?? config.BETTER_AUTH_URL],
		...(config.APP_URL ?? "")
			.split(",")
			.map((url): [string, string] => ["APP_URL", url.trim()])
			.filter(([, url]) => url.length > 0),
	];
	if (!has("API_URL") && !has("BETTER_AUTH_URL")) {
		problems.push("API_URL must be set to the public https URL of the API.");
	}
	if (!has("APP_URL")) {
		problems.push("APP_URL must be set to the public https URL of the app.");
	}
	for (const [key, url] of urls) {
		if (url && !isHttps(url)) problems.push(`${key} must be an https URL.`);
		else if (url && isLoopback(url)) {
			problems.push(`${key} must not be localhost in production.`);
		}
		if (url?.includes("*"))
			problems.push(`${key} must not contain a wildcard.`);
	}

	if (has("AGENT_URL")) {
		const secret = config.AGENT_BRIDGE_SECRET ?? "";
		if (secret.length < SECRET_MIN_LENGTH) {
			problems.push(
				`AGENT_BRIDGE_SECRET must be at least ${SECRET_MIN_LENGTH} characters when AGENT_URL is set.`,
			);
		}
	}

	return problems;
}

export function validateEnv(config: RawEnvironment): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
		exposeDefaultValues: true,
	});

	const errors = validateSync(validated, {
		skipMissingProperties: false,
		whitelist: false,
	});

	if (errors.length > 0) {
		const details = errors
			.map((error) => Object.values(error.constraints ?? {}).join(", "))
			.join("\n  - ");

		throw new Error(
			`Invalid environment configuration:\n  - ${details}\n\nSee .env.example at the root of the repo.`,
		);
	}

	const unsafe = productionProblems(config);
	if (unsafe.length > 0) {
		throw new Error(
			`Refusing to start in production:\n  - ${unsafe.join("\n  - ")}`,
		);
	}

	return validated;
}
