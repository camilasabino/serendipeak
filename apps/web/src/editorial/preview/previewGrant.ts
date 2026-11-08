import { isValidSlug } from '../../api/schema';

export interface PreviewGrant {
	token: string;
	slug: string;
}

// The token only ever travels as a bearer credential and as a cookie value, so it is held to the
// alphabet Django's signer produces: anything else could not be ours and must not reach a header.
const TOKEN_PATTERN = /^[A-Za-z0-9_\-.:=]+$/;
export const MAX_TOKEN_LENGTH = 512;

// Mirrors the API's token lifetime for the cookie only; the API alone decides whether a token is
// still good.
export const PREVIEW_MAX_AGE_SECONDS = 900;

export function parsePreviewGrant(value: unknown): PreviewGrant | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const { token, slug } = value as Record<string, unknown>;
	if (
		typeof token !== 'string' ||
		token.length === 0 ||
		token.length > MAX_TOKEN_LENGTH ||
		!TOKEN_PATTERN.test(token) ||
		!isValidSlug(slug)
	) {
		return undefined;
	}

	return { token, slug };
}

export function parsePreviewFragment(hash: string): PreviewGrant | undefined {
	const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

	return parsePreviewGrant({ token: params.get('token'), slug: params.get('slug') });
}
