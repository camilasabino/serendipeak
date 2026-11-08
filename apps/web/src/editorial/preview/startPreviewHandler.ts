import type { NextApiRequest, NextApiResponse } from 'next';
import { parsePreviewGrant, PREVIEW_MAX_AGE_SECONDS } from './previewGrant';

// Only the shape is checked here. The mountain API is the judge of the token; this route just
// remembers it for the next request to the mountain's own page.
export function startPreviewHandler(request: NextApiRequest, response: NextApiResponse) {
	response.setHeader('Cache-Control', 'no-store');
	if (request.method !== 'POST') {
		response.setHeader('Allow', 'POST');
		response.status(405).end();
		return;
	}
	// A cross-site form cannot send JSON without a preflight this route does not answer.
	if (!request.headers['content-type']?.startsWith('application/json')) {
		response.status(415).end();
		return;
	}

	const grant = parsePreviewGrant(request.body);
	if (!grant) {
		response.status(400).end();
		return;
	}

	// Scoped to the one mountain page, so the cookie is not sent anywhere else on the site.
	response.setPreviewData(grant, {
		maxAge: PREVIEW_MAX_AGE_SECONDS,
		path: `/mountains/${grant.slug}`
	});
	response.status(204).end();
}
