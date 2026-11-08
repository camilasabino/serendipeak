import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';
import { startPreviewHandler as handler } from './startPreviewHandler';

const TOKEN = 'eyJtIjoxfQ:1vHk2x:abc';

function call(request: Partial<NextApiRequest>) {
	const response = {
		setHeader: vi.fn(),
		status: vi.fn(),
		end: vi.fn(),
		setPreviewData: vi.fn()
	};
	response.status.mockReturnValue(response);
	handler(
		{ headers: { 'content-type': 'application/json' }, ...request } as NextApiRequest,
		response as unknown as NextApiResponse
	);

	return response;
}

describe('POST /api/preview', () => {
	it('keeps the grant in a cookie scoped to the one mountain page for fifteen minutes', () => {
		const response = call({ method: 'POST', body: { token: TOKEN, slug: 'draft-peak' } });

		expect(response.setPreviewData).toHaveBeenCalledExactlyOnceWith(
			{ token: TOKEN, slug: 'draft-peak' },
			{ maxAge: 900, path: '/mountains/draft-peak' }
		);
		expect(response.status).toHaveBeenCalledWith(204);
		expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
	});

	it.each(['GET', 'PUT', 'DELETE'])('refuses %s', (method) => {
		const response = call({ method, body: { token: TOKEN, slug: 'draft-peak' } });

		expect(response.status).toHaveBeenCalledWith(405);
		expect(response.setHeader).toHaveBeenCalledWith('Allow', 'POST');
		expect(response.setPreviewData).not.toHaveBeenCalled();
	});

	it.each(['application/x-www-form-urlencoded', 'text/plain', undefined])(
		'refuses the content type %s, which a cross-site form could send',
		(contentType) => {
			const response = call({
				method: 'POST',
				headers: contentType ? { 'content-type': contentType } : {},
				body: { token: TOKEN, slug: 'draft-peak' }
			});

			expect(response.status).toHaveBeenCalledWith(415);
			expect(response.setPreviewData).not.toHaveBeenCalled();
		}
	);

	it.each([
		['no body', undefined],
		['a bad slug', { token: TOKEN, slug: '../x' }],
		['a bad token', { token: 'a b', slug: 'draft-peak' }]
	])('refuses %s', (_name, body) => {
		const response = call({ method: 'POST', body });

		expect(response.status).toHaveBeenCalledWith(400);
		expect(response.setPreviewData).not.toHaveBeenCalled();
	});
});
