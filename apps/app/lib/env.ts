export const API_URL =
	process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const API_SERVER_URL = process.env.API_INTERNAL_URL ?? API_URL;

export function isMarketing(): boolean {
	return process.env.IS_MARKETING === "true";
}
