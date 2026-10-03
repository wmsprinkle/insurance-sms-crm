export function loggablePath(url: string): string {
	const queryAt = url.indexOf("?");
	return queryAt === -1 ? url : url.slice(0, queryAt);
}
