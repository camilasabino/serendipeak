// Cooperative crawlers only: robots.txt is advisory and hides nothing. Drafts stay private through
// the preview token, and the editorial pages through their own noindex and no-store headers.
// `/_next/` and the public media are deliberately not listed, so a crawler can still render pages.
export const DISALLOWED_PATHS = ['/api/', '/editorial/', '/preview'] as const;

export function buildRobotsTxt(origin: string | undefined): string {
	const lines = [
		'User-agent: *',
		'Allow: /',
		...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`)
	];
	if (origin !== undefined) {
		lines.push('', `Sitemap: ${origin}/sitemap.xml`);
	}

	return `${lines.join('\n')}\n`;
}
