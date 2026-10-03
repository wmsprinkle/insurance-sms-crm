export type HeaderRule = {
	source: string;
	headers: Array<{ key: string; value: string }>;
};

const TRACKING_PATH = "/t/:path*";

const DOCUMENT_POLICY = [
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"object-src 'none'",
	"form-action 'self'",
].join("; ");

const PERMISSIONS_POLICY = [
	"camera=()",
	"microphone=()",
	"geolocation=()",
	"payment=()",
	"usb=()",
].join(", ");

export function securityHeaders(production: boolean): HeaderRule[] {
	const common = [
		{ key: "X-Content-Type-Options", value: "nosniff" },
		{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
		{ key: "Permissions-Policy", value: PERMISSIONS_POLICY },
		...(production
			? [
					{
						key: "Strict-Transport-Security",
						value: "max-age=63072000; includeSubDomains",
					},
				]
			: []),
	];

	return [
		{
			source: "/((?!t/).*)",
			headers: [
				...common,
				{ key: "X-Frame-Options", value: "DENY" },
				{ key: "Content-Security-Policy", value: DOCUMENT_POLICY },
			],
		},
		{ source: TRACKING_PATH, headers: common },
	];
}
