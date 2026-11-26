import type { ReactElement } from 'react';
import { SITE_NAME } from '../mountain-page/pageCopy';

export function websiteJsonLd(origin: string): string {
	const data = {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: SITE_NAME,
		url: `${origin}/`
	};

	// "<" is escaped so no value can close the script element early.
	return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function websiteStructuredData(origin: string | null): ReactElement | null {
	if (origin === null) {
		return null;
	}

	return (
		<script
			key="website-jsonld"
			type="application/ld+json"
			dangerouslySetInnerHTML={{ __html: websiteJsonLd(origin) }}
		/>
	);
}
