export type SiteEnv = {
	SITE_ORIGIN?: string;
};

/**
 * The public origin the site is served from, for absolute URLs such as a canonical link. It is
 * read on the server at request time, so changing it needs no new build. Unset means no absolute
 * URL is published; a malformed value is reported and treated as unset, because a wrong canonical
 * is worse for a page than none.
 */
export function readSiteOrigin(
	env: SiteEnv,
	warn: (message: string) => void = console.warn
): string | undefined {
	const value = env.SITE_ORIGIN?.trim();
	if (!value) {
		return undefined;
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		warn(`SITE_ORIGIN is not a valid URL: "${value}". No canonical URL is published.`);
		return undefined;
	}
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.origin !== value.replace(/\/$/, '')
	) {
		warn(
			`SITE_ORIGIN must be a bare http or https origin: "${value}". No canonical URL is published.`
		);
		return undefined;
	}

	return url.origin;
}

export function canonicalUrl(path: string, env: SiteEnv): string | null {
	const origin = readSiteOrigin(env);

	return origin === undefined ? null : `${origin}${path}`;
}
