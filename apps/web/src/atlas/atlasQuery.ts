import type { ParsedUrlQuery } from 'node:querystring';
import { mountainHref } from '../explore/navigate';

export const ATLAS_PATH = '/atlas';

// An earlier atlas selected a mountain in place with this parameter; such links now lead to the
// mountain's own page.
const LEGACY_SELECTION_PARAM = 'mountain';

/** The slug a legacy atlas link selects, as written; whether it exists is for the caller to decide. */
export function legacySelection(query: ParsedUrlQuery): string | undefined {
	const raw = query[LEGACY_SELECTION_PARAM];
	const value = Array.isArray(raw) ? raw[0] : raw;

	return value === undefined || value === '' ? undefined : value;
}

/**
 * Where a legacy atlas link leads: the page of a mountain the atlas holds, or the bare atlas for a
 * slug it does not hold. Undefined for a URL that needs no redirect, or while the catalog is
 * unknown and the slug cannot be told apart. Callers redirect temporarily: these links came from
 * an experience that was never published, so a browser has no reason to remember the answer, and
 * a slug the atlas lacks today may exist tomorrow.
 */
export function legacyRedirect(
	query: ParsedUrlQuery,
	mountains: readonly { slug: string }[] | undefined
): string | undefined {
	const slug = legacySelection(query);
	if (slug === undefined || mountains === undefined) {
		return undefined;
	}

	return mountains.some((mountain) => mountain.slug === slug) ? mountainHref(slug) : ATLAS_PATH;
}
