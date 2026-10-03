import { SMS_AGENT } from "./sms-config";

export function withBrand(text: string, brand: string): string {
	const name = brand.trim();
	if (!name || text.toLowerCase().includes(name.toLowerCase())) return text;
	return `${name}${SMS_AGENT.identify.separator}${text}`;
}
