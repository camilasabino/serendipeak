import type { MountainImage } from '../api/contract';
import { pageRendition } from './renditions';

const PUBLIC_DOMAIN_URL = /^https:\/\/creativecommons\.org\/publicdomain\/(zero|mark)\//i;
const PUBLIC_DOMAIN_NAME = /^(cc0|pdm|public domain)\b/i;

// A link preview shows the picture without its credit, so only a photograph whose license asks
// for no attribution can stand in one. Attribution and share-alike licenses, an unknown license
// and a missing one are all excluded: the record has no field that proves anything more.
export function needsNoAttribution({ license, licenseUrl }: MountainImage): boolean {
	return (
		(licenseUrl !== undefined && PUBLIC_DOMAIN_URL.test(licenseUrl)) ||
		(license !== undefined && PUBLIC_DOMAIN_NAME.test(license.trim()))
	);
}

/** The absolute address of the photograph's page rendition when it may be used in a link preview. */
export function socialPhotographUrl(image: MountainImage | undefined): string | undefined {
	if (!image || !needsNoAttribution(image)) {
		return undefined;
	}

	try {
		const url = new URL(pageRendition(image).src);

		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
	} catch {
		return undefined;
	}
}
