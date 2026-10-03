import { devLoginFromEnvironment } from "@crm/auth/dev-login";
import { loadRootEnv } from "@crm/env";
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

loadRootEnv();

devLoginFromEnvironment(process.env);

const apiUrl =
	process.env.API_URL ??
	process.env.NEXT_PUBLIC_API_URL ??
	"http://localhost:3001";

const allowedDevOrigins = (process.env.APP_URL ?? "")
	.split(",")
	.flatMap((origin) => {
		try {
			return [new URL(origin.trim()).hostname];
		} catch {
			return [];
		}
	});

const nextConfig: NextConfig = {
	allowedDevOrigins,

	env: {
		NEXT_PUBLIC_API_URL: apiUrl,
	},

	headers: async () => securityHeaders(process.env.NODE_ENV === "production"),

	transpilePackages: ["@crm/auth", "@crm/db", "@crm/telemetry", "@crm/ui"],

	serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

	images: {
		formats: ["image/webp"],
		remotePatterns: [
			{ protocol: "https", hostname: "**.blob.vercel-storage.com" },
		],
	},

	cacheComponents: true,
	partialPrefetching: true,
};

export default nextConfig;
